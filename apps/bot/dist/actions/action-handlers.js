import { Vec3 } from "vec3";
import { recordChestContents, listChestMemory } from "../perception/chest-memory.js";
import { moveToward, resolveTargetPosition, findNearestEntity, waitForNextTick, raceWithTimeout } from "./movement.js";
import { executeBuild } from "./building/building.js";
import { requireInventoryItem, ensureToolFor, expandMaterialAliases, resolveItemName, resolveWoodType } from "./utils.js";
export function createDefaultActionHandlers() {
    return {
        move: handleMove,
        mine: handleMine,
        gather: handleGather,
        craft: handleCraft,
        smelt: handleSmelt,
        build: handleBuild,
        loot: handleLoot,
        eat: handleEat,
        smith: handleSmith,
        hunt: handleHunt,
        fish: handleFish,
        fight: handleFight,
        perceive: handlePerceive,
        analyzeInventory: handlePerceive
    };
}
async function handleMove(bot, step) {
    const params = (step.params ?? {});
    const targetPos = resolveTargetPosition(bot, params || {});
    await moveToward(bot, targetPos, params?.range ?? 1.5, params?.timeoutMs ?? 15000);
}
async function handleBuild(bot, step) {
    const params = (step.params ?? {});
    const timeout = 180000;
    await raceWithTimeout(executeBuild(bot, params), timeout);
}
async function handlePerceive(bot, step) {
    const params = (step.params ?? {});
    console.log(`[bot] Perceiving: ${params?.check ?? "surroundings/inventory"}`);
    await waitForNextTick(bot);
}
async function handleSmelt(bot, step) {
    const params = (step.params ?? {});
    if (!params.item)
        throw new Error("Smelt requires item name");
    const rawItem = resolveItemName(params.item);
    const fuelItem = resolveItemName(params.fuel ?? "coal");
    let furnaceBlock = params.furnace
        ? bot.blockAt(new Vec3(params.furnace.x, params.furnace.y, params.furnace.z))
        : bot.findBlock({ matching: b => b.name === "furnace", maxDistance: 32 });
    if (!furnaceBlock) {
        console.log("[smelt] No furnace found. Crafting/Placing one...");
        await handleGather(bot, { params: { item: "cobblestone" } });
        await handleCraft(bot, { params: { recipe: "furnace" } });
        const pos = bot.entity.position.offset(1, 0, 0).floored();
        const ref = findReferenceBlock(bot, pos);
        if (ref) {
            const fItem = bot.inventory.items().find(i => i.name === "furnace");
            if (fItem) {
                await bot.equip(fItem, "hand");
                await bot.placeBlock(ref, new Vec3(0, 1, 0));
                await waitForNextTick(bot);
                furnaceBlock = bot.blockAt(pos);
            }
        }
    }
    if (!furnaceBlock)
        throw new Error("Failed to secure a furnace.");
    await moveToward(bot, furnaceBlock.position, 3, 15000);
    const furnace = await bot.openFurnace(furnaceBlock);
    const fuel = bot.inventory.items().find(i => i.name.includes(fuelItem) || i.name.includes("wood") || i.name.includes("plank") || i.name.includes("coal"));
    if (!fuel)
        throw new Error(`No fuel found for smelting (looked for ${fuelItem} or wood)`);
    await furnace.putFuel(fuel.type, null, fuel.count);
    const input = bot.inventory.items().find(i => i.name.includes(rawItem));
    if (!input)
        throw new Error(`No input item ${rawItem} found to smelt`);
    await furnace.putInput(input.type, null, input.count);
    console.log("[smelt] Cooking... waiting 10s");
    await new Promise(r => setTimeout(r, 10000));
    try {
        await furnace.takeOutput();
    }
    catch (e) { }
    furnace.close();
}
async function handleLoot(bot, step) {
    const params = (step.params ?? {});
    const maxDistance = params.maxDistance ?? 16;
    const targetItem = params.item?.toLowerCase();
    const targetCount = params.count ?? 0;
    const chestId = bot.registry?.blocksByName?.chest?.id;
    if (typeof chestId !== "number") {
        throw new Error("Chest block not registered for this version.");
    }
    const chestBlock = params.position
        ? bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z))
        : bot.findBlock({ matching: chestId, maxDistance });
    if (!chestBlock) {
        throw new Error("No chest found nearby.");
    }
    await moveToward(bot, chestBlock.position, 2.5, 15000);
    const chest = await bot.openContainer(chestBlock);
    const items = chest.containerItems().map((item) => ({ name: item.name, count: item.count ?? 0 }));
    recordChestContents(chestBlock.position, items);
    if (targetItem) {
        let remaining = targetCount;
        const matching = chest.containerItems().filter((item) => item.name.toLowerCase().includes(targetItem));
        for (const item of matching) {
            const available = item.count ?? 0;
            const toWithdraw = remaining > 0 ? Math.min(available, remaining) : available;
            if (toWithdraw <= 0) {
                continue;
            }
            try {
                await chest.withdraw(item.type, null, toWithdraw);
                if (remaining > 0) {
                    remaining -= toWithdraw;
                    if (remaining <= 0) {
                        break;
                    }
                }
            }
            catch (err) {
                console.warn(`[loot] Failed to withdraw ${item.name}: ${err}`);
            }
        }
    }
    chest.close();
}
async function handleEat(bot, step) {
    const params = (step.params ?? {});
    const preferred = params.item?.toLowerCase();
    const inventory = bot.inventory.items();
    const foodCandidates = inventory.filter((item) => {
        const name = item.name.toLowerCase();
        return name.includes("bread")
            || name.includes("cooked")
            || name.includes("apple")
            || name.includes("stew")
            || name.includes("porkchop")
            || name.includes("beef")
            || name.includes("mutton")
            || name.includes("chicken")
            || name.includes("carrot")
            || name.includes("potato")
            || name.includes("fish");
    });
    const food = preferred
        ? foodCandidates.find((item) => item.name.toLowerCase().includes(preferred))
        : foodCandidates[0];
    if (!food) {
        throw new Error("No food available to eat.");
    }
    await bot.equip(food, "hand");
    await bot.consume();
}
async function handleSmith(bot, step) {
    const params = (step.params ?? {});
    if (!params.item1) {
        throw new Error("Smith requires item1");
    }
    const anvilBlocks = ["anvil", "chipped_anvil", "damaged_anvil"];
    const matchingIds = anvilBlocks
        .map((name) => bot.registry?.blocksByName?.[name]?.id)
        .filter((id) => typeof id === "number");
    const anvilBlock = bot.findBlock({ matching: matchingIds, maxDistance: 16 });
    if (!anvilBlock) {
        throw new Error("No anvil found nearby.");
    }
    const item1 = requireInventoryItem(bot, params.item1);
    const item2 = params.item2 ? requireInventoryItem(bot, params.item2) : null;
    await moveToward(bot, anvilBlock.position, 2.5, 15000);
    const anvil = await bot.openAnvil(anvilBlock);
    if (item2) {
        await anvil.combine(item1, item2, params.name);
    }
    else {
        await anvil.rename(item1, params.name ?? item1.name);
    }
    anvil.close();
}
async function handleCraft(bot, step) {
    const params = (step.params ?? {});
    let itemName = params.recipe.toLowerCase();
    const count = params.count ?? 1;
    const structureNames = ["platform", "walls", "roof", "door_frame"];
    if (structureNames.includes(itemName)) {
        console.warn(`[craft] Recipe '${itemName}' looks like a structure. Attempting to switch to material '${params.material ?? "oak_planks"}'`);
        itemName = params.material?.toLowerCase() ?? "oak_planks";
    }
    if (itemName.endsWith("door") && !itemName.includes("_")) {
        const availableWood = resolveWoodType(bot);
        itemName = `${availableWood}_door`;
        console.log(`[craft] Resolved generic 'door' to '${itemName}' based on inventory.`);
    }
    const existing = bot.inventory.items().find(i => i.name === itemName);
    if (existing && existing.count >= count) {
        console.log(`[craft] Already have ${existing.count} ${itemName}, skipping craft.`);
        return;
    }
    const itemType = bot.registry.itemsByName[itemName];
    if (!itemType && !itemName.includes("plank"))
        throw new Error(`Unknown item name: ${itemName}`);
    let recipeList = itemType ? bot.recipesFor(itemType.id, null, 1, true) : [];
    let recipe = recipeList[0];
    if (!recipe && itemName.includes("plank")) {
        const logItem = bot.inventory.items().find(i => i.name.endsWith("_log"));
        if (logItem) {
            const plankName = logItem.name.replace("_log", "_planks");
            const pType = bot.registry.itemsByName[plankName];
            if (pType) {
                recipe = bot.recipesFor(pType.id, null, 1, true)[0];
            }
        }
        if (!recipe) {
            const oak = bot.registry.itemsByName['oak_planks'];
            if (oak)
                recipe = bot.recipesFor(oak.id, null, 1, true)[0];
        }
    }
    if (!recipe)
        throw new Error(`No crafting recipe found for ${itemName}.`);
    if (recipe.requiresTable) {
        let tableBlock = params.craftingTable
            ? bot.blockAt(new Vec3(params.craftingTable.x, params.craftingTable.y, params.craftingTable.z))
            : bot.findBlock({ matching: (b) => b.name === "crafting_table", maxDistance: 32 });
        if (!tableBlock) {
            console.log("[craft] Crafting new table...");
            await handleGather(bot, { params: { item: "log" } });
            const log = bot.inventory.items().find(i => i.name.endsWith("_log"));
            if (!log)
                throw new Error("Failed to gather logs for crafting table.");
            const plankItem = bot.registry.itemsByName[log.name.replace("_log", "_planks")];
            if (plankItem) {
                const plankRecipe = bot.recipesFor(plankItem.id, null, 1, null)[0];
                if (plankRecipe)
                    await bot.craft(plankRecipe, 1, undefined);
            }
            const tRecipe = bot.recipesFor(bot.registry.itemsByName['crafting_table'].id, null, 1, null)[0];
            await bot.craft(tRecipe, 1, undefined);
            const pos = bot.entity.position.offset(1, 0, 0).floored();
            const ref = findReferenceBlock(bot, pos);
            if (ref) {
                const tItem = bot.inventory.items().find(i => i.name === 'crafting_table');
                if (tItem) {
                    await bot.equip(tItem, "hand");
                    await bot.placeBlock(ref, new Vec3(0, 1, 0));
                    await waitForNextTick(bot);
                    tableBlock = bot.blockAt(pos);
                }
            }
        }
        if (!tableBlock)
            throw new Error("Could not access crafting table.");
        await moveToward(bot, tableBlock.position, 3, 15000);
        await bot.craft(recipe, count, tableBlock);
    }
    else {
        await bot.craft(recipe, count, undefined);
    }
}
async function handleGather(bot, step) {
    const params = (step.params ?? {});
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(rawTarget ?? "");
    const timeout = params.timeoutMs ?? 60000;
    const maxDistance = params.maxDistance ?? 16;
    if (!targetItem)
        throw new Error("Gather requires item name");
    const existing = bot.inventory.items().find(i => i.name.toLowerCase().includes(targetItem));
    if (existing) {
        console.log(`[gather] Already have ${targetItem} (${existing.count}), skipping gather.`);
        return;
    }
    const chests = listChestMemory().filter(c => c.status === "known" && c.items && c.items.some(i => i.name.includes(targetItem)));
    if (chests.length > 0) {
        console.log(`[gather] Found ${targetItem} in known chest at ${chests[0].position.x},${chests[0].position.y},${chests[0].position.z}`);
        await handleLoot(bot, { params: { position: chests[0].position, item: targetItem } });
        const nowHas = bot.inventory.items().find(i => i.name.toLowerCase().includes(targetItem));
        if (nowHas) {
            console.log(`[gather] Retrieved ${targetItem} from chest.`);
            return;
        }
    }
    try {
        await handleLoot(bot, { params: { maxDistance, item: targetItem } });
        const looted = bot.inventory.items().find(i => i.name.toLowerCase().includes(targetItem));
        if (looted) {
            console.log(`[gather] Looted ${targetItem} from a nearby chest.`);
            return;
        }
    }
    catch { }
    console.log(`[gather] Starting cycle for: ${targetItem}`);
    const start = Date.now();
    const failedBlocks = new Set();
    let consecutiveFailures = 0;
    while (Date.now() - start < timeout) {
        if (consecutiveFailures >= 3) {
            console.log("[gather] Relocating to new area...");
            const escape = bot.entity.position.offset((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
            await moveToward(bot, escape, 2, 8000).catch(() => { });
            consecutiveFailures = 0;
            continue;
        }
        const dropped = findNearestEntity(bot, (e) => {
            if (e.name !== "item")
                return false;
            const d = e.getDroppedItem?.();
            return d?.name?.toLowerCase().includes(targetItem) || false;
        }, 32);
        if (dropped) {
            console.log(`[gather] Found dropped ${targetItem}.`);
            await moveToward(bot, dropped.position, 1.0, 15000);
            return;
        }
        const blockName = resolveItemToBlock(targetItem);
        if (blockName) {
            const aliases = expandMaterialAliases(blockName);
            const block = bot.findBlock({
                matching: (b) => {
                    if (!b || !b.position)
                        return false;
                    if (!aliases.includes(b.name) && !b.name.includes(blockName))
                        return false;
                    if (failedBlocks.has(b.position.toString()))
                        return false;
                    return true;
                },
                maxDistance: 32
            });
            if (block && block.position) {
                console.log(`[gather] Mining ${block.name} at ${block.position}...`);
                await ensureToolFor(bot, block);
                if (!bot.canDigBlock(block)) {
                    console.log(`[gather] Cannot dig ${block.name}. Blacklisting.`);
                    failedBlocks.add(block.position.toString());
                    consecutiveFailures++;
                    continue;
                }
                try {
                    await collectBlocks(bot, [block]);
                    consecutiveFailures = 0;
                    await waitForNextTick(bot);
                    continue;
                }
                catch (err) {
                    console.warn(`[gather] Mine failed: ${err.message}`);
                    if (block.position)
                        failedBlocks.add(block.position.toString());
                    consecutiveFailures++;
                    continue;
                }
            }
        }
        const raw = resolveProductToRaw(targetItem);
        if (raw) {
            console.log(`[gather] Producing ${targetItem} from ${raw}...`);
            await handleGather(bot, { params: { item: raw, timeoutMs: timeout / 2 } });
            await handleCraft(bot, { params: { recipe: targetItem } });
            return;
        }
        console.log(`[gather] Searching...`);
        const explore = bot.entity.position.offset((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20);
        await moveToward(bot, explore, 2, 5000).catch(() => { });
        consecutiveFailures++;
        await waitForNextTick(bot);
    }
    throw new Error(`Gather ${targetItem} failed.`);
}
async function handleMine(bot, step) {
    const params = (step.params ?? {});
    const block = findBlockTarget(bot, params || {}, 32);
    if (!block)
        throw new Error(`No matching block found`);
    await ensureToolFor(bot, block);
    await collectBlocks(bot, [block]);
}
async function handleHunt(bot, step) {
    const params = (step.params ?? {});
    const target = findNearestEntity(bot, e => e.type === "mob" && (e.name ?? "").includes(params.target ?? ""), 64);
    if (!target)
        throw new Error("Target not found");
    await engageTarget(bot, target, params.range ?? 2, params.timeoutMs ?? 20000);
}
async function handleFight(bot, step) {
    const params = (step.params ?? {});
    const target = findNearestEntity(bot, e => (e.type === "mob" || e.type === "player") && (e.name ?? "").includes(params.target ?? ""), 64);
    if (!target)
        throw new Error("Target not found");
    await engageTarget(bot, target, 2.5, params.timeoutMs ?? 20000);
}
async function handleFish(bot, step) {
    const params = (step.params ?? {});
    const rod = requireInventoryItem(bot, "fishing_rod");
    await bot.equip(rod, "hand");
    for (let i = 0; i < (params.casts ?? 1); i++)
        await bot.fish();
}
async function engageTarget(bot, entity, range, timeoutMs) {
    const start = Date.now();
    while (bot.entity.position.distanceTo(entity.position) > range) {
        if (Date.now() - start > timeoutMs)
            throw new Error("Timeout");
        await moveToward(bot, entity.position, range, timeoutMs - (Date.now() - start));
    }
    await bot.lookAt(entity.position, true);
    bot.attack(entity);
}
function findBlockTarget(bot, params, maxDistance) {
    if (params.position)
        return bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z));
    const name = params.block?.toLowerCase();
    if (!name)
        return null;
    const aliases = expandMaterialAliases(name);
    return bot.findBlock({ matching: (b) => aliases.includes(b.name) || b.name.includes(name), maxDistance });
}
function findReferenceBlock(bot, target) {
    const neighbors = [target.offset(0, -1, 0), target.offset(0, 1, 0), target.offset(1, 0, 0), target.offset(-1, 0, 0), target.offset(0, 0, 1), target.offset(0, 0, -1)];
    for (const p of neighbors) {
        const b = bot.blockAt(p);
        if (b && b.boundingBox !== "empty" && !b.name.includes("water") && !b.name.includes("lava"))
            return b;
    }
    return null;
}
async function collectBlocks(bot, blocks) {
    const collection = bot.collectBlock;
    if (!bot.collectBlock?.collect) {
        throw new Error("Collect block plugin unavailable");
    }
    await raceWithTimeout(collection.collect(blocks, { ignoreNoPath: true }), 15000);
    return true;
}
function resolveItemToBlock(item) {
    if (item.includes("cobblestone"))
        return "stone";
    if (item.includes("dirt"))
        return "dirt";
    if (item.includes("log") || item.includes("wood"))
        return "oak_log";
    if (item.includes("iron"))
        return "iron_ore";
    return null;
}
function resolveProductToRaw(product) {
    if (product.includes("planks"))
        return "log";
    if (product.includes("stick"))
        return "planks";
    if (product.includes("pickaxe"))
        return "stick";
    return null;
}
