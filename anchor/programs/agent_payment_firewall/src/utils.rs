//! Pure, unit-testable helpers (docs/05 §4.1, docs/11 §3 and §5).

use anchor_lang::prelude::*;

use crate::{constants::*, errors::AgentPayError};

/// Canonical request hash: SHA-256 over a fixed-width 185-byte preimage (docs/11 §3.1):
/// domain(25) | policy(32) | agent(32) | merchant(32) | mint(32) | amount u64 LE(8)
/// | request_id(16) | expires_at i64 LE(8).
pub fn compute_request_hash(
    policy: &Pubkey,
    agent: &Pubkey,
    merchant: &Pubkey,
    mint: &Pubkey,
    amount: u64,
    request_id: &[u8; 16],
    expires_at: i64,
) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[
        REQUEST_HASH_DOMAIN,
        policy.as_ref(),
        agent.as_ref(),
        merchant.as_ref(),
        mint.as_ref(),
        &amount.to_le_bytes(),
        request_id,
        &expires_at.to_le_bytes(),
    ])
    .to_bytes()
}

/// UTC calendar day index of a unix timestamp. `div_euclid` keeps negative timestamps correct.
pub fn day_index(unix_timestamp: i64) -> i64 {
    unix_timestamp.div_euclid(SECONDS_PER_DAY)
}

/// Result of applying a payment to the daily counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DailySpend {
    pub spent_today: u64,
    pub day_index: i64,
}

/// Lazy UTC-day reset + checked accumulation + limit check (docs/11 §5).
/// - New day (`current > stored`): counter restarts from 0.
/// - Clock regression (`current < stored`): no reset.
/// - Overflow is checked before the limit comparison.
pub fn apply_daily_spend(
    spent_today: u64,
    stored_day_index: i64,
    now: i64,
    amount: u64,
    daily_limit: u64,
) -> Result<DailySpend> {
    apply_daily_spend_or(
        spent_today,
        stored_day_index,
        now,
        amount,
        daily_limit,
        AgentPayError::ExceedsDailyLimit,
    )
}

/// Same lazy-reset daily accounting, with the error to raise when the limit is exceeded
/// (policy limit vs F-03 per-merchant limit).
pub fn apply_daily_spend_or(
    spent_today: u64,
    stored_day_index: i64,
    now: i64,
    amount: u64,
    daily_limit: u64,
    exceeded: AgentPayError,
) -> Result<DailySpend> {
    let current_day = day_index(now);
    let (base, day) = if current_day > stored_day_index {
        (0, current_day)
    } else {
        (spent_today, stored_day_index)
    };
    let new_spent = base
        .checked_add(amount)
        .ok_or(error!(AgentPayError::ArithmeticOverflow))?;
    if new_spent > daily_limit {
        return Err(exceeded.into());
    }
    Ok(DailySpend {
        spent_today: new_spent,
        day_index: day,
    })
}

/// Policy limit invariant: both > 0 and `max_per_tx <= daily_limit`.
/// Result of rolling-window accounting (F-03).
#[derive(Debug, PartialEq, Eq)]
pub struct RollingSpend {
    pub buckets: [u64; ROLLING_BUCKETS],
    pub current_hour: i64,
}

/// F-03 rolling 24-hour window with hourly buckets (docs/16 §2.3). Buckets older than 24 h
/// are zeroed lazily; the window is the current hour plus the previous 23 hours. If the clock
/// is earlier than `current_hour`, spend is counted into the current bucket (never un-zeroed).
pub fn apply_rolling_spend(
    buckets: [u64; ROLLING_BUCKETS],
    current_hour: i64,
    now: i64,
    amount: u64,
    rolling_limit: u64,
) -> Result<RollingSpend> {
    let hour = now.div_euclid(SECONDS_PER_HOUR);
    let mut b = buckets;
    let mut cur = current_hour;
    if hour > cur {
        let gap = hour
            .checked_sub(cur)
            .ok_or(error!(AgentPayError::ArithmeticOverflow))?
            .min(ROLLING_BUCKETS as i64);
        for k in 1..=gap {
            b[(cur + k).rem_euclid(ROLLING_BUCKETS as i64) as usize] = 0;
        }
        cur = hour;
    }
    let mut window: u64 = 0;
    for v in b {
        window = window
            .checked_add(v)
            .ok_or(error!(AgentPayError::ArithmeticOverflow))?;
    }
    let total = window
        .checked_add(amount)
        .ok_or(error!(AgentPayError::ArithmeticOverflow))?;
    require!(total <= rolling_limit, AgentPayError::ExceedsRollingLimit);
    let idx = cur.rem_euclid(ROLLING_BUCKETS as i64) as usize;
    b[idx] = b[idx]
        .checked_add(amount)
        .ok_or(error!(AgentPayError::ArithmeticOverflow))?;
    Ok(RollingSpend {
        buckets: b,
        current_hour: cur,
    })
}

pub fn validate_limits(max_per_tx: u64, daily_limit: u64) -> Result<()> {
    require!(
        max_per_tx > 0 && daily_limit > 0 && max_per_tx <= daily_limit,
        AgentPayError::InvalidPolicyLimits
    );
    Ok(())
}

