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
export function resolveItemName(name) {
    const lower = name.toLowerCase();
    if (lower === "wood")
        return "oak_log";
    if (lower === "stone")
        return "cobblestone";
    if (lower === "planks")
        return "oak_planks";
    return lower;
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
