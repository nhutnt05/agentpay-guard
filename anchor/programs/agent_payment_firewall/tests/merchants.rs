//! Merchant allowlist integration tests (docs/10 §4): AM-01…AM-05, RM-01, RM-02, RM-04, RM-05.
//! RM-03 (payment after removal) is added with `execute_payment` (T-M2-05).

mod common;

use {
    agent_payment_firewall::errors::AgentPayError,
    anchor_lang::{error::ErrorCode as AnchorErrorCode, prelude::Pubkey},
    common::*,
    solana_signer::Signer,
};

/// Adds `merchant` to the policy as the owner and returns the allowlist entry address.
fn add(env: &mut PolicyEnv, merchant: &Pubkey) -> Pubkey {
    let ix = add_merchant_ix(&env.owner.pubkey(), &env.policy, merchant);
    send(&mut env.svm, &[ix], &env.owner, &[]).expect("add merchant");
    merchant_pda(&env.policy, merchant).0
}

/// RM-01: owner removes a merchant; the entry is closed and its rent goes back to the owner.
#[test]
fn rm01_owner_removes_merchant_and_is_refunded() {
    let mut env = policy_env();
    let merchant = Pubkey::new_unique();
    let entry = add(&mut env, &merchant);
    let rent = lamports(&env.svm, &entry);
    assert!(rent > 0);
    let owner_before = lamports(&env.svm, &env.owner.pubkey());

    let ix = remove_merchant_ix(&env.owner.pubkey(), &env.policy, &merchant);
    let meta = send(&mut env.svm, &[ix], &env.owner, &[])
        .unwrap_or_else(|e| panic!("remove failed: {:#?}", e.meta.logs));

    assert!(!account_exists(&env.svm, &entry), "entry must be closed");
    assert_eq!(
        lamports(&env.svm, &env.owner.pubkey()),
        owner_before + rent - meta.fee,
        "owner receives the entry rent (minus the tx fee they paid)"
    );
    // Policy itself is untouched.
    assert_eq!(
        fetch_policy(&env.svm, &env.policy).owner,
        env.owner.pubkey()
    );
}

/// RM-02: neither a stranger nor the agent can remove a merchant; the entry survives.
#[test]
fn rm02_non_owner_cannot_remove_merchant() {
    let mut env = policy_env();
    let merchant = Pubkey::new_unique();
    let entry = add(&mut env, &merchant);
    let stranger = funded_keypair(&mut env.svm);

    for attacker in [&stranger, &env.agent] {
        let ix = remove_merchant_ix(&attacker.pubkey(), &env.policy, &merchant);
        let res = send(&mut env.svm, &[ix], attacker, &[]);
        assert_error_code(res, u32::from(AgentPayError::UnauthorizedOwner));
        assert!(
            fetch_merchant(&env.svm, &entry).is_allowed,
            "entry must survive"
        );
    }
}

/// RM-04: after removal the same merchant can be added again (fresh `init`).
#[test]
fn rm04_remove_then_re_add() {
    let mut env = policy_env();
    let merchant = Pubkey::new_unique();
    let entry = add(&mut env, &merchant);

    let ix = remove_merchant_ix(&env.owner.pubkey(), &env.policy, &merchant);
    send(&mut env.svm, &[ix], &env.owner, &[]).expect("remove");
    assert!(!account_exists(&env.svm, &entry));

    set_time(&mut env.svm, TEST_NOW + 3_600);
    let entry_again = add(&mut env, &merchant);
    assert_eq!(entry_again, entry, "same PDA address");
    let m = fetch_merchant(&env.svm, &entry);
    assert!(m.is_allowed);
    assert_eq!(
        m.created_at,
        TEST_NOW + 3_600,
        "a new entry, not the old one"
    );
}

/// RM-05 (extra): removing a merchant that was never added fails with AccountNotInitialized.
#[test]
fn rm05_remove_unknown_merchant_fails() {
    let mut env = policy_env();
    let ix = remove_merchant_ix(&env.owner.pubkey(), &env.policy, &Pubkey::new_unique());
    let res = send(&mut env.svm, &[ix], &env.owner, &[]);
    assert_error_code(res, u32::from(AnchorErrorCode::AccountNotInitialized));
}

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
