//! F-05 Token-2022 support (docs/16 §4): T22-01…T22-09 against the real Token-2022 program
//! bundled with LiteSVM (spl_token_2022 11.0.0) and real mint extensions.

#![allow(clippy::result_large_err)]

mod common;

use {
    agent_payment_firewall::errors::AgentPayError,
    anchor_lang::{prelude::Pubkey, solana_program::system_instruction},
    common::*,
    litesvm::{types::TransactionResult, LiteSVM},
    solana_keypair::Keypair,
    solana_signer::Signer,
    spl_associated_token_account_interface::{
        address::get_associated_token_address_with_program_id,
        instruction::create_associated_token_account,
    },
    spl_token_2022_interface::{
        extension::{
            default_account_state::instruction::initialize_default_account_state,
            transfer_fee::instruction::{initialize_transfer_fee_config, set_transfer_fee},
            transfer_hook::instruction::{initialize as init_hook, update as update_hook},
            BaseStateWithExtensions, ExtensionType, StateWithExtensions,
        },
        instruction as t22,
        state::{Account as T22Account, AccountState, Mint as T22Mint},
        ID as T22,
    },
};

#[derive(Clone, Copy)]
enum Ext {
    TransferFee(u16, u64),
    TransferHook,
    PermanentDelegate,
    NonTransferable,
    DefaultFrozen,
    MintClose,
}

/// Creates a Token-2022 mint with the given extensions; `authority` is mint, freeze and
/// extension authority.
fn create_mint_2022(svm: &mut LiteSVM, authority: &Keypair, exts: &[Ext]) -> Pubkey {
    let mint = Keypair::new();
    let m = mint.pubkey();
    let a = authority.pubkey();
    let types: Vec<ExtensionType> = exts
        .iter()
        .map(|e| match e {
            Ext::TransferFee(..) => ExtensionType::TransferFeeConfig,
            Ext::TransferHook => ExtensionType::TransferHook,
            Ext::PermanentDelegate => ExtensionType::PermanentDelegate,
            Ext::NonTransferable => ExtensionType::NonTransferable,
            Ext::DefaultFrozen => ExtensionType::DefaultAccountState,
            Ext::MintClose => ExtensionType::MintCloseAuthority,
        })
        .collect();
    let space = ExtensionType::try_calculate_account_len::<T22Mint>(&types).unwrap();
    let rent = svm.minimum_balance_for_rent_exemption(space);
    let mut ixs = vec![system_instruction::create_account(
        &a,
        &m,
        rent,
        space as u64,
        &T22,
    )];
    for e in exts {
        ixs.push(match *e {
            Ext::TransferFee(bps, max) => {
                initialize_transfer_fee_config(&T22, &m, Some(&a), Some(&a), bps, max).unwrap()
            }
            Ext::TransferHook => init_hook(&T22, &m, Some(a), None).unwrap(),
            Ext::PermanentDelegate => t22::initialize_permanent_delegate(&T22, &m, &a).unwrap(),
            Ext::NonTransferable => t22::initialize_non_transferable_mint(&T22, &m).unwrap(),
            Ext::DefaultFrozen => {
                initialize_default_account_state(&T22, &m, &AccountState::Frozen).unwrap()
            }
            Ext::MintClose => t22::initialize_mint_close_authority(&T22, &m, Some(&a)).unwrap(),
        });
    }
    ixs.push(t22::initialize_mint2(&T22, &m, &a, Some(&a), DECIMALS).unwrap());
    send(svm, &ixs, authority, &[&mint]).expect("create Token-2022 mint");
    m
}

fn ata_2022(svm: &mut LiteSVM, payer: &Keypair, wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    let ix = create_associated_token_account(&payer.pubkey(), wallet, mint, &T22);
    send(svm, &[ix], payer, &[]).expect("create Token-2022 ATA");
    get_associated_token_address_with_program_id(wallet, mint, &T22)
}

fn balance_2022(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let acc = svm.get_account(address).expect("token account");
    assert_eq!(acc.owner, T22);
    StateWithExtensions::<T22Account>::unpack(&acc.data)
        .unwrap()
        .base
        .amount
}

