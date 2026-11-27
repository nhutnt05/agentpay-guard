//! execute_payment integration tests (docs/10 §4).
//! T-M2-04: EP-01 (happy path with full state assertions).
//! Negative cases EP-02…EP-13, EP-20, EP-21, RM-03 are added in T-M2-05.

mod common;

use {agent_payment_firewall::utils::day_index, common::*, solana_signer::Signer};

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
