import type { Bot } from "mineflayer";
import { waitForNextTick } from "./movement.js";
import type { PerceiveParams } from "../action-types.js";

export async function handlePerceive(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as PerceiveParams;
    console.log(`[bot] Perceiving: ${params?.check ?? "surroundings/inventory"}`);
    await waitForNextTick(bot);
}