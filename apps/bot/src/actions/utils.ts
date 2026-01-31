import { Bot } from "mineflayer";
import { Block } from "prismarine-block";
import { Item } from "prismarine-item";

export function requireInventoryItem(bot: Bot, name: string): Item 
{
    const aliases = expandMaterialAliases(bot, name);
    const item = bot.inventory.items().find(i => aliases.some(a => i.name.includes(a)));
    if (!item) throw new Error(`Missing item: ${name} (checked aliases: ${aliases.join(', ')})`);
    return item;
}

export function expandMaterialAliases(bot: Bot, name: string): string[]
{
    const lower = name.toLowerCase();
    
    if (lower === "replaceable") {
        return [
            "air", "bubble_column", "bush", "cave_air", "crimson_roots", "dead_bush", "fern", "fire", 
            "glow_lichen", "hanging_roots", "large_fern", "lava", "leaf_litter", "light", "nether_sprouts", 
            "resin_clump", "seagrass", "short_dry_grass", "short_grass", "snow", "soul_fire", 
            "structure_void", "tall_dry_grass", "tall_grass", "tall_seagrass", "vine", "void_air", 
            "warped_roots", "water"
        ];
    }

    if (lower === "log" || lower === "wood" || lower.includes("log")) {
        return Object.keys(bot.registry.itemsByName).filter(n => 
            n.endsWith("_log") || n.endsWith("_stem") || n.endsWith("_hyphae")
        );
    }

    if (lower === "planks" || lower.includes("plank")) {
        return Object.keys(bot.registry.itemsByName).filter(n => 
            n.endsWith("_planks")
        );
    }

    if (lower === "andesite" || lower === "diorite" || lower === "granite") return [lower];

    if (lower.includes("stone")) return [
        "cobblestone", "cobbled_deepslate", "blackstone"
    ];

    if (lower.includes("dirt")) return [
        lower, "dirt", "coarse_dirt", "grass_block",
        "sand", "gravel", "podzol", "moss_block",
        "mud", "muddy_mangrove_roots", "mycelium",
        "pale_moss_block", "rooted_dirt"
    ];
    
    if (lower.includes("iron")) return ["iron_ore", "deepslate_iron_ore", "raw_iron", "iron_ingot"];
    
    if (lower === "crafting_table") return ["crafting_table"];
    if (lower === "furnace") return ["furnace"];

    const fuzzy = fuzzyFindItemName(bot, name);
    if (fuzzy) return [fuzzy];
    
    return [lower];
}

export async function ensureToolFor(bot: Bot, block: Block): Promise<void> 
{
    const toolPlugin = (bot as any).tool;
    if (toolPlugin?.equipForBlock) {
        await toolPlugin.equipForBlock(block);
        return;
    }
    throw new Error("Tool plugin unavailable for equipping tools");
}

const GENERIC_ITEM_CATEGORIES: Record<string, string[]> = {
    "log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log"],
    "wood": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log"],
    "planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
    "stem": ["crimson_stem", "warped_stem"],
    "stone": ["cobblestone", "cobbled_deepslate", "blackstone"],
    "coal": ["coal", "charcoal"],
    "food": ["bread", "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_mutton", "apple", "golden_apple", "carrot", "baked_potato"],
    "wool": ["white_wool", "orange_wool", "magenta_wool", "light_blue_wool", "yellow_wool", "lime_wool", "pink_wool", "gray_wool", "light_gray_wool", "cyan_wool", "purple_wool", "blue_wool", "brown_wool", "green_wool", "red_wool", "black_wool"],
    "dye": ["white_dye", "orange_dye", "magenta_dye", "light_blue_dye", "yellow_dye", "lime_dye", "pink_dye", "gray_dye", "light_gray_dye", "cyan_dye", "purple_dye", "blue_dye", "brown_dye", "green_dye", "red_dye", "black_dye"]
};

export function resolveItemName(bot: Bot, name: string): string
{
    const lower = name.toLowerCase().replace(/\s+/g, '_');
    
    if (isGenericCategory(lower)) return lower;

    const found = fuzzyFindItemName(bot, lower);
    if (found) return found;

    if (lower.endsWith("logs")) return lower.replace(/logs$/, "log");
    
    return lower;
}

export function isItemMatch(itemName: string, requestedItem: string): boolean
{
    const item = itemName.toLowerCase();
    const requested = requestedItem.toLowerCase();

    if (item === requested) return true;

    if (item.includes(requested)) return true;

    const category = GENERIC_ITEM_CATEGORIES[requested];
    if (category && category.some(variant => item === variant || item.includes(variant.replace("_", "")))) {
        return true;
    }

    for (const [categoryName, variants] of Object.entries(GENERIC_ITEM_CATEGORIES)) {
        const requestedIsInCategory = variants.some(v => requested.includes(v) || v.includes(requested));
        const itemIsInCategory = variants.some(v => item === v || item.includes(v.replace("_", "")));
        if (requestedIsInCategory && itemIsInCategory) {
            return true;
        }
    }

    return false;
}

export function getAcceptableVariants(requestedItem: string): string[]
{
    const lower = requestedItem.toLowerCase();

    if (GENERIC_ITEM_CATEGORIES[lower]) {
        return GENERIC_ITEM_CATEGORIES[lower];
    }

    for (const [categoryName, variants] of Object.entries(GENERIC_ITEM_CATEGORIES)) {
        if (variants.includes(lower)) {
            return variants;
        }
        if (variants.some(v => lower.includes(v) || v.includes(lower))) {
            return variants;
        }
    }

    return [lower];
}

export function isGenericCategory(itemName: string): boolean
{
    const lower = itemName.toLowerCase();
    return Object.keys(GENERIC_ITEM_CATEGORIES).includes(lower);
}

export function resolveWoodType(bot: Bot): string 
{
    const items = bot.inventory.items();
    const planks = items.find(i => i.name.endsWith("_planks"));
    if (planks) return planks.name.replace("_planks", "");
    
    const logs = items.find(i => i.name.endsWith("_log"));
    if (logs) return logs.name.replace("_log", "");
    
    return "oak";
}

export function fuzzyFindItemName(bot: Bot, name: string): string | null {
    const registry = bot.registry;
    const itemsByName = registry.itemsByName;
    
    let clean = name.toLowerCase().replace(/\s+/g, '_');

    if (itemsByName[clean]) return clean;

    if (clean.endsWith('s') && !clean.endsWith('ss')) {
        const singular = clean.slice(0, -1);
        if (itemsByName[singular]) return singular;
    }
    
    if (clean.endsWith('es')) {
        const singular = clean.slice(0, -2);
        if (itemsByName[singular]) return singular;
    }

    if (clean.endsWith("leaves")) return clean;
    if (clean === "wood") return "log"; 

    return null;
}