import { describe, it, expect } from "vitest";
import { buildGoalMetadata, parseEnvBoolean, resolveMentorMode, runSetupWizard } from "../../src/startup/helpers.js";

describe("startup/helpers.ts", () => {
  it("parses environment booleans consistently", () => {
    expect(parseEnvBoolean("YES")).toBe(true);
    expect(parseEnvBoolean("0")).toBe(false);
    expect(parseEnvBoolean("maybe")).toBeNull();
  });

  it("resolves mentor modes and builds goal metadata", () => {
    expect(resolveMentorMode("teacher")).toBe("teacher");
    const metadata = buildGoalMetadata({
      role: "builder",
      mentorMode: "teacher",
      features: { ragEnabled: true, narrationEnabled: false, safetyEnabled: true },
      agentId: 2,
      agentCount: 3,
      seed: "seed-1",
      trialId: "trial-1"
    });

    expect(metadata.condition?.role).toBe("builder");
    expect(metadata.condition?.agentCount).toBe(3);
  });

  it("keeps setup wizard available for interactive bootstrapping", () => {
    expect(runSetupWizard).toBeTypeOf("function");
  });
});