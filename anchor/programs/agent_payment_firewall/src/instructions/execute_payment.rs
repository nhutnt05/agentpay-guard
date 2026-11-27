use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    errors::AgentPayError,
    events::PaymentExecuted,
    state::{AgentPolicy, MerchantAllowlist, PaymentReceipt},
    utils::{apply_daily_spend, compute_request_hash},
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
    /// merchant ATA check below.
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

    /// 5. Classic SPL mint (owner check rejects Token-2022); equality via `has_one = mint`.
    pub mint: Account<'info, Mint>,

    /// 6. Vault ATA; authority must be the policy PDA.
    #[account(
        mut,
        constraint = vault.mint == mint.key() @ AgentPayError::InvalidVault,
        constraint = vault.owner == policy.key() @ AgentPayError::InvalidVault
    )]
    pub vault: Account<'info, TokenAccount>,

    /// 7. Merchant's ATA for the policy mint (ADR-022: ATA required in MVP).
    #[account(
        mut,
        constraint = merchant_token_account.owner == merchant.key()
            @ AgentPayError::InvalidMerchantTokenAccount,
        constraint = merchant_token_account.mint == mint.key()
            @ AgentPayError::InvalidMerchantTokenAccount,
        constraint = merchant_token_account.key()
            == get_associated_token_address(&merchant.key(), &mint.key())
            @ AgentPayError::InvalidMerchantTokenAccount
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,

    /// 8. Replay protection: `init` fails if this request hash was already executed.
    #[account(
        init,
        payer = agent,
        space = ANCHOR_DISCRIMINATOR_LEN + PaymentReceipt::INIT_SPACE,
        seeds = [SEED_RECEIPT, policy.key().as_ref(), request_hash.as_ref()],
        bump
    )]
    pub receipt: Account<'info, PaymentReceipt>,

    /// 9. Classic SPL Token program only.
    pub token_program: Program<'info, Token>,

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
    token::transfer_checked(
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