/// Agent must be a real key and must not be the owner (role separation).
pub fn validate_agent(agent: &Pubkey, owner: &Pubkey) -> Result<()> {
    require!(
        *agent != Pubkey::default() && agent != owner,
        AgentPayError::InvalidAgent
    );
    Ok(())
}

/// A merchant must be a real wallet and must not be the policy PDA, its vault, or its
/// current agent (an agent that can pay itself defeats the allowlist).
pub fn validate_merchant(
    merchant: &Pubkey,
    policy: &Pubkey,
    vault: &Pubkey,
    agent: &Pubkey,
) -> Result<()> {
    require!(
        *merchant != Pubkey::default()
            && merchant != policy
            && merchant != vault
            && merchant != agent,
        AgentPayError::InvalidMerchant
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(err: anchor_lang::error::Error) -> u32 {
        match err {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected error: {other:?}"),
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn vector_inputs() -> (Pubkey, Pubkey, Pubkey, Pubkey, u64, [u8; 16], i64) {
        let mut request_id = [0u8; 16];
        for (i, b) in request_id.iter_mut().enumerate() {
            *b = (i + 1) as u8; // 0x01..0x10
        }
        (
            Pubkey::new_from_array([0x11; 32]),
            Pubkey::new_from_array([0x22; 32]),
            Pubkey::new_from_array([0x33; 32]),
            Pubkey::new_from_array([0x44; 32]),
            5_000_000,
            request_id,
            1_800_000_000,
        )
    }

    /// U-01: reproduces the test vector in docs/11 §3.2.
    #[test]
    fn request_hash_matches_spec_vector() {
        assert_eq!(REQUEST_HASH_DOMAIN.len(), 25);
        let (p, a, m, t, amount, rid, exp) = vector_inputs();
        let h = compute_request_hash(&p, &a, &m, &t, amount, &rid, exp);
        assert_eq!(
            hex(&h),
            "f8e5a3ca0aa977f4fb97ddb7bbe5cb78e2af5d6942a3dbfc202076fc068903c5"
        );
    }

    /// U-02: every field influences the hash.
    #[test]
    fn request_hash_changes_with_each_field() {
        let (p, a, m, t, amount, rid, exp) = vector_inputs();
        let base = compute_request_hash(&p, &a, &m, &t, amount, &rid, exp);
        let other = Pubkey::new_from_array([0x55; 32]);
        let mut rid2 = rid;
        rid2[15] ^= 1;
        let variants = [
            compute_request_hash(&other, &a, &m, &t, amount, &rid, exp),
            compute_request_hash(&p, &other, &m, &t, amount, &rid, exp),
            compute_request_hash(&p, &a, &other, &t, amount, &rid, exp),
            compute_request_hash(&p, &a, &m, &other, amount, &rid, exp),
            compute_request_hash(&p, &a, &m, &t, amount + 1, &rid, exp),
            compute_request_hash(&p, &a, &m, &t, amount, &rid2, exp),
            compute_request_hash(&p, &a, &m, &t, amount, &rid, exp + 1),
        ];
        for v in variants {
            assert_ne!(v, base);
        }
    }

    /// U-03: same day accumulates.
    #[test]
    fn daily_spend_same_day_accumulates() {
        let now = 20_000 * SECONDS_PER_DAY + 100;
        let r = apply_daily_spend(5, 20_000, now, 7, 100).unwrap();
        assert_eq!(
            r,
            DailySpend {
                spent_today: 12,
                day_index: 20_000
            }
        );
    }

    /// U-04: first payment of a new day resets the counter.
    #[test]
    fn daily_spend_new_day_resets() {
        let now = 20_001 * SECONDS_PER_DAY;
        let r = apply_daily_spend(95, 20_000, now, 10, 100).unwrap();
        assert_eq!(
            r,
            DailySpend {
                spent_today: 10,
                day_index: 20_001
            }
        );
    }

    #[test]
    fn daily_spend_limit_boundary() {
        let now = 20_000 * SECONDS_PER_DAY;
        assert!(apply_daily_spend(90, 20_000, now, 10, 100).is_ok());
        let err = apply_daily_spend(90, 20_000, now, 11, 100).unwrap_err();
        assert_eq!(code(err), u32::from(AgentPayError::ExceedsDailyLimit));
    }

    /// U-05: overflow is reported as ArithmeticOverflow, not as a limit error.
    #[test]
    fn daily_spend_overflow() {
        let now = 20_000 * SECONDS_PER_DAY;
        let err = apply_daily_spend(u64::MAX - 1, 20_000, now, 2, u64::MAX).unwrap_err();
        assert_eq!(code(err), u32::from(AgentPayError::ArithmeticOverflow));
    }

    /// U-06: clock regression does not reset the counter.
    #[test]
    fn daily_spend_clock_regression_does_not_reset() {
        let now = 19_999 * SECONDS_PER_DAY + 50;
        let r = apply_daily_spend(40, 20_000, now, 10, 100).unwrap();
        assert_eq!(
            r,
            DailySpend {
                spent_today: 50,
                day_index: 20_000
            }
        );
    }

    /// U-07: day index uses Euclidean division.
    #[test]
    fn day_index_euclidean() {
        assert_eq!(day_index(0), 0);
        assert_eq!(day_index(SECONDS_PER_DAY - 1), 0);
        assert_eq!(day_index(SECONDS_PER_DAY), 1);
        assert_eq!(day_index(-1), -1);
        assert_eq!(day_index(-SECONDS_PER_DAY), -1);
        assert_eq!(day_index(-SECONDS_PER_DAY - 1), -2);
    }

    #[test]
    fn limits_validation() {
        assert!(validate_limits(1, 1).is_ok());
        assert!(validate_limits(10, 20).is_ok());
        for (m, d) in [(0, 10), (10, 0), (0, 0), (11, 10)] {
            let err = validate_limits(m, d).unwrap_err();
            assert_eq!(code(err), u32::from(AgentPayError::InvalidPolicyLimits));
        }
    }

    #[test]
    fn agent_validation() {
        let owner = Pubkey::new_from_array([1; 32]);
        let agent = Pubkey::new_from_array([2; 32]);
        assert!(validate_agent(&agent, &owner).is_ok());
        for bad in [Pubkey::default(), owner] {
            let err = validate_agent(&bad, &owner).unwrap_err();
            assert_eq!(code(err), u32::from(AgentPayError::InvalidAgent));
        }
    }

    #[test]
    fn merchant_validation() {
        let policy = Pubkey::new_from_array([1; 32]);
        let vault = Pubkey::new_from_array([2; 32]);
        let agent = Pubkey::new_from_array([3; 32]);
        let merchant = Pubkey::new_from_array([4; 32]);
        assert!(validate_merchant(&merchant, &policy, &vault, &agent).is_ok());
        for bad in [Pubkey::default(), policy, vault, agent] {
            let err = validate_merchant(&bad, &policy, &vault, &agent).unwrap_err();
            assert_eq!(code(err), u32::from(AgentPayError::InvalidMerchant));
        }
    }
}

/// F-03 rolling window unit tests (RL-U-*).
#[cfg(test)]
mod rolling_tests {
    use super::*;

    const H: i64 = SECONDS_PER_HOUR;
    const T0: i64 = 1_800_000_000; // arbitrary UTC time
    fn empty() -> [u64; ROLLING_BUCKETS] {
        [0; ROLLING_BUCKETS]
    }
    fn code(r: Result<RollingSpend>) -> u32 {
        match r.unwrap_err() {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn accumulates_within_window_and_rejects_over_limit() {
        let r = apply_rolling_spend(empty(), T0 / H, T0, 60, 100).unwrap();
        let r = apply_rolling_spend(r.buckets, r.current_hour, T0 + 5 * H, 40, 100).unwrap();
        assert_eq!(r.buckets.iter().sum::<u64>(), 100);
        let over = apply_rolling_spend(r.buckets, r.current_hour, T0 + 6 * H, 1, 100);
        assert_eq!(code(over), u32::from(AgentPayError::ExceedsRollingLimit));
    }

    #[test]
    fn crossing_utc_midnight_does_not_reset() {
        let midnight = (T0 / 86_400 + 1) * 86_400;
        let r =
            apply_rolling_spend(empty(), (midnight - 600) / H, midnight - 600, 100, 100).unwrap();
        let next_day = apply_rolling_spend(r.buckets, r.current_hour, midnight + 600, 1, 100);
        assert_eq!(
            code(next_day),
            u32::from(AgentPayError::ExceedsRollingLimit)
        );
    }

    #[test]
    fn spend_expires_after_24_hours() {
        let r = apply_rolling_spend(empty(), T0 / H, T0, 100, 100).unwrap();
        // 23 hours later the bucket is still in the window.
        assert!(apply_rolling_spend(r.buckets, r.current_hour, T0 + 23 * H, 1, 100).is_err());
        // 24 hours later it has rotated out.
        let later = apply_rolling_spend(r.buckets, r.current_hour, T0 + 24 * H, 100, 100).unwrap();
        assert_eq!(later.buckets.iter().sum::<u64>(), 100);
    }

    #[test]
    fn long_gap_zeroes_everything_without_overflow() {
        let full = [4u64; ROLLING_BUCKETS];
        let r = apply_rolling_spend(full, T0 / H, T0 + 10_000 * H, 5, 100).unwrap();
        assert_eq!(r.buckets.iter().sum::<u64>(), 5);
        assert_eq!(r.current_hour, T0 / H + 10_000);
    }

    #[test]
    fn clock_going_back_counts_into_current_bucket() {
        let r = apply_rolling_spend(empty(), T0 / H, T0, 10, 100).unwrap();
        let back = apply_rolling_spend(r.buckets, r.current_hour, T0 - 3 * H, 10, 100).unwrap();
        assert_eq!(back.current_hour, T0 / H);
        assert_eq!(back.buckets[(T0 / H).rem_euclid(24) as usize], 20);
    }
}
