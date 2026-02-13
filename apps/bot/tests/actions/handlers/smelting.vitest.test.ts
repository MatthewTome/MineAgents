import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleSmelt } from "../../../src/actions/handlers/smelting/smelt.js";
import { handleMine } from "../../../src/actions/handlers/mining/mine.js";
import { CraftingSystem } from "../../../src/actions/handlers/crafting/craft.js";
import { Vec3 } from "vec3";
import EventEmitter from "events";
import { findReferenceBlock } from "../../../src/actions/handlers/building/index.js";

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
    moveToward: vi.fn().mockResolvedValue(undefined),
    waitForNextTick: vi.fn().mockResolvedValue(undefined),
    moveWithMovementPlugin: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/actions/handlers/crafting/craft.js", () => 
{
    const CraftingSystem = vi.fn();
    CraftingSystem.prototype.recipesFor = vi.fn();
    CraftingSystem.prototype.craft = vi.fn();
    return {
        CraftingSystem,
        craftFromInventory: vi.fn().mockResolvedValue(undefined)
    };
});

vi.mock("../../../src/actions/handlers/mining/mine.js", () => ({
    handleMine: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/actions/handlers/building/index.js", () => ({
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

describe("handleSmelt", () => 
{
    let bot: any;
    let furnace: any;

    beforeEach(() => 
    {
        vi.useFakeTimers();

        furnace = new EventEmitter();
        Object.assign(furnace, {
            putFuel: vi.fn().mockResolvedValue(undefined),
            putInput: vi.fn().mockResolvedValue(undefined),
            takeOutput: vi.fn().mockResolvedValue(undefined),
            inputItem: vi.fn(),
            fuelItem: vi.fn(),
            outputItem: vi.fn(),
            fuel: 100,
            progress: 0,
            close: vi.fn(),
        });

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
            placeBlock: vi.fn().mockResolvedValue(undefined),
            registry: {
                itemsByName: {
                    furnace: { id: 1 }
                }
            }
        };

        vi.mocked(findReferenceBlock).mockReturnValue({ position: { x: 0, y: -1, z: 0 } } as any);
    });

    afterEach(() => 
    {
        vi.useRealTimers();
        vi.resetAllMocks();
    });

    const simulateSmelting = async (ticks: number, finish: boolean) => 
    {
        for (let i = 0; i < ticks; i++) 
        {
            furnace.emit('update');
            await vi.advanceTimersByTimeAsync(50);
        }
        if (finish) 
        {
            furnace.inputItem.mockReturnValue(null); 
            furnace.emit('update');
            await vi.advanceTimersByTimeAsync(50);
        }
    };

    describe("Basic Smelting", () => 
    {
        it("smelts using an existing nearby furnace", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.blockAt.mockReturnValue(furnaceBlock);
            
            bot.inventory.items.mockReturnValue([
                { name: "coal", count: 1, type: 1 },
                { name: "raw_iron", count: 1, type: 2 }
            ]);
    
            furnace.inputItem.mockReturnValue({ count: 1 });
            furnace.outputItem.mockReturnValue(null);
    
            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
            
            furnace.outputItem.mockReturnValue({ name: "iron_ingot", count: 1 });
            await simulateSmelting(1, true);
    
            await promise;
    
            expect(bot.openFurnace).toHaveBeenCalledWith(furnaceBlock);
            expect(furnace.putFuel).toHaveBeenCalled();
            expect(furnace.putInput).toHaveBeenCalled();
            expect(furnace.takeOutput).toHaveBeenCalled();
            expect(furnace.close).toHaveBeenCalled();
        });

        it("throws error if item name is missing", async () => 
        {
            await expect(handleSmelt(bot, { params: {} }))
                .rejects.toThrow("Smelt requires item name");
        });

        it("throws error if fuel is missing", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.inventory.items.mockReturnValue([
                { name: "raw_iron", count: 1 }
            ]);

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("No fuel found");
        });

        it("throws error if input item is missing", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.inventory.items.mockReturnValue([
                { name: "coal", count: 1 }
            ]);

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("No input found");
        });
    });

    describe("Error Handling in Smelting Loop", () => 
    {
        it("handles inventory full when taking output", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.inventory.items.mockReturnValue([
                { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
            ]);

            furnace.inputItem.mockReturnValue({ count: 1 });
            furnace.outputItem.mockReturnValue({ count: 1, name: "iron_ingot" });
            
            furnace.takeOutput.mockRejectedValue(new Error("Inventory Full"));

            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
            
            await simulateSmelting(1, true);
            await promise;

            expect(furnace.takeOutput).toHaveBeenCalled();
            expect(furnace.close).toHaveBeenCalled();
        });

        it("throws if fuel runs out mid-smelt", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.inventory.items.mockReturnValue([
                { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
            ]);

            furnace.inputItem.mockReturnValue({ count: 1 });
            
            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });

            furnace.fuelItem.mockReturnValue(null);
            furnace.fuel = 0;
            furnace.progress = 0;
            furnace.emit('update');

            await expect(promise).rejects.toThrow("Ran out of fuel");
            expect(furnace.close).toHaveBeenCalled();
        });

        it("handles window closing unexpectedly", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.inventory.items.mockReturnValue([
                { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
            ]);
            furnace.inputItem.mockReturnValue({ count: 1 });

            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
            
            await vi.advanceTimersByTimeAsync(100); 
            furnace.emit('close'); 
            
            await promise; 
        });
        
        it("handles failure to put items in furnace", async () => 
        {
            const furnaceBlock = { name: "furnace", position: new Vec3(10, 64, 10) };
            bot.findBlock.mockReturnValue(furnaceBlock);
            bot.inventory.items.mockReturnValue([
                { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
            ]);
            
            furnace.putFuel.mockRejectedValue(new Error("Server lag"));

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("Failed to put items");
                
            expect(furnace.close).toHaveBeenCalled();
        });
    });

    describe("Crafting and Placing Logic", () => 
    {
        it("places a furnace from inventory if none found nearby", async () => 
        {
            bot.findBlock.mockReturnValue(null); 
            bot.inventory.items.mockReturnValue([
                { name: "furnace", count: 1 },
                { name: "coal", count: 1 },
                { name: "raw_iron", count: 1 }
            ]);
            
            const placedBlock = { name: "furnace", position: new Vec3(1, 0, 0) };
            bot.blockAt.mockReturnValue(placedBlock);
            furnace.inputItem.mockReturnValue({ count: 1 });

            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
            await simulateSmelting(1, true);
            await promise;

            expect(bot.placeBlock).toHaveBeenCalled();
            expect(bot.openFurnace).toHaveBeenCalled();
        });

        it("crafts a furnace then places it if none in inventory", async () => 
        {
            bot.findBlock.mockReturnValueOnce(null);
            bot.findBlock.mockReturnValueOnce({ name: "crafting_table" });

            bot.inventory.items
                .mockReturnValueOnce([
                    { name: "cobblestone", count: 8 },
                    { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
                ])
                .mockReturnValue([
                    { name: "furnace", count: 1 },
                    { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
                ]);

            const mockRecipesFor = (CraftingSystem as any).prototype.recipesFor;
            mockRecipesFor.mockReturnValue([{ id: 1 }]);
            (CraftingSystem as any).prototype.craft.mockResolvedValue(undefined);

            bot.blockAt.mockReturnValue({ name: "furnace" });
            furnace.inputItem.mockReturnValue({ count: 1 });

            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
            await simulateSmelting(1, true);
            await promise;

            expect((CraftingSystem as any).prototype.craft).toHaveBeenCalled();
            expect(bot.placeBlock).toHaveBeenCalled();
        });

        it("mines cobblestone, crafts, then places if materials missing", async () => 
        {
            bot.findBlock.mockReturnValueOnce(null);
            bot.findBlock.mockReturnValueOnce({ name: "crafting_table" });
            bot.findBlock.mockReturnValueOnce({ name: "crafting_table" });

            bot.inventory.items.mockImplementation(() => 
            {
                if (vi.mocked(handleMine).mock.calls.length === 0) 
                {
                    return [{ name: "cobblestone", count: 0 }, { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }];
                }
                return [{ name: "furnace", count: 1 }, { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }];
            });

            const mockRecipesFor = (CraftingSystem as any).prototype.recipesFor;
            mockRecipesFor.mockReturnValueOnce([])
                          .mockReturnValueOnce([{ id: 1 }]);

            bot.blockAt.mockReturnValue({ name: "furnace" });
            furnace.inputItem.mockReturnValue({ count: 1 });

            const promise = handleSmelt(bot, { params: { item: "raw_iron" } });
            await simulateSmelting(1, true);
            await promise;

            expect(handleMine).toHaveBeenCalledWith(bot, expect.objectContaining({ 
                params: expect.objectContaining({ block: "cobblestone", count: 8, maxDistance: 32 }) 
            }));
            expect((CraftingSystem as any).prototype.craft).toHaveBeenCalled();
            expect(bot.placeBlock).toHaveBeenCalled();
        });

        it("throws if crafting fails and already have enough cobblestone", async () => 
        {
            bot.findBlock.mockReturnValueOnce(null);
            bot.findBlock.mockReturnValueOnce({ name: "crafting_table" });

            bot.inventory.items.mockReturnValue([
                { name: "cobblestone", count: 10 },
                { name: "coal", count: 1 }, { name: "raw_iron", count: 1 }
            ]);

            (CraftingSystem as any).prototype.recipesFor.mockReturnValue([]); 
            
            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("No furnace recipe available.");
                
            expect(handleMine).not.toHaveBeenCalled();
        });

        it("throws if mining succeeds but still cannot find table/craft", async () => 
        {
            bot.findBlock.mockReturnValue(null);
            
            bot.inventory.items.mockReturnValue([
                { name: "cobblestone", count: 0 }
            ]);

            (CraftingSystem as any).prototype.recipesFor.mockReturnValueOnce([]);
            
            bot.findBlock.mockReturnValue(null); 

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("Cannot craft furnace after mining: No crafting table found.");
        });

        it("throws if furnace cannot be obtained", async () => 
        {
            bot.findBlock.mockReturnValueOnce(null);
            bot.findBlock.mockReturnValueOnce({ name: "crafting_table" });

            (CraftingSystem as any).prototype.recipesFor.mockReturnValue([{id:1}]);
            
            bot.inventory.items
                .mockReturnValueOnce([{ name: "cobblestone", count: 64 }])
                .mockReturnValueOnce([{ name: "cobblestone", count: 64 }]);

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("Failed to obtain furnace.");
        });

        it("throws if no suitable place for furnace", async () => 
        {
            bot.findBlock.mockReturnValue(null);
            bot.inventory.items.mockReturnValue([{ name: "furnace", count: 1 }]);
            
            vi.mocked(findReferenceBlock).mockReturnValue(null);

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("No suitable block");
        });

        it("throws if placement succeeds but block lookup fails", async () => 
        {
            bot.findBlock.mockReturnValue(null);
            bot.inventory.items.mockReturnValue([{ name: "furnace", count: 1 }]);
            bot.blockAt.mockReturnValue(null);

            await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                .rejects.toThrow("No furnace found nearby and failed to place one.");
        });
        
        it("throws if crafting table not found during initial craft attempt", async () => 
        {
             bot.findBlock.mockReturnValue(null);
             
             bot.inventory.items.mockReturnValue([]);
             
             await expect(handleSmelt(bot, { params: { item: "raw_iron" } }))
                 .rejects.toThrow("Cannot craft furnace after mining: No crafting table found.");
        });
    });
});