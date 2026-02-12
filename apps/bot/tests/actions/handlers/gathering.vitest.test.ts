import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "mineflayer";
import { handleGather } from "../../../src/actions/handlers/gathering/gather.js";
import { handleLoot } from "../../../src/actions/handlers/looting/loot.js";
import { craftFromInventory } from "../../../src/actions/handlers/crafting/craft.js";
import { collectBlocks, resolveItemToBlock, resolveProductToRaw } from "../../../src/actions/handlers/mining/mine.js";
import { moveWithMovementPlugin, findNearestEntity, waitForNextTick } from "../../../src/actions/handlers/moving/move.js";
import { listChestMemory } from "../../../src/perception/chest-memory.js";

vi.mock("../../../src/actions/handlers/looting/loot.js", () => ({
    handleLoot: vi.fn()
}));

vi.mock("../../../src/actions/handlers/crafting/craft.js", () => ({
    craftFromInventory: vi.fn()
}));

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
    moveWithMovementPlugin: vi.fn(),
    findNearestEntity: vi.fn(),
    waitForNextTick: vi.fn()
}));

vi.mock("../../../src/actions/handlers/mining/mine.js", () => ({
    collectBlocks: vi.fn(),
    resolveItemToBlock: vi.fn(),
    resolveProductToRaw: vi.fn()
}));

vi.mock("../../../src/perception/chest-memory.js", () => ({
    listChestMemory: vi.fn()
}));

function makeVec3(x: number, y: number, z: number)
{
    return {
        x,
        y,
        z,
        offset(dx: number, dy: number, dz: number)
        {
            return makeVec3(x + dx, y + dy, z + dz);
        },
        toString()
        {
            return `${x},${y},${z}`;
        },
        floored() {
            return makeVec3(Math.floor(x), Math.floor(y), Math.floor(z));
        },
        clone() {
            return makeVec3(x, y, z);
        }
    };
}

function makeBot(items: Array<{ name: string; count: number }> = [])
{
    const position = makeVec3(0, 64, 0);
    return {
        inventory: { items: () => items },
        entity: { position },
        registry: {
            itemsByName: { 
                oak_log: { id: 1, name: "oak_log" }, 
                oak_planks: { id: 2, name: "oak_planks" },
                planks: { id: 2, name: "oak_planks" },
                cobblestone: { id: 3, name: "cobblestone" }
            },
            blocksByName: { 
                log: { id: 1 }, 
                oak_log: { id: 2 },
                stone: { id: 3 }
            }
        },
        findBlocks: vi.fn().mockReturnValue([]),
        findBlock: vi.fn().mockReturnValue(null),
        blockAt: vi.fn(),
        canDigBlock: vi.fn().mockReturnValue(true),
        pathfinder: { stop: vi.fn() },
        recipesFor: vi.fn().mockReturnValue([{ delta: [] }]),
    } as unknown as Bot;
}

describe("handleGather", () =>
{
    beforeEach(() =>
    {
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.mocked(resolveItemToBlock).mockReturnValue(null);
        vi.mocked(resolveProductToRaw).mockReturnValue(null);
        vi.mocked(waitForNextTick).mockResolvedValue(undefined);
        vi.mocked(listChestMemory).mockReturnValue([]);
        vi.mocked(findNearestEntity).mockReturnValue(null);

        vi.mocked(handleLoot).mockResolvedValue(undefined);
        vi.mocked(craftFromInventory).mockResolvedValue(undefined);
        vi.mocked(moveWithMovementPlugin).mockResolvedValue(undefined);
        vi.mocked(collectBlocks).mockResolvedValue(false);
    });

    afterEach(() =>
    {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it("skips gathering when inventory already satisfies the request", async () =>
    {
        const bot = makeBot([{ name: "oak_log", count: 3 }]);

        await handleGather(bot, { params: { item: "log" } });

        expect(handleLoot).not.toHaveBeenCalled();
        expect(collectBlocks).not.toHaveBeenCalled();
    });

    it("prioritizes dropped items before mining", async () =>
    {
        const items: Array<{ name: string; count: number }> = [];
        const bot = makeBot(items);
        const dropPosition = makeVec3(5, 64, 5);

        vi.mocked(findNearestEntity).mockReturnValue({
            name: "item",
            position: dropPosition,
            getDroppedItem: () => ({ name: "oak_log" })
        } as any);

        vi.mocked(moveWithMovementPlugin).mockImplementation(async () => {
            items.push({ name: "oak_log", count: 1 });
        });

        vi.mocked(resolveItemToBlock).mockReturnValue("oak_log");

        await handleGather(bot, { params: { item: "log", timeoutMs: 1000 } });

        expect(moveWithMovementPlugin).toHaveBeenCalledWith(bot, dropPosition, 1.0, 15000);
        expect(collectBlocks).not.toHaveBeenCalled(); 
    });

    it("falls back to mining if no dropped items found", async () =>
    {
        const items: Array<{ name: string; count: number }> = [];
        const bot = makeBot(items);
        const blockPosition = makeVec3(3, 64, -1);
        const targetBlock = { name: "oak_log", position: blockPosition };

        vi.mocked(resolveItemToBlock).mockImplementation((_bot, name) => 
            name.includes("log") ? "oak_log" : null
        );

        vi.mocked(collectBlocks).mockImplementation(async () =>
        {
            items.push({ name: "oak_log", count: 1 });
            return true;
        });

        (bot.findBlocks as any).mockReturnValue([blockPosition]);
        (bot.blockAt as any).mockReturnValue(targetBlock);

        await handleGather(bot, { params: { item: "log", timeoutMs: 1000 } });

        expect(findNearestEntity).toHaveBeenCalled();
        expect(collectBlocks).toHaveBeenCalledTimes(1);
    });

    it("crafts if mining fails or is not applicable", async () =>
    {
        const items = [{ name: "oak_log", count: 2 }];
        const bot = makeBot(items);

        vi.mocked(resolveProductToRaw).mockImplementation((product) =>
            product.includes("planks") ? "oak_log" : null
        );

        vi.mocked(craftFromInventory).mockImplementation(async () => {
            items.push({ name: "oak_planks", count: 4 });
        });

        await handleGather(bot, { params: { item: "planks", timeoutMs: 6000 } });

        expect(craftFromInventory).toHaveBeenCalledWith(bot, { recipe: "oak_planks" }, undefined);
    });
});