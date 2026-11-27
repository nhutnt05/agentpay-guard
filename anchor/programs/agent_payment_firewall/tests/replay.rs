//! Replay protection and request expiry (docs/11 §3–4, docs/10 §4): EP-14…EP-18.
//! T-M3-01.

mod common;

use {
    agent_payment_firewall::{
        errors::AgentPayError, utils::compute_request_hash, MAX_REQUEST_TTL_SECONDS,
    },
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    common::*,
    solana_signer::Signer,
};

/// EP-14: the same request (same hash) executed twice in sequence. The second attempt
/// fails because the receipt PDA already exists; balances, counter and the original
/// receipt are unchanged.
#[test]
fn ep14_duplicate_request_rejected() {
    let mut env = payment_env();
    let req = env.request(2 * ONE);
    env.pay(&req).expect("first execution");
    let receipt = receipt_pda(&env.policy, &req.request_hash).0;
    let receipt_before = fetch_receipt(&env.svm, &receipt);
    let before = snapshot(&env);

    set_time(&mut env.svm, TEST_NOW + 30); // still before expiry
    assert_failed_with_log(env.pay(&req), "already in use");

    assert_eq!(
        snapshot(&env),
        before,
        "duplicate must not move funds or counter"
    );
    let receipt_after = fetch_receipt(&env.svm, &receipt);
    assert_eq!(receipt_after.created_at, receipt_before.created_at);
    assert_eq!(receipt_after.amount, receipt_before.amount);
}

/// EP-15: two transactions carrying the same request, both signed against the same
/// blockhash BEFORE either is submitted (different fee payers, so they are distinct
/// transactions, not a deduplicated signature). Exactly one executes.
///
/// LiteSVM processes them sequentially; on a real cluster the runtime write-locks the
/// shared writable accounts (policy, vault, receipt PDA), which serializes them the same
/// way. The second transaction also shows that a separate fee payer is fine: the agent
/// still signs and still pays the receipt rent.
#[test]
fn ep15_parallel_duplicate_exactly_one_succeeds() {
    let mut env = payment_env();
    let req = env.request(3 * ONE);
    let ix = execute_payment_ix(&env.accounts(&req), &req);
    let other_fee_payer = funded_keypair(&mut env.svm);

    env.svm.expire_blockhash();
    let blockhash = env.svm.latest_blockhash();
    let tx_a = build_tx(std::slice::from_ref(&ix), &env.agent, &[], blockhash);
    let tx_b = build_tx(&[ix], &other_fee_payer, &[&env.agent], blockhash);
    assert_ne!(
        tx_a.signatures[0], tx_b.signatures[0],
        "must be distinct transactions"
    );

    let res_a = env.svm.send_transaction(tx_a);
    let res_b = env.svm.send_transaction(tx_b);
    let successes = [res_a.is_ok(), res_b.is_ok()]
        .iter()
        .filter(|ok| **ok)
        .count();
    assert_eq!(
        successes, 1,
        "exactly one of the two duplicates may execute"
    );
    if let Err(e) = res_b {
        assert!(
            e.meta.logs.iter().any(|l| l.contains("already in use")),
            "loser fails on the existing receipt: {:#?}",
            e.meta.logs
        );
    }

    // Paid exactly once.
    assert_eq!(token_balance(&env.svm, &env.merchant_ata), 3 * ONE);
    assert_eq!(token_balance(&env.svm, &env.vault), VAULT_FUNDING - 3 * ONE);
    assert_eq!(fetch_policy(&env.svm, &env.policy).spent_today, 3 * ONE);
}

