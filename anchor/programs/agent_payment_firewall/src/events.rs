use anchor_lang::prelude::*;

// Events are emitted via program logs (`emit!`). Failed transactions emit nothing;
// the backend treats on-chain accounts and `meta.err` as authoritative (docs/05 §0.3).

#[event]
pub struct PolicyInitialized {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub max_per_tx: u64,
    pub daily_limit: u64,
    pub timestamp: i64,
}

#[event]
pub struct MerchantAdded {
    pub policy: Pubkey,
    pub merchant: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MerchantRemoved {
    pub policy: Pubkey,
    pub merchant: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PaymentExecuted {
    pub policy: Pubkey,
    pub receipt: Pubkey,
    pub request_hash: [u8; 32],
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub spent_today: u64,
    pub day_index: i64,
    pub timestamp: i64,
}

/// F-02: a receipt was closed and its rent refunded to the agent that paid it.
#[event]
pub struct ReceiptClosed {
    pub policy: Pubkey,
    pub receipt: Pubkey,
    pub request_hash: [u8; 32],
    pub merchant: Pubkey,
    pub amount: u64,
    pub closer: Pubkey,
    pub rent_destination: Pubkey,
    pub lamports: u64,
    pub timestamp: i64,
}

/// F-03: rolling limit created or changed (`rolling_limit == 0` never emitted: closing is separate).
#[event]
pub struct SpendingRulesSet {
    pub policy: Pubkey,
    pub rolling_limit: u64,
    pub timestamp: i64,
}

/// F-03: per-merchant limits created or changed.
#[event]
pub struct MerchantLimitSet {
    pub policy: Pubkey,
    pub merchant: Pubkey,
    pub max_per_tx: u64,
    pub daily_limit: u64,
    pub timestamp: i64,
}

#[event]
pub struct PolicyPaused {
    pub policy: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PolicyResumed {
    pub policy: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PolicyUpdated {
    pub policy: Pubkey,
    pub old_agent: Pubkey,
    pub new_agent: Pubkey,
    pub old_max_per_tx: u64,
    pub new_max_per_tx: u64,
    pub old_daily_limit: u64,
    pub new_daily_limit: u64,
    pub timestamp: i64,
}

#[event]
pub struct Withdrawn {
    pub policy: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
