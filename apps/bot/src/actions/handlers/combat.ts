import type { Bot } from "mineflayer";
import { moveToward, findNearestEntity } from "./movement.js";
import type { FightParams, HuntParams } from "../action-types.js";
import type { EatParams } from "../action-types.js";

export async function handleHunt(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as HuntParams;
    const target = findNearestEntity(bot, (entity) => entity.type === "mob" && (entity.name ?? "").includes(params.target ?? ""), 64);
    if (!target) throw new Error("Target not found");
    await engageTarget(bot, target, params.range ?? 2, params.timeoutMs ?? 20000);
}

export async function handleFight(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as FightParams;
    const target = findNearestEntity(bot, (entity) => (entity.type === "mob" || entity.type === "player") && (entity.name ?? "").includes(params.target ?? ""), 64);
    if (!target) throw new Error("Target not found");
    await engageTarget(bot, target, 2.5, params.timeoutMs ?? 20000);
}

async function engageTarget(bot: Bot, entity: any, range: number, timeoutMs: number): Promise<void>
{
    const start = Date.now();
    while (bot.entity.position.distanceTo(entity.position) > range)
    {
        if (Date.now() - start > timeoutMs) throw new Error("Timeout");
        await moveToward(bot, entity.position, range, timeoutMs - (Date.now() - start));
    }
    await bot.lookAt(entity.position, true);
    bot.attack(entity);
}

export async function handleEat(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as EatParams;
    const preferred = params.item?.toLowerCase();
    const inventory = bot.inventory.items();
    const foodCandidates = inventory.filter((item) =>
    {
        const name = item.name.toLowerCase();
        return name.includes("bread")
            || name.includes("cooked")
            || name.includes("apple")
            || name.includes("stew")
            || name.includes("porkchop")
            || name.includes("beef")
            || name.includes("mutton")
            || name.includes("chicken")
            || name.includes("carrot")
            || name.includes("potato")
            || name.includes("fish");
    });

    const food = preferred
        ? foodCandidates.find((item) => item.name.toLowerCase().includes(preferred))
        : foodCandidates[0];

    if (!food)
    {
        throw new Error("No food available to eat.");
    }

    await bot.equip(food, "hand");
    await bot.consume();
}