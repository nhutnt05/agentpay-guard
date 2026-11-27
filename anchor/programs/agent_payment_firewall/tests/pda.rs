//! PDA / account-substitution defenses (docs/04 §8, docs/10 §4): PDA-01…PDA-03. T-M3-06.
//!
//! Forged accounts are injected with LiteSVM `set_account`. On a real cluster nobody but
//! this program can create accounts it owns, so the "program-owned forgery" cases are
//! defense-in-depth: they prove the seeds/bump checks hold even if such data existed.

// LiteSVM's TransactionResult has a large Err variant by design (test-only helpers).
#![allow(clippy::result_large_err)]

mod common;

use {
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    common::*,
    solana_signer::Signer,
};

/// Byte offsets inside `AgentPolicy` (docs/03 §3).
const POLICY_ID_OFFSET: usize = 136;
const BUMP_OFFSET: usize = 209;

/// Copies the real policy account to `at`, optionally changing its owner program.
fn forge_policy_copy(env: &mut PaymentEnv, at: Pubkey, owner_program: Option<Pubkey>) {
    let mut acc = env.svm.get_account(&env.policy).expect("real policy");
    if let Some(p) = owner_program {
        acc.owner = p;
    }
    env.svm.set_account(at, acc).unwrap();
}

/// Payment through a substituted `policy` account; everything else derived consistently
/// from that account (so the policy slot is the only thing being tested).
fn pay_via_policy(env: &mut PaymentEnv, policy: Pubkey) -> litesvm::types::TransactionResult {
    let req = payment_request(&policy, &env.agent.pubkey(), &env.merchant, &env.mint, ONE);
    let mut accounts = env.accounts(&req);
    accounts.policy = policy;
    accounts.receipt = receipt_pda(&policy, &req.request_hash).0;
    // Keep the REAL allowlist entry and vault, so only the policy check can fail first.
    let agent = env.agent.insecure_clone();
    send(
        &mut env.svm,
        &[execute_payment_ix(&accounts, &req)],
        &agent,
        &[],
    )
}

/// PDA-01: a byte-identical copy of the policy owned by another program is rejected by
/// the account-owner check (in both a payment and an owner instruction).
#[test]
fn pda01_policy_owned_by_other_program_rejected() {
    let mut env = payment_env();
    let fake = Pubkey::new_unique();
    let some_other_program = Pubkey::new_unique();
    forge_policy_copy(&mut env, fake, Some(some_other_program));
    let before = snapshot(&env);

    let res = pay_via_policy(&mut env, fake);
    assert_error_code(res, framework(AnchorErrorCode::AccountOwnedByWrongProgram));
    assert_eq!(snapshot(&env), before);

    let owner = env.owner.insecure_clone();
    let res = send(
        &mut env.svm,
        &[pause_policy_ix(&owner.pubkey(), &fake)],
        &owner,
        &[],
    );
    assert_error_code(res, framework(AnchorErrorCode::AccountOwnedByWrongProgram));
}

/// PDA-01b (extra): type confusion — a `MerchantAllowlist` account (program-owned, real)
/// passed as the policy fails the discriminator check.
#[test]
fn pda01b_wrong_account_type_as_policy_rejected() {
    let mut env = payment_env();
    let entry = merchant_pda(&env.policy, &env.merchant).0;
    let owner = env.owner.insecure_clone();
    let res = send(
        &mut env.svm,
        &[pause_policy_ix(&owner.pubkey(), &entry)],
        &owner,
        &[],
    );
    assert_error_code(
        res,
        framework(AnchorErrorCode::AccountDiscriminatorMismatch),
    );
    assert!(!fetch_policy(&env.svm, &env.policy).is_paused);
}

