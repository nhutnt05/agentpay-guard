use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::AgentPayError,
    events::PolicyUpdated,
    state::AgentPolicy,
    utils::{validate_agent, validate_limits},
};

/// Owner changes limits and/or replaces the agent (docs/05 §7).
/// The policy PDA, vault, merchants and receipts are unchanged; `mint`, `vault`, `owner`
/// and `policy_id` are immutable (no argument exists for them). Allowed while paused.
#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,
}

pub fn handle_update_policy(
    ctx: Context<UpdatePolicy>,
    new_max_per_tx: Option<u64>,
    new_daily_limit: Option<u64>,
    new_agent: Option<Pubkey>,
) -> Result<()> {
    require!(
        new_max_per_tx.is_some() || new_daily_limit.is_some() || new_agent.is_some(),
        AgentPayError::EmptyUpdate
    );

    let policy = &mut ctx.accounts.policy;
    let old_agent = policy.agent;
    let old_max_per_tx = policy.max_per_tx;
    let old_daily_limit = policy.daily_limit;

    // Validate the RESULTING limits (a partial update must keep the invariant too).
    let max_per_tx = new_max_per_tx.unwrap_or(old_max_per_tx);
    let daily_limit = new_daily_limit.unwrap_or(old_daily_limit);
    validate_limits(max_per_tx, daily_limit)?;

    let agent = new_agent.unwrap_or(old_agent);
    if new_agent.is_some() {
        validate_agent(&agent, &policy.owner)?;
    }

    // `spent_today` / `day_index` are deliberately NOT reset: lowering `daily_limit`
    // below `spent_today` blocks further payments until the next UTC day.
    policy.max_per_tx = max_per_tx;
    policy.daily_limit = daily_limit;
    policy.agent = agent;

    emit!(PolicyUpdated {
        policy: policy.key(),
        old_agent,
        new_agent: agent,
        old_max_per_tx,
        new_max_per_tx: max_per_tx,
        old_daily_limit,
        new_daily_limit: daily_limit,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
