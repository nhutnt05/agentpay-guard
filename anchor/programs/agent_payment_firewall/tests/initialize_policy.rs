//! initialize_policy integration tests IP-01…IP-07 (docs/10 §4).

mod common;

use {
    agent_payment_firewall::{errors::AgentPayError, utils::day_index},
    anchor_lang::prelude::Pubkey,
    common::*,
    solana_signer::Signer,
    spl_token_interface::ID as TOKEN_PROGRAM_ID,
};

const MAX_PER_TX: u64 = 10 * ONE;
const DAILY_LIMIT: u64 = 20 * ONE;

/// IP-01: valid init creates the policy with correct fields and a vault ATA controlled by the policy PDA.
#[test]
fn ip01_initialize_policy_success() {
    let Fixture {
        mut svm,
        owner,
        agent,
        mint,
    } = fixture();
    let policy_id = random_policy_id();
    let (policy, bump) = policy_pda(&owner.pubkey(), &policy_id);
    let vault = vault_address(&policy, &mint);

    let ix = initialize_policy_ix(
        &owner.pubkey(),
        &mint,
        policy_id,
        agent.pubkey(),
        MAX_PER_TX,
        DAILY_LIMIT,
    );
    let res = send(&mut svm, &[ix], &owner, &[]);
    assert!(
        res.is_ok(),
        "init failed: {:#?}",
        res.err().map(|e| e.meta.logs)
    );

    let p = fetch_policy(&svm, &policy);
    assert_eq!(p.owner, owner.pubkey());
    assert_eq!(p.agent, agent.pubkey());
    assert_eq!(p.mint, mint);
    assert_eq!(p.vault, vault);
    assert_eq!(p.policy_id, policy_id);
    assert_eq!(p.max_per_tx, MAX_PER_TX);
    assert_eq!(p.daily_limit, DAILY_LIMIT);
    assert_eq!(p.spent_today, 0);
    assert_eq!(p.day_index, day_index(TEST_NOW));
    assert!(!p.is_paused);
    assert_eq!(p.created_at, TEST_NOW);
    assert_eq!(p.bump, bump);

    // Policy account has exactly the specified size (docs/03: 210 bytes).
    assert_eq!(svm.get_account(&policy).unwrap().data.len(), 210);

    // Vault: classic Token program account, mint = policy mint, authority = policy PDA, empty.
    let v = token_account(&svm, &vault);
    assert_eq!(v.mint, mint);
    assert_eq!(v.owner, policy);
    assert_eq!(v.amount, 0);
    assert!(v.delegate.is_none());
    assert!(v.close_authority.is_none());
}

/// IP-02: the same (owner, policy_id) cannot be initialized twice; existing state is untouched.
#[test]
fn ip02_reinitialize_same_policy_id_fails() {
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
        MAX_PER_TX,
        DAILY_LIMIT,
    );
    send(&mut svm, &[ix], &owner, &[]).expect("first init");

    let other_agent = Pubkey::new_unique();
    let ix2 = initialize_policy_ix(&owner.pubkey(), &mint, policy_id, other_agent, ONE, ONE);
    assert_failed_with_log(send(&mut svm, &[ix2], &owner, &[]), "already in use");

    let p = fetch_policy(&svm, &policy);
    assert_eq!(p.agent, agent.pubkey());
    assert_eq!(p.max_per_tx, MAX_PER_TX);
}

/// IP-03: invalid limits are rejected and nothing is created (atomic rollback).
#[test]
fn ip03_invalid_limits_rejected() {
    let Fixture {
        mut svm,
        owner,
        agent,
        mint,
    } = fixture();
    for (max_per_tx, daily_limit) in [
        (0, DAILY_LIMIT),
        (MAX_PER_TX, 0),
        (0, 0),
        (DAILY_LIMIT + 1, DAILY_LIMIT),
    ] {
        let policy_id = random_policy_id();
        let (policy, _) = policy_pda(&owner.pubkey(), &policy_id);
        let ix = initialize_policy_ix(
            &owner.pubkey(),
            &mint,
            policy_id,
            agent.pubkey(),
            max_per_tx,
            daily_limit,
        );
        assert_error_code(
            send(&mut svm, &[ix], &owner, &[]),
            u32::from(AgentPayError::InvalidPolicyLimits),
        );
        assert!(
            !account_exists(&svm, &policy),
            "policy must not exist after failed init"
        );
        assert!(
            !account_exists(&svm, &vault_address(&policy, &mint)),
            "vault must not exist after failed init"
        );
    }
}

