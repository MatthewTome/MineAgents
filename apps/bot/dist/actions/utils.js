export function requireInventoryItem(bot, name) {
    const aliases = expandMaterialAliases(name);
    const item = bot.inventory.items().find(i => aliases.some(a => i.name.includes(a)));
    if (!item)
        throw new Error(`Missing item: ${name} (checked aliases: ${aliases.join(', ')})`);
    return item;
}
export function expandMaterialAliases(name) {
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
    if (lower === "wood" || lower === "log" || lower.includes("log")) {
        return [
            "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log",
            "mangrove_log", "cherry_log", "pale_oak_log", "crimson_stem", "warped_stem"
        ];
    }
    if (lower === "planks" || lower.includes("plank")) {
        return [
            "oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks",
            "mangrove_planks", "cherry_planks", "pale_oak_planks", "bamboo_planks", "crimson_planks", "warped_planks"
        ];
    }
    if (lower.includes("stone"))
        return [
            lower, "cobblestone", "mossy_cobblestone", "stone", "smooth_stone", "stone_bricks", "diorite", "andesite",
            "granite", "chiseled_stone_bricks", "cracked_stone_bricks", "mossy_stone_bricks", "stone_bricks"
        ];
    if (lower.includes("dirt"))
        return [
            lower, "dirt", "coarse_dirt", "grass_block",
            "sand", "gravel", "podzol", "moss_block",
            "mud", "muddy_mangrove_roots", "mycelium",
            "pale_moss_block", "rooted_dirt"
        ];
    if (lower.includes("iron"))
        return ["iron_ore", "deepslate_iron_ore", "raw_iron", "iron_ingot"];
    if (lower === "crafting_table")
        return ["crafting_table"];
    if (lower === "furnace")
        return ["furnace"];
    return [lower];
}
export async function ensureToolFor(bot, block) {
    const toolPlugin = bot.tool;
    if (toolPlugin?.equipForBlock) {
        await toolPlugin.equipForBlock(block);
        return;
    }
    throw new Error("Tool plugin unavailable for equipping tools");
}
const GENERIC_ITEM_CATEGORIES = {
    "log": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log"],
    "wood": ["oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", "pale_oak_log"],
    "planks": ["oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks", "pale_oak_planks"],
    "stem": ["crimson_stem", "warped_stem"],
    "stone": ["cobblestone", "stone", "andesite", "diorite", "granite", "deepslate"],
    "coal": ["coal", "charcoal"],
    "food": ["bread", "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_mutton", "apple", "golden_apple", "carrot", "baked_potato"],
    "wool": ["white_wool", "orange_wool", "magenta_wool", "light_blue_wool", "yellow_wool", "lime_wool", "pink_wool", "gray_wool", "light_gray_wool", "cyan_wool", "purple_wool", "blue_wool", "brown_wool", "green_wool", "red_wool", "black_wool"],
    "dye": ["white_dye", "orange_dye", "magenta_dye", "light_blue_dye", "yellow_dye", "lime_dye", "pink_dye", "gray_dye", "light_gray_dye", "cyan_dye", "purple_dye", "blue_dye", "brown_dye", "green_dye", "red_dye", "black_dye"]
};
export function resolveItemName(name) {
    const lower = name.toLowerCase();
    if (lower === "wood")
        return "log";
    if (lower === "stone")
        return "cobblestone";
    if (lower === "planks")
        return "planks";
    if (lower === "log")
        return "log";
    return lower;
}
export function isItemMatch(itemName, requestedItem) {
    const item = itemName.toLowerCase();
    const requested = requestedItem.toLowerCase();
    if (item === requested)
        return true;
    if (item.includes(requested))
        return true;
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
export function getAcceptableVariants(requestedItem) {
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
export function isGenericCategory(itemName) {
    const lower = itemName.toLowerCase();
    return Object.keys(GENERIC_ITEM_CATEGORIES).includes(lower);
}
export function resolveWoodType(bot) {
    const items = bot.inventory.items();
    const planks = items.find(i => i.name.endsWith("_planks"));
    if (planks)
        return planks.name.replace("_planks", "");
    const logs = items.find(i => i.name.endsWith("_log"));
    if (logs)
        return logs.name.replace("_log", "");
    return "oak";
}
