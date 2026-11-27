//! Shared LiteSVM test helpers (docs/10 §2).
//! Program binary comes from `anchor build` (target/deploy). Run tests with `anchor test`
//! so the .so is rebuilt first; `cargo test` alone may use a stale binary.
#![allow(dead_code, clippy::result_large_err)]

use {
    agent_payment_firewall::{
        events::PaymentExecuted,
        state::{AgentPolicy, MerchantAllowlist, PaymentReceipt},
        utils::compute_request_hash,
        SEED_MERCHANT, SEED_POLICY, SEED_RECEIPT,
    },
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_instruction},
        AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
    },
    litesvm::{types::TransactionResult, LiteSVM},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_associated_token_account_interface::{
        address::get_associated_token_address, instruction::create_associated_token_account,
        program::ID as ATA_PROGRAM_ID,
    },
    spl_token_interface::{
        instruction as token_ix,
        state::{Account as SplTokenAccount, Mint as SplMint},
        ID as TOKEN_PROGRAM_ID,
    },
};

pub const DECIMALS: u8 = 6;
/// 1 token with 6 decimals.
pub const ONE: u64 = 1_000_000;
/// Fixed, realistic cluster time for deterministic tests.
pub const TEST_NOW: i64 = 1_800_000_000;
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub fn program_id() -> Pubkey {
    agent_payment_firewall::id()
}

pub fn new_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/agent_payment_firewall.so"
    ));
    svm.add_program(program_id(), bytes).unwrap();
    set_time(&mut svm, TEST_NOW);
    svm
}

pub fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

pub fn funded_keypair(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
    kp
}

/// Sends a legacy transaction. Expires the blockhash first so identical
/// instructions sent twice are distinct transactions (not deduplicated signatures).
pub fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    extra: &[&Keypair],
) -> TransactionResult {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![payer];
    for kp in extra {
        // The same keypair may be both fee payer and instruction signer; sign once.
        if !signers.iter().any(|s| s.pubkey() == kp.pubkey()) {
            signers.push(kp);
        }
    }
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
}

/// Asserts the transaction failed with the given custom/framework error code.
pub fn assert_error_code(res: TransactionResult, code: u32) {
    match res {
        Ok(_) => panic!("expected error code {code}, but transaction succeeded"),
        Err(e) => {
            let s = format!("{:?}", e.err);
            assert!(
                s.contains(&format!("Custom({code})")),
                "expected Custom({code}), got {s}\nlogs: {:#?}",
                e.meta.logs
            );
        }
    }
}

/// Asserts failure and that some log line contains `needle`.
pub fn assert_failed_with_log(res: TransactionResult, needle: &str) {
    match res {
        Ok(_) => panic!("expected failure containing log '{needle}', but transaction succeeded"),
        Err(e) => assert!(
            e.meta.logs.iter().any(|l| l.contains(needle)),
            "expected log containing '{needle}', got {:?}\nlogs: {:#?}",
            e.err,
            e.meta.logs
        ),
    }
}

// ---------- SPL token helpers (real SPL Token / ATA instructions) ----------

pub fn create_mint(svm: &mut LiteSVM, payer: &Keypair, authority: &Pubkey) -> Pubkey {
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(SplMint::LEN);
    let ixs = [
        system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            rent,
            SplMint::LEN as u64,
            &TOKEN_PROGRAM_ID,
        ),
        token_ix::initialize_mint2(&TOKEN_PROGRAM_ID, &mint.pubkey(), authority, None, DECIMALS)
            .unwrap(),
    ];
    send(svm, &ixs, payer, &[&mint]).expect("create mint");
    mint.pubkey()
}

