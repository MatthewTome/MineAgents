import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { resolveItemName, isItemMatch } from "../../utils.js";

const TILE_ENTITY_BLOCKS = [
    "chest", "trapped_chest", "ender_chest", "barrel",
    "furnace", "blast_furnace", "smoker",
    "crafting_table", "fletching_table", "cartography_table", "loom",
    "anvil", "chipped_anvil", "damaged_anvil",
    "enchanting_table", "brewing_stand", "cauldron",
    "hopper", "dropper", "dispenser",
    "bed", "respawn_anchor",
    "beacon", "conduit",
    "sign", "wall_sign", "hanging_sign",
    "banner", "wall_banner",
    "campfire", "soul_campfire",
    "lectern", "bell", "grindstone", "stonecutter",
    "jukebox", "note_block",
    "beehive", "bee_nest",
    "decorated_pot", "suspicious_sand", "suspicious_gravel"
];

export function countInventoryItems(bot: Bot, name: string): number {
    const target = resolveItemName(bot, name);
    const allItems = bot.inventory.items();

    let total = 0;
    for (const item of allItems) {
        if (isItemMatch(item.name, target)) {
            total += item.count;
        }
    }

    console.log(`[building] Inventory check for '${target}': found ${total} items.`);
    return total;
}

export function isTileEntityBlock(blockName: string): boolean {
    const lower = blockName.toLowerCase();
    return TILE_ENTITY_BLOCKS.some(te => lower.includes(te));
}

export function findReferenceBlock(bot: Bot, target: Vec3): Block | null {
    const neighbors = [
        target.offset(0, -1, 0),
        target.offset(0, 1, 0),
        target.offset(1, 0, 0),
        target.offset(-1, 0, 0),
        target.offset(0, 0, 1),
        target.offset(0, 0, -1)
    ];
    for (const p of neighbors) {
        const block = bot.blockAt(p);
        if (block && block.boundingBox !== "empty" && !block.name.includes("water") && !block.name.includes("lava")) {
            return block;
        }
    }
    return null;
}