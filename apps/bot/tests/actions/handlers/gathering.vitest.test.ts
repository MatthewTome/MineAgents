import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "mineflayer";

vi.mock("../../src/actions/handlers/looting.js", () => ({
    handleLoot: vi.fn()
}));

vi.mock("../../src/actions/handlers/crafting.js", () => ({
    craftFromInventory: vi.fn()
}));

vi.mock("../../src/actions/handlers/movement.js", () => ({
    moveToward: vi.fn(),
    findNearestEntity: vi.fn(),
    waitForNextTick: vi.fn()
}));

vi.mock("../../src/actions/handlers/mining.js", () => ({
    collectBlocks: vi.fn(),
    resolveItemToBlock: vi.fn(),
    resolveProductToRaw: vi.fn()
}));

vi.mock("../../src/perception/chest-memory.js", () => ({
    listChestMemory: vi.fn()
}));

import { handleGather } from "../../../src/actions/handlers/gathering.js";
import { handleLoot } from "../../../src/actions/handlers/looting.js";
import { craftFromInventory } from "../../../src/actions/handlers/crafting.js";
import { collectBlocks, resolveItemToBlock, resolveProductToRaw } from "../../../src/actions/handlers/mining.js";
import { moveToward, findNearestEntity, waitForNextTick } from "../../../src/actions/handlers/movement.js";
import { listChestMemory } from "../../../src/perception/chest-memory.js";

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
            itemsByName: { oak_log: {}, oak_planks: {} },
            blocksByName: { log: { id: 1 }, oak_log: { id: 2 } }
        },
        findBlocks: vi.fn().mockReturnValue([]),
        blockAt: vi.fn(),
        canDigBlock: vi.fn().mockReturnValue(true),
        pathfinder: { stop: vi.fn() }
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

    it("pulls from chest memory when a known chest contains the item", async () =>
    {
        const items: Array<{ name: string; count: number }> = [];
        const bot = makeBot(items);
        const chestPosition = { x: 1, y: 64, z: 2 };

        vi.mocked(listChestMemory).mockReturnValue([
            { status: "known", position: chestPosition, items: [{ name: "oak_log", count: 4 }] }
        ] as any);

        vi.mocked(handleLoot).mockImplementation(async () =>
        {
            items.push({ name: "oak_log", count: 1 });
        });

        await handleGather(bot, { params: { item: "log" } });

        expect(handleLoot).toHaveBeenCalledWith(bot, { params: { position: chestPosition, item: "oak_log" } }, undefined);
    });

    it("moves to collect dropped items when they match the target", async () =>
    {
        const bot = makeBot();
        const dropPosition = makeVec3(5, 64, 5);

        vi.mocked(findNearestEntity).mockReturnValue({
            name: "item",
            position: dropPosition,
            getDroppedItem: () => ({ name: "oak_log" })
        } as any);

        await handleGather(bot, { params: { item: "log" } });

        expect(moveToward).toHaveBeenCalledWith(bot, dropPosition, 1.0, 15000);
        expect(collectBlocks).not.toHaveBeenCalled();
    });

    it("mines blocks when a matching source block is found", async () =>
    {
        const bot = makeBot();
        const blockPosition = makeVec3(3, 64, -1);

        vi.mocked(resolveItemToBlock).mockReturnValue("log");
        (bot.findBlocks as any).mockReturnValue([blockPosition]);
        (bot.blockAt as any).mockReturnValue({ name: "oak_log", position: blockPosition });

        await handleGather(bot, { params: { item: "log" } });

        expect(collectBlocks).toHaveBeenCalledTimes(1);
    });

    it("crafts the item from raw materials when applicable", async () =>
    {
        const bot = makeBot([{ name: "oak_log", count: 2 }]);

        vi.mocked(resolveProductToRaw).mockImplementation((product) =>
            product === "planks" ? "log" : null
        );

        await handleGather(bot, { params: { item: "planks" } });

        expect(craftFromInventory).toHaveBeenCalledWith(bot, { recipe: "planks" }, undefined);
    });
});