/// A mint owned by the Token-2022 program (base layout identical to classic Mint).
pub fn create_token_2022_mint_fixture(svm: &mut LiteSVM, authority: &Pubkey) -> Pubkey {
    let mint = Pubkey::new_unique();
    let mut data = vec![0u8; SplMint::LEN];
    SplMint::pack(
        SplMint {
            mint_authority: Some(*authority).into(),
            supply: 0,
            decimals: DECIMALS,
            is_initialized: true,
            freeze_authority: None.into(),
        },
        &mut data,
    )
    .unwrap();
    let lamports = svm.minimum_balance_for_rent_exemption(SplMint::LEN);
    svm.set_account(
        mint,
        Account {
            lamports,
            data,
            owner: TOKEN_2022_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    mint
}

pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    let ix = create_associated_token_account(&payer.pubkey(), wallet, mint, &TOKEN_PROGRAM_ID);
    send(svm, &[ix], payer, &[]).expect("create ATA");
    get_associated_token_address(wallet, mint)
}

pub fn mint_to(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    dest: &Pubkey,
    authority: &Keypair,
    amount: u64,
) {
    let ix = token_ix::mint_to(
        &TOKEN_PROGRAM_ID,
        mint,
        dest,
        &authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    send(svm, &[ix], payer, &[authority]).expect("mint_to");
}

pub fn transfer_checked(
    svm: &mut LiteSVM,
    payer: &Keypair,
    from: &Pubkey,
    mint: &Pubkey,
    to: &Pubkey,
    owner: &Keypair,
    amount: u64,
) -> TransactionResult {
    let ix = token_ix::transfer_checked(
        &TOKEN_PROGRAM_ID,
        from,
        mint,
        to,
        &owner.pubkey(),
        &[],
        amount,
        DECIMALS,
    )
    .unwrap();
    send(svm, &[ix], payer, &[owner])
}

pub fn token_account(svm: &LiteSVM, address: &Pubkey) -> SplTokenAccount {
    let acc = svm.get_account(address).expect("token account exists");
    assert_eq!(
        acc.owner, TOKEN_PROGRAM_ID,
        "token account must be owned by classic Token program"
    );
    SplTokenAccount::unpack(&acc.data).unwrap()
}

pub fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    token_account(svm, address).amount
}

// ---------- AgentPay Guard helpers ----------

pub fn policy_pda(owner: &Pubkey, policy_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_POLICY, owner.as_ref(), policy_id.as_ref()],
        &program_id(),
    )
}

pub fn vault_address(policy: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address(policy, mint)
}

pub fn random_policy_id() -> [u8; 32] {
    Pubkey::new_unique().to_bytes()
}

pub fn initialize_policy_ix(
    owner: &Pubkey,
    mint: &Pubkey,
    policy_id: [u8; 32],
    agent: Pubkey,
    max_per_tx: u64,
    daily_limit: u64,
) -> Instruction {
    let (policy, _) = policy_pda(owner, &policy_id);
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::InitializePolicy {
            policy_id,
            agent,
            max_per_tx,
            daily_limit,
        }
        .data(),
        agent_payment_firewall::accounts::InitializePolicy {
            owner: *owner,
            policy,
            mint: *mint,
            vault: vault_address(&policy, mint),
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ATA_PROGRAM_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn fetch_policy(svm: &LiteSVM, address: &Pubkey) -> AgentPolicy {
    let acc = svm.get_account(address).expect("policy account exists");
    assert_eq!(acc.owner, program_id());
    let mut data: &[u8] = &acc.data;
    AgentPolicy::try_deserialize(&mut data).unwrap()
}

pub fn merchant_pda(policy: &Pubkey, merchant: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_MERCHANT, policy.as_ref(), merchant.as_ref()],
        &program_id(),
    )
}

