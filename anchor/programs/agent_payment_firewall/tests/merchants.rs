//! Merchant allowlist integration tests (docs/10 §4): AM-01…AM-04.
//! RM-* tests are added with `remove_merchant` (T-M2-02).

mod common;

use {
    agent_payment_firewall::errors::AgentPayError, anchor_lang::prelude::Pubkey, common::*,
    solana_signer::Signer,
};

/// AM-01: owner adds a merchant; entry fields are correct and the PDA has the spec size.
#[test]
fn am01_owner_adds_merchant() {
    let PolicyEnv {
        mut svm,
        owner,
        policy,
        ..
    } = policy_env();
    let merchant = Pubkey::new_unique();
    let (entry, bump) = merchant_pda(&policy, &merchant);

    let res = send(
        &mut svm,
        &[add_merchant_ix(&owner.pubkey(), &policy, &merchant)],
        &owner,
        &[],
    );
    assert!(
        res.is_ok(),
        "add failed: {:#?}",
        res.err().map(|e| e.meta.logs)
    );

    let m = fetch_merchant(&svm, &entry);
    assert_eq!(m.policy, policy);
    assert_eq!(m.merchant, merchant);
    assert!(m.is_allowed);
    assert_eq!(m.created_at, TEST_NOW);
    assert_eq!(m.bump, bump);
    assert_eq!(svm.get_account(&entry).unwrap().data.len(), 82);
}

/// AM-02: a non-owner cannot add a merchant, even signing and paying themselves.
/// Also covers the agent trying to allowlist a merchant (agent has no owner powers).
#[test]
fn am02_non_owner_cannot_add_merchant() {
    let PolicyEnv {
        mut svm,
        agent,
        policy,
        ..
    } = policy_env();
    let stranger = funded_keypair(&mut svm);
    let merchant = Pubkey::new_unique();
    let (entry, _) = merchant_pda(&policy, &merchant);

    for attacker in [&stranger, &agent] {
        let res = send(
            &mut svm,
            &[add_merchant_ix(&attacker.pubkey(), &policy, &merchant)],
            attacker,
            &[],
        );
        assert_error_code(res, u32::from(AgentPayError::UnauthorizedOwner));
        assert!(!account_exists(&svm, &entry), "entry must not be created");
    }
}

/// AM-03: adding the same merchant twice fails; the original entry is unchanged.
#[test]
fn am03_duplicate_add_fails() {
    let PolicyEnv {
        mut svm,
        owner,
        policy,
        ..
    } = policy_env();
    let merchant = Pubkey::new_unique();
    let (entry, _) = merchant_pda(&policy, &merchant);
    let ix = add_merchant_ix(&owner.pubkey(), &policy, &merchant);
    send(&mut svm, std::slice::from_ref(&ix), &owner, &[]).expect("first add");
    let before = fetch_merchant(&svm, &entry);

    set_time(&mut svm, TEST_NOW + 60);
    assert_failed_with_log(send(&mut svm, &[ix], &owner, &[]), "already in use");

    let after = fetch_merchant(&svm, &entry);
    assert_eq!(after.created_at, before.created_at);
    assert!(after.is_allowed);
}

/// AM-04: merchant must not be the default key, the policy PDA, the vault, or the agent.
#[test]
fn am04_invalid_merchant_rejected() {
    let PolicyEnv {
        mut svm,
        owner,
        agent,
        policy,
        vault,
        ..
    } = policy_env();
    for bad in [Pubkey::default(), policy, vault, agent.pubkey()] {
        let (entry, _) = merchant_pda(&policy, &bad);
        let res = send(
            &mut svm,
            &[add_merchant_ix(&owner.pubkey(), &policy, &bad)],
            &owner,
            &[],
        );
        assert_error_code(res, u32::from(AgentPayError::InvalidMerchant));
        assert!(!account_exists(&svm, &entry), "entry must not be created");
    }
}

/// AM-05 (extra): several merchants can be added atomically in one transaction.
/// "Add while paused" is tested with `pause_policy` in M3 (PS-*).
#[test]
fn am05_owner_can_add_multiple_merchants() {
    let PolicyEnv {
        mut svm,
        owner,
        policy,
        ..
    } = policy_env();
    let merchants: Vec<Pubkey> = (0..3).map(|_| Pubkey::new_unique()).collect();
    let ixs: Vec<_> = merchants
        .iter()
        .map(|m| add_merchant_ix(&owner.pubkey(), &policy, m))
        .collect();
    let res = send(&mut svm, &ixs, &owner, &[]);
    assert!(
        res.is_ok(),
        "batch add failed: {:#?}",
        res.err().map(|e| e.meta.logs)
    );
    for m in merchants {
        assert!(fetch_merchant(&svm, &merchant_pda(&policy, &m).0).is_allowed);
    }
}