/// EP-16: the supplied hash does not match the payment fields. Each case changes exactly
/// one hashed field (or uses arbitrary bytes); the receipt PDA is derived consistently from
/// the supplied hash, so the failure is the on-chain recomputation, not the seeds.
#[test]
fn ep16_invalid_request_hash_rejected() {
    let mut env = payment_env();
    let amount = 2 * ONE;
    let base = env.request(amount);
    let p = env.policy;
    let a = env.agent.pubkey();
    let m = env.merchant;
    let t = env.mint;
    let other = Pubkey::new_unique();
    let rid = base.request_id;
    let exp = base.expires_at;
    let mut other_rid = rid;
    other_rid[0] ^= 0xff;

    let wrong_hashes: Vec<(&str, [u8; 32])> = vec![
        (
            "policy",
            compute_request_hash(&other, &a, &m, &t, amount, &rid, exp),
        ),
        (
            "agent",
            compute_request_hash(&p, &other, &m, &t, amount, &rid, exp),
        ),
        (
            "merchant",
            compute_request_hash(&p, &a, &other, &t, amount, &rid, exp),
        ),
        (
            "mint",
            compute_request_hash(&p, &a, &m, &other, amount, &rid, exp),
        ),
        (
            "amount",
            compute_request_hash(&p, &a, &m, &t, amount + 1, &rid, exp),
        ),
        (
            "request_id",
            compute_request_hash(&p, &a, &m, &t, amount, &other_rid, exp),
        ),
        (
            "expires_at",
            compute_request_hash(&p, &a, &m, &t, amount, &rid, exp + 1),
        ),
        ("arbitrary", [7u8; 32]),
    ];

    for (field, wrong) in wrong_hashes {
        let before = snapshot(&env);
        let req = PaymentRequest {
            request_hash: wrong,
            ..base
        };
        let res = env.pay(&req);
        assert!(res.is_err(), "hash with wrong `{field}` must be rejected");
        assert_rejected(
            &env,
            &before,
            &req,
            res,
            custom(AgentPayError::InvalidRequestHash),
        );
    }

    // The correct hash still works afterwards (nothing was consumed by the failures).
    env.pay(&base)
        .expect("valid request after rejected attempts");
}

/// EP-16b: the receipt account passed is not derived from the supplied hash.
/// Rejected by the seeds constraint before the handler runs.
#[test]
fn ep16b_receipt_not_derived_from_hash_rejected() {
    let mut env = payment_env();
    let req = env.request(ONE);
    let decoy = env.request(ONE);
    let before = snapshot(&env);
    let mut accounts = env.accounts(&req);
    accounts.receipt = receipt_pda(&env.policy, &decoy.request_hash).0;
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
    assert!(!account_exists(&env.svm, &accounts.receipt));
}

/// EP-17: request already expired (`now > expires_at`); `now == expires_at` is still valid.
#[test]
fn ep17_expired_request_rejected() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let expired = env.request_expiring(ONE, TEST_NOW - 1);
    let res = env.pay(&expired);
    assert_rejected(
        &env,
        &before,
        &expired,
        res,
        custom(AgentPayError::RequestExpired),
    );

    // A valid request that becomes stale before submission is rejected too.
    let stale = env.request_expiring(ONE, TEST_NOW + 60);
    set_time(&mut env.svm, TEST_NOW + 61);
    let before = snapshot(&env);
    let res = env.pay(&stale);
    assert_rejected(
        &env,
        &before,
        &stale,
        res,
        custom(AgentPayError::RequestExpired),
    );

    // Boundary: expires exactly now → accepted.
    let boundary = env.request_expiring(ONE, TEST_NOW + 61);
    env.pay(&boundary)
        .expect("expires_at == now must be accepted");
}

/// EP-18: expiry further than MAX_REQUEST_TTL_SECONDS (600 s) ahead; exactly 600 s is valid.
#[test]
fn ep18_expiry_too_far_rejected() {
    let mut env = payment_env();
    let before = snapshot(&env);
    let too_far = env.request_expiring(ONE, TEST_NOW + MAX_REQUEST_TTL_SECONDS + 1);
    let res = env.pay(&too_far);
    assert_rejected(
        &env,
        &before,
        &too_far,
        res,
        custom(AgentPayError::RequestExpiryTooFar),
    );

    let far_future = env.request_expiring(ONE, i64::MAX);
    let before = snapshot(&env);
    let res = env.pay(&far_future);
    assert_rejected(
        &env,
        &before,
        &far_future,
        res,
        custom(AgentPayError::RequestExpiryTooFar),
    );

    let max_ttl = env.request_expiring(ONE, TEST_NOW + MAX_REQUEST_TTL_SECONDS);
    env.pay(&max_ttl)
        .expect("expires_at == now + MAX_TTL must be accepted");
}

/// EP-18b: a new request id for the same merchant and amount is NOT a replay; it is
/// accepted within limits (documented limitation, docs/11 §4).
#[test]
fn ep18b_same_payment_new_request_id_is_accepted() {
    let mut env = payment_env();
    let first = env.request(ONE);
    let second = env.request(ONE);
    assert_ne!(first.request_hash, second.request_hash);
    env.pay(&first).expect("first");
    env.pay(&second)
        .expect("semantic duplicate with new id is accepted (bounded by limits)");
    assert_eq!(fetch_policy(&env.svm, &env.policy).spent_today, 2 * ONE);
}
