import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "mineflayer";
import { handleChatCommand } from "./chat-commands.js";
import type { ActionExecutor } from "./action-executor.js";

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

        expect(handled).toBe(true);
        expect(executor.executePlan).toHaveBeenCalledTimes(1);
        expect(bot.chat).toHaveBeenCalledWith("[success] chat#step-1");
    });

    it("parses !act with custom id and json params", async () =>
    {
        const bot = makeBot();
        const executor = makeExecutor();

        const handled = await handleChatCommand(bot, executor, "Player", "!act id=custom-id chat {\"message\":\"hey\"}");

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