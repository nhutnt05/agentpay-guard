use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    constants::*,
    errors::AgentPayError,
    events::PaymentExecuted,
    state::{AgentPolicy, MerchantAllowlist, MerchantLimit, PaymentReceipt, SpendingRules},
    token_policy::check_mint_at_payment,
    utils::{apply_daily_spend, apply_daily_spend_or, apply_rolling_spend, compute_request_hash},
};

/// Agent pays an allowlisted merchant from the policy vault (docs/05 §4).
///
/// Field order is part of the design (docs/05 §4 "Account order rationale"):
/// `merchant_allowlist` precedes the token accounts so a non-allowlisted merchant fails
/// on the allowlist first. Do not reorder.
#[derive(Accounts)]
#[instruction(request_hash: [u8; 32])]
pub struct ExecutePayment<'info> {
    /// 1. Only signer with spending rights; also pays the receipt rent.
    #[account(mut)]
    pub agent: Signer<'info>,

    /// 2. Canonical policy PDA; authorizes the agent and pins mint/vault.
    #[account(
        mut,
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump,
        has_one = agent @ AgentPayError::UnauthorizedAgent,
        has_one = mint @ AgentPayError::InvalidMint,
        has_one = vault @ AgentPayError::InvalidVault,
        constraint = !policy.is_paused @ AgentPayError::PolicyPaused
    )]
    pub policy: Account<'info, AgentPolicy>,

    /// CHECK: (account 3) Merchant wallet identity only — never read or written.
    /// Bound by the `merchant_allowlist` PDA seeds + `has_one = merchant`, and by the
    /// merchant ATA check below. Must not be the current agent: `add_merchant` refuses the
    /// agent, but `update_policy(new_agent)` could later make an allowlisted merchant the
    /// agent, which would let the agent pay itself (threat T-29).
    #[account(constraint = merchant.key() != agent.key() @ AgentPayError::InvalidMerchant)]
    pub merchant: UncheckedAccount<'info>,

    /// 4. Must exist for (policy, merchant). Missing → `AccountNotInitialized`.
    #[account(
        seeds = [SEED_MERCHANT, policy.key().as_ref(), merchant.key().as_ref()],
        bump = merchant_allowlist.bump,
        has_one = policy,
        has_one = merchant,
        constraint = merchant_allowlist.is_allowed @ AgentPayError::MerchantNotAllowed
    )]
    pub merchant_allowlist: Account<'info, MerchantAllowlist>,

    /// CHECK: (F-03) Rolling-limit rules of this policy. Always passed (seed-derived, so the
    /// agent cannot substitute or omit it); enforced only if it exists, i.e. is owned by this
    /// program. Only this program can make the PDA program-owned, and sending lamports to the
    /// address does not change that, so nobody can turn a rule on or off except the owner.
    #[account(mut, seeds = [SEED_RULES, policy.key().as_ref()], bump)]
    pub spending_rules: UncheckedAccount<'info>,

    /// CHECK: (F-03) Per-merchant limits; same existence rule as `spending_rules`.
    #[account(mut, seeds = [SEED_MERCHANT_LIMIT, policy.key().as_ref(), merchant.key().as_ref()], bump)]
    pub merchant_limit: UncheckedAccount<'info>,

    /// 5. Classic SPL or Token-2022 mint (F-05); equality via `has_one = mint`. The token
    ///    program check sits here so a wrong program fails before the ATA derivations below.
    #[account(constraint = *mint.to_account_info().owner == token_program.key() @ AgentPayError::InvalidTokenProgram)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// 6. Vault ATA; authority must be the policy PDA.
    #[account(
        mut,
        constraint = vault.mint == mint.key() @ AgentPayError::InvalidVault,
        constraint = vault.owner == policy.key() @ AgentPayError::InvalidVault
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// 7. Merchant's ATA for the policy mint (ADR-022: ATA required in MVP).
    #[account(
        mut,
        constraint = merchant_token_account.owner == merchant.key()
            @ AgentPayError::InvalidMerchantTokenAccount,
        constraint = merchant_token_account.mint == mint.key()
            @ AgentPayError::InvalidMerchantTokenAccount,
        constraint = merchant_token_account.key()
            == get_associated_token_address_with_program_id(
                &merchant.key(),
                &mint.key(),
                &token_program.key()
            )
            @ AgentPayError::InvalidMerchantTokenAccount
    )]
    pub merchant_token_account: InterfaceAccount<'info, TokenAccount>,

    /// 8. Replay protection: `init` fails if this request hash was already executed.
    #[account(
        init,
        payer = agent,
        space = ANCHOR_DISCRIMINATOR_LEN + PaymentReceipt::INIT_SPACE,
        seeds = [SEED_RECEIPT, policy.key().as_ref(), request_hash.as_ref()],
        bump
    )]
    pub receipt: Account<'info, PaymentReceipt>,

    /// 9. Token program that owns the mint (classic or Token-2022, F-05).
    #[account(constraint = token_program.key() == *mint.to_account_info().owner @ AgentPayError::InvalidTokenProgram)]
    pub token_program: Interface<'info, TokenInterface>,

    /// 10.
    pub system_program: Program<'info, System>,
}

