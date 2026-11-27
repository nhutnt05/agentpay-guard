//! Owner administration (docs/05 §5–7, docs/10 §4): pause/resume PS-01…PS-05 (T-M3-03),
//! update_policy UP-01…UP-06 (T-M3-04).

// LiteSVM's TransactionResult has a large Err variant by design (test-only helpers).
#![allow(clippy::result_large_err)]

mod common;

use {
    agent_payment_firewall::{
        errors::AgentPayError,
        events::{PolicyPaused, PolicyResumed, PolicyUpdated},
    },
    anchor_lang::prelude::Pubkey,
    common::*,
    solana_signer::Signer,
};

fn pause(env: &mut PaymentEnv) -> litesvm::types::TransactionResult {
    let owner = env.owner.insecure_clone();
    let ix = pause_policy_ix(&owner.pubkey(), &env.policy);
    send(&mut env.svm, &[ix], &owner, &[])
}

fn resume(env: &mut PaymentEnv) -> litesvm::types::TransactionResult {
    let owner = env.owner.insecure_clone();
    let ix = resume_policy_ix(&owner.pubkey(), &env.policy);
    send(&mut env.svm, &[ix], &owner, &[])
}

/// PS-01: owner pauses; flag set, event emitted, nothing else changes.
#[test]
fn ps01_owner_pauses_policy() {
    let mut env = payment_env();
    let before = fetch_policy(&env.svm, &env.policy);
    let meta = pause(&mut env).unwrap_or_else(|e| panic!("pause failed: {:#?}", e.meta.logs));

    let after = fetch_policy(&env.svm, &env.policy);
    assert!(after.is_paused);
    assert_eq!(after.agent, before.agent);
    assert_eq!(after.spent_today, before.spent_today);
    assert_eq!(after.max_per_tx, before.max_per_tx);

    let ev = find_event::<PolicyPaused>(&meta.logs).expect("PolicyPaused event");
    assert_eq!(ev.policy, env.policy);
    assert_eq!(ev.timestamp, TEST_NOW);
}

/// PS-02 + EP-08 (real instruction): payment fails while paused, succeeds after resume.
#[test]
fn ps02_pause_blocks_payment_and_resume_restores_it() {
    let mut env = payment_env();
    pause(&mut env).expect("pause");

    let before = snapshot(&env);
    let blocked = env.request(ONE);
    let res = env.pay(&blocked);
    assert_rejected(
        &env,
        &before,
        &blocked,
        res,
        custom(AgentPayError::PolicyPaused),
    );

    let meta = resume(&mut env).unwrap_or_else(|e| panic!("resume failed: {:#?}", e.meta.logs));
    assert!(!fetch_policy(&env.svm, &env.policy).is_paused);
    let ev = find_event::<PolicyResumed>(&meta.logs).expect("PolicyResumed event");
    assert_eq!(ev.policy, env.policy);

    let ok = env.request(ONE);
    env.pay(&ok).expect("payment after resume");
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), ONE);
}

/// PS-03: neither the agent nor a stranger can pause or resume.
#[test]
fn ps03_non_owner_cannot_pause_or_resume() {
    let mut env = payment_env();
    let stranger = funded_keypair(&mut env.svm);
    let agent = env.agent.insecure_clone();

    for attacker in [&agent, &stranger] {
        let ix = pause_policy_ix(&attacker.pubkey(), &env.policy);
        let res = send(&mut env.svm, &[ix], attacker, &[]);
        assert_error_code(res, custom(AgentPayError::UnauthorizedOwner));
        assert!(!fetch_policy(&env.svm, &env.policy).is_paused);
    }

    // Once the owner pauses, the agent cannot un-pause itself.
    pause(&mut env).expect("owner pause");
    for attacker in [&agent, &stranger] {
        let ix = resume_policy_ix(&attacker.pubkey(), &env.policy);
        let res = send(&mut env.svm, &[ix], attacker, &[]);
        assert_error_code(res, custom(AgentPayError::UnauthorizedOwner));
        assert!(fetch_policy(&env.svm, &env.policy).is_paused);
    }
}

/// PS-04: pausing twice / resuming an active policy are explicit errors.
#[test]
fn ps04_double_pause_and_resume_when_active_fail() {
    let mut env = payment_env();
    assert_error_code(resume(&mut env), custom(AgentPayError::PolicyNotPaused));
    pause(&mut env).expect("first pause");
    assert_error_code(pause(&mut env), custom(AgentPayError::PolicyAlreadyPaused));
    assert!(fetch_policy(&env.svm, &env.policy).is_paused);
}

