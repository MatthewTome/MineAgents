import type { Bot } from "mineflayer";
import { waitForNextTick } from "./movement.js";
import type { PerceiveParams } from "../action-types.js";
import { resolveItemName } from "../action-utils.js";

export async function handlePerceive(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    let params: PerceiveParams;
    if (Array.isArray(step.params))
    {
        params = { check: step.params[0] } as unknown as PerceiveParams;
    }
    else
    {
        params = (step.params ?? {}) as unknown as PerceiveParams;
    }

    const checkQuery = params.check;
    const isGeneric = !checkQuery || ["check", "inventory", "items", "surroundings"].includes(checkQuery.toLowerCase());

    console.log(`[perceive] Request: "${checkQuery ?? "generic/inventory"}"`);

    if (isGeneric)
    {
        console.log("[perceive] Generic check detected. Waiting for next tick to sync inventory...");
        await waitForNextTick(bot);
        
        const totalItems = bot.inventory.items().reduce((acc, i) => acc + i.count, 0);
        console.log(`[perceive] Sync complete. Total items in inventory: ${totalItems}`);
        return;
    }

    const target = parseTargetFromQuery(bot, checkQuery);

    if (target)
    {
        console.log(`[perceive] Verifying goal: Have >= ${target.count} ${target.item}`);
        await verifyInventory(bot, target.item, target.count);
    }
    else
    {
        console.log(`[perceive] Could not parse specific target from "${checkQuery}". Waiting for next tick to sync.`);
        await waitForNextTick(bot);
        
        const totalItems = bot.inventory.items().reduce((acc, i) => acc + i.count, 0);
        console.log(`[perceive] Sync complete. Total items in inventory: ${totalItems}`);
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
    const timeoutMs = 4000; 
    const intervalMs = 250;
    const start = Date.now();

    let currentCount = 0;

    while (Date.now() - start < timeoutMs)
    {
        currentCount = countItem(bot, itemName);
        if (currentCount >= minCount)
        {
            console.log(`[perceive] Success: Found ${currentCount} ${itemName} (needed ${minCount}).`);
            return;
        }
        
        if ((Date.now() - start) % 1000 < intervalMs) 
        {
            console.log(`[perceive] Waiting for ${itemName}... (Have: ${currentCount}, Need: ${minCount})`);
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