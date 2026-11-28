//! execute_payment integration tests (docs/10 §4).
//! T-M2-04: EP-01 (happy path with full state assertions).
//! T-M2-05: negative cases EP-02…EP-13, EP-20, EP-21, RM-03. EP-23: agent cannot pay itself (T-29). Each asserts the specific
//! error AND that no state changed (balances, counter, receipt).

mod common;

use {
    agent_payment_firewall::{errors::AgentPayError, utils::day_index},
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    common::*,
    solana_signer::Signer,
};

/// EP-23 (T-29): the owner rotates the agent to a wallet that is already an allowlisted
/// merchant; the new agent must not be able to pay itself. Nothing moves.
#[test]
fn ep23_agent_rotated_to_allowlisted_merchant_cannot_pay_itself() {
    let mut env = payment_env();
    let merchant_kp = funded_keypair(&mut env.svm);
    let merchant = merchant_kp.pubkey();
    let owner = env.owner.insecure_clone();
    send(
        &mut env.svm,
        &[add_merchant_ix(&owner.pubkey(), &env.policy, &merchant)],
        &owner,
        &[],
    )
    .expect("add merchant");
    let merchant_ata = create_ata(&mut env.svm, &owner, &merchant, &env.mint);
    send(
        &mut env.svm,
        &[update_policy_ix(&owner.pubkey(), &env.policy, None, None, Some(merchant))],
        &owner,
        &[],
    )
    .expect("rotate agent to the merchant wallet");

    // Pay as the new agent (== merchant) to itself.
    env.agent = merchant_kp;
    env.merchant = merchant;
    env.merchant_ata = merchant_ata;
    let before = snapshot(&env);
    let req = env.request(ONE);
    let res = env.pay(&req);
    assert_rejected(&env, &before, &req, res, custom(AgentPayError::InvalidMerchant));
}

/// EP-01: authorized agent pays an allowlisted merchant.
/// Asserts balances, policy counter, receipt contents/size, rent payer and event.
#[test]
fn ep01_valid_payment_succeeds() {
    let mut env = payment_env();
    let amount = 5 * ONE;
    let req = env.request(amount);
    let (receipt, receipt_bump) = receipt_pda(&env.policy, &req.request_hash);

    let policy_before = fetch_policy(&env.svm, &env.policy);
    let agent_lamports_before = lamports(&env.svm, &env.agent.pubkey());
    assert!(!account_exists(&env.svm, &receipt));

    let meta = env
        .pay(&req)
        .unwrap_or_else(|e| panic!("payment failed: {:?}\n{:#?}", e.err, e.meta.logs));

    // Token balances moved exactly `amount`.
    assert_eq!(token_balance(&env.svm, &env.vault), VAULT_FUNDING - amount);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), amount);

    // Policy: only the spending counter changed.
    let policy = fetch_policy(&env.svm, &env.policy);
    assert_eq!(policy.spent_today, amount);
    assert_eq!(policy.day_index, day_index(TEST_NOW));
    assert_eq!(policy.agent, policy_before.agent);
    assert_eq!(policy.max_per_tx, policy_before.max_per_tx);
    assert_eq!(policy.daily_limit, policy_before.daily_limit);
    assert!(!policy.is_paused);

    // Receipt: created atomically with the transfer, every field correct, 185 bytes.
    let r = fetch_receipt(&env.svm, &receipt);
    assert_eq!(r.policy, env.policy);
    assert_eq!(r.request_hash, req.request_hash);
    assert_eq!(r.agent, env.agent.pubkey());
    assert_eq!(r.merchant, env.merchant);
    assert_eq!(r.amount, amount);
    assert_eq!(r.mint, env.mint);
    assert_eq!(r.created_at, TEST_NOW);
    assert_eq!(r.bump, receipt_bump);
    let receipt_rent = lamports(&env.svm, &receipt);
    assert_eq!(env.svm.get_account(&receipt).unwrap().data.len(), 185);

    // The agent paid the receipt rent and the transaction fee.
    assert_eq!(
        lamports(&env.svm, &env.agent.pubkey()),
        agent_lamports_before - receipt_rent - meta.fee
    );

    // Event mirrors the state change.
    let ev = find_payment_event(&meta.logs).expect("PaymentExecuted event emitted");
    assert_eq!(ev.policy, env.policy);
    assert_eq!(ev.receipt, receipt);
    assert_eq!(ev.request_hash, req.request_hash);
    assert_eq!(ev.agent, env.agent.pubkey());
    assert_eq!(ev.merchant, env.merchant);
    assert_eq!(ev.mint, env.mint);
    assert_eq!(ev.amount, amount);
    assert_eq!(ev.spent_today, amount);
    assert_eq!(ev.day_index, day_index(TEST_NOW));
    assert_eq!(ev.timestamp, TEST_NOW);
}

