import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleSmelt } from "../../../src/actions/handlers/smelting/smelt.js";
import { craftFromInventory } from "../../../src/actions/handlers/crafting/craft.js";
import { handleMine } from "../../../src/actions/handlers/mining/mine.js";
import { Vec3 } from "vec3";

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
    moveToward: vi.fn().mockResolvedValue(undefined),
    waitForNextTick: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/actions/handlers/crafting/craft.js", () => ({
    craftFromInventory: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/actions/handlers/mining/mine.js", () => ({
    handleMine: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/actions/handlers/building/build.js", () => ({
    findReferenceBlock: vi.fn().mockReturnValue({ position: { x: 0, y: -1, z: 0 } })
}));

vi.mock("../../../src/actions/utils.js", () => ({
    resolveItemName: vi.fn((bot, name) => name),
    requireInventoryItem: vi.fn()
}));

vi.mock("../../../src/actions/handlers/teamwork/teamwork.js", () => ({
    buildLockKey: vi.fn(() => "lock"),
    withResourceLock: vi.fn(async (locks, key, fn) => await fn())
}));

describe("handleSmelt", () => {
    let bot: any;
    let furnace: any;

    beforeEach(() => {
        vi.useFakeTimers();

        furnace = {
            putFuel: vi.fn().mockResolvedValue(undefined),
            putInput: vi.fn().mockResolvedValue(undefined),
            takeOutput: vi.fn().mockResolvedValue(undefined),
            close: vi.fn()
        };

        bot = {
            blockAt: vi.fn(),
            findBlock: vi.fn(),
            openFurnace: vi.fn().mockResolvedValue(furnace),
            inventory: {
                items: vi.fn().mockReturnValue([])
            },
            entity: {
                position: new Vec3(0, 0, 0)
            },
            equip: vi.fn().mockResolvedValue(undefined),
            placeBlock: vi.fn().mockResolvedValue(undefined)
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("smelts using an existing nearby furnace", async () => {
        const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
        bot.findBlock.mockReturnValue(furnaceBlock);
        bot.blockAt.mockReturnValue(furnaceBlock);
        
        bot.inventory.items.mockReturnValue([
            { name: "coal", count: 1, type: 1 },
            { name: "raw_iron", count: 1, type: 2 }
        ]);

        const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
        
        await vi.advanceTimersByTimeAsync(10000);
        await promise;

        expect(bot.openFurnace).toHaveBeenCalledWith(furnaceBlock);
        expect(furnace.putFuel).toHaveBeenCalled();
        expect(furnace.putInput).toHaveBeenCalled();
    });

    it("places a furnace from inventory if none found nearby", async () => {
        bot.findBlock.mockReturnValue(null); 
        
        bot.inventory.items.mockReturnValue([
            { name: "furnace", count: 1, type: 3 },
            { name: "coal", count: 1, type: 1 },
            { name: "raw_iron", count: 1, type: 2 }
        ]);
        
        const placedBlock = { name: "furnace", position: new Vec3(1, 0, 0) };
        bot.blockAt.mockReturnValue(placedBlock);

        const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
        
        await vi.advanceTimersByTimeAsync(10000);
        await promise;

        expect(bot.placeBlock).toHaveBeenCalled();
        expect(bot.openFurnace).toHaveBeenCalled();
    });

    it("crafts a furnace then places it if none in inventory", async () => {
        bot.findBlock.mockReturnValue(null);
        const placedBlock = { name: "furnace", position: new Vec3(1, 0, 0) };
        bot.blockAt.mockReturnValue(placedBlock);

        bot.inventory.items
            .mockReturnValueOnce([
                { name: "cobblestone", count: 8 },
                { name: "coal", count: 1 }, 
                { name: "raw_iron", count: 1 }
            ])
            .mockReturnValueOnce([
                { name: "furnace", count: 1 },
                { name: "coal", count: 1 }, 
                { name: "raw_iron", count: 1 }
            ])
            .mockReturnValue([
                { name: "furnace", count: 1 },
                { name: "coal", count: 1 }, 
                { name: "raw_iron", count: 1 }
            ]);

        const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
        
        await vi.advanceTimersByTimeAsync(10000);
        await promise;

        expect(craftFromInventory).toHaveBeenCalledWith(expect.anything(), { recipe: "furnace" }, undefined);
        expect(bot.placeBlock).toHaveBeenCalled();
        expect(bot.openFurnace).toHaveBeenCalled();
    });

    it("mines cobblestone, crafts furnace, then places it if materials missing", async () => {
        bot.findBlock.mockReturnValue(null);
        const placedBlock = { name: "furnace", position: new Vec3(1, 0, 0) };
        bot.blockAt.mockReturnValue(placedBlock);

        (craftFromInventory as any).mockRejectedValueOnce(new Error("Insufficient ingredients"));
        (craftFromInventory as any).mockResolvedValueOnce(undefined);

        bot.inventory.items
            .mockReturnValueOnce([
                { name: "cobblestone", count: 0 },
                { name: "coal", count: 1 }, 
                { name: "raw_iron", count: 1 }
            ])
            .mockReturnValueOnce([
                { name: "cobblestone", count: 0 }
            ])
            .mockReturnValueOnce([
                { name: "furnace", count: 1 },
                { name: "coal", count: 1 }, 
                { name: "raw_iron", count: 1 }
            ])
            .mockReturnValue([
                { name: "furnace", count: 1 },
                { name: "coal", count: 1 }, 
                { name: "raw_iron", count: 1 }
            ]);

        const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
        
        await vi.advanceTimersByTimeAsync(10000);
        await promise;

        expect(craftFromInventory).toHaveBeenCalledTimes(2);
        expect(handleMine).toHaveBeenCalledWith(expect.anything(), { params: { block: "cobblestone", count: 8, maxDistance: 32 } });
        expect(bot.placeBlock).toHaveBeenCalled();
        expect(bot.openFurnace).toHaveBeenCalled();
    });
});