import { describe, it, expect, vi } from "vitest";

vi.mock("node:worker_threads", () => ({
  parentPort: {
    on: vi.fn(),
    postMessage: vi.fn()
  },
  workerData: {}
}));

vi.mock("../../src/planner/planner.js", () => ({
  HuggingFacePlanner: class {
    modelName = "mock-model";
    async backend() {
      return "local";
    }
    async createPlan() {
      return { intent: "test", steps: [], model: "mock-model", backend: "local", raw: "" };
    }
  }
}));

vi.mock("../../src/logger/session-logger.js", () => ({
  SessionLogger: class {
    installGlobalHandlers() {}
  }
}));

vi.mock("../../src/logger/debug-trace.js", () => ({
  DebugTracer: class {}
}));

import * as subject from "../../src/planner/planner-worker.js";
import { parentPort } from "node:worker_threads";

describe("planner/planner-worker.ts", () => {
  it("exports something", () => {
    expect(subject).toBeDefined();
    expect(parentPort?.postMessage).toHaveBeenCalledWith({ type: "ready", backend: "local", model: "mock-model" });
  });
});