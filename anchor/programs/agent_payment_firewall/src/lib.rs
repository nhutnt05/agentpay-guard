pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("GvjcbQ2g7dg6ZNNBffhyVLmSz8ncbaEvL2c4M1Esayza");

/// AgentPay Guard — on-chain payment firewall for AI agents.
/// `lib.rs` only dispatches; logic lives in `instructions/*`.
#[program]
pub mod agent_payment_firewall {
    use super::*;

    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        policy_id: [u8; 32],
        agent: Pubkey,
        max_per_tx: u64,
        daily_limit: u64,
    ) -> Result<()> {
        instructions::initialize_policy::handle_initialize_policy(
            ctx,
            policy_id,
            agent,
            max_per_tx,
            daily_limit,
        )
    }

    pub fn add_merchant(ctx: Context<AddMerchant>) -> Result<()> {
        instructions::add_merchant::handle_add_merchant(ctx)
    }

    pub fn remove_merchant(ctx: Context<RemoveMerchant>) -> Result<()> {
        instructions::remove_merchant::handle_remove_merchant(ctx)
    }

    /// Arguments order matters: `request_hash` is first because it is used in the receipt seeds.
    pub fn execute_payment(
        ctx: Context<ExecutePayment>,
        request_hash: [u8; 32],
        request_id: [u8; 16],
        amount: u64,
        expires_at: i64,
    ) -> Result<()> {
        instructions::execute_payment::handle_execute_payment(
            ctx,
            request_hash,
            request_id,
            amount,
            expires_at,
        )
    }

    pub fn pause_policy(ctx: Context<PausePolicy>) -> Result<()> {
        instructions::pause_policy::handle_pause_policy(ctx)
    }

    pub fn resume_policy(ctx: Context<ResumePolicy>) -> Result<()> {
        instructions::resume_policy::handle_resume_policy(ctx)
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        new_max_per_tx: Option<u64>,
        new_daily_limit: Option<u64>,
        new_agent: Option<Pubkey>,
    ) -> Result<()> {
        instructions::update_policy::handle_update_policy(
            ctx,
            new_max_per_tx,
            new_daily_limit,
            new_agent,
        )
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }
}