/// EP-01b: two different requests on the same day accumulate the daily counter.
#[test]
fn ep01b_payments_accumulate_daily_counter() {
    let mut env = payment_env();
    let first = env.request(3 * ONE);
    let second = env.request(4 * ONE);
    env.pay(&first).expect("first payment");
    env.pay(&second).expect("second payment");

    assert_eq!(fetch_policy(&env.svm, &env.policy).spent_today, 7 * ONE);
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), 7 * ONE);
    assert_eq!(token_balance(&env.svm, &env.vault), VAULT_FUNDING - 7 * ONE);
    assert!(account_exists(
        &env.svm,
        &receipt_pda(&env.policy, &first.request_hash).0
    ));
    assert!(account_exists(
        &env.svm,
        &receipt_pda(&env.policy, &second.request_hash).0
    ));
}

/// EP-02: a key that is not `policy.agent` cannot pay, even with a hash valid for itself.
#[test]
fn ep02_unauthorized_agent_rejected() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let impostor = funded_keypair(&mut env.svm);
    let req = payment_request(
        &env.policy,
        &impostor.pubkey(),
        &env.merchant,
        &env.mint,
        ONE,
    );
    let mut accounts = env.accounts(&req);
    accounts.agent = impostor.pubkey();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &impostor,
        &[],
    );
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::UnauthorizedAgent),
    );
}

/// EP-02b: the owner is not the agent and cannot pay through `execute_payment` either.
#[test]
fn ep02b_owner_cannot_act_as_agent() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let owner = env.owner.insecure_clone();
    let req = payment_request(&env.policy, &owner.pubkey(), &env.merchant, &env.mint, ONE);
    let mut accounts = env.accounts(&req);
    accounts.agent = owner.pubkey();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &owner,
        &[],
    );
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::UnauthorizedAgent),
    );
}

/// EP-03: merchant never allowlisted (its ATA exists, so the allowlist is the only failing rule).
/// Verifies the demo assumption in docs/05 §4: the error is `AccountNotInitialized`
/// on `merchant_allowlist`, and the log names that account.
#[test]
fn ep03_unallowlisted_merchant_rejected() {
    let mut env = payment_env();
    let attacker = Pubkey::new_unique();
    let owner = env.owner.insecure_clone();
    create_ata(&mut env.svm, &owner, &attacker, &env.mint);
    let before = snapshot(&env);
    let req = payment_request(&env.policy, &env.agent.pubkey(), &attacker, &env.mint, ONE);
    let accounts = payment_accounts(
        &env.agent.pubkey(),
        &env.policy,
        &attacker,
        &env.mint,
        &req.request_hash,
    );
    let agent = env.agent.insecure_clone();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    );
    if let Err(e) = &res {
        // `SHOW_EP03_LOGS=1 cargo test ... -- --nocapture` prints the exact rejection logs
        // the backend parses (docs/11 §7).
        if std::env::var("SHOW_EP03_LOGS").is_ok() {
            eprintln!("EP-03 logs: {:#?}", e.meta.logs);
        }
        assert!(
            e.meta.logs.iter().any(|l| l.contains("merchant_allowlist")),
            "log should name the merchant_allowlist account: {:#?}",
            e.meta.logs
        );
    }
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        framework(AnchorErrorCode::AccountNotInitialized),
    );
}

/// EP-03b: same, but the attacker has no token account at all. Still rejected on the
/// allowlist (it precedes the token accounts), not on the missing ATA.
#[test]
fn ep03b_unallowlisted_merchant_without_ata_rejected_on_allowlist() {
    let mut env = payment_env();
    let attacker = Pubkey::new_unique();
    let before = snapshot(&env);
    let req = payment_request(&env.policy, &env.agent.pubkey(), &attacker, &env.mint, ONE);
    let accounts = payment_accounts(
        &env.agent.pubkey(),
        &env.policy,
        &attacker,
        &env.mint,
        &req.request_hash,
    );
    let agent = env.agent.insecure_clone();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    );
    if let Err(e) = &res {
        assert!(
            e.meta.logs.iter().any(|l| l.contains("merchant_allowlist")),
            "{:#?}",
            e.meta.logs
        );
    }
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        framework(AnchorErrorCode::AccountNotInitialized),
    );
}