/// Policy on a Token-2022 mint + allowlisted merchant with a Token-2022 ATA + funded vault.
struct Env22 {
    svm: LiteSVM,
    owner: Keypair,
    agent: Keypair,
    mint: Pubkey,
    policy: Pubkey,
    vault: Pubkey,
    merchant: Pubkey,
    merchant_ata: Pubkey,
}

fn init_policy(
    svm: &mut LiteSVM,
    owner: &Keypair,
    agent: &Pubkey,
    mint: &Pubkey,
    accept: bool,
) -> (Pubkey, TransactionResult) {
    let policy_id = random_policy_id();
    let policy = policy_pda(&owner.pubkey(), &policy_id).0;
    let ix = initialize_policy_ix_full(
        &owner.pubkey(),
        mint,
        policy_id,
        *agent,
        DEFAULT_MAX_PER_TX,
        DEFAULT_DAILY_LIMIT,
        accept,
        &T22,
    );
    (policy, send(svm, &[ix], owner, &[]))
}

fn env22(exts: &[Ext], accept: bool) -> Env22 {
    let mut svm = new_svm();
    let owner = funded_keypair(&mut svm);
    let agent = funded_keypair(&mut svm);
    let mint = create_mint_2022(&mut svm, &owner, exts);
    let (policy, res) = init_policy(&mut svm, &owner, &agent.pubkey(), &mint, accept);
    res.expect("initialize policy on Token-2022 mint");
    let vault = get_associated_token_address_with_program_id(&policy, &mint, &T22);
    let merchant = Pubkey::new_unique();
    send(
        &mut svm,
        &[add_merchant_ix(&owner.pubkey(), &policy, &merchant)],
        &owner,
        &[],
    )
    .expect("add merchant");
    let merchant_ata = ata_2022(&mut svm, &owner, &merchant, &mint);
    let ix = t22::mint_to(&T22, &mint, &vault, &owner.pubkey(), &[], VAULT_FUNDING).unwrap();
    send(&mut svm, &[ix], &owner, &[]).expect("fund vault");
    Env22 {
        svm,
        owner,
        agent,
        mint,
        policy,
        vault,
        merchant,
        merchant_ata,
    }
}

impl Env22 {
    fn request(&self, amount: u64) -> PaymentRequest {
        payment_request(
            &self.policy,
            &self.agent.pubkey(),
            &self.merchant,
            &self.mint,
            amount,
        )
    }
    fn accounts(&self, req: &PaymentRequest) -> PaymentAccounts {
        PaymentAccounts {
            agent: self.agent.pubkey(),
            policy: self.policy,
            merchant: self.merchant,
            merchant_allowlist: merchant_pda(&self.policy, &self.merchant).0,
            mint: self.mint,
            vault: self.vault,
            merchant_token_account: self.merchant_ata,
            receipt: receipt_pda(&self.policy, &req.request_hash).0,
            token_program: T22,
        }
    }
    fn pay_with(&mut self, accounts: &PaymentAccounts, req: &PaymentRequest) -> TransactionResult {
        let agent = self.agent.insecure_clone();
        send(
            &mut self.svm,
            &[execute_payment_ix(accounts, req)],
            &agent,
            &[],
        )
    }
    fn pay(&mut self, req: &PaymentRequest) -> TransactionResult {
        let accounts = self.accounts(req);
        self.pay_with(&accounts, req)
    }
    fn balances(&self) -> (u64, u64, u64) {
        (
            balance_2022(&self.svm, &self.vault),
            balance_2022(&self.svm, &self.merchant_ata),
            fetch_policy(&self.svm, &self.policy).spent_today,
        )
    }
    fn assert_payment_rejected(&mut self, amount: u64, code: u32) {
        let before = self.balances();
        let req = self.request(amount);
        assert_error_code(self.pay(&req), code);
        assert_eq!(self.balances(), before, "state must be unchanged");
        assert!(!account_exists(
            &self.svm,
            &receipt_pda(&self.policy, &req.request_hash).0
        ));
    }
}

/// T22-01: plain Token-2022 mint — full payment through the Token-2022 program.
#[test]
fn t22_01_plain_token_2022_payment() {
    let mut env = env22(&[], false);
    let req = env.request(3 * ONE);
    env.pay(&req).expect("payment");
    assert_eq!(env.balances(), (VAULT_FUNDING - 3 * ONE, 3 * ONE, 3 * ONE));
    let receipt = fetch_receipt(&env.svm, &receipt_pda(&env.policy, &req.request_hash).0);
    assert_eq!(receipt.mint, env.mint);
    assert_eq!(receipt.amount, 3 * ONE);
}

