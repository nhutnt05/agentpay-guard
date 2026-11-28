use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::AgentPayError,
    events::{MerchantLimitSet, SpendingRulesSet},
    state::{AgentPolicy, MerchantAllowlist, MerchantLimit, SpendingRules},
    utils::{day_index, validate_limits},
};

// F-03 owner instructions (docs/16 §2). The rule accounts are optional: their EXISTENCE turns
// the rule on, and `execute_payment` always receives their (seed-derived) addresses, so the
// agent cannot leave a rule out. Allowed while the policy is paused.

#[derive(Accounts)]
pub struct SetSpendingRules<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// `init_if_needed`: owner-only and every field is written below (a pre-funded address is
    /// adopted by Anchor's init path, so nobody can block the owner by sending lamports).
    #[account(
        init_if_needed,
        payer = owner,
        space = ANCHOR_DISCRIMINATOR_LEN + SpendingRules::INIT_SPACE,
        seeds = [SEED_RULES, policy.key().as_ref()],
        bump
    )]
    pub spending_rules: Account<'info, SpendingRules>,

    pub system_program: Program<'info, System>,
}

pub fn handle_set_spending_rules(ctx: Context<SetSpendingRules>, rolling_limit: u64) -> Result<()> {
    require!(rolling_limit > 0, AgentPayError::InvalidPolicyLimits);
    let now = Clock::get()?.unix_timestamp;
    let policy = ctx.accounts.policy.key();
    let rules = &mut ctx.accounts.spending_rules;
    if rules.policy == Pubkey::default() {
        // New account: empty window starting now.
        rules.policy = policy;
        rules.buckets = [0; ROLLING_BUCKETS];
        rules.current_hour = now.div_euclid(SECONDS_PER_HOUR);
        rules.bump = ctx.bumps.spending_rules;
    }
    // Existing account: only the limit changes; spend already in the window still counts.
    rules.rolling_limit = rolling_limit;
    emit!(SpendingRulesSet {
        policy,
        rolling_limit,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseSpendingRules<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,

    #[account(
        mut,
        close = owner,
        seeds = [SEED_RULES, policy.key().as_ref()],
        bump = spending_rules.bump,
        has_one = policy
    )]
    pub spending_rules: Account<'info, SpendingRules>,
}

pub fn handle_close_spending_rules(_ctx: Context<CloseSpendingRules>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct SetMerchantLimit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// CHECK: Identity only; bound by the allowlist and limit PDA seeds.
    pub merchant: UncheckedAccount<'info>,

    /// Limits only make sense for an allowlisted merchant (missing → AccountNotInitialized).
    #[account(
        seeds = [SEED_MERCHANT, policy.key().as_ref(), merchant.key().as_ref()],
        bump = merchant_allowlist.bump,
        has_one = policy,
        has_one = merchant
    )]
    pub merchant_allowlist: Account<'info, MerchantAllowlist>,

    #[account(
        init_if_needed,
        payer = owner,
        space = ANCHOR_DISCRIMINATOR_LEN + MerchantLimit::INIT_SPACE,
        seeds = [SEED_MERCHANT_LIMIT, policy.key().as_ref(), merchant.key().as_ref()],
        bump
    )]
    pub merchant_limit: Account<'info, MerchantLimit>,

    pub system_program: Program<'info, System>,
}

pub fn handle_set_merchant_limit(
    ctx: Context<SetMerchantLimit>,
    max_per_tx: u64,
    daily_limit: u64,
) -> Result<()> {
    validate_limits(max_per_tx, daily_limit)?;
    let now = Clock::get()?.unix_timestamp;
    let policy = ctx.accounts.policy.key();
    let merchant = ctx.accounts.merchant.key();
    let limit = &mut ctx.accounts.merchant_limit;
    if limit.policy == Pubkey::default() {
        limit.policy = policy;
        limit.merchant = merchant;
        limit.spent_today = 0;
        limit.day_index = day_index(now);
        limit.bump = ctx.bumps.merchant_limit;
    }
    limit.max_per_tx = max_per_tx;
    limit.daily_limit = daily_limit;
    emit!(MerchantLimitSet {
        policy,
        merchant,
        max_per_tx,
        daily_limit,
        timestamp: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseMerchantLimit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = owner @ AgentPayError::UnauthorizedOwner
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// CHECK: Identity only; bound by the limit PDA seeds.
    pub merchant: UncheckedAccount<'info>,

    #[account(
        mut,
        close = owner,
        seeds = [SEED_MERCHANT_LIMIT, policy.key().as_ref(), merchant.key().as_ref()],
        bump = merchant_limit.bump,
        has_one = policy,
        has_one = merchant
    )]
    pub merchant_limit: Account<'info, MerchantLimit>,
}

pub fn handle_close_merchant_limit(_ctx: Context<CloseMerchantLimit>) -> Result<()> {
    Ok(())
}
