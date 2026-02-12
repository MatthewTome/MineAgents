import { describe, it, expect, vi, beforeEach } from "vitest";
import { CraftingSystem } from "../../../src/actions/handlers/crafting/craft.js";

import { Bot } from 'mineflayer';
import { Recipe } from 'prismarine-recipe';
import { Item } from 'prismarine-item';
import { Window } from 'prismarine-windows';
import { Block } from 'prismarine-block';

const mockClickWindow = vi.fn();
const mockOpenBlock = vi.fn();
const mockCloseWindow = vi.fn();
const mockTossStack = vi.fn();
const mockRecipesAll = vi.fn();

const createMockItem = (type: number, count: number, slot: number): Item => ({
    type,
    count,
    metadata: 0,
    stackSize: 64,
    slot,
    name: 'mock_item',
    displayName: 'Mock Item',
    durabilityUsed: 0,
    nbt: null,
    enchants: [],
    customName: null,
    customLore: null,
    repairCost: 0
} as unknown as Item);

const createMockRecipe = (id: number, count: number, requiresTable: boolean, ingredients?: any[], inShape?: any[], delta?: any[]): Recipe => ({
    result: { id, count },
    requiresTable,
    ingredients,
    inShape,
    delta,
    outShape: undefined,
    shape: inShape
} as unknown as Recipe);

