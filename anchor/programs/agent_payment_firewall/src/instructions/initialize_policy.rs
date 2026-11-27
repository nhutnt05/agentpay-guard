use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    events::PolicyInitialized,
    state::AgentPolicy,
    utils::{day_index, validate_agent, validate_limits},
};

/// Creates the Policy PDA and its vault ATA (docs/05 §1).
#[derive(Accounts)]
#[instruction(policy_id: [u8; 32])]
pub struct InitializePolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = ANCHOR_DISCRIMINATOR_LEN + AgentPolicy::INIT_SPACE,
        seeds = [SEED_POLICY, owner.key().as_ref(), policy_id.as_ref()],
        bump
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// Classic SPL Token mint (`anchor_spl::token::Mint` rejects Token-2022 by owner check).
    pub mint: Account<'info, Mint>,

    /// Vault = ATA(policy PDA, mint, classic Token program).
    /// `init_if_needed` (ADR-016): ATA creation is permissionless, so a pre-created canonical
    /// ATA must be adopted instead of failing. This is the ONLY use of `init_if_needed`.
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = policy,
        associated_token::token_program = token_program
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_policy(
    ctx: Context<InitializePolicy>,
    policy_id: [u8; 32],
    agent: Pubkey,
    max_per_tx: u64,
    daily_limit: u64,
) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    validate_limits(max_per_tx, daily_limit)?;
    validate_agent(&agent, &owner)?;

    let now = Clock::get()?.unix_timestamp;
    let policy_key = ctx.accounts.policy.key();
    let mint = ctx.accounts.mint.key();
    let vault = ctx.accounts.vault.key();

    ctx.accounts.policy.set_inner(AgentPolicy {
        owner,
        agent,
        mint,
        vault,
        policy_id,
        max_per_tx,
        daily_limit,
        spent_today: 0,
        day_index: day_index(now),
        is_paused: false,
        created_at: now,
        bump: ctx.bumps.policy,
    });

    emit!(PolicyInitialized {
        policy: policy_key,
        owner,
        agent,
        mint,
        vault,
        max_per_tx,
        daily_limit,
        timestamp: now,
    });
    Ok(())
}
