import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { MineParams } from "../action-types.js";
import type { Block } from "prismarine-block";
import { expandMaterialAliases } from "../action-utils.js";
import { raceWithTimeout } from "./movement.js";

export async function collectBlocks(bot: Bot, blocks: Block[]): Promise<boolean>
{
    const collection = (bot as any).collectBlock;
    if (!bot.collectBlock?.collect)
    {
        throw new Error("Collect block plugin unavailable");
    }

    try
    {
        await raceWithTimeout(collection.collect(blocks), 20000);
        return true;
    }
    catch (err)
    {
        bot.pathfinder?.stop();
        bot.stopDigging();
        throw err;
    }
}

export function findBlockTarget(bot: Bot, params: MineParams, maxDistance: number): Block | null
{
    if (params.position)
    {
        return bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z));
    }
    const name = params.block?.toLowerCase();
    if (!name) return null;
    const aliases = expandMaterialAliases(bot, name);
    return bot.findBlock({ matching: (block) => aliases.includes(block.name) || block.name.includes(name), maxDistance });
}

export function resolveItemToBlock(item: string): string | null
{
    const lower = item.toLowerCase();

    if (lower.includes("cobblestone")) return "stone";
    if (lower.includes("dirt")) return "dirt";
    if (lower.includes("iron")) return "iron_ore";
    if (lower.includes("gold")) return "gold_ore";
    if (lower.includes("diamond")) return "diamond_ore";
    if (lower.includes("coal")) return "coal_ore";
    if (lower.includes("copper")) return "copper_ore";
    if (lower.includes("redstone") && !lower.includes("block")) return "redstone_ore";
    if (lower.includes("lapis")) return "lapis_ore";
    if (lower.includes("emerald")) return "emerald_ore";

    if (lower === "log" || lower === "wood") return "log";
    if (lower.includes("_log")) return lower;
    if (lower.includes("_stem")) return lower;
    if (lower.includes("log") || lower.includes("wood")) return "log";

    if (lower.includes("sand") && !lower.includes("stone")) return "sand";
    if (lower.includes("gravel")) return "gravel";
    if (lower.includes("clay")) return "clay";

    return null;
}

export function resolveProductToRaw(product: string): string | null
{
    if (product.includes("planks")) return "log";
    if (product.includes("stick")) return "planks";
    if (product.includes("pickaxe")) return "stick";
    return null;
}

export async function handleMine(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as MineParams;
    const block = findBlockTarget(bot, params || {}, 32);
    if (!block) throw new Error("No matching block found");

    await collectBlocks(bot, [block]);
}