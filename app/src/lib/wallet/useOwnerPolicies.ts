"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { dayIndex, effectiveDailySpend } from "@/lib/policy/effective";

/** One `AgentPolicy` owned by the connected wallet, as shown on the dashboards. */
export interface OwnerPolicySummary {
  address: string;
  mint: string;
  vault: string;
  isPaused: boolean;
  maxPerTx: bigint;
  dailyLimit: bigint;
  /** Today's spend after the lazy UTC-day reset (docs/11 §5). */
  effectiveSpentToday: bigint;
  /** Raw vault balance in base units; null if the vault could not be read. */
  vaultBalance: bigint | null;
  decimals: number;
}

/** `AgentPolicy.owner` is the first field after the 8-byte Anchor discriminator. */
const OWNER_OFFSET = 8;

/**
 * Lists the policies owned by `owner` straight from chain (getProgramAccounts with the
 * account discriminator + owner memcmp, via the IDL coder). Read-only: never signs.
 */
export function useOwnerPolicies(owner: PublicKey | null) {
  const { connection } = useConnection();
  const [policies, setPolicies] = useState<OwnerPolicySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!owner) {
      setPolicies([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const program = getReadonlyProgram(connection, owner);
      const accounts = await program.account.agentPolicy.all([
        { memcmp: { offset: OWNER_OFFSET, bytes: owner.toBase58() } },
      ]);
      const today = dayIndex(Math.floor(Date.now() / 1000));
      const rows = await Promise.all(
        accounts.map(async ({ publicKey, account }): Promise<OwnerPolicySummary> => {
          const dailyLimit = BigInt(account.dailyLimit.toString());
          const { effectiveSpentToday } = effectiveDailySpend({
            spentToday: BigInt(account.spentToday.toString()),
            storedDayIndex: Number(account.dayIndex.toString()),
            currentDayIndex: today,
            dailyLimit,
          });
          let vaultBalance: bigint | null = null;
          let decimals = 6;
          try {
            const bal = await connection.getTokenAccountBalance(account.vault);
            vaultBalance = BigInt(bal.value.amount);
            decimals = bal.value.decimals;
          } catch {
            // Vault unreadable (RPC hiccup): show the policy anyway.
          }
          return {
            address: publicKey.toBase58(),
            mint: account.mint.toBase58(),
            vault: account.vault.toBase58(),
            isPaused: account.isPaused,
            maxPerTx: BigInt(account.maxPerTx.toString()),
            dailyLimit,
            effectiveSpentToday,
            vaultBalance,
            decimals,
          };
        }),
      );
      rows.sort((a, b) => a.address.localeCompare(b.address));
      setPolicies(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policies");
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [connection, owner]);

  useEffect(() => {
    // Fetch on mount / owner change; state is set after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { policies, loading, error, reload };
}
