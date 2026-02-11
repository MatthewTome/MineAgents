import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";

const ITEM_ALIASES: Record<string, string> = {
    log: "oak_log",
    logs: "oak_log",
    wood: "oak_log",
    wood_log: "oak_log",
    wood_logs: "oak_log",
    wooden_log: "oak_log",
    wooden_logs: "oak_log",
    plank: "oak_planks",
    planks: "oak_planks",
    wood_plank: "oak_plank",
    wood_planks: "oak_plank",
    wooden_plank: "oak_plank",
    wooden_planks: "oak_plank",
    stick: "stick",
    sticks: "stick",
    coal: "coal",
    coal_ore: "coal_ore",
    "coal ore": "coal_ore",
    iron: "raw_iron",
    iron_ore: "iron_ore",
    "iron ore": "iron_ore",
    raw_iron: "raw_iron",
    "raw iron": "raw_iron",
    iron_ingot: "iron_ingot",
    "iron ingot": "iron_ingot",
    cobblestone: "cobblestone",
    stone: "stone",
    crafting_table: "crafting_table",
    "crafting table": "crafting_table",
    furnace: "furnace"
};

const REPLACEABLE_BLOCKS = [
    "air",
    "cave_air",
    "void_air",
    "oak_leaves",
    "oak_sapling",
    "short_grass",
    "tall_grass",
    "fern",
    "dead_bush",
    "grass",
    "snow",
    "water"
];

export function normalizeItemName(name: string): string
{
    return name.toLowerCase().trim().replace(/\s+/g, "_");
}

export function resolveItemName(bot: Bot, name: string): string
{
    let normalized = normalizeItemName(name);
    const alias = ITEM_ALIASES[normalized];
    if (alias) normalized = alias;

    if (bot.registry.itemsByName[normalized]) return normalized;
    if (bot.registry.blocksByName[normalized]) return normalized;

    if (normalized.endsWith("s")) {
        const singular = normalized.slice(0, -1);
        if (bot.registry.itemsByName[singular]) return singular;
    }

    if (!normalized.endsWith("s")) {
        const plural = normalized + "s";
        if (bot.registry.itemsByName[plural]) return plural;
    }

    return normalized;
}

export function isItemMatch(itemName: string, requestedItem: string): boolean
{
    const item = normalizeItemName(itemName);
    const requested = normalizeItemName(requestedItem);
    
    if (item === requested) return true;
    
    if (item + "s" === requested) return true;
    if (requested + "s" === item) return true;

    return false;
}

export function requireInventoryItem(bot: Bot, name: string): Item
{
    const target = resolveItemName(bot, name);
    const item = bot.inventory.items().find(i => isItemMatch(i.name, target));
    if (!item) throw new Error(`Missing item: ${target} (resolved from ${name})`);
    return item;
}

export async function ensureToolFor(bot: Bot, block: Block): Promise<void>
{
    const toolPlugin = (bot as any).tool;
    if (toolPlugin?.equipForBlock)
    {
        await toolPlugin.equipForBlock(block);
        return;
    }
    throw new Error("Tool plugin unavailable for equipping tools");
}

export function resolveWoodType(): string
{
    return "oak";
}

export function getReplaceableBlocks(): string[]
{
    return [...REPLACEABLE_BLOCKS];
}