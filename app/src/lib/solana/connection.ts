import { clusterApiUrl, Connection } from "@solana/web3.js";

export type Cluster = "devnet";

/** The only supported cluster in the MVP (ADR-015, NFR-5). */
export function getCluster(): Cluster {
  const configured = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  if (configured !== "devnet") {
    throw new Error(`unsupported cluster '${configured}' (devnet only)`);
  }
  return "devnet";
}

let serverConnection: Connection | undefined;

/**
 * Server-side RPC connection (`SOLANA_RPC_URL`, may carry a provider API key — never send
 * it to the browser). Commitment `confirmed` for all reads.
 */
export function getServerConnection(): Connection {
  serverConnection ??= new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl(getCluster()),
    "confirmed",
  );
  return serverConnection;
}

/** Public RPC URL for browser reads and wallet transactions. */
export function getPublicRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(getCluster());
}
