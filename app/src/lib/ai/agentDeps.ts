import "server-only";
import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { getAllowedOwners } from "@/lib/server/access";
import { getAgentPublicKey } from "@/lib/server/agentKeypair";
import { getServerConnection } from "@/lib/solana/connection";
import type { AgentDeps } from "./analyze";
import { firecrawlScrape } from "./firecrawl";

/** Production dependencies for the agent routes (server-only configuration). */
export function getAgentDeps(): AgentDeps {
  const connection = getServerConnection();
  return {
    rpc: connection,
    program: getReadonlyProgram(connection, PublicKey.default),
    agent: getAgentPublicKey(),
    allowedOwners: getAllowedOwners(),
    demoMode: process.env.DEMO_MODE === "true",
    getDecimals: async (mint) => (await getMint(connection, mint, "confirmed")).decimals,
    scrape: firecrawlScrape,
  };
}
