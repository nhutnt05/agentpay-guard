"use client";

import dynamic from "next/dynamic";

/**
 * Wallet connect/account button. Client-only: its label depends on browser wallet state, so
 * server-rendering it would cause hydration mismatches. The placeholder prevents layout shift.
 */
export const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div className="h-10 w-[150px] rounded-[10px] bg-elevated" aria-hidden="true" /> },
);
