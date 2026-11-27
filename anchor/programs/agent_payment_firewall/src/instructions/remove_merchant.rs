use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::AgentPayError,
    events::MerchantRemoved,
    state::{AgentPolicy, MerchantAllowlist},
};

/// Owner removes a merchant: the allowlist account is closed and its rent refunded
/// to the owner (docs/05 §3, ADR-017). Re-adding later uses `add_merchant` (`init`) again.
#[derive(Accounts)]
pub struct RemoveMerchant<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// CHECK: Identity only — never read or written. Bound to the entry by its PDA seeds
    /// and `has_one = merchant`.
    pub merchant: UncheckedAccount<'info>,

    /// A merchant that was never added fails deserialization (`AccountNotInitialized`).
    #[account(
        mut,
        close = owner,
        seeds = [SEED_MERCHANT, policy.key().as_ref(), merchant.key().as_ref()],
        bump = merchant_allowlist.bump,
        has_one = policy,
        has_one = merchant
    )]
    pub merchant_allowlist: Account<'info, MerchantAllowlist>,
}

pub fn handle_remove_merchant(ctx: Context<RemoveMerchant>) -> Result<()> {
    emit!(MerchantRemoved {
        policy: ctx.accounts.policy.key(),
        merchant: ctx.accounts.merchant.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
