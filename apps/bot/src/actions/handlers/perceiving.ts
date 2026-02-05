import type { Bot } from "mineflayer";
import { waitForNextTick } from "./movement.js";
import type { PerceiveParams } from "../action-types.js";
import { resolveItemName } from "../action-utils.js";

export async function handlePerceive(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as PerceiveParams;
    const checkQuery = params.check;

    console.log(`[bot] Perceiving: ${checkQuery ?? "surroundings/inventory"}`);

    if (!checkQuery)
    {
        await waitForNextTick(bot);
        return;
    }

    const target = parseTargetFromQuery(bot, checkQuery);

    if (target)
    {
        await verifyInventory(bot, target.item, target.count);
    }
    else
    {
        await waitForNextTick(bot);
    }
}

function parseTargetFromQuery(bot: Bot, query: string): { item: string; count: number } | null
{
    let count = 1;
    
    const numberMatch = query.match(/(\d+)/);
    if (numberMatch)
    {
        count = parseInt(numberMatch[1], 10);
    }

    const directResolve = resolveItemName(bot, query);
    if (isValidItem(bot, directResolve))
    {
        return { item: directResolve, count };
    }

    const tokens = query.toLowerCase().split(/[\s,]+/);
    
    for (const token of tokens)
    {
        if (token.match(/^\d+$/) || ["check", "for", "inventory", "have"].includes(token)) continue;

        const resolved = resolveItemName(bot, token);
        if (isValidItem(bot, resolved))
        {
            return { item: resolved, count };
        }
    }

    for (let i = 0; i < tokens.length - 1; i++)
    {
        const pair = `${tokens[i]}_${tokens[i+1]}`;
        const resolved = resolveItemName(bot, pair);
        if (isValidItem(bot, resolved))
        {
            return { item: resolved, count };
        }
    }

    return null;
}

function isValidItem(bot: Bot, name: string): boolean
{
    return !!bot.registry.itemsByName[name];
}

async function verifyInventory(bot: Bot, itemName: string, minCount: number): Promise<void>
{
    const timeoutMs = 3000; 
    const intervalMs = 250;
    const start = Date.now();

    let currentCount = 0;

    while (Date.now() - start < timeoutMs)
    {
        currentCount = countItem(bot, itemName);
        if (currentCount >= minCount)
        {
            return;
        }
        
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    currentCount = countItem(bot, itemName);
    if (currentCount < minCount)
    {
        throw new Error(`Perception check failed: Found ${currentCount} ${itemName}, required ${minCount}.`);
    }
}

function countItem(bot: Bot, name: string): number
{
    const items = bot.inventory.items().filter(i => i.name === name);
    return items.reduce((acc, i) => acc + i.count, 0);
}