use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, errors::AgentPayError, events::Withdrawn, state::AgentPolicy};

/// Owner withdraws tokens from the vault to a token account the owner controls
/// (docs/05 §8). The agent can never call this successfully (`has_one = owner`).
/// Allowed while paused; does not touch the spending counter.
#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner,
        has_one = mint @ AgentPayError::InvalidMint,
        has_one = vault @ AgentPayError::InvalidVault
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// Classic SPL or Token-2022 mint; equality via `has_one = mint`.
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = vault.mint == mint.key() @ AgentPayError::InvalidVault,
        constraint = vault.owner == policy.key() @ AgentPayError::InvalidVault
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Any token account of the policy mint whose authority is the owner
    /// (ATA not required). Funds can never be routed to a third party.
    #[account(
        mut,
        constraint = destination.owner == owner.key() @ AgentPayError::InvalidWithdrawDestination,
        constraint = destination.mint == mint.key() @ AgentPayError::InvalidWithdrawDestination
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    #[account(constraint = token_program.key() == *mint.to_account_info().owner @ AgentPayError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, AgentPayError::InvalidAmount);
    require!(
        ctx.accounts.vault.amount >= amount,
        AgentPayError::InsufficientVaultBalance
    );

    let policy = &ctx.accounts.policy;
    let policy_key = policy.key();
    let owner = policy.owner;
    let policy_id = policy.policy_id;
    let signer_seeds: &[&[&[u8]]] = &[&[
        SEED_POLICY,
        owner.as_ref(),
        policy_id.as_ref(),
        &[policy.bump],
    ]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.policy.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    emit!(Withdrawn {
        policy: policy_key,
        destination: ctx.accounts.destination.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
