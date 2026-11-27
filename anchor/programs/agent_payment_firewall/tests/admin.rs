//! Owner administration (docs/05 §5–6, docs/10 §4): pause/resume PS-01…PS-04. T-M3-03.
//! update_policy (UP-*) is added in T-M3-04.

// LiteSVM's TransactionResult has a large Err variant by design (test-only helpers).
#![allow(clippy::result_large_err)]

mod common;

use {
    agent_payment_firewall::{
        errors::AgentPayError,
        events::{PolicyPaused, PolicyResumed},
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
