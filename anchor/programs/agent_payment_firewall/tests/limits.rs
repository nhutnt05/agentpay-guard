//! F-03 rolling-window and per-merchant limits (docs/16 §2): RL-* and ML-*.

#![allow(clippy::result_large_err)]

mod common;

use {
    agent_payment_firewall::{
        errors::AgentPayError,
        state::{MerchantLimit, SpendingRules},
        SECONDS_PER_DAY,
    },
    anchor_lang::{
        error::ErrorCode as AnchorErrorCode, prelude::Pubkey,
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    common::*,
    litesvm::types::TransactionResult,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn set_rules_ix(owner: &Pubkey, policy: &Pubkey, rolling_limit: u64) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::SetSpendingRules { rolling_limit }.data(),
        agent_payment_firewall::accounts::SetSpendingRules {
            owner: *owner,
            policy: *policy,
            spending_rules: rules_pda(policy).0,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn close_rules_ix(owner: &Pubkey, policy: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::CloseSpendingRules {}.data(),
        agent_payment_firewall::accounts::CloseSpendingRules {
            owner: *owner,
            policy: *policy,
            spending_rules: rules_pda(policy).0,
        }
        .to_account_metas(None),
    )
}

fn set_merchant_limit_ix(
    owner: &Pubkey,
    policy: &Pubkey,
    merchant: &Pubkey,
    max_per_tx: u64,
    daily_limit: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::SetMerchantLimit {
            max_per_tx,
            daily_limit,
        }
        .data(),
        agent_payment_firewall::accounts::SetMerchantLimit {
            owner: *owner,
            policy: *policy,
            merchant: *merchant,
            merchant_allowlist: merchant_pda(policy, merchant).0,
            merchant_limit: merchant_limit_pda(policy, merchant).0,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn close_merchant_limit_ix(owner: &Pubkey, policy: &Pubkey, merchant: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::CloseMerchantLimit {}.data(),
        agent_payment_firewall::accounts::CloseMerchantLimit {
            owner: *owner,
            policy: *policy,
            merchant: *merchant,
            merchant_limit: merchant_limit_pda(policy, merchant).0,
        }
        .to_account_metas(None),
    )
}

fn owner_send(env: &mut PaymentEnv, ix: Instruction) -> TransactionResult {
    let owner = env.owner.insecure_clone();
    send(&mut env.svm, &[ix], &owner, &[])
}

fn rules(env: &PaymentEnv) -> SpendingRules {
    let acc = env.svm.get_account(&rules_pda(&env.policy).0).unwrap();
    SpendingRules::try_deserialize(&mut &acc.data[..]).unwrap()
}

fn merchant_limit(env: &PaymentEnv) -> MerchantLimit {
    let acc = env
        .svm
        .get_account(&merchant_limit_pda(&env.policy, &env.merchant).0)
        .unwrap();
    MerchantLimit::try_deserialize(&mut &acc.data[..]).unwrap()
}

/// Start of the UTC day after TEST_NOW.
const MIDNIGHT: i64 = (TEST_NOW / SECONDS_PER_DAY + 1) * SECONDS_PER_DAY;

/// RL-01: without a rules account payments behave exactly as before.
#[test]
fn rl01_no_rules_unchanged() {
    let mut env = payment_env();
    assert!(!account_exists(&env.svm, &rules_pda(&env.policy).0));
    env.pay(&env.request(10 * ONE)).expect("payment");
}

/// RL-02/03: spending the rolling limit just before UTC midnight blocks payments just after
/// midnight (the calendar daily limit would allow them); 24 h later they work again.
#[test]
fn rl02_rolling_limit_spans_utc_midnight() {
    let mut env = payment_env();
    let (owner, policy) = (env.owner.pubkey(), env.policy);
    owner_send(&mut env, set_rules_ix(&owner, &policy, 10 * ONE)).expect("set rules");

    set_time(&mut env.svm, MIDNIGHT - 1_800);
    env.pay(&env.request_expiring(10 * ONE, MIDNIGHT - 1_500))
        .expect("23:30 payment");

    set_time(&mut env.svm, MIDNIGHT + 600);
    let buckets_before = rules(&env).buckets;
    let before = snapshot(&env);
    let req = env.request_expiring(ONE, MIDNIGHT + 900);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsRollingLimit),
    );
    assert_eq!(rules(&env).buckets, buckets_before, "rules unchanged");

    set_time(&mut env.svm, MIDNIGHT - 1_800 + 24 * 3_600);
    env.pay(&env.request_expiring(10 * ONE, MIDNIGHT - 1_500 + 24 * 3_600))
        .expect("24 h later the window has rotated");
}

/// RL-06: lamports sent to the rules address by anyone do not switch rules on, and do not
/// stop the owner from creating them later.
#[test]
fn rl06_prefunded_rules_address_is_harmless() {
    let mut env = payment_env();
    let rules_address = rules_pda(&env.policy).0;
    env.svm.airdrop(&rules_address, 5_000_000).unwrap();
    env.pay(&env.request(2 * ONE))
        .expect("system-owned address = no rules");

    let (owner, policy) = (env.owner.pubkey(), env.policy);
    owner_send(&mut env, set_rules_ix(&owner, &policy, 12 * ONE))
        .expect("owner can still set rules");
    assert_eq!(rules(&env).rolling_limit, 12 * ONE);
    // New rules start with an empty window: 10 fits, then 10 + 3 > 12.
    env.pay(&env.request(10 * ONE))
        .expect("within new rolling limit");
    let before = snapshot(&env);
    let req = env.request(3 * ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsRollingLimit),
    );
}