/// PDA-02: program-owned forgeries at non-canonical addresses fail the seeds check:
/// (a) copy at the PDA of a different policy_id (stored policy_id no longer matches the
/// address), (b) the real policy with a tampered stored bump.
#[test]
fn pda02_non_canonical_policy_rejected_by_seeds() {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();

    // (a) Valid-looking data at PDA(owner, other_id), still claiming the original id.
    let other_id = random_policy_id();
    let (wrong_address, _) = policy_pda(&owner.pubkey(), &other_id);
    forge_policy_copy(&mut env, wrong_address, None);
    let stored_id = env.svm.get_account(&wrong_address).unwrap().data
        [POLICY_ID_OFFSET..POLICY_ID_OFFSET + 32]
        .to_vec();
    assert_ne!(
        stored_id,
        other_id.to_vec(),
        "forgery keeps the original id"
    );

    let res = send(
        &mut env.svm,
        &[pause_policy_ix(&owner.pubkey(), &wrong_address)],
        &owner,
        &[],
    );
    assert_error_code(res, framework(AnchorErrorCode::ConstraintSeeds));
    let before = snapshot(&env);
    let res = pay_via_policy(&mut env, wrong_address);
    assert_error_code(res, framework(AnchorErrorCode::ConstraintSeeds));
    assert_eq!(snapshot(&env), before);

    // (b) Tampered bump on the real policy: seeds + stored bump no longer give its address.
    let mut acc = env.svm.get_account(&env.policy).unwrap();
    acc.data[BUMP_OFFSET] = acc.data[BUMP_OFFSET].wrapping_sub(1);
    env.svm.set_account(env.policy, acc).unwrap();
    let res = send(
        &mut env.svm,
        &[pause_policy_ix(&owner.pubkey(), &env.policy)],
        &owner,
        &[],
    );
    assert!(res.is_err(), "tampered bump must not validate");
    let s = format!("{:?}", res.unwrap_err().err);
    assert!(
        s.contains(&format!(
            "Custom({})",
            framework(AnchorErrorCode::ConstraintSeeds)
        )),
        "expected ConstraintSeeds, got {s}"
    );
}

/// PDA-03: client-side derivation (test helpers, mirrored by the future
/// `app/src/lib/anchor/pda.ts`) matches the accounts the program actually created, and a
/// fixed cross-language vector is pinned for the M4 TypeScript test.
#[test]
fn pda03_client_derivation_matches_program() {
    let mut env = payment_env();
    let req = env.request(ONE);
    env.pay(&req).expect("payment");

    // Addresses derived off-chain are exactly the accounts that exist on-chain.
    let p = fetch_policy(&env.svm, &env.policy);
    assert_eq!(policy_pda(&p.owner, &p.policy_id), (env.policy, p.bump));
    assert_eq!(vault_address(&env.policy, &env.mint), p.vault);
    let (entry, entry_bump) = merchant_pda(&env.policy, &env.merchant);
    assert_eq!(fetch_merchant(&env.svm, &entry).bump, entry_bump);
    let (receipt, receipt_bump) = receipt_pda(&env.policy, &req.request_hash);
    assert_eq!(fetch_receipt(&env.svm, &receipt).bump, receipt_bump);

    // Fixed vector for cross-language checks (inputs are synthetic byte-filled keys).
    let owner = Pubkey::new_from_array([0x01; 32]);
    let policy_id = [0x02; 32];
    let mint = Pubkey::new_from_array([0x04; 32]);
    let merchant = Pubkey::new_from_array([0x33; 32]);
    let request_hash: [u8; 32] =
        hex32("f8e5a3ca0aa977f4fb97ddb7bbe5cb78e2af5d6942a3dbfc202076fc068903c5");
    let (policy, policy_bump) = policy_pda(&owner, &policy_id);
    let (entry, _) = merchant_pda(&policy, &merchant);
    let (receipt, _) = receipt_pda(&policy, &request_hash);
    let vault = vault_address(&policy, &mint);
    println!("PDA-03 vector (program {}):", program_id());
    println!("  policy   = {policy} (bump {policy_bump})");
    println!("  vault    = {vault}");
    println!("  merchant = {entry}");
    println!("  receipt  = {receipt}");
    assert_eq!(policy.to_string(), PDA03_POLICY);
    assert_eq!(vault.to_string(), PDA03_VAULT);
    assert_eq!(entry.to_string(), PDA03_MERCHANT);
    assert_eq!(receipt.to_string(), PDA03_RECEIPT);
}

// Values for program id GvjcbQ2g7dg6ZNNBffhyVLmSz8ncbaEvL2c4M1Esayza, independently
// cross-checked with `solana find-program-derived-address` (Solana CLI 4.1.2, 2026-11-27).
// They change if the program id or any seed changes — update docs/04 §6 together.
const PDA03_POLICY: &str = "6wVE5Vdm6bvokkFPqcoHo5iTaE4kcMNgPBX8zJBV1Hia";
const PDA03_VAULT: &str = "6Byu3BKDgZFB4XEvTsvHHELwdceEwArwGTYgoGcd9gPp";
const PDA03_MERCHANT: &str = "DstxS233x8kAic27CPdbKkGQWB76enWKLRtmpbrd45hW";
const PDA03_RECEIPT: &str = "8A1ta9NdQ6GgxdmJGV8qJES7S9G5yBCUqdMietG3RyCJ";

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}
