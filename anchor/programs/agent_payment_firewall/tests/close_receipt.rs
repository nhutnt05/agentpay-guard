//! F-02 receipt cleanup (docs/16 §1): CR-01…CR-08.

mod common;

use {
    agent_payment_firewall::{
        errors::AgentPayError, events::ReceiptClosed, MAX_REQUEST_TTL_SECONDS,
        RECEIPT_CLOSE_GRACE_SECONDS,
    },
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    common::*,
    solana_signer::Signer,
};

const CLOSABLE_AT: i64 = TEST_NOW + MAX_REQUEST_TTL_SECONDS + RECEIPT_CLOSE_GRACE_SECONDS;

/// Executes one payment at TEST_NOW and returns (env, request, receipt address).
fn paid_env() -> (PaymentEnv, PaymentRequest, Pubkey) {
    let mut env = payment_env();
    let req = env.request(2 * ONE);
    env.pay(&req).expect("payment");
    let receipt = receipt_pda(&env.policy, &req.request_hash).0;
    assert_eq!(fetch_receipt(&env.svm, &receipt).created_at, TEST_NOW);
    (env, req, receipt)
}

/// CR-01: the agent closes at exactly the earliest allowed time; the full rent goes back to
/// the agent (a separate fee payer pays the tx fee so the delta is exact).
#[test]
fn cr01_agent_closes_after_grace_and_gets_rent() {
    let (mut env, req, receipt) = paid_env();
    let rent = lamports(&env.svm, &receipt);
    assert!(rent > 0);
    let agent_before = lamports(&env.svm, &env.agent.pubkey());
    let fee_payer = funded_keypair(&mut env.svm);
    set_time(&mut env.svm, CLOSABLE_AT);

    let agent = env.agent.insecure_clone();
    let ix = close_receipt_ix(&agent.pubkey(), &env.policy, &receipt, &agent.pubkey());
    let meta = send(&mut env.svm, &[ix], &fee_payer, &[&agent]).expect("close");

    assert!(!account_exists(&env.svm, &receipt), "receipt must be gone");
    assert_eq!(lamports(&env.svm, &env.agent.pubkey()), agent_before + rent);
    let ev: ReceiptClosed = find_event(&meta.logs).expect("ReceiptClosed event");
    assert_eq!(ev.request_hash, req.request_hash);
    assert_eq!(ev.lamports, rent);
    assert_eq!(ev.closer, agent.pubkey());
    assert_eq!(ev.rent_destination, agent.pubkey());
}

/// CR-02: one second before the earliest allowed time → ReceiptNotExpired, receipt kept.
#[test]
fn cr02_too_early_rejected() {
    let (mut env, _req, receipt) = paid_env();
    set_time(&mut env.svm, CLOSABLE_AT - 1);
    let agent = env.agent.insecure_clone();
    let ix = close_receipt_ix(&agent.pubkey(), &env.policy, &receipt, &agent.pubkey());
    assert_error_code(
        send(&mut env.svm, &[ix], &agent, &[]),
        custom(AgentPayError::ReceiptNotExpired),
    );
    assert!(account_exists(&env.svm, &receipt));
}

/// CR-03 (key safety test): after the receipt is closed, the identical request cannot run
/// again — it fails with RequestExpired and nothing moves.
#[test]
fn cr03_replay_after_close_is_expired() {
    let (mut env, req, receipt) = paid_env();
    set_time(&mut env.svm, CLOSABLE_AT);
    let owner = env.owner.insecure_clone();
    let ix = close_receipt_ix(&owner.pubkey(), &env.policy, &receipt, &env.agent.pubkey());
    send(&mut env.svm, &[ix], &owner, &[]).expect("close");
    assert!(!account_exists(&env.svm, &receipt));

    let before = snapshot(&env);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::RequestExpired),
    );
}

/// CR-04: a key that is neither the owner nor the receipt agent cannot close.
#[test]
fn cr04_random_closer_rejected() {
    let (mut env, _req, receipt) = paid_env();
    set_time(&mut env.svm, CLOSABLE_AT);
    let stranger = funded_keypair(&mut env.svm);
    let ix = close_receipt_ix(
        &stranger.pubkey(),
        &env.policy,
        &receipt,
        &env.agent.pubkey(),
    );
    assert_error_code(
        send(&mut env.svm, &[ix], &stranger, &[]),
        custom(AgentPayError::UnauthorizedCloser),
    );
    assert!(account_exists(&env.svm, &receipt));
}

