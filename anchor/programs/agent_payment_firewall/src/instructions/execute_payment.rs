use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    errors::AgentPayError,
    state::{AgentPolicy, MerchantAllowlist, PaymentReceipt},
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

/// TEMPORARY (T-M2-03): accounts struct only. Always fails, so a transaction can never
/// leave a receipt or move tokens (the failed transaction rolls back the receipt `init`).
/// Replaced by the full validation + transfer logic in T-M2-04 (docs/05 §4.1).
pub fn handle_execute_payment(
    _ctx: Context<ExecutePayment>,
    _request_hash: [u8; 32],
    _request_id: [u8; 16],
    _amount: u64,
    _expires_at: i64,
) -> Result<()> {
    msg!("execute_payment handler not implemented yet (T-M2-04)");
    Err(ProgramError::InvalidInstructionData.into())
}
