import type { Bot } from "mineflayer";
import { requireInventoryItem } from "../action-utils.js";
import type { FishParams } from "../action-types.js";

export async function handleFish(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as FishParams;
    const rod = requireInventoryItem(bot, "fishing_rod");
    await bot.equip(rod, "hand");
    for (let i = 0; i < (params.casts ?? 1); i++) await bot.fish();
}