/// `signer` is the account placed in the `owner` slot (may be a non-owner in negative tests).
pub fn add_merchant_ix(signer: &Pubkey, policy: &Pubkey, merchant: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::AddMerchant {}.data(),
        agent_payment_firewall::accounts::AddMerchant {
            owner: *signer,
            policy: *policy,
            merchant: *merchant,
            merchant_allowlist: merchant_pda(policy, merchant).0,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// `signer` is the account placed in the `owner` slot (may be a non-owner in negative tests).
pub fn remove_merchant_ix(signer: &Pubkey, policy: &Pubkey, merchant: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::RemoveMerchant {}.data(),
        agent_payment_firewall::accounts::RemoveMerchant {
            owner: *signer,
            policy: *policy,
            merchant: *merchant,
            merchant_allowlist: merchant_pda(policy, merchant).0,
        }
        .to_account_metas(None),
    )
}

pub fn lamports(svm: &LiteSVM, address: &Pubkey) -> u64 {
    svm.get_account(address).map(|a| a.lamports).unwrap_or(0)
}

pub fn fetch_merchant(svm: &LiteSVM, address: &Pubkey) -> MerchantAllowlist {
    let acc = svm.get_account(address).expect("allowlist account exists");
    assert_eq!(acc.owner, program_id());
    let mut data: &[u8] = &acc.data;
    MerchantAllowlist::try_deserialize(&mut data).unwrap()
}

pub fn account_exists(svm: &LiteSVM, address: &Pubkey) -> bool {
    svm.get_account(address)
        .map(|a| a.lamports > 0)
        .unwrap_or(false)
}

/// Standard fixture: owner, agent, classic mint (authority = owner).
pub struct Fixture {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent: Keypair,
    pub mint: Pubkey,
}

pub fn fixture() -> Fixture {
    let mut svm = new_svm();
    let owner = funded_keypair(&mut svm);
    let agent = funded_keypair(&mut svm);
    let mint = create_mint(&mut svm, &owner, &owner.pubkey());
    Fixture {
        svm,
        owner,
        agent,
        mint,
    }
}

pub const DEFAULT_MAX_PER_TX: u64 = 10 * ONE;
pub const DEFAULT_DAILY_LIMIT: u64 = 20 * ONE;

/// Fixture with an initialized policy (default limits) and its vault.
pub struct PolicyEnv {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent: Keypair,
    pub mint: Pubkey,
    pub policy: Pubkey,
    pub vault: Pubkey,
}

pub fn policy_env() -> PolicyEnv {
    let Fixture {
        mut svm,
        owner,
        agent,
        mint,
    } = fixture();
    let policy_id = random_policy_id();
    let (policy, _) = policy_pda(&owner.pubkey(), &policy_id);
    let ix = initialize_policy_ix(
        &owner.pubkey(),
        &mint,
        policy_id,
        agent.pubkey(),
        DEFAULT_MAX_PER_TX,
        DEFAULT_DAILY_LIMIT,
    );
    send(&mut svm, &[ix], &owner, &[]).expect("initialize policy");
    PolicyEnv {
        svm,
        owner,
        agent,
        mint,
        vault: vault_address(&policy, &mint),
        policy,
    }
}

// ---------- execute_payment helpers ----------

/// Canonical payment request fields (docs/11 §3).
#[derive(Clone, Copy, Debug)]
pub struct PaymentRequest {
    pub request_hash: [u8; 32],
    pub request_id: [u8; 16],
    pub amount: u64,
    pub expires_at: i64,
}

pub fn random_request_id() -> [u8; 16] {
    Pubkey::new_unique().to_bytes()[..16].try_into().unwrap()
}

/// Builds a request with a correct canonical hash, expiring 300 s after TEST_NOW.
pub fn payment_request(
    policy: &Pubkey,
    agent: &Pubkey,
    merchant: &Pubkey,
    mint: &Pubkey,
    amount: u64,
) -> PaymentRequest {
    let request_id = random_request_id();
    let expires_at = TEST_NOW + 300;
    PaymentRequest {
        request_hash: compute_request_hash(
            policy,
            agent,
            merchant,
            mint,
            amount,
            &request_id,
            expires_at,
        ),
        request_id,
        amount,
        expires_at,
    }
}

pub fn receipt_pda(policy: &Pubkey, request_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[SEED_RECEIPT, policy.as_ref(), request_hash.as_ref()],
        &program_id(),
    )
}

/// All accounts of `execute_payment`, overridable for negative tests.
#[derive(Clone, Copy, Debug)]
pub struct PaymentAccounts {
    pub agent: Pubkey,
    pub policy: Pubkey,
    pub merchant: Pubkey,
    pub merchant_allowlist: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub merchant_token_account: Pubkey,
    pub receipt: Pubkey,
    pub token_program: Pubkey,
}

