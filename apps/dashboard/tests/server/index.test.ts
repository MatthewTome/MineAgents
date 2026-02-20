// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
describe("dashboard server helpers", () => {
  it("round-trips session ids and names", async () => {
    vi.resetModules();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
    process.env.DASHBOARD_LOG_DIR = dir;
    const { encodeSessionId, decodeSessionId, getSessionName } = await import("../../server/index");
    const sessionDir = path.join(dir, "sessions", "2024-01-01", "Agent_123");
    const encoded = encodeSessionId(sessionDir);
    expect(encoded).toContain("__");
    expect(getSessionName("Agent_123")).toBe("Agent");
    expect(decodeSessionId(encoded)).toBe(sessionDir);
  });

  it("discovers explicitly tagged evaluation runs", async () => {
    vi.resetModules();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-eval-"));
    process.env.DASHBOARD_LOG_DIR = dir;

    const runA = path.join(dir, "evaluations", "test-runs", "run-a");
    const runB = path.join(dir, "evaluations", "test-runs", "run-b");
    fs.mkdirSync(runA, { recursive: true });
    fs.mkdirSync(path.join(runB, "nested"), { recursive: true });
    fs.writeFileSync(path.join(runA, "session.log"), "{}\n", "utf-8");
    fs.writeFileSync(path.join(runB, "nested", "session.log"), "{}\n", "utf-8");

    const { discoverEvaluationSessions } = await import("../../server/index");
    const sessions = discoverEvaluationSessions();
    expect(sessions).toHaveLength(2);
  });

  it("parses packets from JSON payloads", async () => {
    const { parsePacket } = await import("../../server/index");
    expect(parsePacket('{"type":"Plan","data":{"intent":"test"}}')?.type).toBe("Plan");
    expect(parsePacket("Narration text")?.type).toBe("Narration");
    expect(parsePacket(null)).toBeNull();
  });

  it("reads json line logs and computes metrics", async () => {
    const { readJsonLines, computeMetrics, computeBoxPlot } = await import("../../server/index");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logs-"));
    const logFile = path.join(dir, "session.log");
    fs.writeFileSync(logFile, JSON.stringify({ ts: 1, message: "test" }) + "\n");
    expect(readJsonLines(logFile)).toHaveLength(1);

    const metrics = computeMetrics([
      {
        sessionId: "1",
        name: "Trial",
        condition: "baseline",
        durationSec: 10,
        success: true,
        actionCount: 4,
        actionAttempts: 6,
        planSteps: 5,
        evaluationRun: true
      }
    ] as any);

    expect(metrics.conditions.baseline.successRate).toBe(1);
    expect(metrics.conditions.baseline.averageActionAttempts).toBe(6);
    expect(metrics.conditions.baseline.averagePlanSteps).toBe(5);
    expect(computeBoxPlot([1, 2, 3]).median).toBe(2);
  });
});