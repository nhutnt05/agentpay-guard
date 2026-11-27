use anchor_lang::prelude::*;

use crate::{constants::*, errors::AgentPayError, events::PolicyResumed, state::AgentPolicy};

/// Owner re-enables agent payments after a pause (docs/05 §6).
#[derive(Accounts)]
pub struct ResumePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,
}

pub fn handle_resume_policy(ctx: Context<ResumePolicy>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    require!(policy.is_paused, AgentPayError::PolicyNotPaused);
    policy.is_paused = false;
    emit!(PolicyResumed {
        policy: policy.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
