import { describe, expect, it } from "vitest";
import { AGENT_IS_MERCHANT_WARNING, agentIsAllowlistedMerchant, newAgentWarning } from "./warnings";

const M1 = "2G3ycA33spLfeTf7XRirooNaKgS26D2JaXBfyfAPirSn";
const M2 = "4EQztCaFYShjMB49yxtkCqgoGMFv4YkFQ3ohuHKvMARf";
const AGENT = "DgyKmgocPn3TW9CuyZgub5KwjRM3rgm1nU9pp4UcZWM1";

describe("agent = allowlisted merchant warning (T-M4-17)", () => {
  it("detects the current agent among the allowlisted merchants", () => {
    expect(agentIsAllowlistedMerchant(AGENT, [M1, M2])).toBe(false);
    expect(agentIsAllowlistedMerchant(M2, [M1, M2])).toBe(true);
  });

  it("warns before replacing the agent with an allowlisted merchant", () => {
    expect(newAgentWarning(` ${M1} `, [M1, M2])).toBe(AGENT_IS_MERCHANT_WARNING);
    expect(newAgentWarning(AGENT, [M1, M2])).toBeNull();
    expect(newAgentWarning(AGENT, [])).toBeNull();
  });
});
