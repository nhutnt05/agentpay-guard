import { createHash } from "node:crypto";

// Content handling for the agent (docs/08 §2.1): cap at 50 KB and REPORT truncation —
// never truncate silently. The hash lets the UI/evidence show exactly what the LLM saw.

export const MAX_CONTENT_BYTES = 50_000;

export interface PreparedContent {
  text: string;
  truncated: boolean;
  originalBytes: number;
  sha256: string;
}

export function prepareContent(raw: string): PreparedContent {
  const bytes = Buffer.from(raw, "utf8");
  const truncated = bytes.length > MAX_CONTENT_BYTES;
  // Cut on a byte boundary, then drop a possibly split trailing UTF-8 character.
  const text = truncated
    ? bytes.subarray(0, MAX_CONTENT_BYTES).toString("utf8").replace(/�+$/, "")
    : raw;
  return {
    text,
    truncated,
    originalBytes: bytes.length,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}
