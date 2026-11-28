import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { hexToBytes } from "@/lib/encoding/hex";
import { PROGRAM_ID } from "./constants";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  merchantAllowlistPda,
  merchantTokenAccount,
  policyPda,
  receiptPda,
  tokenProgramForPolicy,
  vaultAddress,
} from "./pda";

// PDA-03 (TypeScript half): reproduces the cross-language vector of docs/04 §6.1, which was
// produced by the Rust test PDA-03 and independently by `solana find-program-derived-address`.
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));

describe("PDA derivation (PDA-03 TS)", () => {
  it("uses the deployed program id", () => {
    expect(PROGRAM_ID.toBase58()).toBe("GvjcbQ2g7dg6ZNNBffhyVLmSz8ncbaEvL2c4M1Esayza");
  });

  it("reproduces the docs/04 §6.1 vector", () => {
    const owner = key(0x01);
    const policyId = new Uint8Array(32).fill(0x02);
    const mint = key(0x04);
    const merchant = key(0x33);
    const requestHash = hexToBytes(
      "f8e5a3ca0aa977f4fb97ddb7bbe5cb78e2af5d6942a3dbfc202076fc068903c5",
      32,
    );

    const [policy, bump] = policyPda(owner, policyId);
    expect(policy.toBase58()).toBe("6wVE5Vdm6bvokkFPqcoHo5iTaE4kcMNgPBX8zJBV1Hia");
    expect(bump).toBe(255);
    expect(vaultAddress(policy, mint).toBase58()).toBe("6Byu3BKDgZFB4XEvTsvHHELwdceEwArwGTYgoGcd9gPp");
    expect(merchantAllowlistPda(policy, merchant)[0].toBase58()).toBe(
      "DstxS233x8kAic27CPdbKkGQWB76enWKLRtmpbrd45hW",
    );
    expect(receiptPda(policy, requestHash)[0].toBase58()).toBe(
      "8A1ta9NdQ6GgxdmJGV8qJES7S9G5yBCUqdMietG3RyCJ",
    );
  });

  it("merchant token account is the ATA (same derivation as the vault helper)", () => {
    const mint = key(0x04);
    const merchant = key(0x33);
    expect(merchantTokenAccount(merchant, mint).equals(vaultAddress(merchant, mint))).toBe(true);
  });

  it("F-05: token program is inferred from the stored vault (classic vs Token-2022)", () => {
    const policy = PublicKey.unique();
    const mint = PublicKey.unique();
    const classicVault = vaultAddress(policy, mint);
    const t22Vault = vaultAddress(policy, mint, TOKEN_2022_PROGRAM_ID);
    expect(classicVault.equals(t22Vault)).toBe(false);
    expect(tokenProgramForPolicy(policy, mint, classicVault).equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(tokenProgramForPolicy(policy, mint, t22Vault).equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(() => tokenProgramForPolicy(policy, mint, PublicKey.unique())).toThrow(/not an ATA/);
  });

  it("rejects wrong-length policy ids and hashes", () => {
    expect(() => policyPda(key(1), new Uint8Array(31))).toThrow(/policy_id/);
    expect(() => receiptPda(key(1), new Uint8Array(33))).toThrow(/request_hash/);
  });
});
