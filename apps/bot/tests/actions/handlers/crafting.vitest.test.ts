import { describe, it, expect, vi } from "vitest";
import { craftFromInventory } from "../../../src/actions/handlers/crafting.js";
import { makeMockBot } from "../../test-helpers.js";

const ESSENTIAL_ITEMS = [
    { name: "oak_planks", id: 1, requiresTable: false },
    { name: "stick", id: 2, requiresTable: false },
    { name: "crafting_table", id: 3, requiresTable: false },
    { name: "wooden_pickaxe", id: 4, requiresTable: true },
    { name: "stone_pickaxe", id: 5, requiresTable: true },
    { name: "iron_pickaxe", id: 6, requiresTable: true },
    { name: "iron_axe", id: 7, requiresTable: true },
    { name: "iron_shovel", id: 8, requiresTable: true },
    { name: "iron_sword", id: 9, requiresTable: true },
    { name: "furnace", id: 10, requiresTable: true },
    { name: "chest", id: 11, requiresTable: true },
];

const INGREDIENT_REGISTRY = {
    oak_log: { id: 100, name: "oak_log" },
    oak_planks: { id: 1, name: "oak_planks" },
    stick: { id: 2, name: "stick" },
    crafting_table: { id: 3, name: "crafting_table" },
    cobblestone: { id: 101, name: "cobblestone" },
    iron_ingot: { id: 102, name: "iron_ingot" },
    wooden_pickaxe: { id: 4, name: "wooden_pickaxe" },
    stone_pickaxe: { id: 5, name: "stone_pickaxe" },
    iron_pickaxe: { id: 6, name: "iron_pickaxe" },
    iron_axe: { id: 7, name: "iron_axe" },
    iron_shovel: { id: 8, name: "iron_shovel" },
    iron_sword: { id: 9, name: "iron_sword" },
    furnace: { id: 10, name: "furnace" },
    chest: { id: 11, name: "chest" },
};

function createMockTable() {
    return {
        name: "crafting_table",
        position: { x: 5, y: 64, z: 5 }
    };
}

