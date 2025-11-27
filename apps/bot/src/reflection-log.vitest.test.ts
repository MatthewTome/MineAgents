import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { ReflectionLogger } from "./reflection-log.js";
import type { ActionLogEntry } from "./action-executor.js";

const TMP_DIR = path.join(process.cwd(), "logs-test");

describe("ReflectionLogger", () =>
{
    afterEach(() =>
    {
        if (fs.existsSync(TMP_DIR))
        {
            fs.rmSync(TMP_DIR, { recursive: true, force: true });
        }
    });

    it("records entries and writes a readable summary file", () =>
    {
        const logger = new ReflectionLogger(TMP_DIR);

        const entry: ActionLogEntry =
        {
            id: "chat-1",
            action: "chat",
            status: "success",
            attempts: 1,
            ts: Date.now(),
            description: "from test"
        };

        logger.record(entry);

        const file = logger.writeSummaryFile("summary-test");
        expect(fs.existsSync(file)).toBe(true);

        const content = fs.readFileSync(file, "utf8");
        expect(content).toContain("Session started:");
        expect(content).toContain("Entries: 1");
        expect(content).toContain("id=chat-1 action=chat status=success attempts=1 desc=\"from test\"");
    });
});