describe('CraftingSystem', () => {
    let bot: Bot;
    let craftingSystem: CraftingSystem;
    let inventoryWindow: Window;

    beforeEach(() => {
        vi.clearAllMocks();

        inventoryWindow = {
            id: 0,
            type: 'minecraft:inventory',
            slots: new Array(45).fill(null),
            inventoryStart: 9,
            inventoryEnd: 45,
            selectedItem: null,
            count: vi.fn(),
            items: vi.fn(),
        } as unknown as Window;

        bot = {
            inventory: inventoryWindow,
            openBlock: mockOpenBlock,
            closeWindow: mockCloseWindow,
            clickWindow: mockClickWindow,
            tossStack: mockTossStack,
            recipesAll: mockRecipesAll,
        } as unknown as Bot;

        bot.inventory.items = () => {
            return inventoryWindow.slots.filter(s => s !== null && s.slot >= inventoryWindow.inventoryStart) as Item[];
        };

        craftingSystem = new CraftingSystem(bot);
    });

    describe('recipesFor', () => {
        it('should return empty list if material requirements are not met', () => {
            const recipe = createMockRecipe(100, 1, false, undefined, undefined, [
                { id: 1, count: -1, metadata: 0 }
            ]);
            mockRecipesAll.mockReturnValue([recipe]);

            const results = craftingSystem.recipesFor(100, null, 1, null);
            expect(results).toHaveLength(0);
        });

        it('should return recipe if ingredients exist in inventory', () => {
            const recipe = createMockRecipe(100, 1, false, undefined, undefined, [
                { id: 1, count: -1, metadata: 0 }
            ]);
            mockRecipesAll.mockReturnValue([recipe]);

            inventoryWindow.slots[10] = createMockItem(1, 10, 10);

            const results = craftingSystem.recipesFor(100, null, 1, null);
            expect(results).toHaveLength(1);
            expect(results[0]).toBe(recipe);
        });

        it('should exclude recipes requiring a table if no table block is provided', () => {
            const recipe = createMockRecipe(100, 1, true);
            mockRecipesAll.mockReturnValue([recipe]);

            const results = craftingSystem.recipesFor(100, null, 1, null);
            expect(results).toHaveLength(0);
        });
        
        it('should include recipes requiring a table if table block IS provided', () => {
            const recipe = createMockRecipe(100, 1, true);
            mockRecipesAll.mockReturnValue([recipe]);

            const mockTableBlock = { name: 'crafting_table' } as Block;
            const results = craftingSystem.recipesFor(100, null, 1, mockTableBlock);
            expect(results).toHaveLength(1);
        });
    });

    describe('craft', () => {
        it('should throw error if recipe requires table but none provided', async () => {
            const recipe = createMockRecipe(100, 1, true);
            await expect(craftingSystem.craft(recipe)).rejects.toThrow("Recipe requires craftingTable");
        });

        it('should craft shapeless recipe successfully in inventory', async () => {
            const logId = 1;
            const plankId = 2;
            const recipe = createMockRecipe(plankId, 4, false, 
                [{ id: logId, metadata: 0 }],
                undefined, 
                [{ id: logId, count: -1, metadata: 0 }]
            );

            inventoryWindow.slots[10] = createMockItem(logId, 1, 10);

            await craftingSystem.craft(recipe);

            expect(mockClickWindow).toHaveBeenCalledWith(10, 0, 0);
            expect(mockClickWindow).toHaveBeenCalledWith(4, 1, 0);
            expect(mockClickWindow).toHaveBeenCalledWith(0, 0, 0);
        });

        it('should craft shaped recipe successfully with table', async () => {
            const tableBlock = { name: 'crafting_table' } as Block;
            
            const tableWindow = {
                type: 'minecraft:crafting',
                slots: new Array(46).fill(null),
                inventoryStart: 10,
                inventoryEnd: 46,
                selectedItem: null,
            } as unknown as Window;
            mockOpenBlock.mockResolvedValue(tableWindow);

            const plankId = 2;
            const stickId = 3;
            const recipe = createMockRecipe(stickId, 4, true, undefined, [
                [{ id: plankId }, { id: -1 }],
                [{ id: plankId }, { id: -1 }]
            ]);

            tableWindow.slots[10] = createMockItem(plankId, 2, 10);

            mockClickWindow.mockImplementation((slot, button, mode) => {
                if (slot === 10 && button === 0) {
                    tableWindow.selectedItem = createMockItem(plankId, 2, -1);
                    tableWindow.slots[10] = null;
                }
                if ((slot === 1 || slot === 4) && button === 1) {
                    if (tableWindow.selectedItem) {
                        tableWindow.selectedItem.count--;
                        if (tableWindow.selectedItem.count <= 0) {
                            tableWindow.selectedItem = null;
                        }
                    }
                }
            });

            await craftingSystem.craft(recipe, 1, tableBlock);

            expect(mockOpenBlock).toHaveBeenCalledWith(tableBlock);
            expect(mockClickWindow).toHaveBeenCalledTimes(5);
            expect(mockCloseWindow).toHaveBeenCalledWith(tableWindow);
        });

        it('should handle missing ingredients during execution (Race Condition)', async () => {
            const recipe = createMockRecipe(100, 1, false, undefined, [[{ id: 1 }]]);
            
            await expect(craftingSystem.craft(recipe)).rejects.toThrow("Missing ingredient: ID 1");
        });

        it('should toss result if inventory is full after crafting', async () => {
            const logId = 1;
            const plankId = 2;
            const recipe = createMockRecipe(plankId, 4, false, undefined, [[{ id: logId }]]);

            inventoryWindow.slots[10] = createMockItem(logId, 1, 10);
            
            for (let i = 9; i < 45; i++) {
                if (i !== 10) inventoryWindow.slots[i] = createMockItem(999, 64, i);
            }

            mockClickWindow.mockImplementation((slot, button, mode) => {
                if (slot === 0) {
                    inventoryWindow.selectedItem = createMockItem(plankId, 4, -1);
                }
            });

            await craftingSystem.craft(recipe);

            expect(mockTossStack).toHaveBeenCalled();
        });

        it('should put away held item before picking up a different ingredient', async () => {
            const woodId = 1;
            const stoneId = 2;
            const recipe = createMockRecipe(100, 1, false, undefined, [[{ id: woodId }]]);

            inventoryWindow.slots[9] = createMockItem(999, 64, 9);
            inventoryWindow.slots[10] = createMockItem(woodId, 1, 10);
            inventoryWindow.slots[11] = null;

            inventoryWindow.selectedItem = createMockItem(stoneId, 1, -1);

            await craftingSystem.craft(recipe);

            expect(mockClickWindow).toHaveBeenNthCalledWith(1, 11, 0, 0);
            expect(mockClickWindow).toHaveBeenNthCalledWith(2, 10, 0, 0);
        });
    });
});