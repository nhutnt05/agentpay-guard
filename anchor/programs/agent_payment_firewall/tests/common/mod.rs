//! Shared LiteSVM test helpers (docs/10 §2).
//! Program binary comes from `anchor build` (target/deploy). Run tests with `anchor test`
//! so the .so is rebuilt first; `cargo test` alone may use a stale binary.
#![allow(dead_code, clippy::result_large_err)]

use {
    agent_payment_firewall::{state::AgentPolicy, SEED_POLICY},
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_instruction},
        AccountDeserialize, InstructionData, ToAccountMetas,
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
