import type { Bot } from "mineflayer";
import type { PickupParams } from "../../types.js";
import { findNearestEntity, moveWithMovementPlugin, waitForNextTick } from "../moving/move.js";

export async function handlePickup(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as PickupParams;
    const itemName = params.item?.toLowerCase();

    const droppedItem = findNearestEntity(bot, (entity) =>
    {
        if (entity.name !== "item") return false;
        const dropped = (entity as any).getDroppedItem?.();
        if (!dropped) return false;
        if (itemName && !dropped.name?.toLowerCase().includes(itemName)) return false;
        return true;
    }, 32);

    if (!droppedItem)
    {
        console.log(`[pickup] No dropped items found${itemName ? ` matching "${itemName}"` : ""}`);
        return;
    }

    console.log(`[pickup] Moving to collect dropped item at ${droppedItem.position}`);
    await moveWithMovementPlugin(bot, droppedItem.position, 1, 15000);
    await waitForNextTick(bot);
    console.log("[pickup] Item collected");
}