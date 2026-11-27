//! Owner-only withdraw (docs/05 §8, docs/10 §4): WD-01…WD-05 (+ extras). T-M3-05.

// LiteSVM's TransactionResult has a large Err variant by design (test-only helpers).
#![allow(clippy::result_large_err)]

mod common;

use {
    agent_payment_firewall::{errors::AgentPayError, events::Withdrawn},
    anchor_lang::prelude::Pubkey,
    common::*,
    litesvm::types::TransactionResult,
    solana_keypair::Keypair,
    solana_signer::Signer,
};

/// Env + the owner's own ATA for the policy mint (the normal withdraw destination).
fn setup() -> (PaymentEnv, Pubkey) {
    let mut env = payment_env();
    let owner = env.owner.insecure_clone();
    let mint = env.mint;
    let owner_ata = create_ata(&mut env.svm, &owner, &owner.pubkey(), &mint);
    (env, owner_ata)
}

fn accounts(env: &PaymentEnv, signer: &Pubkey, destination: &Pubkey) -> WithdrawAccounts {
    WithdrawAccounts {
        owner: *signer,
        policy: env.policy,
        mint: env.mint,
        vault: env.vault,
        destination: *destination,
    }
}

fn withdraw_as(
    env: &mut PaymentEnv,
    signer: &Keypair,
    a: &WithdrawAccounts,
    amount: u64,
) -> TransactionResult {
    let ix = withdraw_ix(a, amount);
    send(&mut env.svm, &[ix], signer, &[])
}

/// Balances captured BEFORE an attempt, compared after it.
struct Balances {
    vault: u64,
    watched: u64,
}

fn balances(env: &PaymentEnv, watched: &Pubkey) -> Balances {
    Balances {
        vault: token_balance(&env.svm, &env.vault),
        watched: token_balance(&env.svm, watched),
    }
}

/// Asserts the error and that neither the vault nor `watched` changed since `before`.
fn assert_withdraw_rejected(
    env: &PaymentEnv,
    before: Balances,
    res: TransactionResult,
    code: u32,
    watched: &Pubkey,
) {
    assert_error_code(res, code);
    assert_eq!(
        token_balance(&env.svm, &env.vault),
        before.vault,
        "vault must be unchanged"
    );
    assert_eq!(
        token_balance(&env.svm, watched),
        before.watched,
        "destination must be unchanged"
    );
}

/// WD-01: owner withdraws to their own ATA; balances move, event emitted, spending
/// counter untouched. A full withdrawal (remaining balance) also works.
#[test]
fn wd01_owner_withdraws_to_own_account() {
    let (mut env, owner_ata) = setup();
    let owner = env.owner.insecure_clone();
    let spent_before = fetch_policy(&env.svm, &env.policy).spent_today;

    let a = accounts(&env, &owner.pubkey(), &owner_ata);
    let meta = withdraw_as(&mut env, &owner, &a, 40 * ONE)
        .unwrap_or_else(|e| panic!("withdraw failed: {:#?}", e.meta.logs));
    assert_eq!(
        token_balance(&env.svm, &env.vault),
        VAULT_FUNDING - 40 * ONE
    );
    assert_eq!(token_balance(&env.svm, &owner_ata), 40 * ONE);
    assert_eq!(
        fetch_policy(&env.svm, &env.policy).spent_today,
        spent_before
    );

    let ev = find_event::<Withdrawn>(&meta.logs).expect("Withdrawn event");
    assert_eq!(ev.policy, env.policy);
    assert_eq!(ev.destination, owner_ata);
    assert_eq!(ev.amount, 40 * ONE);
    assert_eq!(ev.timestamp, TEST_NOW);

    withdraw_as(&mut env, &owner, &a, VAULT_FUNDING - 40 * ONE).expect("withdraw the rest");
    assert_eq!(token_balance(&env.svm, &env.vault), 0);
    assert_eq!(token_balance(&env.svm, &owner_ata), VAULT_FUNDING);
}

/// WD-01b (extra): a non-ATA token account owned by the owner is also a valid destination.
#[test]
fn wd01b_owner_withdraws_to_non_ata_account() {
    let (mut env, _) = setup();
    let owner = env.owner.insecure_clone();
    let mint = env.mint;
    let plain = create_plain_token_account(&mut env.svm, &owner, &owner.pubkey(), &mint);
    let a = accounts(&env, &owner.pubkey(), &plain);
    withdraw_as(&mut env, &owner, &a, ONE).expect("withdraw to owner's non-ATA account");
    assert_eq!(token_balance(&env.svm, &plain), ONE);
}

