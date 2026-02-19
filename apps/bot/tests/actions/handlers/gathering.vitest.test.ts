import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { handleGather, handlePickup } from "../../../src/actions/handlers/gathering/gather.js";
import { handleLoot } from "../../../src/actions/handlers/looting/loot.js";
import { handleCraft } from "../../../src/actions/handlers/crafting/craft.js";
import { handleSmelt } from "../../../src/actions/handlers/smelting/smelt.js";
import { collectBlocks, resolveItemToBlock, resolveProductToRaw } from "../../../src/actions/handlers/mining/mine.js";
import { findNearestEntity, moveWithMovementPlugin, waitForNextTick } from "../../../src/actions/handlers/moving/move.js";
import { listChestMemory } from "../../../src/perception/chest-memory.js";
import { resolveItemName, isItemMatch } from "../../../src/actions/utils.js";

vi.mock("../../../src/actions/handlers/looting/loot.js", () => ({
    handleLoot: vi.fn()
}));

vi.mock("../../../src/actions/handlers/crafting/craft.js", () => ({
    handleCraft: vi.fn()
}));

vi.mock("../../../src/actions/handlers/smelting/smelt.js", () => ({
    handleSmelt: vi.fn()
}));

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
    moveWithMovementPlugin: vi.fn(),
    findNearestEntity: vi.fn(),
    waitForNextTick: vi.fn()
}));

vi.mock("../../../src/actions/handlers/mining/mine.js", () => ({
    collectBlocks: vi.fn(),
    resolveItemToBlock: vi.fn(),
    resolveProductToRaw: vi.fn(),
    handleMine: vi.fn()
}));

vi.mock("../../../src/perception/chest-memory.js", () => ({
    listChestMemory: vi.fn()
}));

vi.mock("../../../src/actions/utils.js", () => ({
    resolveItemName: vi.fn(),
    isItemMatch: vi.fn()
}));

type InventoryItem = { name: string; count: number };

function vec3(x: number, y: number, z: number)
{
    return {
        x,
        y,
        z,
        floored: () => vec3(Math.floor(x), Math.floor(y), Math.floor(z)),
        toString: () => `${x},${y},${z}`
    } as any;
}

function makeBot(items: InventoryItem[] = []): Bot
{
    return {
        inventory: { items: () => items },
        entity: { position: vec3(0, 64, 0) },
        registry: {
            itemsByName: {
                oak_log: { id: 1, name: "oak_log" },
                oak_planks: { id: 2, name: "oak_planks" },
                iron_ingot: { id: 3, name: "iron_ingot" },
                raw_iron: { id: 4, name: "raw_iron" },
                cobblestone: { id: 5, name: "cobblestone" }
            },
            blocksByName: {
                oak_log: { id: 21, name: "oak_log" },
                stone: { id: 22, name: "stone" }
            },
            recipes: {
                2: [
                    {
                        ingredients: [{ id: 1 }],
                        result: { count: 4 }
                    }
                ]
            }
        },
        findBlocks: vi.fn().mockReturnValue([]),
        blockAt: vi.fn().mockReturnValue(null)
    } as unknown as Bot;
}

