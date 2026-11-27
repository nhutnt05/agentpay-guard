import "server-only";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { getServerConnection } from "@/lib/solana/connection";
import { getAllowedOwners } from "./access";
import { getAgentKeypair } from "./agentKeypair";
import type { PaymentDeps } from "./payments";

/** Production dependencies for the payment service, from server-only configuration. */
export function getPaymentDeps(): PaymentDeps {
  const connection = getServerConnection();
  let agent: PaymentDeps["agent"] = null;
  try {
    agent = getAgentKeypair();
  } catch {
    agent = null; // reported as CONFIG_ERROR / POLICY_NOT_SERVED by the service
  }
  return {
    rpc: connection,
    // The program client only builds instructions; signing is done explicitly with `agent`.
    program: getReadonlyProgram(connection, agent?.publicKey ?? PublicKey.default),
    agent,
    allowedOwners: getAllowedOwners(),
    demoMode: process.env.DEMO_MODE === "true",
  };
}