/// RL-07: the agent cannot swap in another account (e.g. another policy's rules) for the
/// rules slot — the address is seed-checked.
#[test]
fn rl07_rules_account_substitution_rejected() {
    let mut env = payment_env();
    let (owner, policy) = (env.owner.pubkey(), env.policy);
    owner_send(&mut env, set_rules_ix(&owner, &policy, ONE)).expect("set rules");
    let before = snapshot(&env);
    let req = env.request(2 * ONE);
    let mut ix = execute_payment_ix(&env.accounts(&req), &req);
    // Account order: agent, policy, merchant, merchant_allowlist, spending_rules, ...
    ix.accounts[4].pubkey = Pubkey::new_unique();
    let agent = env.agent.insecure_clone();
    let res = send(&mut env.svm, &[ix], &agent, &[]);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        framework(AnchorErrorCode::ConstraintSeeds),
    );
}

/// RL-08: only the owner manages rules; closing them removes the rolling limit.
#[test]
fn rl08_owner_only_and_close() {
    let mut env = payment_env();
    let policy = env.policy;
    let agent = env.agent.insecure_clone();
    assert_error_code(
        send(
            &mut env.svm,
            &[set_rules_ix(&agent.pubkey(), &policy, ONE)],
            &agent,
            &[],
        ),
        custom(AgentPayError::UnauthorizedOwner),
    );
    let owner = env.owner.pubkey();
    owner_send(&mut env, set_rules_ix(&owner, &policy, ONE)).expect("set");
    assert!(env.pay(&env.request(2 * ONE)).is_err());
    owner_send(&mut env, close_rules_ix(&owner, &policy)).expect("close");
    assert!(!account_exists(&env.svm, &rules_pda(&policy).0));
    env.pay(&env.request(2 * ONE))
        .expect("no rolling limit after close");
}

/// RL-09: updating the limit keeps the spend already in the window.
#[test]
fn rl09_update_keeps_window() {
    let mut env = payment_env();
    let (owner, policy) = (env.owner.pubkey(), env.policy);
    owner_send(&mut env, set_rules_ix(&owner, &policy, 10 * ONE)).expect("set");
    env.pay(&env.request(8 * ONE)).expect("pay 8");
    owner_send(&mut env, set_rules_ix(&owner, &policy, 9 * ONE)).expect("lower to 9");
    assert_eq!(rules(&env).buckets.iter().sum::<u64>(), 8 * ONE);
    assert!(env.pay(&env.request(2 * ONE)).is_err(), "8 + 2 > 9");
    env.pay(&env.request(ONE)).expect("8 + 1 = 9");
}

/// ML-01: per-merchant max per transaction.
#[test]
fn ml01_merchant_max_per_tx() {
    let mut env = payment_env();
    let (owner, policy, merchant) = (env.owner.pubkey(), env.policy, env.merchant);
    owner_send(
        &mut env,
        set_merchant_limit_ix(&owner, &policy, &merchant, 2 * ONE, 5 * ONE),
    )
    .expect("set merchant limit");
    let before = snapshot(&env);
    let req = env.request(3 * ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsMerchantMaxPerTx),
    );
    env.pay(&env.request(2 * ONE)).expect("within merchant max");
}