describe("actions/handlers/crafting.ts", () => {
    it("skips crafting when inventory already satisfies the request", async () => {
        const bot = makeMockBot({
            items: [{ name: "oak_planks", count: 4, type: 1 }],
            registryItems: INGREDIENT_REGISTRY
        });
        const recipesFor = vi.fn().mockReturnValue([{ id: 1, requiresTable: false }]);
        (bot as any).recipesFor = recipesFor;

        await craftFromInventory(bot as any, { recipe: "oak_planks", count: 2 });

        expect(bot.craft).not.toHaveBeenCalled();
    });

    it("falls back to material when crafting structure aliases", async () => {
        const bot = makeMockBot({
            items: [{ name: "oak_log", count: 2, type: 100 }],
            registryItems: INGREDIENT_REGISTRY
        });
        const recipe = { id: 1, requiresTable: false };
        const recipesFor = vi.fn().mockReturnValue([recipe]);
        (bot as any).recipesFor = recipesFor;

        await craftFromInventory(bot as any, { recipe: "platform", material: "oak_planks", count: 1 });

        expect(recipesFor).toHaveBeenCalledWith(1, null, 1, null);
        expect(bot.craft).toHaveBeenCalledWith(recipe, 1, undefined);
    });

    describe("API recipe lookups for essential items", () => {
        ESSENTIAL_ITEMS.forEach(({ name, id, requiresTable }) => {
            it(`finds recipe for ${name} via API`, async () => {
                const mockTable = createMockTable();
                const bot = makeMockBot({
                    items: [],
                    registryItems: INGREDIENT_REGISTRY
                });

                const recipe = { id, requiresTable, delta: [] };
                const recipesFor = vi.fn().mockImplementation((itemId, metadata, count, table) => {
                    if (requiresTable && table) return [recipe];
                    if (!requiresTable && table === null) return [recipe];
                    return [];
                });
                (bot as any).recipesFor = recipesFor;

                if (requiresTable) {
                    bot.findBlock = vi.fn().mockReturnValue(mockTable);
                }

                await craftFromInventory(bot as any, { recipe: name, count: 1 });

                expect(recipesFor).toHaveBeenCalled();
                expect(bot.craft).toHaveBeenCalled();
            });
        });
    });

    describe("hardcoded fallback recipes when API returns empty", () => {
        it("crafts oak_planks using hardcoded fallback with oak_log ingredient", async () => {
            const bot = makeMockBot({
                items: [{ name: "oak_log", count: 1, type: 100 }],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);

            await craftFromInventory(bot as any, { recipe: "oak_planks", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe).toHaveProperty("result");
            expect(craftedRecipe).toHaveProperty("delta");
            expect(craftedRecipe.result.id).toBe(1);
            expect(craftedRecipe.requiresTable).toBe(false);
        });

        it("crafts stick using hardcoded fallback with planks ingredient", async () => {
            const bot = makeMockBot({
                items: [{ name: "oak_planks", count: 2, type: 1 }],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);

            await craftFromInventory(bot as any, { recipe: "stick", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(2);
            expect(craftedRecipe.requiresTable).toBe(false);
        });

        it("crafts crafting_table using hardcoded fallback with planks ingredient", async () => {
            const bot = makeMockBot({
                items: [{ name: "oak_planks", count: 4, type: 1 }],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);

            await craftFromInventory(bot as any, { recipe: "crafting_table", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(3);
            expect(craftedRecipe.requiresTable).toBe(false);
        });

        it("crafts wooden_pickaxe using hardcoded fallback with table", async () => {
            const mockTable = createMockTable();
            const bot = makeMockBot({
                items: [
                    { name: "oak_planks", count: 3, type: 1 },
                    { name: "stick", count: 2, type: 2 }
                ],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);
            bot.findBlock = vi.fn().mockReturnValue(mockTable);

            await craftFromInventory(bot as any, { recipe: "wooden_pickaxe", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(4);
            expect(craftedRecipe.requiresTable).toBe(true);
        });

        it("crafts stone_pickaxe using hardcoded fallback with cobblestone and sticks", async () => {
            const mockTable = createMockTable();
            const bot = makeMockBot({
                items: [
                    { name: "cobblestone", count: 3, type: 101 },
                    { name: "stick", count: 2, type: 2 }
                ],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);
            bot.findBlock = vi.fn().mockReturnValue(mockTable);

            await craftFromInventory(bot as any, { recipe: "stone_pickaxe", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(5);
            expect(craftedRecipe.requiresTable).toBe(true);
        });

        it("crafts iron_pickaxe using hardcoded fallback with iron_ingot and sticks", async () => {
            const mockTable = createMockTable();
            const bot = makeMockBot({
                items: [
                    { name: "iron_ingot", count: 3, type: 102 },
                    { name: "stick", count: 2, type: 2 }
                ],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);
            bot.findBlock = vi.fn().mockReturnValue(mockTable);

            await craftFromInventory(bot as any, { recipe: "iron_pickaxe", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(6);
            expect(craftedRecipe.requiresTable).toBe(true);
        });

        it("crafts furnace using hardcoded fallback with cobblestone", async () => {
            const mockTable = createMockTable();
            const bot = makeMockBot({
                items: [{ name: "cobblestone", count: 8, type: 101 }],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);
            bot.findBlock = vi.fn().mockReturnValue(mockTable);

            await craftFromInventory(bot as any, { recipe: "furnace", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(10);
            expect(craftedRecipe.requiresTable).toBe(true);
        });

        it("crafts chest using hardcoded fallback with planks", async () => {
            const mockTable = createMockTable();
            const bot = makeMockBot({
                items: [{ name: "oak_planks", count: 8, type: 1 }],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);
            bot.findBlock = vi.fn().mockReturnValue(mockTable);

            await craftFromInventory(bot as any, { recipe: "chest", count: 1 });

            expect(bot.craft).toHaveBeenCalled();
            const craftedRecipe = (bot.craft as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(craftedRecipe.result.id).toBe(11);
            expect(craftedRecipe.requiresTable).toBe(true);
        });
    });

    describe("error handling", () => {
        it("throws error for unknown item with no fallback", async () => {
            const bot = makeMockBot({
                items: [],
                registryItems: { ...INGREDIENT_REGISTRY, unknown_item: { id: 999, name: "unknown_item" } }
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);

            await expect(craftFromInventory(bot as any, { recipe: "unknown_item", count: 1 }))
                .rejects.toThrow("No crafting recipe found for unknown_item");
        });

        it("throws error when crafting table required but not accessible", async () => {
            const bot = makeMockBot({
                items: [
                    { name: "iron_ingot", count: 3, type: 102 },
                    { name: "stick", count: 2, type: 2 }
                ],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);
            bot.findBlock = vi.fn().mockReturnValue(null);

            await expect(craftFromInventory(bot as any, { recipe: "iron_pickaxe", count: 1 }))
                .rejects.toThrow("Could not access crafting table");
        });

        it("throws error when ingredients are missing for fallback recipe", async () => {
            const bot = makeMockBot({
                items: [],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);

            await expect(craftFromInventory(bot as any, { recipe: "oak_planks", count: 1 }))
                .rejects.toThrow("Insufficient ingredients");
        });

        it("throws error with specific missing ingredient info", async () => {
            const bot = makeMockBot({
                items: [{ name: "oak_planks", count: 1, type: 1 }],
                registryItems: INGREDIENT_REGISTRY
            });

            const recipesFor = vi.fn().mockReturnValue([]);
            (bot as any).recipesFor = recipesFor;
            (bot as any).recipesAll = vi.fn().mockReturnValue([]);

            await expect(craftFromInventory(bot as any, { recipe: "stick", count: 1 }))
                .rejects.toThrow(/Missing.*oak_planks/);
        });
    });
});