/// T22-03: token program must be the mint's owner (Token-2022 mint + classic program).
#[test]
fn t22_03_classic_program_for_token_2022_mint_rejected() {
    let mut env = env22(&[], false);
    let before = env.balances();
    let req = env.request(ONE);
    let mut accounts = env.accounts(&req);
    accounts.token_program = spl_token_interface::ID;
    assert_error_code(
        env.pay_with(&accounts, &req),
        custom(AgentPayError::InvalidTokenProgram),
    );
    assert_eq!(env.balances(), before);
}

/// T22-04: PermanentDelegate (issuer power) needs the owner's explicit opt-in.
#[test]
fn t22_04_permanent_delegate_requires_opt_in() {
    let mut svm = new_svm();
    let owner = funded_keypair(&mut svm);
    let agent = Keypair::new();
    let mint = create_mint_2022(&mut svm, &owner, &[Ext::PermanentDelegate]);
    let (policy, res) = init_policy(&mut svm, &owner, &agent.pubkey(), &mint, false);
    assert_error_code(res, custom(AgentPayError::IssuerPowersNotAccepted));
    assert!(!account_exists(&svm, &policy));

    let (policy, res) = init_policy(&mut svm, &owner, &agent.pubkey(), &mint, true);
    res.expect("accepted issuer powers");
    assert_eq!(fetch_policy(&svm, &policy).mint, mint);
}

/// T22-05: transfer hook unset → payments work; once the issuer sets a hook program →
/// rejected, nothing moves.
#[test]
fn t22_05_transfer_hook_must_stay_unset() {
    let mut env = env22(&[Ext::TransferHook], false);
    env.pay(&env.request(ONE)).expect("hook unset: payment ok");

    let owner = env.owner.insecure_clone();
    let hook_program = Pubkey::new_unique();
    let ix = update_hook(&T22, &env.mint, &owner.pubkey(), &[], Some(hook_program)).unwrap();
    send(&mut env.svm, &[ix], &owner, &[]).expect("issuer sets a hook");
    env.assert_payment_rejected(ONE, custom(AgentPayError::UnsupportedMintExtension));
}

/// T22-06: transfer fee 0 → payments work; the issuer raises the fee (effective two epochs
/// later) → still fine until then, rejected once it applies.
#[test]
fn t22_06_transfer_fee_must_stay_zero() {
    let mut env = env22(&[Ext::TransferFee(0, 0)], false);
    env.pay(&env.request(ONE)).expect("zero fee: payment ok");

    let owner = env.owner.insecure_clone();
    let ix = set_transfer_fee(&T22, &env.mint, &owner.pubkey(), &[], 100, ONE).unwrap();
    send(&mut env.svm, &[ix], &owner, &[]).expect("issuer raises fee");
    env.pay(&env.request(ONE))
        .expect("new fee not yet effective this epoch");

    let mut clock: anchor_lang::prelude::Clock = env.svm.get_sysvar();
    clock.epoch += 2;
    env.svm.set_sysvar(&clock);
    env.assert_payment_rejected(ONE, custom(AgentPayError::UnsupportedMintExtension));
}

/// T22-06b: a mint created with a non-zero fee is rejected at init.
#[test]
fn t22_06b_nonzero_fee_rejected_at_init() {
    let mut svm = new_svm();
    let owner = funded_keypair(&mut svm);
    let mint = create_mint_2022(&mut svm, &owner, &[Ext::TransferFee(50, ONE)]);
    let (_, res) = init_policy(&mut svm, &owner, &Pubkey::new_unique(), &mint, true);
    assert_error_code(res, custom(AgentPayError::UnsupportedMintExtension));
}

/// T22-07: NonTransferable and DefaultAccountState are rejected at init, even with opt-in.
#[test]
fn t22_07_unsupported_extensions_rejected() {
    for ext in [Ext::NonTransferable, Ext::DefaultFrozen] {
        let mut svm = new_svm();
        let owner = funded_keypair(&mut svm);
        let mint = create_mint_2022(&mut svm, &owner, &[ext]);
        let (policy, res) = init_policy(&mut svm, &owner, &Pubkey::new_unique(), &mint, true);
        assert_error_code(res, custom(AgentPayError::UnsupportedMintExtension));
        assert!(!account_exists(&svm, &policy));
    }
}

