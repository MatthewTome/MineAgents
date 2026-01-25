import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResourceLockManager, resolveLeaderForGoal } from "../../src/teamwork/coordination.js";

describe("coordination", () =>
{
    let tempDir: string | null = null;

    afterEach(() =>
    {
        if (tempDir)
        {
            fs.rmSync(tempDir, { recursive: true, force: true });
            tempDir = null;
        }
    });

    it("elects a leader once for the same goal", () =>
    {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mineagents-coord-"));
        const filePath = path.join(tempDir, "coord.json");
        const lockPath = path.join(tempDir, "coord.lock");

        const first = resolveLeaderForGoal({
            filePath,
            lockPath,
            goal: "build shelter",
            candidate: {
                name: "alpha",
                role: "guide",
                agentId: 1
            }
        });

        expect(first?.isLeader).toBe(true);
        expect(first?.leader.name).toBe("alpha");

        const second = resolveLeaderForGoal({
            filePath,
            lockPath,
            goal: "build shelter",
            candidate: {
                name: "bravo",
                role: "miner",
                agentId: 2
            }
        });

        expect(second?.isLeader).toBe(false);
        expect(second?.leader.name).toBe("alpha");
    });

    it("prevents concurrent resource locks on shared objects", async () =>
    {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mineagents-locks-"));
        const filePath = path.join(tempDir, "coord.json");
        const lockPath = path.join(tempDir, "coord.lock");

        const alpha = new ResourceLockManager({ filePath, lockPath, owner: "agent-alpha", ttlMs: 2000 });
        const bravo = new ResourceLockManager({ filePath, lockPath, owner: "agent-bravo", ttlMs: 2000 });

        const first = await alpha.acquire("chest:1,2,3", { waitMs: 50, pollMs: 10 });
        expect(first).toBe(true);

        const second = await bravo.acquire("chest:1,2,3", { waitMs: 50, pollMs: 10 });
        expect(second).toBe(false);

        alpha.release("chest:1,2,3");

        const third = await bravo.acquire("chest:1,2,3", { waitMs: 50, pollMs: 10 });
        expect(third).toBe(true);
    });
});