/// PS-05 (extra): owner can still manage merchants while paused (docs/05 §2, §5).
#[test]
fn ps05_owner_manages_merchants_while_paused() {
    let mut env = payment_env();
    pause(&mut env).expect("pause");
    let owner = env.owner.insecure_clone();
    let newcomer = Pubkey::new_unique();
    let add = add_merchant_ix(&owner.pubkey(), &env.policy, &newcomer);
    send(&mut env.svm, &[add], &owner, &[]).expect("add while paused");
    let remove = remove_merchant_ix(&owner.pubkey(), &env.policy, &env.merchant);
    send(&mut env.svm, &[remove], &owner, &[]).expect("remove while paused");
    assert!(account_exists(
        &env.svm,
        &merchant_pda(&env.policy, &newcomer).0
    ));
    assert!(!account_exists(
        &env.svm,
        &merchant_pda(&env.policy, &env.merchant).0
    ));
}

fn update(
    env: &mut PaymentEnv,
    max_per_tx: Option<u64>,
    daily_limit: Option<u64>,
    agent: Option<Pubkey>,
) -> litesvm::types::TransactionResult {
    let owner = env.owner.insecure_clone();
    let ix = update_policy_ix(&owner.pubkey(), &env.policy, max_per_tx, daily_limit, agent);
    send(&mut env.svm, &[ix], &owner, &[])
}

/// UP-01: owner replaces the agent. The policy PDA, vault, merchants and spending
/// counter are unchanged; the new agent can pay, the old agent cannot.
#[test]
fn up01_owner_replaces_agent() {
    let mut env = payment_env();
    let first = env.request(2 * ONE);
    env.pay(&first).expect("payment by original agent");
    let before = fetch_policy(&env.svm, &env.policy);
    let old_agent = env.agent.insecure_clone();
    let new_agent = funded_keypair(&mut env.svm);

    let meta = update(&mut env, None, None, Some(new_agent.pubkey()))
        .unwrap_or_else(|e| panic!("update failed: {:#?}", e.meta.logs));

    let after = fetch_policy(&env.svm, &env.policy);
    assert_eq!(after.agent, new_agent.pubkey());
    // Same policy account (address is unchanged by construction: we read it at env.policy),
    // same vault, same limits, same counter, same owner/mint/id.
    assert_eq!(after.vault, before.vault);
    assert_eq!(after.vault, env.vault);
    assert_eq!(after.owner, before.owner);
    assert_eq!(after.mint, before.mint);
    assert_eq!(after.policy_id, before.policy_id);
    assert_eq!(after.max_per_tx, before.max_per_tx);
    assert_eq!(after.daily_limit, before.daily_limit);
    assert_eq!(after.spent_today, before.spent_today);
    assert_eq!(policy_pda(&after.owner, &after.policy_id).0, env.policy);

    let ev = find_event::<PolicyUpdated>(&meta.logs).expect("PolicyUpdated event");
    assert_eq!(ev.old_agent, old_agent.pubkey());
    assert_eq!(ev.new_agent, new_agent.pubkey());
    assert_eq!(ev.new_max_per_tx, before.max_per_tx);

    // Old agent is locked out immediately.
    let snap = snapshot(&env);
    let stale = payment_request(
        &env.policy,
        &old_agent.pubkey(),
        &env.merchant,
        &env.mint,
        ONE,
    );
    let res = env.pay(&stale); // env.agent is still the old keypair here
    assert_rejected(
        &env,
        &snap,
        &stale,
        res,
        custom(AgentPayError::UnauthorizedAgent),
    );

    // New agent pays with the existing allowlist and vault.
    env.agent = new_agent;
    let req = env.request(3 * ONE);
    env.pay(&req).expect("payment by new agent");
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), 5 * ONE);
    assert_eq!(fetch_policy(&env.svm, &env.policy).spent_today, 5 * ONE);
    assert_eq!(
        fetch_receipt(&env.svm, &receipt_pda(&env.policy, &req.request_hash).0).agent,
        env.agent.pubkey()
    );
}