pub fn payment_accounts(
    agent: &Pubkey,
    policy: &Pubkey,
    merchant: &Pubkey,
    mint: &Pubkey,
    request_hash: &[u8; 32],
) -> PaymentAccounts {
    PaymentAccounts {
        agent: *agent,
        policy: *policy,
        merchant: *merchant,
        merchant_allowlist: merchant_pda(policy, merchant).0,
        mint: *mint,
        vault: vault_address(policy, mint),
        merchant_token_account: get_associated_token_address(merchant, mint),
        receipt: receipt_pda(policy, request_hash).0,
        token_program: TOKEN_PROGRAM_ID,
    }
}

pub fn execute_payment_ix(accounts: &PaymentAccounts, req: &PaymentRequest) -> Instruction {
    Instruction::new_with_bytes(
        program_id(),
        &agent_payment_firewall::instruction::ExecutePayment {
            request_hash: req.request_hash,
            request_id: req.request_id,
            amount: req.amount,
            expires_at: req.expires_at,
        }
        .data(),
        agent_payment_firewall::accounts::ExecutePayment {
            agent: accounts.agent,
            policy: accounts.policy,
            merchant: accounts.merchant,
            merchant_allowlist: accounts.merchant_allowlist,
            mint: accounts.mint,
            vault: accounts.vault,
            merchant_token_account: accounts.merchant_token_account,
            receipt: accounts.receipt,
            token_program: accounts.token_program,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn fetch_receipt(svm: &LiteSVM, address: &Pubkey) -> PaymentReceipt {
    let acc = svm.get_account(address).expect("receipt account exists");
    assert_eq!(acc.owner, program_id());
    let mut data: &[u8] = &acc.data;
    PaymentReceipt::try_deserialize(&mut data).unwrap()
}

/// Decodes the `PaymentExecuted` event from `Program data:` log lines, if present.
pub fn find_payment_event(logs: &[String]) -> Option<PaymentExecuted> {
    use base64::Engine;
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
        .find(|bytes| bytes.starts_with(PaymentExecuted::DISCRIMINATOR))
        .map(|bytes| {
            PaymentExecuted::try_from_slice(&bytes[PaymentExecuted::DISCRIMINATOR.len()..])
                .expect("decode PaymentExecuted")
        })
}

pub const VAULT_FUNDING: u64 = 100 * ONE;

/// Policy (default limits) + one allowlisted merchant with an ATA + funded vault.
pub struct PaymentEnv {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub agent: Keypair,
    pub mint: Pubkey,
    pub policy: Pubkey,
    pub vault: Pubkey,
    pub merchant: Pubkey,
    pub merchant_ata: Pubkey,
}

pub fn payment_env() -> PaymentEnv {
    let PolicyEnv {
        mut svm,
        owner,
        agent,
        mint,
        policy,
        vault,
    } = policy_env();
    let merchant = Pubkey::new_unique();
    send(
        &mut svm,
        &[add_merchant_ix(&owner.pubkey(), &policy, &merchant)],
        &owner,
        &[],
    )
    .expect("add merchant");
    let merchant_ata = create_ata(&mut svm, &owner, &merchant, &mint);
    mint_to(&mut svm, &owner, &mint, &vault, &owner, VAULT_FUNDING);
    PaymentEnv {
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

impl PaymentEnv {
    pub fn request(&self, amount: u64) -> PaymentRequest {
        payment_request(
            &self.policy,
            &self.agent.pubkey(),
            &self.merchant,
            &self.mint,
            amount,
        )
    }

    pub fn accounts(&self, req: &PaymentRequest) -> PaymentAccounts {
        payment_accounts(
            &self.agent.pubkey(),
            &self.policy,
            &self.merchant,
            &self.mint,
            &req.request_hash,
        )
    }

    /// Agent signs and pays fees (MVP default).
    pub fn pay(&mut self, req: &PaymentRequest) -> TransactionResult {
        let ix = execute_payment_ix(&self.accounts(req), req);
        let agent = self.agent.insecure_clone();
        send(&mut self.svm, &[ix], &agent, &[])
    }
}
