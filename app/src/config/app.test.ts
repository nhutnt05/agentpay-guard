import { describe, expect, it } from "vitest";
import { APP_NAME, APP_TAGLINE } from "@/config/app";

// Toolchain smoke test (T-M4-01): proves Vitest runs and the `@/` alias resolves.
// Real unit tests (request hash, PDAs, validation) arrive with T-M4-03.
describe("app config", () => {
  it("exposes the product identity", () => {
    expect(APP_NAME).toBe("AgentPay Guard");
    expect(APP_TAGLINE).toMatch(/payment rules/);
  });
});