/// WD-02: the agent cannot withdraw — neither to its own account nor to the owner's.
#[test]
fn wd02_agent_cannot_withdraw() {
    let (mut env, owner_ata) = setup();
    let agent = env.agent.insecure_clone();
    let mint = env.mint;
    let agent_ata = create_ata(&mut env.svm, &agent, &agent.pubkey(), &mint);

    for dest in [agent_ata, owner_ata] {
        let before = balances(&env, &dest);
        let a = accounts(&env, &agent.pubkey(), &dest);
        let res = withdraw_as(&mut env, &agent, &a, ONE);
        assert_withdraw_rejected(
            &env,
            before,
            res,
            custom(AgentPayError::UnauthorizedOwner),
            &dest,
        );
    }
}

/// WD-03: the owner cannot route funds to a third party, or to an account of another mint.
#[test]
fn wd03_destination_must_be_owner_account_of_policy_mint() {
    let (mut env, _) = setup();
    let owner = env.owner.insecure_clone();
    let mint = env.mint;
    let third_party = Pubkey::new_unique();
    let third_party_ata = create_ata(&mut env.svm, &owner, &third_party, &mint);
    let other_mint = create_mint(&mut env.svm, &owner, &owner.pubkey());
    let owner_other_mint_ata = create_ata(&mut env.svm, &owner, &owner.pubkey(), &other_mint);

    for dest in [third_party_ata, owner_other_mint_ata] {
        let before = balances(&env, &dest);
        let a = accounts(&env, &owner.pubkey(), &dest);
        let res = withdraw_as(&mut env, &owner, &a, ONE);
        assert_withdraw_rejected(
            &env,
            before,
            res,
            custom(AgentPayError::InvalidWithdrawDestination),
            &dest,
        );
    }
}

/// WD-04: withdraw works while the policy is paused (incident response).
#[test]
fn wd04_withdraw_while_paused() {
    let (mut env, owner_ata) = setup();
    let owner = env.owner.insecure_clone();
    let ix = pause_policy_ix(&owner.pubkey(), &env.policy);
    send(&mut env.svm, &[ix], &owner, &[]).expect("pause");
    let a = accounts(&env, &owner.pubkey(), &owner_ata);
    withdraw_as(&mut env, &owner, &a, 10 * ONE).expect("withdraw while paused");
    assert_eq!(token_balance(&env.svm, &owner_ata), 10 * ONE);
    assert!(fetch_policy(&env.svm, &env.policy).is_paused);
}

/// WD-05: amount above the vault balance, and zero amount, are rejected.
#[test]
fn wd05_invalid_amounts_rejected() {
    let (mut env, owner_ata) = setup();
    let owner = env.owner.insecure_clone();
    let a = accounts(&env, &owner.pubkey(), &owner_ata);
    let before = balances(&env, &owner_ata);
    let res = withdraw_as(&mut env, &owner, &a, VAULT_FUNDING + 1);
    assert_withdraw_rejected(
        &env,
        before,
        res,
        custom(AgentPayError::InsufficientVaultBalance),
        &owner_ata,
    );
    let before = balances(&env, &owner_ata);
    let res = withdraw_as(&mut env, &owner, &a, 0);
    assert_withdraw_rejected(
        &env,
        before,
        res,
        custom(AgentPayError::InvalidAmount),
        &owner_ata,
    );
}

/// WD-06 (extra): a fake vault (token account owned by the policy PDA but not the
/// recorded vault) cannot be drained through withdraw either.
#[test]
fn wd06_wrong_vault_rejected() {
    let (mut env, owner_ata) = setup();
    let owner = env.owner.insecure_clone();
    let policy = env.policy;
    let mint = env.mint;
    let fake = create_plain_token_account(&mut env.svm, &owner, &policy, &mint);
    mint_to(&mut env.svm, &owner, &mint, &fake, &owner, 5 * ONE);
    let mut a = accounts(&env, &owner.pubkey(), &owner_ata);
    a.vault = fake;
    let before = balances(&env, &owner_ata);
    let res = withdraw_as(&mut env, &owner, &a, ONE);
    assert_withdraw_rejected(
        &env,
        before,
        res,
        custom(AgentPayError::InvalidVault),
        &owner_ata,
    );
    assert_eq!(token_balance(&env.svm, &fake), 5 * ONE);
}
