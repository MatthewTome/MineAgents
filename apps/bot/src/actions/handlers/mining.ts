import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { MineParams } from "../action-types.js";
import type { Block } from "prismarine-block";
import { resolveItemName } from "../action-utils.js";
import { raceWithTimeout } from "./movement.js";

export async function collectBlocks(bot: Bot, blocks: Block[]): Promise<boolean>
{
    const collection = (bot as any).collectBlock;
    if (!collection || !collection.collect)
    {
        throw new Error("Collect block plugin unavailable");
    }

    if (blocks.length === 0) return false;

    const targets = blocks.map((block) => ({
        position: block.position.clone(),
        type: block.type
    }));

    try
    {
        await raceWithTimeout(collection.collect(blocks), 1000000);

        for (const target of targets)
        {
            const blockAfter = bot.blockAt(target.position);
            if (blockAfter && blockAfter.type === target.type)
            {
                throw new Error(`Mining verification failed: Block at ${target.position} was not removed.`);
            }
        }

        return true;
    }
    catch (err)
    {
        bot.pathfinder?.stop();
        bot.stopDigging();
        throw err;
    }
}

export function findBlockTargets(bot: Bot, params: MineParams, maxDistance: number, count = 1): Block[]
{
    const name = params.block?.toLowerCase();
    if (!name) return [];

    const blockName = resolveItemToBlock(name) ?? resolveItemName(bot, name);
    if (!blockName) return [];

    const targets: Block[] = [];
    const seen = new Set<string>();
    const addTarget = (block: Block) =>
    {
        const key = `${block.position.x},${block.position.y},${block.position.z}`;
        if (seen.has(key)) return;
        targets.push(block);
        seen.add(key);
    };

    if (params.position)
    {
        const pos = new Vec3(params.position.x, params.position.y, params.position.z);
        const blockAtPos = bot.blockAt(pos);
        
        if (blockAtPos && blockAtPos.name === blockName)
        {
            addTarget(blockAtPos);
        }
    }

    const desiredCount = Math.max(1, Math.floor(count));
    if (targets.length < desiredCount)
    {
        const positions = bot.findBlocks({
            matching: (block) => block.name === blockName,
            maxDistance,
            count: desiredCount
        });

        for (const pos of positions)
        {
            const block = bot.blockAt(pos);
            if (block && block.name === blockName) addTarget(block);
            if (targets.length >= desiredCount) break;
        }
    }

return targets;
}

export function findBlockTarget(bot: Bot, params: MineParams, maxDistance: number): Block | null
{
    return findBlockTargets(bot, params, maxDistance, 1)[0] ?? null;
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
    const normalized = product.toLowerCase().trim().replace(/\s+/g, "_");

    if (normalized.includes("plank"))
    {
        const woodMatch = normalized.match(/^(.*)_planks?$/);
        if (woodMatch?.[1])
        {
            const wood = woodMatch[1];
            if (wood === "crimson" || wood === "warped") return `${wood}_stem`;
            return `${wood}_log`;
        }
        return "oak_log";
    }
    if (normalized.includes("stick")) return "oak_planks";
    if (normalized.includes("pickaxe")) return "stick";
    
    return null;
}

export async function handleMine(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as MineParams;
    const count = Math.max(1, Math.floor(Number(params.count ?? 1)));
    const maxDistance = params.maxDistance ?? 32;
    const blocks = findBlockTargets(bot, params || {}, maxDistance, count);
    if (blocks.length === 0) throw new Error("No matching block found");
    if (blocks.length < count)
    {
        throw new Error(`Only found ${blocks.length} block(s) to mine, but ${count} required.`);
    }

    await collectBlocks(bot, blocks);
}