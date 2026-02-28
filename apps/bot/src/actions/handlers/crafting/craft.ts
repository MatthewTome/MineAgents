import { Bot } from 'mineflayer';
import { Block } from 'prismarine-block';
import { Item } from 'prismarine-item';
import { Recipe } from 'prismarine-recipe';
import { Window } from 'prismarine-windows';
import { moveWithMovementPlugin } from "../moving/move.js";
import { resolveItemName } from "../../utils.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";

export class CraftingSystem
{
    private bot: Bot;
    private windowCraftingTable: Window | undefined;

    constructor(bot: Bot)
    {
        this.bot = bot;
    }

    public async craft(recipe: Recipe, count: number = 1, craftingTable?: Block): Promise<void>
    {
        if (recipe.requiresTable && !craftingTable)
        {
            throw new Error("Recipe requires craftingTable but none provided");
        }

        console.log(`[Intent] Starting crafting sequence: ${recipe.result.count * count}x (Recipe ID: ${recipe.result.id})`);

        try
        {
            for (let i = 0; i < count; i++)
            {
                await this.craftOnce(recipe, craftingTable);
            }
        }
        catch (err)
        {
            console.error(`[Reflect] Crafting failed: ${(err as Error).message}`);
            throw err;
        }
        finally
        {
            if (this.windowCraftingTable)
            {
                this.bot.closeWindow(this.windowCraftingTable);
                this.windowCraftingTable = undefined;
                console.log("[Act] Closed crafting window.");
            }
        }

        console.log(`[Reflect] Crafting complete.`);
    }

    public recipesFor(itemType: number, metadata: number | null, minResultCount: number | null, craftingTable: Block | boolean | null): Recipe[]
    {
        const results: Recipe[] = [];
        const recipeList = this.bot.recipesAll(itemType, metadata, craftingTable); 

        for (const recipe of recipeList)
        {
            if (recipe.requiresTable && !craftingTable)
            {
                continue;
            }

            if (this.requirementsMetForRecipe(recipe, minResultCount))
            {
                results.push(recipe);
            }
        }

        return results;
    }

    private requirementsMetForRecipe(recipe: Recipe, minResultCount: number | null): boolean
    {
        const craftCount = minResultCount ? Math.ceil(minResultCount / recipe.result.count) : 1;

        if (recipe.delta)
        {
            for (const deltaItem of recipe.delta)
            {
                const currentCount = this.countInventory(deltaItem.id, deltaItem.metadata);
                
                if (currentCount + (deltaItem.count * craftCount) < 0)
                {
                    return false; 
                }
            }
        }
        
        return true; 
    }

    private async craftOnce(recipe: Recipe, tableBlock?: Block): Promise<void>
    {
        let window: Window = this.bot.inventory;

        if (recipe.requiresTable && tableBlock)
        {
            if (!this.windowCraftingTable)
            {
                console.log("[Act] Opening Crafting Table...");
                this.windowCraftingTable = await this.bot.openBlock(tableBlock);
            }
            window = this.windowCraftingTable;
        }

        if (recipe.inShape)
        {
            await this.placeShaped(recipe, window);
        }
        else if (recipe.ingredients)
        {
            await this.placeShapeless(recipe, window);
        }

        await this.collectResult(window);
    }

    private async placeShaped(recipe: Recipe, window: Window): Promise<void>
    {
        const inShape = recipe.inShape;
        if (!inShape) return;

        console.log("[Act] Placing shaped ingredients...");

        for (let y = 0; y < inShape.length; y++)
        {
            for (let x = 0; x < inShape[y].length; x++)
            {
                const ingredient = inShape[y][x];
                
                if (ingredient.id === -1) continue;

                const destSlot = this.getGridSlot(x, y, window.type === 'minecraft:crafting');

                await this.placeItemInSlot(window, ingredient.id, ingredient.metadata ?? null, destSlot);
            }
        }
    }

    private async placeShapeless(recipe: Recipe, window: Window): Promise<void>
    {
        const ingredients = recipe.ingredients;
        if (!ingredients) return;

        console.log("[Act] Placing shapeless ingredients...");

        const availableSlots = window.type === 'minecraft:crafting' 
            ? [1, 2, 3, 4, 5, 6, 7, 8, 9] 
            : [1, 2, 3, 4];

        for (const ingredient of ingredients)
        {
            const destSlot = availableSlots.pop();
            
            if (destSlot === undefined) 
            {
                throw new Error("Not enough crafting slots for shapeless recipe");
            }

            await this.placeItemInSlot(window, ingredient.id, ingredient.metadata ?? null, destSlot);
        }
    }