/// EP-04: an allowlist entry of ANOTHER policy cannot be reused.
#[test]
fn ep04_allowlist_entry_of_other_policy_rejected() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let other_id = random_policy_id();
    let (other_policy, _) = policy_pda(&owner.pubkey(), &other_id);
    let init = initialize_policy_ix(
        &owner.pubkey(),
        &env.mint,
        other_id,
        env.agent.pubkey(),
        DEFAULT_MAX_PER_TX,
        DEFAULT_DAILY_LIMIT,
    );
    send(&mut env.svm, &[init], &owner, &[]).expect("second policy");
    let outsider = Pubkey::new_unique();
    create_ata(&mut env.svm, &owner, &outsider, &env.mint);
    send(
        &mut env.svm,
        &[add_merchant_ix(&owner.pubkey(), &other_policy, &outsider)],
        &owner,
        &[],
    )
    .expect("allowlist in other policy");

    let before = snapshot(&env);
    let req = payment_request(&env.policy, &env.agent.pubkey(), &outsider, &env.mint, ONE);
    let mut accounts = payment_accounts(
        &env.agent.pubkey(),
        &env.policy,
        &outsider,
        &env.mint,
        &req.request_hash,
    );
    accounts.merchant_allowlist = merchant_pda(&other_policy, &outsider).0;
    let agent = env.agent.insecure_clone();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    );
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        framework(AnchorErrorCode::ConstraintSeeds),
    );
}

/// EP-05: amount above `max_per_tx`.
#[test]
fn ep05_exceeds_max_per_tx() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let req = env.request(DEFAULT_MAX_PER_TX + 1);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsMaxPerTx),
    );
}

/// EP-06: cumulative spending above `daily_limit` (10 + 10 = 20 ok, then +1 fails).
#[test]
fn ep06_exceeds_daily_limit() {
    let mut env = payment_env();
    let first = env.request(DEFAULT_MAX_PER_TX);
    env.pay(&first).expect("first");
    let second = env.request(DEFAULT_MAX_PER_TX);
    env.pay(&second).expect("second");
    let before = snapshot(&env);
    assert_eq!(before.spent_today, DEFAULT_DAILY_LIMIT);
    let req = env.request(1);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsDailyLimit),
    );
}

/// EP-07: paying exactly the remaining daily budget succeeds (boundary).
#[test]
fn ep07_exact_remaining_daily_budget_succeeds() {
    let mut env = payment_env();
    let first = env.request(DEFAULT_MAX_PER_TX);
    env.pay(&first).expect("first");
    let remaining = env.request(DEFAULT_DAILY_LIMIT - DEFAULT_MAX_PER_TX);
    env.pay(&remaining).expect("exact remaining must succeed");
    assert_eq!(
        fetch_policy(&env.svm, &env.policy).spent_today,
        DEFAULT_DAILY_LIMIT
    );
}

/// EP-08: paused policy (paused by the owner via `pause_policy`).
#[test]
fn ep08_paused_policy_rejected() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let ix = pause_policy_ix(&owner.pubkey(), &env.policy);
    send(&mut env.svm, &[ix], &owner, &[]).expect("owner pauses");
    assert!(fetch_policy(&env.svm, &env.policy).is_paused);
    let before = snapshot(&env);
    let req = env.request(ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::PolicyPaused),
    );
}

/// EP-09: a different mint (with a matching merchant ATA and a hash over that mint).
#[test]
fn ep09_wrong_mint_rejected() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let merchant = env.merchant;
    let other_mint = create_mint(&mut env.svm, &owner, &owner.pubkey());
    let other_ata = create_ata(&mut env.svm, &owner, &merchant, &other_mint);
    let before = snapshot(&env);
    let req = payment_request(
        &env.policy,
        &env.agent.pubkey(),
        &merchant,
        &other_mint,
        ONE,
    );
    let mut accounts = env.accounts(&req);
    accounts.mint = other_mint;
    accounts.merchant_token_account = other_ata;
    let agent = env.agent.insecure_clone();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    );
    assert_rejected(&env, &before, &req, res, custom(AgentPayError::InvalidMint));
}

