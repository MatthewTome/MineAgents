import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "mineflayer";
import { ActionExecutor, type ActionHandler, type ActionStep } from "../src/actions/action-executor.js";

function makeBot()
{
    return { chat: vi.fn() } as unknown as Bot;
}

describe("ActionExecutor", () =>
{
    beforeEach(() =>
    {
        vi.useRealTimers();
    });

    afterEach(() =>
    {
        vi.clearAllTimers();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it("skips duplicate action ids to stay idempotent", async () =>
    {
        const bot = makeBot();
        const executor = new ActionExecutor(bot);

        const step: ActionStep = { id: "chat-1", action: "chat", params: { message: "hello" } };

        const firstRun = await executor.executePlan([step]);
        const secondRun = await executor.executePlan([step]);

        console.log({ 
            run1Status: firstRun[0].status, 
            run2Status: secondRun[0].status, 
            expectedRun2: "skipped" 
        });

        expect(firstRun[0].status).toBe("success");
        expect(secondRun[0].status).toBe("skipped");
        expect(secondRun[0].reason).toContain("duplicate");
        expect((bot as any).chat).toHaveBeenCalledTimes(1);
    });

    it("retries failed actions with backoff and logs reasons", async () =>
    {
        vi.useFakeTimers();

        const bot = makeBot();
        let attempts = 0;

        const flakeyHandler: ActionHandler = async () =>
        {
            attempts++;
            if (attempts < 3)
            {
                throw new Error(`boom-${attempts}`);
            }
        };

        const executor = new ActionExecutor(bot, { custom: flakeyHandler },
        {
            maxAttempts: 3,
            baseBackoffMs: 50
        });

        const runPromise = executor.executePlan([{ id: "retry-me", action: "custom" }]);

        await vi.runAllTimersAsync();
        const results = await runPromise;

        expect(attempts).toBe(3);
        expect(results[0].status).toBe("success");
        expect(results[0].attempts).toBe(3);

        const retryLogs = executor.getLogs().filter(l => l.id === "retry-me" && l.status === "retry");

        console.log({ 
            actualAttempts: attempts, 
            expected: 3, 
            retryReasons: retryLogs.map(l => l.reason) 
        });

        expect(retryLogs.length).toBe(2);
        expect(retryLogs[0].reason).toBe("boom-1");
        expect(retryLogs[1].reason).toBe("boom-2");
    });
});