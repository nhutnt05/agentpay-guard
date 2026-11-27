import { connection as requestTime } from "next/server";
import { checkProgramIdConfig } from "@/lib/anchor/constants";
import { ok } from "@/lib/api/response";
import { getAgentPublicKey } from "@/lib/server/agentKeypair";
import { rateLimitRead } from "@/lib/server/guards";
import { getCluster, getServerConnection } from "@/lib/solana/connection";

// GET /api/v1/health (docs/06 §3.1). Always answers, even when the RPC is down, and never
// returns secrets — only which integrations are configured.
export async function GET(request: Request) {
  await requestTime(); // request-time only: never prerender RPC data at build
  const limited = rateLimitRead(request, "health");
  if (limited) return limited;

  const connection = getServerConnection();
  const agent = getAgentPublicKey();
  const programId = checkProgramIdConfig();

  let rpcSlot: number | null = null;
  let agentSolBalanceLamports: string | null = null;
  let rpcError: string | null = null;
  try {
    const [slot, balance] = await Promise.all([
      connection.getSlot("confirmed"),
      agent ? connection.getBalance(agent, "confirmed") : Promise.resolve(null),
    ]);
    rpcSlot = slot;
    agentSolBalanceLamports = balance === null ? null : String(balance);
  } catch {
    rpcError = "RPC request failed";
  }

  return ok({
    cluster: getCluster(),
    programId: programId.idlProgramId,
    programIdConfigOk: programId.ok,
    agentPubkey: agent?.toBase58() ?? null,
    agentSolBalanceLamports,
    rpcSlot,
    rpcError,
    llmConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    firecrawlConfigured: Boolean(process.env.FIRECRAWL_API_KEY),
    allowedOwnersConfigured: Boolean(process.env.ALLOWED_POLICY_OWNERS?.trim()),
    version: "0.1.0",
  });
}
