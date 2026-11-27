use anchor_lang::prelude::*;

use crate::{constants::*, errors::AgentPayError, events::PolicyPaused, state::AgentPolicy};

/// Owner emergency stop: blocks `execute_payment` only (docs/05 §5).
/// Owner instructions (withdraw, update, merchant management) keep working while paused.
#[derive(Accounts)]
pub struct PausePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,
}

pub fn handle_pause_policy(ctx: Context<PausePolicy>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require!(!policy.is_paused, AgentPayError::PolicyAlreadyPaused);
    policy.is_paused = true;
    emit!(PolicyPaused {
        policy: policy.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