    private async placeItemInSlot(window: Window, id: number, metadata: number | null, destSlot: number): Promise<void>
    {
        const heldItem = window.selectedItem;

        const holdingCorrect = heldItem && heldItem.type === id && (metadata === null || heldItem.metadata === metadata);

        if (!holdingCorrect)
        {
            if (heldItem)
            {
                await this.putAwayHeldItem(window);
            }

            const itemInInventory = this.findInventoryItem(window, id, metadata);
            
            if (!itemInInventory)
            {
                throw new Error(`Missing ingredient: ID ${id}`);
            }

            await this.bot.clickWindow(itemInInventory.slot, 0, 0);
        }

        await this.bot.clickWindow(destSlot, 1, 0);
    }

    private async collectResult(window: Window): Promise<void>
    {
        await this.putAwayHeldItem(window);

        console.log("[Act] Collecting crafted result...");
        await this.bot.clickWindow(0, 0, 0);

        const emptySlotIndex = window.slots.findIndex((s, index) => {
            if (index < window.inventoryStart) return false;
            return s === null;
        });
        
        if (emptySlotIndex !== -1)
        {
            await this.bot.clickWindow(emptySlotIndex, 0, 0);
        }
        else
        {
            await this.bot.tossStack(this.bot.inventory.selectedItem!);
        }
    }

    private getGridSlot(x: number, y: number, isTable: boolean): number
    {
        if (isTable)
        {
            return 1 + x + (y * 3);
        }
        else
        {
            return 1 + x + (y * 2);
        }
    }
    private findInventoryItem(window: Window, id: number, metadata: number | null): Item | undefined
    {
        for (let i = window.inventoryStart; i < window.inventoryEnd; i++)
        {
            const item = window.slots[i];
            if (item && item.type === id && (metadata === null || item.metadata === metadata))
            {
                return item;
            }
        }
        return undefined;
    }

    private async putAwayHeldItem(window: Window): Promise<void>
    {
        if (!window.selectedItem) return;

        const held = window.selectedItem;

        const destIndex = window.slots.findIndex((s, index) => {
            if (index < window.inventoryStart || index >= window.inventoryEnd) return false;
            
            if (s === null) return true;

            return s.type === held.type && s.count < s.stackSize;
        });

        if (destIndex !== -1)
        {
            await this.bot.clickWindow(destIndex, 0, 0);
        }
        else
        {
            await this.bot.tossStack(window.selectedItem);
        }
    }

    private countInventory(id: number, metadata: number | null): number
    {
        return this.bot.inventory.items().filter(item => 
            item.type === id && (metadata === null || item.metadata === metadata)
        ).reduce((acc, item) => acc + item.count, 0);
    }
}

export async function handleCraft(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = step.params as unknown as { recipe: string; count?: number };
    const parsed = parseCraftRequest(params.recipe, params.count);
    const name = parsed.itemName;
    const count = parsed.count;
    
    if (!name) throw new Error("Crafting requires a recipe name.");
    
    const itemName = resolveItemName(bot, name);
    const itemDef = bot.registry.itemsByName[itemName];
    
    if (!itemDef) throw new Error(`Unknown item: ${name} (resolved: ${itemName})`);
    
    const system = new CraftingSystem(bot);

    const table = bot.findBlock({ matching: (b) => b.name === 'crafting_table', maxDistance: 32 });
    
    const recipes = system.recipesFor(itemDef.id, null, count, table || true);

    if (recipes.length === 0) 
    {
        throw new Error(`No recipes found for ${itemName} (insufficient materials or impossible)`);
    }
    
    const recipe = recipes[0];
    
    if (recipe.requiresTable) 
    {
        if (!table) 
        {
             throw new Error(`Recipe for ${itemName} requires a crafting table, but none was found nearby.`);
        }
        console.log(`[handleCraft] Moving to crafting table at ${table.position}...`);
        await moveWithMovementPlugin(bot, table.position, 2, 10000);
    }
    
    await system.craft(recipe, count, table || undefined);
}

function parseCraftRequest(rawRecipe: string, requestedCount?: number): { itemName: string; count: number }
{
    if (!rawRecipe)
    {
        return { itemName: rawRecipe, count: requestedCount ?? 1 };
    }

    const normalizedRecipe = rawRecipe.trim();

    if (requestedCount !== undefined)
    {
        return { itemName: normalizedRecipe, count: requestedCount };
    }

    const prefixedCountMatch = normalizedRecipe.match(/^(\d+)\s+(.+)$/);
    if (!prefixedCountMatch)
    {
        return { itemName: normalizedRecipe, count: 1 };
    }

    const parsedCount = parseInt(prefixedCountMatch[1], 10);
    const itemName = prefixedCountMatch[2].trim();

    return {
        itemName,
        count: Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1
    };
}