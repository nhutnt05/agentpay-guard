//! F-05 Token-2022 support: which mint extensions a policy may use (docs/16 §4.2).
//!
//! Classic SPL Token mints have no extensions and pass every check. For Token-2022 mints:
//! - at `initialize_policy` the mint's extension set must be on the allowlist below
//!   (extensions are fixed when the mint is created), and `PermanentDelegate` — an issuer
//!   power that can move vault funds — requires the owner's explicit `accept_issuer_powers`;
//! - at every `execute_payment` the two extensions whose *configuration* the issuer can change
//!   later must still be inert: transfer hook program unset, transfer fee 0 for this epoch.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        transfer_fee::TransferFeeConfig, transfer_hook::TransferHook, BaseStateWithExtensions,
        ExtensionType, StateWithExtensions,
    },
    state::Mint as MintState,
    ID as TOKEN_2022_ID,
};

use crate::errors::AgentPayError;

fn is_token_2022(mint: &AccountInfo) -> bool {
    mint.owner.to_bytes() == TOKEN_2022_ID.to_bytes()
}

/// Init-time check of the mint's extension set.
pub fn check_mint_extensions_at_init(mint: &AccountInfo, accept_issuer_powers: bool) -> Result<()> {
    if !is_token_2022(mint) {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    for ext in state.get_extension_types()? {
        match ext {
            // Issuer powers:
            // - PermanentDelegate: issuer can move funds out of any account of this mint,
            //   including the vault.
            // - MintCloseAuthority: once supply is 0 the issuer can close the mint and recreate
            //   it at the same address with a different extension set (e.g. PermanentDelegate,
            //   DefaultAccountState) that this init-time check never saw (threat T-31).
            ExtensionType::PermanentDelegate | ExtensionType::MintCloseAuthority => {
                require!(accept_issuer_powers, AgentPayError::IssuerPowersNotAccepted)
            }
            // Re-checked at every payment (configurable later by the issuer).
            ExtensionType::TransferFeeConfig | ExtensionType::TransferHook => {}
            // No effect on what the vault can send or what the merchant receives:
            // display-only, metadata, groups, close-at-zero-supply, issuer pause (availability
            // only), and confidential transfers (the vault never configures confidential
            // balances — that would need the policy PDA to sign ConfigureAccount).
            ExtensionType::ConfidentialTransferMint
            | ExtensionType::ConfidentialTransferFeeConfig
            | ExtensionType::MetadataPointer
            | ExtensionType::TokenMetadata
            | ExtensionType::InterestBearingConfig
            | ExtensionType::ScaledUiAmount
            | ExtensionType::GroupPointer
            | ExtensionType::TokenGroup
            | ExtensionType::GroupMemberPointer
            | ExtensionType::TokenGroupMember
            | ExtensionType::Pausable => {}
            // NonTransferable, DefaultAccountState (issuer can freeze new ATAs),
            // ConfidentialMintBurn and any extension added in the future: rejected.
            _ => return err!(AgentPayError::UnsupportedMintExtension),
        }
    }
    check_configurable_extensions(&state, Clock::get()?.epoch)
}

/// Payment-time check: transfer hook still unset and transfer fee still zero.
pub fn check_mint_at_payment(mint: &AccountInfo) -> Result<()> {
    if !is_token_2022(mint) {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<MintState>::unpack(&data)?;
    check_configurable_extensions(&state, Clock::get()?.epoch)
}

fn check_configurable_extensions(state: &StateWithExtensions<MintState>, epoch: u64) -> Result<()> {
    if let Ok(fee) = state.get_extension::<TransferFeeConfig>() {
        let f = fee.get_epoch_fee(epoch);
        require!(
            u16::from(f.transfer_fee_basis_points) == 0 && u64::from(f.maximum_fee) == 0,
            AgentPayError::UnsupportedMintExtension
        );
    }
    if let Ok(hook) = state.get_extension::<TransferHook>() {
        require!(
            hook.program_id.0.to_bytes() == [0u8; 32],
            AgentPayError::UnsupportedMintExtension
        );
    }
    Ok(())
}
