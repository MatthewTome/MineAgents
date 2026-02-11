import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "mineflayer";
import { handleChatCommand, PlanNarrator } from "../../../src/actions/handlers/chatting/chat.js";
import type { ActionExecutor } from "../../../src/actions/executor.js";

function makeBot()
{
    return { chat: vi.fn(), username: "MineAgent" } as unknown as Bot;
}

function makeExecutor(resultStatus: string = "success")
{
    return {
        executePlan: vi.fn().mockResolvedValue([
            { id: "step-1", action: "chat", status: resultStatus, attempts: 1 }
        ])
    } as unknown as ActionExecutor;
}

describe("chat command bridge", () =>
{
    beforeEach(() =>
    {
        vi.useRealTimers();
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it("runs !say through the action executor and reports status", async () =>
    {
        const bot = makeBot();
        const executor = makeExecutor();

        const handled = await handleChatCommand(bot, executor, "Player", "!say hello world");

        console.log({ 
            actualChat: (bot.chat as any).mock.calls, 
            expected: ["[success] chat#step-1"] 
        });

        expect(handled).toBe(true);
        expect(executor.executePlan).toHaveBeenCalledTimes(1);
        expect(bot.chat).toHaveBeenCalledWith("[success] chat#step-1");
    });

    it("parses !act with custom id and json params", async () =>
    {
        const bot = makeBot();
        const executor = makeExecutor();

        const handled = await handleChatCommand(bot, executor, "Player", "!act id=custom-id chat {\"message\":\"hey\"}");

        console.log({ 
            actualPlan: (executor.executePlan as any).mock.calls[0][0], 
            expectedId: "custom-id" 
        });

        expect(handled).toBe(true);
        expect(executor.executePlan).toHaveBeenCalledWith([
            {
                id: "custom-id",
                action: "chat",
                params: { message: "hey" },
                description: "chat command from Player"
            }
        ]);
    });
});

describe("PlanNarrator", () =>
{
    beforeEach(() =>
    {
        vi.useRealTimers();
    });

    afterEach(() =>
    {
        vi.useRealTimers();
        vi.clearAllTimers();
    });

    it("limits narration length and removes extra whitespace", () =>
    {
        const narrator = new PlanNarrator({ maxLength: 40 });
        const intent = "  Collect wood, craft planks, build shelter near spawn with a roof and walls.  ";
        const summary = narrator.maybeNarrate({ intent }) ?? "";

        console.log({ actualLength: summary.length, expectedMax: 40, actualSummary: summary });

        expect(summary.length).toBeLessThanOrEqual(40);
        expect(summary.endsWith("...")).toBe(true);
        expect(summary).not.toContain("  ");
    });

    it("formats diverse plans into readable, compact summaries", () =>
    {
        const narrator = new PlanNarrator({ minIntervalMs: 0 });
        const cases =
        [
            {
                title: "no intent falls back to step and goal",
                plan: {
                    goal: "cross ravine",
                    steps: [{ id: "s-1", action: "bridge", description: "across gap" }]
                },
                expectation: /bridge: across gap for cross ravine/,
            },
            {
                title: "multi-step plan shows count and trims",
                plan: {
                    goal: "secure base",
                    steps: [
                        { id: "s-1", action: "gather", description: "wood" },
                        { id: "s-2", action: "craft", description: "planks" },
                        { id: "s-3", action: "build", description: "walls & roof" },
                    ]
                },
                expectation: /^gather: wood for secure base \(3 steps\)$/,
            },
            {
                title: "unusual characters stay readable and deduped",
                plan: {
                    intent: "   Scout @ village; trade??  get maps!!   "
                },
                expectation: /^Scout @ village; trade\?\? get maps!!$/,
            },
            {
                title: "missing everything falls back to planning placeholder",
                plan: {},
                expectation: /^planning actions$/,
            },
        ];

        for (const testCase of cases)
        {
            const summary = narrator.maybeNarrate(testCase.plan) ?? "";

            console.log({ actual: summary, expected: testCase.expectation });

            expect(summary.length).toBeLessThanOrEqual(140);
            expect(summary).not.toMatch(/\s{2,}/);
            expect(summary.trim()).toBe(summary);
            expect(summary).toMatch(testCase.expectation);
        }
    });

    it("exposes intent and goal hints so players can anticipate actions", () =>
    {
        const narrator = new PlanNarrator();

        const bridgePlan = narrator.maybeNarrate(
        {
            goal: "reach desert temple",
            steps:
            [
                { id: "s-1", action: "bridge", description: "over ravine" },
                { id: "s-2", action: "loot", description: "the chest" }
            ]
        }) ?? "";

        const rescuePlan = narrator.maybeNarrate(
        {
            intent: "Rescue villager from raid and secure houses",
            goal: "protect settlement",
            steps:
            [
                { id: "s-1", action: "defend", description: "north gate" },
                { id: "s-2", action: "escort", description: "survivors" }
            ]
        }, Date.now() + 2_000) ?? "";

        console.log({ actualBridge: bridgePlan, actualRescue: rescuePlan });

        expect(bridgePlan).toMatchInlineSnapshot(`"bridge: over ravine for reach desert temple (2 steps)"`);
        expect(rescuePlan).toMatchInlineSnapshot(`"Rescue villager from raid and secure houses"`);
        expect(bridgePlan.includes("bridge")).toBe(true);
        expect(bridgePlan.includes("desert temple")).toBe(true);
    });

    it("rate limits narration to one message per second", () =>
    {
        vi.useFakeTimers();
        const narrator = new PlanNarrator({ minIntervalMs: 1000 });

        const summaries = [] as Array<string | null>;

        for (let i = 0; i < 5; i++)
        {
            summaries.push(narrator.maybeNarrate({ intent: `call-${i}` }, i * 200));
            vi.advanceTimersByTime(200);
        }

        vi.advanceTimersByTime(1_000);
        summaries.push(narrator.maybeNarrate({ intent: "after-wait" }, 1_800));

        const emitted = summaries.filter((s): s is string => Boolean(s));

        console.log({ actual: emitted, expected: ["call-0", "after-wait"] });

        expect(emitted[0]).toBe("call-0");
        expect(emitted.includes("call-1")).toBe(false);
        expect(emitted.includes("call-2")).toBe(false);
        expect(emitted.includes("call-3")).toBe(false);
        expect(emitted.includes("call-4")).toBe(false);
        expect(emitted.at(-1)).toBe("after-wait");
    });
});