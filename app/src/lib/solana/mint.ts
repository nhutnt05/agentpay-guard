import { type Mint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import type { Commitment, Connection, PublicKey } from "@solana/web3.js";

/**
 * F-05: reads a mint owned by either classic SPL Token or Token-2022 (one RPC call).
 * `getMint` alone assumes the classic program and throws for Token-2022 mints.
 */
export async function getMintAnyProgram(
  connection: Pick<Connection, "getAccountInfo">,
  mint: PublicKey,
  commitment: Commitment = "confirmed",
): Promise<Mint> {
  const info = await connection.getAccountInfo(mint, commitment);
  const programId = info?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  return unpackMint(mint, info, programId);
}