/// ML-02/03: per-merchant daily limit with lazy UTC-day reset.
#[test]
fn ml02_merchant_daily_limit_and_reset() {
    let mut env = payment_env();
    let (owner, policy, merchant) = (env.owner.pubkey(), env.policy, env.merchant);
    owner_send(
        &mut env,
        set_merchant_limit_ix(&owner, &policy, &merchant, 3 * ONE, 5 * ONE),
    )
    .expect("set merchant limit");
    env.pay(&env.request(3 * ONE)).expect("3 of 5");
    let before = snapshot(&env);
    let req = env.request(3 * ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsMerchantDailyLimit),
    );
    assert_eq!(merchant_limit(&env).spent_today, 3 * ONE);

    set_time(&mut env.svm, MIDNIGHT + 60);
    env.pay(&env.request_expiring(3 * ONE, MIDNIGHT + 360))
        .expect("next UTC day");
    assert_eq!(merchant_limit(&env).spent_today, 3 * ONE);
}

/// ML-04: limits can only be set for an allowlisted merchant; non-owner cannot set them.
#[test]
fn ml04_limit_requires_allowlisted_merchant_and_owner() {
    let mut env = payment_env();
    let (owner, policy) = (env.owner.pubkey(), env.policy);
    let stranger_merchant = Pubkey::new_unique();
    assert_error_code(
        owner_send(
            &mut env,
            set_merchant_limit_ix(&owner, &policy, &stranger_merchant, ONE, ONE),
        ),
        framework(AnchorErrorCode::AccountNotInitialized),
    );
    let agent = env.agent.insecure_clone();
    let merchant = env.merchant;
    assert_error_code(
        send(
            &mut env.svm,
            &[set_merchant_limit_ix(
                &agent.pubkey(),
                &policy,
                &merchant,
                ONE,
                ONE,
            )],
            &agent,
            &[],
        ),
        custom(AgentPayError::UnauthorizedOwner),
    );
    assert_error_code(
        owner_send(
            &mut env,
            set_merchant_limit_ix(&owner, &policy, &merchant, 2 * ONE, ONE),
        ),
        custom(AgentPayError::InvalidPolicyLimits),
    );
}

/// ML-05: a merchant-limit rejection rolls back everything, including the rolling buckets
/// that the same payment had already passed.
#[test]
fn ml05_rejection_is_atomic_across_rules() {
    let mut env = payment_env();
    let (owner, policy, merchant) = (env.owner.pubkey(), env.policy, env.merchant);
    owner_send(&mut env, set_rules_ix(&owner, &policy, 50 * ONE)).expect("rules");
    owner_send(
        &mut env,
        set_merchant_limit_ix(&owner, &policy, &merchant, ONE, ONE),
    )
    .expect("merchant limit");
    let buckets_before = rules(&env).buckets;
    let limit_before = merchant_limit(&env).spent_today;
    let before = snapshot(&env);
    let req = env.request(2 * ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsMerchantMaxPerTx),
    );
    assert_eq!(rules(&env).buckets, buckets_before);
    assert_eq!(merchant_limit(&env).spent_today, limit_before);
}

/// ML-06: closing the merchant limit removes it; payments are bounded by the policy again.
#[test]
fn ml06_close_merchant_limit() {
    let mut env = payment_env();
    let (owner, policy, merchant) = (env.owner.pubkey(), env.policy, env.merchant);
    owner_send(
        &mut env,
        set_merchant_limit_ix(&owner, &policy, &merchant, ONE, ONE),
    )
    .expect("set");
    assert!(env.pay(&env.request(2 * ONE)).is_err());
    let owner_before = lamports(&env.svm, &owner);
    owner_send(
        &mut env,
        close_merchant_limit_ix(&owner, &policy, &merchant),
    )
    .expect("close");
    assert!(
        lamports(&env.svm, &owner) > owner_before - 10_000,
        "rent refunded to owner"
    );
    env.pay(&env.request(2 * ONE)).expect("policy limits only");
}

/// Keeps the Keypair import used (fee payer path with rules present).
#[test]
fn rl10_rules_with_separate_fee_payer() {
    let mut env = payment_env();
    let (owner, policy) = (env.owner.pubkey(), env.policy);
    owner_send(&mut env, set_rules_ix(&owner, &policy, 5 * ONE)).expect("rules");
    let req = env.request(5 * ONE);
    let ix = execute_payment_ix(&env.accounts(&req), &req);
    let fee_payer: Keypair = funded_keypair(&mut env.svm);
    let agent = env.agent.insecure_clone();
    send(&mut env.svm, &[ix], &fee_payer, &[&agent]).expect("payment with fee payer");
    assert_eq!(rules(&env).buckets.iter().sum::<u64>(), 5 * ONE);
}
