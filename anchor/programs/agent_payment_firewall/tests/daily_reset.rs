//! UTC daily window with clock control (docs/11 §5, docs/10 §4): EP-22 + edge cases.
//! T-M3-09. Uses LiteSVM `set_sysvar::<Clock>` via `set_time()`.
//!
//! Defaults: max_per_tx = 10, daily_limit = 20 (tokens). TEST_NOW is inside UTC day D.

// LiteSVM's TransactionResult has a large Err variant by design (test-only helpers).
#![allow(clippy::result_large_err)]

mod common;

use {
    agent_payment_firewall::{errors::AgentPayError, utils::day_index, SECONDS_PER_DAY},
    common::*,
    litesvm::types::TransactionResult,
};

/// First second of the UTC day containing TEST_NOW.
fn day_start() -> i64 {
    day_index(TEST_NOW) * SECONDS_PER_DAY
}

/// Sets the cluster clock to `t` and pays `amount` with a request valid at `t`.
fn pay_at(env: &mut PaymentEnv, t: i64, amount: u64) -> (PaymentRequest, TransactionResult) {
    set_time(&mut env.svm, t);
    let req = env.request_expiring(amount, t + 300);
    let res = env.pay(&req);
    (req, res)
}

/// Spends the whole daily limit at `t` (two max-size payments).
fn exhaust_day(env: &mut PaymentEnv, t: i64) {
    pay_at(env, t, DEFAULT_MAX_PER_TX)
        .1
        .expect("first max payment");
    pay_at(env, t, DEFAULT_MAX_PER_TX)
        .1
        .expect("second max payment");
    assert_eq!(
        fetch_policy(&env.svm, &env.policy).spent_today,
        DEFAULT_DAILY_LIMIT
    );
}

/// EP-22: after the daily limit is exhausted on day D, the first payment on day D+1
/// succeeds; the counter restarts from that payment and `day_index` advances.
#[test]
fn ep22_next_day_resets_spending() {
    let mut env = payment_env();
    exhaust_day(&mut env, TEST_NOW);

    let next_day = day_start() + SECONDS_PER_DAY + 3_600; // 01:00 UTC on D+1
    let (_, res) = pay_at(&mut env, next_day, 4 * ONE);
    res.expect("first payment of the new day");

    let p = fetch_policy(&env.svm, &env.policy);
    assert_eq!(
        p.spent_today,
        4 * ONE,
        "counter restarts from the new payment"
    );
    assert_eq!(p.day_index, day_index(TEST_NOW) + 1);
    assert_eq!(
        token_balance(&env.svm, &env.merchant_ata),
        DEFAULT_DAILY_LIMIT + 4 * ONE
    );
}

/// EP-22b: exact UTC boundary. 23:59:59 on D is still day D (blocked); 00:00:00 on D+1
/// is a new day (allowed).
#[test]
fn ep22b_exact_midnight_boundary() {
    let mut env = payment_env();
    exhaust_day(&mut env, TEST_NOW);
    let midnight = day_start() + SECONDS_PER_DAY;

    let before = snapshot(&env);
    let (req, res) = pay_at(&mut env, midnight - 1, ONE);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsDailyLimit),
    );

    let (_, res) = pay_at(&mut env, midnight, ONE);
    res.expect("00:00:00 UTC belongs to the next day");
    let p = fetch_policy(&env.svm, &env.policy);
    assert_eq!((p.spent_today, p.day_index), (ONE, day_index(midnight)));
}

/// EP-22c: the reset is lazy and atomic. If the first payment of a new day fails, the
/// stored counter and day are NOT rolled over (the failed transaction reverts everything).
/// Read-side code must therefore derive the effective value (docs/11 §5).
#[test]
fn ep22c_failed_first_payment_of_new_day_does_not_reset_storage() {
    let mut env = payment_env();
    exhaust_day(&mut env, TEST_NOW);
    let next_day = day_start() + SECONDS_PER_DAY + 60;

    let before = snapshot(&env);
    let (req, res) = pay_at(&mut env, next_day, DEFAULT_MAX_PER_TX + 1);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsMaxPerTx),
    );
    let p = fetch_policy(&env.svm, &env.policy);
    assert_eq!(
        p.spent_today, DEFAULT_DAILY_LIMIT,
        "stored counter still shows day D"
    );
    assert_eq!(p.day_index, day_index(TEST_NOW), "stored day still D");

    // The next valid payment performs the reset.
    pay_at(&mut env, next_day, ONE)
        .1
        .expect("valid payment on the new day");
    assert_eq!(fetch_policy(&env.svm, &env.policy).spent_today, ONE);
}

/// EP-22d: clock regression (cluster time moving back into an earlier day) does not
/// reset the counter; spending is still counted against the stored day.
#[test]
fn ep22d_clock_regression_does_not_reset() {
    let mut env = payment_env();
    exhaust_day(&mut env, TEST_NOW);
    let previous_day = day_start() - 3_600; // 23:00 UTC on D-1

    let before = snapshot(&env);
    let (req, res) = pay_at(&mut env, previous_day, ONE);
    assert_rejected(
        &env,
        &before,
        &req,
        res,
        custom(AgentPayError::ExceedsDailyLimit),
    );
    assert_eq!(
        fetch_policy(&env.svm, &env.policy).day_index,
        day_index(TEST_NOW)
    );
}

/// EP-22e: documented limitation (docs/00 §4, docs/11 §5). Calendar-day windows allow up
/// to 2 × daily_limit within seconds around 00:00 UTC. This test proves the behavior so it
/// is stated accurately, not hidden.
#[test]
fn ep22e_two_daily_limits_around_midnight_is_accepted_limitation() {
    let mut env = payment_env();
    let midnight = day_start() + SECONDS_PER_DAY;
    exhaust_day(&mut env, midnight - 1);
    exhaust_day(&mut env, midnight);
    assert_eq!(
        token_balance(&env.svm, &env.merchant_ata),
        2 * DEFAULT_DAILY_LIMIT,
        "2 x daily_limit paid within 1 second across the UTC boundary"
    );
}
