import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { moveToward, waitForNextTick } from "./movement.js";
import { resolveWoodType, isItemMatch } from "../action-utils.js";
import { buildLockKey, withResourceLock } from "./teamwork.js";
import { findReferenceBlock } from "./building.js";
import type { CraftParams } from "../action-types.js";
import type { ResourceLockManager } from "../../teamwork/coordination.js";
import {
    buildRecipeFromDefinition,
    hasIngredientsForRecipe,
    getMissingIngredients,
    resolveRecipeForItem,
    type BuiltRecipe
} from "./recipe-definitions.js";

export async function handleCraft(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as CraftParams;
    await craftFromInventory(bot, params, resourceLocks);
}

function countItems(bot: Bot, name: string): number
{
    const items = bot.inventory.items().filter(i => isItemMatch(i.name, name));
    return items.reduce((acc, i) => acc + i.count, 0);
}

export async function craftFromInventory(bot: Bot, params: CraftParams, resourceLocks?: ResourceLockManager): Promise<void>
{
    let itemName = params.recipe.toLowerCase();

    if (itemName.startsWith("craft_"))
    {
        itemName = itemName.substring(6);
    }

    let count = params.count ?? 1;
    const trimmedRecipe = itemName.trim();
    const leadingCountMatch = trimmedRecipe.match(/^(?:x)?(\d+)\s+(.+)$/);
    const trailingCountMatch = trimmedRecipe.match(/^(.+)\s+x(\d+)$/);

    if (params.count === undefined)
    {
        if (leadingCountMatch)
        {
            count = Number.parseInt(leadingCountMatch[1], 10);
            itemName = leadingCountMatch[2];
        }
        else if (trailingCountMatch)
        {
            count = Number.parseInt(trailingCountMatch[2], 10);
            itemName = trailingCountMatch[1];
        }
    }

    itemName = itemName.trim().toLowerCase().replace(/\s+/g, "_");
    if (itemName.endsWith("_plank"))
    {
        itemName = `${itemName}s`;
    }

    if (itemName.endsWith("sticks"))
    {
        itemName = itemName.replace(/sticks$/, "stick");
    }

    if (itemName.endsWith("plank"))
    {
        itemName = `${itemName}s`;
    }

    const structureNames = ["platform", "walls", "roof", "door_frame"];
    if (structureNames.includes(itemName))
    {
        console.warn(`[craft] Recipe '${itemName}' looks like a structure. Attempting to switch to material '${params.material ?? "oak_planks"}'`);
        itemName = params.material?.toLowerCase() ?? "oak_planks";
    }

    if (itemName.endsWith("door") && !itemName.includes("_"))
    {
        const availableWood = resolveWoodType();
        itemName = `${availableWood}_door`;
        console.log(`[craft] Resolved generic 'door' to '${itemName}' based on inventory.`);
    }

    const existing = bot.inventory.items().find((item) => item.name === itemName);
    if (existing && existing.count >= count)
    {
        console.log(`[craft] Already have ${existing.count} ${itemName}, skipping craft.`);
        return;
    }

    let itemType = bot.registry.itemsByName[itemName];
    if (!itemType && itemName.includes("plank"))
    {
        const logItem = bot.inventory.items().find((item) => item.name.endsWith("_log"));
        const fallbackPlank = logItem ? logItem.name.replace("_log", "_planks") : "oak_planks";
        itemType = bot.registry.itemsByName[fallbackPlank];
        if (itemType)
        {
            itemName = itemType.name ?? fallbackPlank;
        }
    }

    if (!itemType)
    {
        throw new Error(`Unknown item name: ${itemName}`);
    }

    console.log(`[craft] Looking up recipe for ${itemName} (id: ${itemType.id})`);

    let tableBlock = params.craftingTable
        ? bot.blockAt(new Vec3(params.craftingTable.x, params.craftingTable.y, params.craftingTable.z))
        : bot.findBlock({ matching: (block) => block.name === "crafting_table", maxDistance: 32 });

    const inventoryRecipes = bot.recipesFor(itemType.id, null, 1, null);
    const tableRecipes = tableBlock ? bot.recipesFor(itemType.id, null, 1, tableBlock) : [];

    console.log(`[craft] Inventory recipes found: ${inventoryRecipes.length}, Table recipes found: ${tableRecipes.length}`);

    let recipe = inventoryRecipes[0] ?? tableRecipes[0];
    let fallbackRecipe: BuiltRecipe | null = null;

    if (!recipe)
    {
        const fallbackDef = resolveRecipeForItem(itemName, bot);
        if (fallbackDef)
        {
            console.log(`[craft] Using hardcoded fallback recipe for ${itemName}`);
            fallbackRecipe = buildRecipeFromDefinition(bot, fallbackDef);
            if (!fallbackRecipe)
            {
                throw new Error(`Failed to build fallback recipe for ${itemName}`);
            }

            if (!hasIngredientsForRecipe(bot, fallbackRecipe))
            {
                console.log("[craft] Missing ingredients. Waiting 2s for pickup...");
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (!hasIngredientsForRecipe(bot, fallbackRecipe))
            {
                const missing = getMissingIngredients(bot, fallbackRecipe);
                const missingStr = missing.map(m => `${m.needed - m.have} ${m.name}`).join(", ");
                throw new Error(`Insufficient ingredients for ${itemName}. Missing: ${missingStr}`);
            }
        }
        else
        {
            const allRecipes = bot.recipesAll ? bot.recipesAll(itemType.id, null, null) : [];
            console.warn(`[craft] WARNING: No recipes found for ${itemName} (id: ${itemType.id}), recipesAll returned ${allRecipes.length}`);
            throw new Error(`No crafting recipe found for ${itemName} in Minecraft data.`);
        }
    }

    const craftableRecipe = fallbackRecipe ?? recipe;
    const productCount = craftableRecipe.result.count;
    const craftTimes = Math.ceil(count / productCount);
    
    console.log(`[craft] Recipe produces ${productCount} ${itemName}. Target ${count}. Crafting ${craftTimes} batches.`);

    const startCount = countItems(bot, itemName);

    if (craftableRecipe.requiresTable)
    {
        if (!tableBlock)
        {
            const tableItem = bot.inventory.items().find((item) => item.name === "crafting_table");
            if (tableItem)
            {
                const pos = bot.entity.position.offset(1, 0, 0).floored();
                const ref = findReferenceBlock(bot, pos);
                if (ref)
                {
                    await bot.equip(tableItem, "hand");
                    await bot.placeBlock(ref, new Vec3(0, 1, 0));
                    await waitForNextTick(bot);
                    tableBlock = bot.blockAt(pos);
                }
            }
        }

        if (!tableBlock) throw new Error("Could not access crafting table.");

        const confirmedTable = tableBlock;
        const lockKey = buildLockKey("crafting_table", confirmedTable.position);
        await withResourceLock(resourceLocks, lockKey, async () =>
        {
            await moveToward(bot, confirmedTable.position, 3, 15000);
            await bot.craft(craftableRecipe as any, craftTimes, confirmedTable);
        });
    }
    else
    {
        await bot.craft(craftableRecipe as any, craftTimes, undefined);
    }

    await waitForNextTick(bot);
    let endCount = countItems(bot, itemName);

    if (endCount <= startCount)
    {
        await new Promise(resolve => setTimeout(resolve, 500));
        endCount = countItems(bot, itemName);
        if (endCount <= startCount)
        {
             throw new Error(`Crafting verification failed: attempted to craft ${itemName}, but inventory count did not increase (held: ${startCount} -> ${endCount}).`);
        }
    }

    console.log(`[craft] Successfully crafted ${count} (approx) ${itemName}. Inventory now has ${endCount}.`);
}