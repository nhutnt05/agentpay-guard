"use client";

import { useCallback, useEffect, useState } from "react";
import { type AnyData, createApiClient } from "@/lib/client/api";

const api = createApiClient();

/**
 * Policy + allowlisted merchants from the read API (GET /policies/[id] and /merchants).
 * The API reads the chain on every call; nothing is cached server-side.
 */
export function usePolicyData(policyId: string) {
  const [policy, setPolicy] = useState<AnyData | null>(null);
  const [merchants, setMerchants] = useState<AnyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [p, m] = await Promise.all([api.policy(policyId), api.merchants(policyId)]);
        if (!p.ok) {
          setPolicy(null);
          setError(p.error?.message ?? "Failed to load policy");
          return;
        }
        setPolicy(p.data ?? null);
        setMerchants((m.data?.merchants as AnyData[] | undefined) ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load policy");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [policyId],
  );

  useEffect(() => {
    // Fetch on mount / policy change; state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load("initial");
  }, [load]);

  return { policy, merchants, loading, refreshing, error, reload: load };
}