/// IP-04: agent must be non-default and different from the owner.
#[test]
fn ip04_invalid_agent_rejected() {
    let Fixture {
        mut svm,
        owner,
        mint,
        ..
    } = fixture();
    for agent in [Pubkey::default(), owner.pubkey()] {
        let policy_id = random_policy_id();
        let (policy, _) = policy_pda(&owner.pubkey(), &policy_id);
        let ix = initialize_policy_ix(
            &owner.pubkey(),
            &mint,
            policy_id,
            agent,
            MAX_PER_TX,
            DAILY_LIMIT,
        );
        assert_error_code(
            send(&mut svm, &[ix], &owner, &[]),
            u32::from(AgentPayError::InvalidAgent),
        );
        assert!(!account_exists(&svm, &policy));
    }
}

/// IP-05 (changed by F-05): a Token-2022 mint passed with the CLASSIC token program is
/// rejected. The vault ATA is created while accounts load (`init_if_needed`), so the ATA
/// program refuses the mismatched token program (`IncorrectProgramId`) before the
/// `InvalidTokenProgram` constraint runs. Token-2022 itself: tests/token_2022.rs.
#[test]
fn ip05_token_2022_mint_rejected() {
    let Fixture {
        mut svm,
        owner,
        agent,
        ..
    } = fixture();
    let mint_2022 = create_token_2022_mint_fixture(&mut svm, &owner.pubkey());
    let policy_id = random_policy_id();
    let (policy, _) = policy_pda(&owner.pubkey(), &policy_id);
    let ix = initialize_policy_ix(
        &owner.pubkey(),
        &mint_2022,
        policy_id,
        agent.pubkey(),
        MAX_PER_TX,
        DAILY_LIMIT,
    );
    let res = send(&mut svm, &[ix], &owner, &[]);
    let err = format!("{:?}", res.as_ref().err().map(|e| &e.err));
    assert!(err.contains("IncorrectProgramId"), "got {err}");
    assert!(!account_exists(&svm, &policy));
}

/// IP-06: a vault ATA pre-created by a third party is adopted (init_if_needed), not a griefing vector.
#[test]
fn ip06_precreated_vault_ata_is_accepted() {
    let Fixture {
        mut svm,
        owner,
        agent,
        mint,
    } = fixture();
    let stranger = funded_keypair(&mut svm);
    let policy_id = random_policy_id();
    let (policy, _) = policy_pda(&owner.pubkey(), &policy_id);
    let vault = create_ata(&mut svm, &stranger, &policy, &mint);
    assert_eq!(vault, vault_address(&policy, &mint));

    let ix = initialize_policy_ix(
        &owner.pubkey(),
        &mint,
        policy_id,
        agent.pubkey(),
        MAX_PER_TX,
        DAILY_LIMIT,
    );
    let res = send(&mut svm, &[ix], &owner, &[]);
    assert!(
        res.is_ok(),
        "init failed: {:#?}",
        res.err().map(|e| e.meta.logs)
    );

    let p = fetch_policy(&svm, &policy);
    assert_eq!(p.vault, vault);
    let v = token_account(&svm, &vault);
    assert_eq!(v.owner, policy);
    assert_eq!(v.mint, mint);
}

/// IP-07: funding is a plain SPL transfer into the vault ATA; no deposit instruction exists.
#[test]
fn ip07_fund_vault_with_plain_spl_transfer() {
    let Fixture {
        mut svm,
        owner,
        agent,
        mint,
    } = fixture();
    let policy_id = random_policy_id();
    let (policy, _) = policy_pda(&owner.pubkey(), &policy_id);
    let vault = vault_address(&policy, &mint);
    let ix = initialize_policy_ix(
        &owner.pubkey(),
        &mint,
        policy_id,
        agent.pubkey(),
        MAX_PER_TX,
        DAILY_LIMIT,
    );
    send(&mut svm, &[ix], &owner, &[]).expect("init");
    let before = fetch_policy(&svm, &policy);

    let owner_ata = create_ata(&mut svm, &owner, &owner.pubkey(), &mint);
    mint_to(&mut svm, &owner, &mint, &owner_ata, &owner, 100 * ONE);
    let res = transfer_checked(
        &mut svm,
        &owner,
        &owner_ata,
        &mint,
        &vault,
        &owner,
        40 * ONE,
    );
    assert!(
        res.is_ok(),
        "transfer failed: {:#?}",
        res.err().map(|e| e.meta.logs)
    );

    assert_eq!(token_balance(&svm, &vault), 40 * ONE);
    assert_eq!(token_balance(&svm, &owner_ata), 60 * ONE);
    // Funding does not touch policy state.
    let after = fetch_policy(&svm, &policy);
    assert_eq!(after.spent_today, before.spent_today);
    assert_eq!(after.vault, vault);
    // Sanity: vault is a classic Token account.
    assert_eq!(svm.get_account(&vault).unwrap().owner, TOKEN_PROGRAM_ID);
}
