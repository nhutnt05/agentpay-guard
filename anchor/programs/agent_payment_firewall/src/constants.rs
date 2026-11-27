use anchor_lang::prelude::*;

/// Anchor account discriminator length (default 8-byte discriminator).
pub const ANCHOR_DISCRIMINATOR_LEN: usize = 8;

/// PDA seed for `AgentPolicy`: [SEED_POLICY, owner, policy_id].
#[constant]
pub const SEED_POLICY: &[u8] = b"policy";

/// PDA seed for `MerchantAllowlist`: [SEED_MERCHANT, policy, merchant].
#[constant]
pub const SEED_MERCHANT: &[u8] = b"merchant";

/// PDA seed for `PaymentReceipt`: [SEED_RECEIPT, policy, request_hash].
#[constant]
pub const SEED_RECEIPT: &[u8] = b"receipt";

/// Domain separator of the canonical request hash (docs/11 §3). 25 bytes.
#[constant]
pub const REQUEST_HASH_DOMAIN: &[u8] = b"AGENTPAY_GUARD_PAYMENT_V1";

/// UTC day length used for the daily spending window.
#[constant]
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Maximum distance of `expires_at` into the future for a payment request.
#[constant]
pub const MAX_REQUEST_TTL_SECONDS: i64 = 600;
