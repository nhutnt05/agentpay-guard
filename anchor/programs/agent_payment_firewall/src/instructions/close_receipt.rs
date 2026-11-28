use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::AgentPayError,
    events::ReceiptClosed,
    state::{AgentPolicy, PaymentReceipt},
};

/// Closes an old receipt and refunds its rent to the agent that paid it (F-02, docs/16 §1).
///
/// Safety argument: `execute_payment` only accepts `expires_at <= now + MAX_REQUEST_TTL_SECONDS`
/// and stores `created_at = now`, so every executed request has
/// `expires_at <= created_at + MAX_REQUEST_TTL_SECONDS`. The receipt may only be closed after
/// that bound plus `RECEIPT_CLOSE_GRACE_SECONDS`, so a replay of the same request (same hash,
/// same `expires_at`) fails with `RequestExpired` even though the receipt no longer exists.
#[derive(Accounts)]
pub struct CloseReceipt<'info> {
    /// Policy owner or the agent recorded in the receipt.
    pub closer: Signer<'info>,

    #[account(
        seeds = [SEED_POLICY, policy.owner.as_ref(), policy.policy_id.as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, AgentPolicy>,

    #[account(
        mut,
        close = rent_destination,
        seeds = [SEED_RECEIPT, policy.key().as_ref(), receipt.request_hash.as_ref()],
        bump = receipt.bump,
        has_one = policy
    )]
    pub receipt: Account<'info, PaymentReceipt>,

    /// CHECK: Lamport destination only; must be the agent that paid the receipt rent.
    #[account(
        mut,
        address = receipt.agent @ AgentPayError::InvalidRentDestination
    )]
    pub rent_destination: UncheckedAccount<'info>,
}

pub fn handle_close_receipt(ctx: Context<CloseReceipt>) -> Result<()> {
    let closer = ctx.accounts.closer.key();
    let receipt = &ctx.accounts.receipt;
    require!(
        closer == ctx.accounts.policy.owner || closer == receipt.agent,
        AgentPayError::UnauthorizedCloser
    );

    let now = Clock::get()?.unix_timestamp;
    let closable_at = receipt
        .created_at
        .checked_add(MAX_REQUEST_TTL_SECONDS)
        .and_then(|t| t.checked_add(RECEIPT_CLOSE_GRACE_SECONDS))
        .ok_or(error!(AgentPayError::ArithmeticOverflow))?;
    require!(now >= closable_at, AgentPayError::ReceiptNotExpired);

    emit!(ReceiptClosed {
        policy: receipt.policy,
        receipt: receipt.key(),
        request_hash: receipt.request_hash,
        merchant: receipt.merchant,
        amount: receipt.amount,
        closer,
        rent_destination: receipt.agent,
        lamports: receipt.to_account_info().lamports(),
        timestamp: now,
    });
    Ok(())
}
