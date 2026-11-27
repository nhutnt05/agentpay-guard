use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::AgentPayError,
    events::MerchantAdded,
    state::{AgentPolicy, MerchantAllowlist},
    utils::validate_merchant,
};

/// Owner allowlists a merchant wallet for this policy (docs/05 §2).
/// Allowed while the policy is paused.
#[derive(Accounts)]
pub struct AddMerchant<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Seeds use the stored owner (proves a canonical policy PDA);
    /// `has_one = owner` is the authorization check (readable custom error).
    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// CHECK: Identity only — never read or written. Bound to the allowlist entry
    /// through the `merchant_allowlist` PDA seeds.
    pub merchant: UncheckedAccount<'info>,

    /// `init` (not `init_if_needed`): adding an existing merchant fails (ADR-017).
    #[account(
        init,
        payer = owner,
        space = ANCHOR_DISCRIMINATOR_LEN + MerchantAllowlist::INIT_SPACE,
        seeds = [SEED_MERCHANT, policy.key().as_ref(), merchant.key().as_ref()],
        bump
    )]
    pub merchant_allowlist: Account<'info, MerchantAllowlist>,

    pub system_program: Program<'info, System>,
}

pub fn handle_add_merchant(ctx: Context<AddMerchant>) -> Result<()> {
    let policy = &ctx.accounts.policy;
    let policy_key = policy.key();
    let merchant = ctx.accounts.merchant.key();
    validate_merchant(&merchant, &policy_key, &policy.vault, &policy.agent)?;

    let now = Clock::get()?.unix_timestamp;
    ctx.accounts
        .merchant_allowlist
        .set_inner(MerchantAllowlist {
            policy: policy_key,
            merchant,
            is_allowed: true,
            created_at: now,
            bump: ctx.bumps.merchant_allowlist,
        });

    emit!(MerchantAdded {
        policy: policy_key,
        merchant,
        timestamp: now,
    });
    Ok(())
}