/// EP-10: Token-2022 program id in the `token_program` slot for a classic mint
/// (F-05: rejected by the mint-owner constraint, `InvalidTokenProgram`).
#[test]
fn ep10_wrong_token_program_rejected() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let req = env.request(ONE);
    let mut accounts = env.accounts(&req);
    accounts.token_program = TOKEN_2022_PROGRAM_ID;
    let agent = env.agent.insecure_clone();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    );
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::InvalidTokenProgram),
    );
}

/// EP-11: vault substitution: (a) another token account owned by the policy PDA,
/// (b) an attacker-owned token account. Both fail `has_one = vault`.
#[test]
fn ep11_wrong_vault_rejected() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let policy = env.policy;
    let mint = env.mint;
    let pda_owned = create_plain_token_account(&mut env.svm, &owner, &policy, &mint);
    mint_to(&mut env.svm, &owner, &mint, &pda_owned, &owner, 50 * ONE);
    let attacker = Pubkey::new_unique();
    let attacker_ata = create_ata(&mut env.svm, &owner, &attacker, &mint);
    mint_to(&mut env.svm, &owner, &mint, &attacker_ata, &owner, 50 * ONE);

    for fake_vault in [pda_owned, attacker_ata] {
        let before = snapshot(&env);
        let fake_before = token_balance(&env.svm, &fake_vault);
        let req = env.request(ONE);
        let mut accounts = env.accounts(&req);
        accounts.vault = fake_vault;
        let agent = env.agent.insecure_clone();
        let res = send(
            &mut env.svm,
            &[execute_payment_ix(&accounts, &req)],
            &agent,
            &[],
        );
        assert_rejected(
            &env,
            &before,
            &req,
            res,
            custom(AgentPayError::InvalidVault),
        );
        assert_eq!(token_balance(&env.svm, &fake_vault), fake_before);
    }
}

/// EP-12: merchant token account owned by someone else (e.g., attacker's ATA).
#[test]
fn ep12_merchant_token_account_wrong_owner_rejected() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let attacker = Pubkey::new_unique();
    let mint = env.mint;
    let attacker_ata = create_ata(&mut env.svm, &owner, &attacker, &mint);
    let before = snapshot(&env);
    let req = env.request(ONE);
    let mut accounts = env.accounts(&req);
    accounts.merchant_token_account = attacker_ata;
    let agent = env.agent.insecure_clone();
    let res = send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    );
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::InvalidMerchantTokenAccount),
    );
    assert_eq!(token_balance(&env.svm, &attacker_ata), 0);
}

/// EP-13: merchant-owned token account that is (a) not the ATA, (b) of another mint.
#[test]
fn ep13_merchant_token_account_not_ata_or_wrong_mint_rejected() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let merchant = env.merchant;
    let mint = env.mint;
    let non_ata = create_plain_token_account(&mut env.svm, &owner, &merchant, &mint);
    let other_mint = create_mint(&mut env.svm, &owner, &owner.pubkey());
    let other_mint_ata = create_ata(&mut env.svm, &owner, &merchant, &other_mint);

    for bad in [non_ata, other_mint_ata] {
        let before = snapshot(&env);
        let req = env.request(ONE);
        let mut accounts = env.accounts(&req);
        accounts.merchant_token_account = bad;
        let agent = env.agent.insecure_clone();
        let res = send(
            &mut env.svm,
            &[execute_payment_ix(&accounts, &req)],
            &agent,
            &[],
        );
        assert_rejected(
            &env,
            &before,
            &req,
            res,
            custom(AgentPayError::InvalidMerchantTokenAccount),
        );
    }
}

/// EP-20: vault balance below the amount (amount within all limits).
#[test]
fn ep20_insufficient_vault_balance() {
    let mut env = payment_env_funded(2 * ONE);
    let before = snapshot(&env);
    let req = env.request(5 * ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::InsufficientVaultBalance),
    );
}

/// EP-21: zero amount.
#[test]
fn ep21_zero_amount_rejected() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let req = env.request(0);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::InvalidAmount),
    );
}

/// RM-03: after `remove_merchant`, payments to that merchant fail.
#[test]
fn rm03_payment_to_removed_merchant_rejected() {
    let mut env = payment_env();
    let first = env.request(ONE);
    env.pay(&first).expect("payment while allowlisted");
    let owner = env.owner.insecure_clone();
    let ix = remove_merchant_ix(&owner.pubkey(), &env.policy, &env.merchant);
    send(&mut env.svm, &[ix], &owner, &[]).expect("remove merchant");
    let before = snapshot(&env);
    let req = env.request(ONE);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        framework(AnchorErrorCode::AccountNotInitialized),
    );
}
