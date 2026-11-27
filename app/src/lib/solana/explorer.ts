import { getCluster } from "./connection";

const BASE = "https://explorer.solana.com";

export function explorerTxUrl(signature: string): string {
  return `${BASE}/tx/${encodeURIComponent(signature)}?cluster=${getCluster()}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BASE}/address/${encodeURIComponent(address)}?cluster=${getCluster()}`;
}
