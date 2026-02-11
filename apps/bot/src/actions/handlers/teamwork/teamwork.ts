import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import type { RequestResourceParams } from "../../types.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";

export async function handleRequestResource(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as RequestResourceParams;
    if (!params.item) throw new Error("RequestResource requires item name");

    const urgency = params.urgent ? "[URGENT] " : "";
    const count = params.count ?? "some";
    const roleName = (bot as any).__roleName ?? "agent";

    bot.chat(`${urgency}[team] ${bot.username} (${roleName}) needs ${count} ${params.item}`);
    console.log(`[requestResource] Announced need for ${count} ${params.item}`);
}

export async function withResourceLock<T>(resourceLocks: ResourceLockManager | undefined, resourceKey: string | null, action: () => Promise<T>): Promise<T>
{
    if (!resourceLocks || !resourceKey) { return action(); }

    const acquired = await resourceLocks.acquire(resourceKey);
    if (!acquired) { throw new Error(`Resource locked: ${resourceKey}`); }

    try { return await action(); }
    finally { resourceLocks.release(resourceKey); }
}

export function buildLockKey(resourceType: string, position?: Vec3 | null): string | null
{
    if (!position) { return null; }
    return `${resourceType}:${position.toString()}`;
}