describe("handleGather", () =>
{
    beforeEach(() =>
    {
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.mocked(resolveItemName).mockImplementation((_bot, name) => name);
        vi.mocked(isItemMatch).mockImplementation((a, b) => a === b);
        vi.mocked(resolveItemToBlock).mockReturnValue(null);
        vi.mocked(resolveProductToRaw).mockReturnValue(null);
        vi.mocked(waitForNextTick).mockResolvedValue(undefined);
        vi.mocked(listChestMemory).mockReturnValue([]);
        vi.mocked(findNearestEntity).mockReturnValue(null);
        vi.mocked(handleLoot).mockResolvedValue(undefined);
        vi.mocked(handleCraft).mockResolvedValue(undefined);
        vi.mocked(handleSmelt).mockResolvedValue(undefined);
        vi.mocked(moveWithMovementPlugin).mockResolvedValue(true);
        vi.mocked(collectBlocks).mockResolvedValue(false);
    });

    afterEach(() =>
    {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("throws if target item is invalid", async () =>
    {
        vi.mocked(resolveItemName).mockReturnValue("");
        const bot = makeBot([]);
        await expect(handleGather(bot, {})).rejects.toThrow("Gather requires item name");
    });

    it("returns immediately when combined stacks already satisfy the requested count", async () =>
    {
        const bot = makeBot([
            { name: "oak_log", count: 2 }
        ]);

        await handleGather(bot, { params: { item: "oak_log", count: 2 } });

        expect(handleLoot).not.toHaveBeenCalled();
        expect(handleCraft).not.toHaveBeenCalled();
        expect(collectBlocks).not.toHaveBeenCalled();
    });

    it("collects dropped items first and exits once target count is reached", async () =>
    {
        const items: InventoryItem[] = [];
        const bot = makeBot(items);
        const droppedPosition = vec3(4, 64, 2);

        vi.mocked(findNearestEntity).mockReturnValue({
            name: "item",
            position: droppedPosition,
            getDroppedItem: () => ({ name: "oak_log" })
        } as any);

        vi.mocked(moveWithMovementPlugin).mockImplementation(async () =>
        {
            items.push({ name: "oak_log", count: 1 });
            vi.mocked(findNearestEntity).mockReturnValue(null);
            return true;
        });

        await handleGather(bot, { params: { item: "oak_log", count: 1, timeoutMs: 2000 } });

        expect(moveWithMovementPlugin).toHaveBeenCalledTimes(1);
        expect(handleLoot).not.toHaveBeenCalled();
        expect(collectBlocks).not.toHaveBeenCalled();
    });

    it("passes only the remaining count to chest looting", async () =>
    {
        const items: InventoryItem[] = [{ name: "oak_log", count: 1 }];
        const bot = makeBot(items);

        vi.mocked(listChestMemory).mockReturnValue([
            {
                status: "known",
                position: vec3(10, 64, 10),
                items: [{ name: "oak_log", count: 32 }]
            }
        ] as any);

        vi.mocked(handleLoot).mockImplementation(async () =>
        {
            items.push({ name: "oak_log", count: 2 });
        });

        await handleGather(bot, { params: { item: "oak_log", count: 3, timeoutMs: 2000 } });

        const [lootBot, lootStep] = vi.mocked(handleLoot).mock.calls[0];
        expect(lootBot).toBe(bot);
        expect(lootStep?.params).toMatchObject({
            item: "oak_log",
            count: 2
        });
    });

    it("mines when block mapping exists and stops once inventory goal is met", async () =>
    {
        const items: InventoryItem[] = [];
        const bot = makeBot(items);
        const blockPos = vec3(2, 64, 2);

        vi.mocked(resolveItemToBlock).mockReturnValue("oak_log");
        (bot.findBlocks as any).mockReturnValue([blockPos]);
        (bot.blockAt as any).mockReturnValue({ name: "oak_log", position: blockPos });
        vi.mocked(collectBlocks).mockImplementation(async () =>
        {
            items.push({ name: "oak_log", count: 1 });
            return true;
        });

        await handleGather(bot, { params: { item: "oak_log", count: 1, timeoutMs: 2000 } });

        expect(collectBlocks).toHaveBeenCalledTimes(1);
        expect(waitForNextTick).toHaveBeenCalledTimes(1);
    });

    it("crafts with remaining count and exits after crafting succeeds", async () =>
    {
        const items: InventoryItem[] = [{ name: "oak_planks", count: 1 }];
        const bot = makeBot(items);

        vi.mocked(handleCraft).mockImplementation(async () =>
        {
            items.push({ name: "oak_planks", count: 2 });
        });

        await handleGather(bot, { params: { item: "oak_planks", count: 3, timeoutMs: 2000 } });

        expect(handleCraft).toHaveBeenCalledWith(
            bot,
            { params: { recipe: "oak_planks", count: 2 } },
            undefined
        );
    });

    it("smelts ingots with remaining count and exits after success", async () =>
    {
        const items: InventoryItem[] = [{ name: "iron_ingot", count: 1 }];
        const bot = makeBot(items);

        vi.mocked(handleSmelt).mockImplementation(async () =>
        {
            items.push({ name: "iron_ingot", count: 1 });
        });

        await handleGather(bot, { params: { item: "iron_ingot", count: 2, timeoutMs: 2000 } });

        expect(handleSmelt).toHaveBeenCalledWith(
            bot,
            { params: { item: "iron_ore", count: 1 } },
            undefined
        );
    });

    it("gathers prerequisites with bounded recursion depth", async () =>
    {
        const items: InventoryItem[] = [];
        const bot = makeBot(items);
        const blockPos = vec3(1, 64, 1);

        vi.mocked(resolveProductToRaw).mockReturnValue("oak_log");
        vi.mocked(resolveItemToBlock).mockImplementation((_bot, item) => item === "oak_log" ? "oak_log" : null);
        (bot.findBlocks as any).mockReturnValue([blockPos]);
        (bot.blockAt as any).mockReturnValue({ name: "oak_log", position: blockPos });
        vi.mocked(collectBlocks).mockImplementation(async () =>
        {
            items.push({ name: "oak_log", count: 1 });
            return true;
        });
        vi.mocked(handleCraft).mockImplementation(async () =>
        {
            const logCount = items.filter((item) => item.name === "oak_log").reduce((sum, item) => sum + item.count, 0);
            if (logCount > 0)
            {
                items.push({ name: "oak_planks", count: 4 });
                return;
            }
            throw new Error("not enough resources yet");
        });

        await handleGather(bot, { params: { item: "oak_planks", count: 4, timeoutMs: 6000 } });

        expect(handleCraft).toHaveBeenCalled();
    });

    it("times out instead of looping forever when nothing is acquirable", async () =>
    {
        const bot = makeBot([]);

        await expect(
            handleGather(bot, { params: { item: "cobblestone", count: 1, timeoutMs: 1000 } })
        ).rejects.toThrow("Gather cobblestone failed: Timeout or not found.");
    });
    
    it("handlePickup exits if no dropped items", async () =>
    {
        const bot = makeBot([]);
        vi.mocked(findNearestEntity).mockReturnValue(null);
        await handlePickup(bot, {});
        expect(moveWithMovementPlugin).not.toHaveBeenCalled();
    });

    it("handlePickup moves to item", async () =>
    {
        const bot = makeBot([]);
        const dropped = { name: "item", position: vec3(1,1,1), getDroppedItem: () => ({ name: "stone" }) };
        vi.mocked(findNearestEntity).mockReturnValue(dropped as any);
        await handlePickup(bot, { params: { item: "stone" } });
        expect(moveWithMovementPlugin).toHaveBeenCalled();
    });
});