/// Handler steps 1–14 in the fixed order of docs/05 §4.1. Account constraints above have
/// already enforced: canonical policy PDA, agent signer, mint, vault, not paused, merchant
/// allowlisted, merchant ATA valid, classic Token program, receipt PDA fresh.
///
/// Atomicity: any error below (including in the CPI) aborts the transaction, rolling back
/// the receipt creation, the counter update and the transfer together.
pub fn handle_execute_payment(
    ctx: Context<ExecutePayment>,
    request_hash: [u8; 32],
    request_id: [u8; 16],
    amount: u64,
    expires_at: i64,
) -> Result<()> {
    // 1–2. Amount bounds.
    require!(amount > 0, AgentPayError::InvalidAmount);
    require!(
        amount <= ctx.accounts.policy.max_per_tx,
        AgentPayError::ExceedsMaxPerTx
    );

    // 3–5. Request lifetime: not expired, and not further ahead than the max TTL.
    let now = Clock::get()?.unix_timestamp;
    require!(now <= expires_at, AgentPayError::RequestExpired);
    let latest_allowed_expiry = now
        .checked_add(MAX_REQUEST_TTL_SECONDS)
        .ok_or(error!(AgentPayError::ArithmeticOverflow))?;
    require!(
        expires_at <= latest_allowed_expiry,
        AgentPayError::RequestExpiryTooFar
    );

    // 6. The supplied hash (used in the receipt seeds) must be the canonical hash of the
    //    actual payment fields; never trust it as-is.
    let policy_key = ctx.accounts.policy.key();
    let agent = ctx.accounts.agent.key();
    let merchant = ctx.accounts.merchant.key();
    let mint = ctx.accounts.mint.key();
    let expected = compute_request_hash(
        &policy_key,
        &agent,
        &merchant,
        &mint,
        amount,
        &request_id,
        expires_at,
    );
    require!(expected == request_hash, AgentPayError::InvalidRequestHash);

    // 7–9. Lazy UTC-day reset, checked accumulation, daily limit.
    let spend = apply_daily_spend(
        ctx.accounts.policy.spent_today,
        ctx.accounts.policy.day_index,
        now,
        amount,
        ctx.accounts.policy.daily_limit,
    )?;

    // 9a. F-03: optional rolling-window and per-merchant limits (checks only; written in 11).
    let rules = load_rule::<SpendingRules>(&ctx.accounts.spending_rules)?;
    let rolling = match &rules {
        Some(r) => {
            require_keys_eq!(r.policy, policy_key, AgentPayError::InvalidPolicyLimits);
            Some(apply_rolling_spend(
                r.buckets,
                r.current_hour,
                now,
                amount,
                r.rolling_limit,
            )?)
        }
        None => None,
    };
    let merchant_limit = load_rule::<MerchantLimit>(&ctx.accounts.merchant_limit)?;
    let merchant_spend = match &merchant_limit {
        Some(m) => {
            require_keys_eq!(m.policy, policy_key, AgentPayError::InvalidPolicyLimits);
            require_keys_eq!(m.merchant, merchant, AgentPayError::InvalidPolicyLimits);
            require!(
                amount <= m.max_per_tx,
                AgentPayError::ExceedsMerchantMaxPerTx
            );
            Some(apply_daily_spend_or(
                m.spent_today,
                m.day_index,
                now,
                amount,
                m.daily_limit,
                AgentPayError::ExceedsMerchantDailyLimit,
            )?)
        }
        None => None,
    };

    // 9b. F-05: Token-2022 transfer hook still unset and transfer fee still zero.
    check_mint_at_payment(&ctx.accounts.mint.to_account_info())?;

    // 10. Explicit balance check for a clear error (the Token program would also fail).
    require!(
        ctx.accounts.vault.amount >= amount,
        AgentPayError::InsufficientVaultBalance
    );

    // 11. Effects: spending counter.
    let policy = &mut ctx.accounts.policy;
    policy.spent_today = spend.spent_today;
    policy.day_index = spend.day_index;
    let owner = policy.owner;
    let policy_id = policy.policy_id;
    let policy_bump = policy.bump;

    // 11b. Effects: F-03 rule counters.
    if let (Some(mut r), Some(next)) = (rules, rolling) {
        r.buckets = next.buckets;
        r.current_hour = next.current_hour;
        store_rule(&ctx.accounts.spending_rules, &r)?;
    }
    if let (Some(mut m), Some(next)) = (merchant_limit, merchant_spend) {
        m.spent_today = next.spent_today;
        m.day_index = next.day_index;
        store_rule(&ctx.accounts.merchant_limit, &m)?;
    }

    // 12. Effects: receipt (account was created by the `init` constraint).
    let receipt_key = ctx.accounts.receipt.key();
    ctx.accounts.receipt.set_inner(PaymentReceipt {
        policy: policy_key,
        request_hash,
        agent,
        merchant,
        amount,
        mint,
        created_at: now,
        bump: ctx.bumps.receipt,
    });

    // 13. Interaction: vault → merchant ATA, signed by the policy PDA.
    let signer_seeds: &[&[&[u8]]] = &[&[
        SEED_POLICY,
        owner.as_ref(),
        policy_id.as_ref(),
        &[policy_bump],
    ]];
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.merchant_token_account.to_account_info(),
        authority: ctx.accounts.policy.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    // 14. Event (convenience only; chain state is authoritative).
    emit!(PaymentExecuted {
        policy: policy_key,
        receipt: receipt_key,
        request_hash,
        agent,
        merchant,
        mint,
        amount,
        spent_today: spend.spent_today,
        day_index: spend.day_index,
        timestamp: now,
    });
    Ok(())
}

/// F-03: an optional rule account exists iff this program owns it (then it must deserialize,
/// discriminator included); otherwise there is no rule.
fn load_rule<T: AccountDeserialize>(info: &AccountInfo) -> Result<Option<T>> {
    if info.owner != &crate::ID {
        return Ok(None);
    }
    let data = info.try_borrow_data()?;
    Ok(Some(T::try_deserialize(&mut &data[..])?))
}

fn store_rule<T: AccountSerialize>(info: &AccountInfo, value: &T) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    let mut writer: &mut [u8] = &mut data[..];
    value.try_serialize(&mut writer)
}
