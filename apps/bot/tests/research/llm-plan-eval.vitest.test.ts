import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

describe("llm plan evaluator", () => {
  it("exports CSV and JSON results", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mineagents-llm-eval-"));
    const casesPath = path.join(process.cwd(), "evaluations", "llm_plan_cases.json");
    const csvPath = path.join(tempDir, "llm.csv");
    const jsonPath = path.join(tempDir, "llm.json");

    execSync(
      `node --import tsx src/research/evaluators/llm-plan-eval.ts ${casesPath} ${csvPath} ${jsonPath}`,
      {
        cwd: path.join(process.cwd()),
        stdio: "pipe"
      }
    );

    expect(fs.existsSync(csvPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv).toContain("case_id,passed,expect_valid");
  });
});