/// CR-05: the rent cannot be redirected, not even by the owner.
#[test]
fn cr05_rent_destination_must_be_receipt_agent() {
    let (mut env, _req, receipt) = paid_env();
    set_time(&mut env.svm, CLOSABLE_AT);
    let owner = env.owner.insecure_clone();
    let ix = close_receipt_ix(&owner.pubkey(), &env.policy, &receipt, &owner.pubkey());
    assert_error_code(
        send(&mut env.svm, &[ix], &owner, &[]),
        custom(AgentPayError::InvalidRentDestination),
    );
    assert!(account_exists(&env.svm, &receipt));
}

/// CR-06: a receipt of another policy cannot be closed through this policy, even by the
/// owner of this policy.
#[test]
fn cr06_receipt_of_other_policy_rejected() {
    let (mut env, _req, receipt) = paid_env();
    let owner = env.owner.insecure_clone();
    let other_id = random_policy_id();
    let other_policy = policy_pda(&owner.pubkey(), &other_id).0;
    let init = initialize_policy_ix(
        &owner.pubkey(),
        &env.mint,
        other_id,
        env.agent.pubkey(),
        DEFAULT_MAX_PER_TX,
        DEFAULT_DAILY_LIMIT,
    );
    send(&mut env.svm, &[init], &owner, &[]).expect("second policy");
    set_time(&mut env.svm, CLOSABLE_AT);

    let ix = close_receipt_ix(
        &owner.pubkey(),
        &other_policy,
        &receipt,
        &env.agent.pubkey(),
    );
    let res = send(&mut env.svm, &[ix], &owner, &[]);
    let err = format!("{:?}", res.as_ref().err().map(|e| &e.err));
    let seeds = format!("Custom({})", framework(AnchorErrorCode::ConstraintSeeds));
    let has_one = format!("Custom({})", framework(AnchorErrorCode::ConstraintHasOne));
    assert!(
        err.contains(&seeds) || err.contains(&has_one),
        "expected seeds/has_one error, got {err}"
    );
    assert!(account_exists(&env.svm, &receipt));
}

/// CR-07: after the agent is rotated, the owner can still close, and the rent goes to the
/// OLD agent recorded in the receipt; the new agent cannot redirect it.
#[test]
fn cr07_rotated_agent_rent_goes_to_old_agent() {
    let (mut env, _req, receipt) = paid_env();
    let owner = env.owner.insecure_clone();
    let new_agent = funded_keypair(&mut env.svm);
    let upd = update_policy_ix(
        &owner.pubkey(),
        &env.policy,
        None,
        None,
        Some(new_agent.pubkey()),
    );
    send(&mut env.svm, &[upd], &owner, &[]).expect("rotate agent");
    set_time(&mut env.svm, CLOSABLE_AT);

    let redirect = close_receipt_ix(
        &new_agent.pubkey(),
        &env.policy,
        &receipt,
        &new_agent.pubkey(),
    );
    assert_error_code(
        send(&mut env.svm, &[redirect], &new_agent, &[]),
        custom(AgentPayError::InvalidRentDestination),
    );

    let rent = lamports(&env.svm, &receipt);
    let old_before = lamports(&env.svm, &env.agent.pubkey());
    let ix = close_receipt_ix(&owner.pubkey(), &env.policy, &receipt, &env.agent.pubkey());
    send(&mut env.svm, &[ix], &owner, &[]).expect("owner close");
    assert_eq!(lamports(&env.svm, &env.agent.pubkey()), old_before + rent);
}

/// CR-08: closing the same receipt twice in one transaction fails as a whole (atomic).
#[test]
fn cr08_double_close_in_one_tx_fails() {
    let (mut env, _req, receipt) = paid_env();
    set_time(&mut env.svm, CLOSABLE_AT);
    let owner = env.owner.insecure_clone();
    let ix = close_receipt_ix(&owner.pubkey(), &env.policy, &receipt, &env.agent.pubkey());
    let res = send(&mut env.svm, &[ix.clone(), ix], &owner, &[]);
    assert!(res.is_err(), "second close in the same tx must fail");
    assert!(
        account_exists(&env.svm, &receipt),
        "tx rolled back; receipt kept"
    );
}