/// UP-02: the resulting limits must satisfy 0 < max_per_tx <= daily_limit, and a new
/// agent must be valid. Rejected updates change nothing.
#[test]
fn up02_invalid_updates_rejected() {
    let mut env = payment_env();
    let before = fetch_policy(&env.svm, &env.policy);
    let owner_key = env.owner.pubkey();

    let limit_cases = [
        (Some(0), None),                       // max_per_tx = 0
        (None, Some(0)),                       // daily_limit = 0
        (Some(DEFAULT_DAILY_LIMIT + 1), None), // max above current daily
        (None, Some(DEFAULT_MAX_PER_TX - 1)),  // daily below current max
        (Some(5 * ONE), Some(4 * ONE)),        // both given, inconsistent
    ];
    for (max, daily) in limit_cases {
        let res = update(&mut env, max, daily, None);
        assert_error_code(res, custom(AgentPayError::InvalidPolicyLimits));
    }
    for bad_agent in [Pubkey::default(), owner_key] {
        let res = update(&mut env, None, None, Some(bad_agent));
        assert_error_code(res, custom(AgentPayError::InvalidAgent));
    }
    // A valid limit change combined with an invalid agent is rejected atomically.
    let res = update(&mut env, Some(ONE), None, Some(owner_key));
    assert_error_code(res, custom(AgentPayError::InvalidAgent));

    let after = fetch_policy(&env.svm, &env.policy);
    assert_eq!(after.max_per_tx, before.max_per_tx);
    assert_eq!(after.daily_limit, before.daily_limit);
    assert_eq!(after.agent, before.agent);
}

/// UP-03: neither the agent nor a stranger can update the policy (the agent cannot
/// raise its own limits or hand control to another key).
#[test]
fn up03_non_owner_cannot_update() {
    let mut env = payment_env();
    let stranger = funded_keypair(&mut env.svm);
    let agent = env.agent.insecure_clone();
    let before = fetch_policy(&env.svm, &env.policy);
    for attacker in [&agent, &stranger] {
        let ix = update_policy_ix(
            &attacker.pubkey(),
            &env.policy,
            Some(u64::MAX),
            Some(u64::MAX),
            Some(stranger.pubkey()),
        );
        let res = send(&mut env.svm, &[ix], attacker, &[]);
        assert_error_code(res, custom(AgentPayError::UnauthorizedOwner));
    }
    let after = fetch_policy(&env.svm, &env.policy);
    assert_eq!(after.agent, before.agent);
    assert_eq!(after.max_per_tx, before.max_per_tx);
    assert_eq!(after.daily_limit, before.daily_limit);
}

/// UP-04: an update with no fields is an explicit error.
#[test]
fn up04_empty_update_rejected() {
    let mut env = payment_env();
    assert_error_code(
        update(&mut env, None, None, None),
        custom(AgentPayError::EmptyUpdate),
    );
}

/// UP-05: lowering daily_limit below spent_today does not reset the counter and blocks
/// further payments for the rest of the day; lowering max_per_tx applies immediately.
#[test]
fn up05_lowered_limits_apply_without_resetting_counter() {
    let mut env = payment_env();
    let first = env.request(8 * ONE);
    env.pay(&first).expect("spend 8");

    update(&mut env, Some(5 * ONE), Some(6 * ONE), None).expect("lower limits");
    let p = fetch_policy(&env.svm, &env.policy);
    assert_eq!(
        p.spent_today,
        8 * ONE,
        "counter must not be reset by update"
    );
    assert_eq!((p.max_per_tx, p.daily_limit), (5 * ONE, 6 * ONE));

    let snap = snapshot(&env);
    let over_daily = env.request(ONE);
    let res = env.pay(&over_daily);
    assert_rejected(
        &env,
        &snap,
        &over_daily,
        res,
        custom(AgentPayError::ExceedsDailyLimit),
    );

    // Raise the daily limit again: the lowered per-tx cap still applies.
    update(&mut env, None, Some(20 * ONE), None).expect("raise daily");
    let snap = snapshot(&env);
    let over_tx = env.request(6 * ONE);
    let res = env.pay(&over_tx);
    assert_rejected(
        &env,
        &snap,
        &over_tx,
        res,
        custom(AgentPayError::ExceedsMaxPerTx),
    );
    let ok = env.request(5 * ONE);
    env.pay(&ok).expect("within new limits");
}

/// UP-06 (extra): the owner can replace a compromised agent while the policy is paused,
/// then resume (incident-response flow).
#[test]
fn up06_replace_agent_while_paused() {
    let mut env = payment_env();
    pause(&mut env).expect("pause");
    let new_agent = funded_keypair(&mut env.svm);
    update(&mut env, None, None, Some(new_agent.pubkey())).expect("update while paused");
    resume(&mut env).expect("resume");
    env.agent = new_agent;
    let req = env.request(ONE);
    env.pay(&req).expect("new agent pays after resume");
}
