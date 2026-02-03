import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { MineParams } from "../action-types.js";
import type { Block } from "prismarine-block";
import { resolveItemName } from "../action-utils.js";
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
    const blockName = resolveItemToBlock(name) ?? resolveItemName(bot, name);
    return bot.findBlock({ matching: (block) => block.name === blockName, maxDistance });
}

export function resolveItemToBlock(item: string): string | null
{
    const lower = item.toLowerCase();

    if (lower.includes("cobblestone") || lower === "stone") return "stone";
    if (lower.includes("coal")) return "coal_ore";
    if (lower.includes("iron")) return "iron_ore";
    if (lower === "log" || lower === "wood") return "oak_log";
    if (lower.includes("_log")) return lower;

    return null;
}

export function resolveProductToRaw(product: string): string | null
{
    if (product.includes("planks")) return "oak_log";
    if (product.includes("stick")) return "oak_planks";
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