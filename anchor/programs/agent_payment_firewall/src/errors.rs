use anchor_lang::prelude::*;

/// Custom program errors. Codes are assigned from 6000 in declaration order.
/// NEVER reorder variants; only append (docs/05 §0.2).
#[error_code]
pub enum AgentPayError {
    #[msg("Policy is paused")]
    PolicyPaused, // 6000
    #[msg("Signer is not the policy agent")]
    UnauthorizedAgent, // 6001
    #[msg("Signer is not the policy owner")]
    UnauthorizedOwner, // 6002
    #[msg("Merchant is not allowlisted")]
    MerchantNotAllowed, // 6003
    #[msg("Mint does not match policy")]
    InvalidMint, // 6004
    #[msg("Vault does not match policy")]
    InvalidVault, // 6005
    #[msg("Merchant token account owner or mint is invalid")]
    InvalidMerchantTokenAccount, // 6006
    #[msg("Amount must be greater than zero")]
    InvalidAmount, // 6007
    #[msg("Amount exceeds per-transaction limit")]
    ExceedsMaxPerTx, // 6008
    #[msg("Amount exceeds remaining daily limit")]
    ExceedsDailyLimit, // 6009
    #[msg("Vault balance is insufficient")]
    InsufficientVaultBalance, // 6010
    #[msg("Request hash does not match payment fields")]
    InvalidRequestHash, // 6011
    #[msg("Payment request has expired")]
    RequestExpired, // 6012
    #[msg("Request expiry exceeds maximum TTL")]
    RequestExpiryTooFar, // 6013
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow, // 6014
    #[msg("Limits must be > 0 and max_per_tx <= daily_limit")]
    InvalidPolicyLimits, // 6015
    #[msg("Agent must be non-default and different from owner")]
    InvalidAgent, // 6016
    #[msg("Policy is already paused")]
    PolicyAlreadyPaused, // 6017
    #[msg("Policy is not paused")]
    PolicyNotPaused, // 6018
    #[msg("Withdraw destination must be an owner token account of the policy mint")]
    InvalidWithdrawDestination, // 6019
    #[msg("update_policy called with no changes")]
    EmptyUpdate, // 6020
    #[msg("Merchant must not be default, the policy, the vault, or the agent")]
    InvalidMerchant, // 6021
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Error codes are part of the public interface (backend maps them). Guard the order.
    #[test]
    fn error_codes_are_stable() {
        let code = |e: AgentPayError| u32::from(e);
        assert_eq!(code(AgentPayError::PolicyPaused), 6000);
        assert_eq!(code(AgentPayError::MerchantNotAllowed), 6003);
        assert_eq!(code(AgentPayError::ExceedsDailyLimit), 6009);
        assert_eq!(code(AgentPayError::InvalidRequestHash), 6011);
        assert_eq!(code(AgentPayError::ArithmeticOverflow), 6014);
        assert_eq!(code(AgentPayError::InvalidPolicyLimits), 6015);
        assert_eq!(code(AgentPayError::InvalidAgent), 6016);
        assert_eq!(code(AgentPayError::InvalidMerchant), 6021);
    }
}
