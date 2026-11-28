use anchor_lang::prelude::*;

/// Payment policy and signing authority of the vault ATA (docs/03 §3).
/// Size: 8 (discriminator) + 202 = 210 bytes.
#[account]
#[derive(InitSpace)]
pub struct AgentPolicy {
    /// Wallet that created the policy. Immutable.
    pub owner: Pubkey,
    /// Only key allowed to sign `execute_payment`. Replaceable by the owner.
    pub agent: Pubkey,
    /// Classic SPL Token mint. Immutable.
    pub mint: Pubkey,
    /// ATA(owner = policy PDA, mint). Immutable.
    pub vault: Pubkey,
    /// Owner-chosen identifier, part of the PDA seeds. Immutable.
    pub policy_id: [u8; 32],
    /// Maximum base units per payment.
    pub max_per_tx: u64,
    /// Maximum base units per UTC day.
    pub daily_limit: u64,
    /// Base units spent during `day_index` (lazily reset).
    pub spent_today: u64,
    /// `unix_timestamp.div_euclid(86_400)` of the day `spent_today` refers to.
    pub day_index: i64,
    /// When true, `execute_payment` fails.
    pub is_paused: bool,
    pub created_at: i64,
    pub bump: u8,
}

/// One allowlist entry per (policy, merchant wallet). Existence means "allowed" (docs/03 §5).
/// Size: 8 + 74 = 82 bytes.
#[account]
#[derive(InitSpace)]
pub struct MerchantAllowlist {
    pub policy: Pubkey,
    /// Merchant wallet (not its token account).
    pub merchant: Pubkey,
    /// Always true while the account exists in the MVP; still checked (defense in depth).
    pub is_allowed: bool,
    pub created_at: i64,
    pub bump: u8,
}

/// Proof that a canonical payment request executed (docs/03 §6). Closable only via
/// `close_receipt` after expiry + grace (F-02), when replay already fails with `RequestExpired`.
/// Size: 8 + 177 = 185 bytes.
#[account]
#[derive(InitSpace)]
pub struct PaymentReceipt {
    pub policy: Pubkey,
    pub request_hash: [u8; 32],
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
    pub created_at: i64,
    pub bump: u8,
}

/// F-03: optional rolling 24-hour limit of a policy (docs/16 §2). Exists ⇒ enforced.
/// Size: 8 + 241 = 249 bytes.
#[account]
#[derive(InitSpace)]
pub struct SpendingRules {
    pub policy: Pubkey,
    /// Max base units in the current hour plus the previous 23 hours.
    pub rolling_limit: u64,
    /// Spend per UTC hour, ring buffer indexed by `hour.rem_euclid(24)`.
    pub buckets: [u64; 24],
    /// `unix_timestamp.div_euclid(3600)` of the newest bucket.
    pub current_hour: i64,
    pub bump: u8,
}

/// F-03: optional per-merchant limits (docs/16 §2). Exists ⇒ enforced in addition to the
/// policy limits. Size: 8 + 97 = 105 bytes.
#[account]
#[derive(InitSpace)]
pub struct MerchantLimit {
    pub policy: Pubkey,
    pub merchant: Pubkey,
    pub max_per_tx: u64,
    pub daily_limit: u64,
    /// Base units paid to this merchant during `day_index` (lazily reset).
    pub spent_today: u64,
    pub day_index: i64,
    pub bump: u8,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::ANCHOR_DISCRIMINATOR_LEN;

    /// U-08: account sizes match docs/03.
    #[test]
    fn account_sizes_match_spec() {
        assert_eq!(AgentPolicy::DISCRIMINATOR.len(), ANCHOR_DISCRIMINATOR_LEN);
        assert_eq!(
            MerchantAllowlist::DISCRIMINATOR.len(),
            ANCHOR_DISCRIMINATOR_LEN
        );
        assert_eq!(
            PaymentReceipt::DISCRIMINATOR.len(),
            ANCHOR_DISCRIMINATOR_LEN
        );
        assert_eq!(ANCHOR_DISCRIMINATOR_LEN + AgentPolicy::INIT_SPACE, 210);
        assert_eq!(ANCHOR_DISCRIMINATOR_LEN + MerchantAllowlist::INIT_SPACE, 82);
        assert_eq!(ANCHOR_DISCRIMINATOR_LEN + PaymentReceipt::INIT_SPACE, 185);
        assert_eq!(ANCHOR_DISCRIMINATOR_LEN + SpendingRules::INIT_SPACE, 249);
        assert_eq!(ANCHOR_DISCRIMINATOR_LEN + MerchantLimit::INIT_SPACE, 105);
    }
}