/// T22-08: a non-ATA Token-2022 account of the merchant is refused (ADR-022 still applies).
#[test]
fn t22_08_merchant_must_use_token_2022_ata() {
    let mut env = env22(&[], false);
    let owner = env.owner.insecure_clone();
    let other = Keypair::new();
    let space =
        ExtensionType::try_calculate_account_len::<T22Account>(&[ExtensionType::ImmutableOwner])
            .unwrap();
    let rent = env.svm.minimum_balance_for_rent_exemption(space);
    let ixs = [
        system_instruction::create_account(
            &owner.pubkey(),
            &other.pubkey(),
            rent,
            space as u64,
            &T22,
        ),
        t22::initialize_immutable_owner(&T22, &other.pubkey()).unwrap(),
        t22::initialize_account3(&T22, &other.pubkey(), &env.mint, &env.merchant).unwrap(),
    ];
    send(&mut env.svm, &ixs, &owner, &[&other]).expect("non-ATA merchant account");

    let before = env.balances();
    let req = env.request(ONE);
    let mut accounts = env.accounts(&req);
    accounts.merchant_token_account = other.pubkey();
    assert_error_code(
        env.pay_with(&accounts, &req),
        custom(AgentPayError::InvalidMerchantTokenAccount),
    );
    assert_eq!(env.balances(), before);
}

/// T22-09: owner withdraw works with a Token-2022 mint.
#[test]
fn t22_09_withdraw_token_2022() {
    let mut env = env22(&[], false);
    let owner = env.owner.insecure_clone();
    let dest = ata_2022(&mut env.svm, &owner, &owner.pubkey(), &env.mint);
    let accounts = WithdrawAccounts {
        owner: owner.pubkey(),
        policy: env.policy,
        mint: env.mint,
        vault: env.vault,
        destination: dest,
    };
    // `withdraw_ix` targets the classic program; swap the token_program meta (last account).
    let mut ix = withdraw_ix(&accounts, 5 * ONE);
    ix.accounts.last_mut().unwrap().pubkey = T22;
    send(&mut env.svm, &[ix], &owner, &[]).expect("withdraw");
    assert_eq!(balance_2022(&env.svm, &dest), 5 * ONE);
    assert_eq!(balance_2022(&env.svm, &env.vault), VAULT_FUNDING - 5 * ONE);
}

/// T22-10: a PYUSD-like mint (verified mainnet extension set, docs/16 §4.2: permanent
/// delegate, zero transfer fee, unset transfer hook, mint close authority) works only with the
/// owner's opt-in, and pays normally.
#[test]
fn t22_10_pyusd_like_mint_with_opt_in() {
    let exts = [
        Ext::MintClose,
        Ext::PermanentDelegate,
        Ext::TransferFee(0, 0),
        Ext::TransferHook,
    ];
    let mut svm = new_svm();
    let owner = funded_keypair(&mut svm);
    let mint = create_mint_2022(&mut svm, &owner, &exts);
    let (_, res) = init_policy(&mut svm, &owner, &Pubkey::new_unique(), &mint, false);
    assert_error_code(res, custom(AgentPayError::IssuerPowersNotAccepted));

    let mut env = env22(&exts, true);
    let req = env.request(2 * ONE);
    env.pay(&req).expect("payment");
    assert_eq!(env.balances(), (VAULT_FUNDING - 2 * ONE, 2 * ONE, 2 * ONE));
}

/// Checks the extension set really is on the mint (guards the fixtures themselves).
#[test]
fn t22_fixture_has_extensions() {
    let mut svm = new_svm();
    let owner = funded_keypair(&mut svm);
    let mint = create_mint_2022(
        &mut svm,
        &owner,
        &[Ext::TransferHook, Ext::PermanentDelegate],
    );
    let acc = svm.get_account(&mint).unwrap();
    let state = StateWithExtensions::<T22Mint>::unpack(&acc.data).unwrap();
    let types = state.get_extension_types().unwrap();
    assert!(types.contains(&ExtensionType::TransferHook));
    assert!(types.contains(&ExtensionType::PermanentDelegate));
}
