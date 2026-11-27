//! Arithmetic overflow (docs/10 §4, threat T-16): EP-19, EP-19b. T-M3-02.
//! Both overflow sites in `execute_payment` use checked arithmetic and must fail with
//! `ArithmeticOverflow`, leaving all state unchanged.

mod common;

use {agent_payment_firewall::errors::AgentPayError, common::*};

/// EP-19: daily counter overflow.
/// Limits = u64::MAX, vault funded with u64::MAX tokens. Paying u64::MAX − 1 succeeds;
/// paying 2 more would overflow `spent_today` (u64::MAX − 1 + 2). It must fail with
/// `ArithmeticOverflow` — not `ExceedsDailyLimit`, and not `InsufficientVaultBalance`
/// even though the vault now holds only 1 token (overflow is checked before balance).
#[test]
fn ep19_daily_counter_overflow_rejected() {
    let mut env = payment_env_with(u64::MAX, u64::MAX, u64::MAX);
    assert_eq!(token_balance(&env.svm, &env.vault), u64::MAX);

    let big = env.request(u64::MAX - 1);
    env.pay(&big)
        .expect("payment of u64::MAX - 1 within u64::MAX limits");
    assert_eq!(
        fetch_policy(&env.svm, &env.policy).spent_today,
        u64::MAX - 1
    );
    assert_eq!(token_balance(&env.svm, &env.vault), 1);

    let before = snapshot(&env);
    let req = env.request(2);
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ArithmeticOverflow),
    );
}

/// EP-19b: expiry-window overflow. With the cluster clock near i64::MAX, `now + 600`
/// cannot be computed; the program must return `ArithmeticOverflow` instead of wrapping
/// (a wrapped value would make every expiry look "too far" or "valid" incorrectly).
#[test]
fn ep19b_expiry_window_overflow_rejected() {
    let mut env = payment_env();
    let near_max = i64::MAX - 100;
    set_time(&mut env.svm, near_max);
    let before = snapshot(&env);
    let req = env.request_expiring(ONE, near_max + 50); // not expired: now <= expires_at
    let res = env.pay(&req);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ArithmeticOverflow),
    );
}
