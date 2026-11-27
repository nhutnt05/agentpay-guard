import { BN } from "@anchor-lang/core";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { describe, expect, it } from "vitest";
import { PROGRAM_ID } from "./constants";
import idl from "./idl/agent_payment_firewall.json";
import { merchantAllowlistPda, merchantTokenAccount, receiptPda, vaultAddress } from "./pda";
import { getReadonlyProgram, readOnlyWallet } from "./program";

// Offline checks of the @anchor-lang/core client against our IDL (no RPC calls are made:
// the Connection is never used by instruction building or coding).
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const connection = new Connection("http://127.0.0.1:1", "confirmed");
const program = getReadonlyProgram(connection, key(0x22));

describe("program client", () => {
  it("is bound to the deployed program id", () => {
    expect(program.programId.equals(PROGRAM_ID)).toBe(true);
  });

  it("read-only wallet refuses to sign", async () => {
    const wallet = readOnlyWallet(key(1));
    await expect(wallet.signTransaction(new Transaction())).rejects.toThrow(/cannot sign/);
    await expect(wallet.signAllTransactions([])).rejects.toThrow(/cannot sign/);
  });

  it("builds execute_payment with IDL account order, flags and discriminator", async () => {
    const policy = key(0x11);
    const agent = key(0x22);
    const merchant = key(0x33);
    const mint = key(0x44);
    const requestHash = new Uint8Array(32).fill(7);
    const ix = await program.methods
      .executePayment(Array.from(requestHash), Array.from(new Uint8Array(16).fill(9)), new BN(5_000_000), new BN(1_800_000_000))
      .accountsStrict({
        agent,
        policy,
        merchant,
        merchantAllowlist: merchantAllowlistPda(policy, merchant)[0],
        mint,
        vault: vaultAddress(policy, mint),
        merchantTokenAccount: merchantTokenAccount(merchant, mint),
        receipt: receiptPda(policy, requestHash)[0],
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: PublicKey.default,
      })
      .instruction();

    const spec = idl.instructions.find((i) => i.name === "execute_payment")!;
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    expect(ix.keys.length).toBe(spec.accounts.length);
    spec.accounts.forEach((acc, i) => {
      expect(ix.keys[i].isWritable, acc.name).toBe(Boolean((acc as { writable?: boolean }).writable));
      expect(ix.keys[i].isSigner, acc.name).toBe(Boolean((acc as { signer?: boolean }).signer));
    });
    expect(ix.keys[0].pubkey.equals(agent)).toBe(true);
    expect(ix.keys[1].pubkey.equals(policy)).toBe(true);
    // data = 8-byte discriminator | hash(32) | request_id(16) | amount u64 LE | expires_at i64 LE
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(spec.discriminator);
    expect(ix.data.length).toBe(8 + 32 + 16 + 8 + 8);
    expect(Array.from(ix.data.subarray(8, 40))).toEqual(Array.from(requestHash));
    expect(ix.data.readBigUInt64LE(56)).toBe(5_000_000n);
    expect(ix.data.readBigInt64LE(64)).toBe(1_800_000_000n);
  });

  it("AgentPolicy layout matches the memcmp offsets of docs/03 §8", async () => {
    const owner = key(0x01);
    const agent = key(0x02);
    const policy = {
      owner,
      agent,
      mint: key(0x03),
      vault: key(0x04),
      policyId: Array.from(new Uint8Array(32).fill(5)),
      maxPerTx: new BN(10),
      dailyLimit: new BN(20),
      spentToday: new BN(3),
      dayIndex: new BN(20_833),
      isPaused: false,
      createdAt: new BN(1_800_000_000),
      bump: 254,
    };
    const data = await program.coder.accounts.encode("agentPolicy", policy);
    expect(data.length).toBe(210);
    expect(new PublicKey(data.subarray(8, 40)).equals(owner)).toBe(true); // owner @ 8
    expect(new PublicKey(data.subarray(40, 72)).equals(agent)).toBe(true); // agent @ 40
    const decoded = program.coder.accounts.decode("agentPolicy", data);
    expect(decoded.spentToday.toString()).toBe("3");
    expect(decoded.bump).toBe(254);
  });
});
