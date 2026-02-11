import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { DropParams, EquipParams } from "../../types.js";
import { findNearestEntity, moveToward, waitForNextTick } from "../moving/move.js";
import type { GiveParams } from "../../types.js";

export async function handleGive(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as GiveParams;
    if (!params.target) throw new Error("Give requires target player name");
    if (!params.item) throw new Error("Give requires item name");

    const targetName = params.target.toLowerCase();
    const itemName = params.item.toLowerCase();
    const method = params.method ?? "drop";

    const targetEntity = findNearestEntity(bot, (entity) =>
        entity.type === "player" && (entity.username?.toLowerCase().includes(targetName) ?? false),
        64
    );

    if (!targetEntity) throw new Error(`Target player "${params.target}" not found nearby`);

    const items = bot.inventory.items().filter((item) =>
        item.name.toLowerCase().includes(itemName)
    );

    if (items.length === 0) throw new Error(`No ${params.item} in inventory`);

    if (method === "chest")
    {
        const chestId = bot.registry?.blocksByName?.chest?.id;
        let chestBlock = typeof chestId === "number"
            ? bot.findBlock({ matching: chestId, maxDistance: 16 })
            : null;

        if (!chestBlock)
        {
            const chestItem = bot.inventory.items().find((item) => item.name === "chest");
            if (chestItem)
            {
                const pos = bot.entity.position.offset(1, 0, 0).floored();
                const ref = bot.blockAt(pos.offset(0, -1, 0));
                if (ref && ref.boundingBox !== "empty")
                {
                    await bot.equip(chestItem, "hand");
                    await bot.placeBlock(ref, new Vec3(0, 1, 0));
                    await waitForNextTick(bot);
                    chestBlock = bot.blockAt(pos);
                }
            }
        }

        if (!chestBlock) throw new Error("No chest available for deposit");

        await moveToward(bot, chestBlock.position, 2.5, 15000);
        const chest = await bot.openContainer(chestBlock);

        let deposited = 0;
        for (const item of items)
        {
            const toDeposit = params.count ? Math.min(params.count - deposited, item.count) : item.count;
            if (toDeposit <= 0) continue;

            try
            {
                await chest.deposit(item.type, null, toDeposit);
                deposited += toDeposit;
            }
            catch (err)
            {
                console.warn(`[give] Failed to deposit ${item.name}: ${err}`);
            }

            if (params.count && deposited >= params.count) break;
        }

        chest.close();

        const pos = chestBlock.position;
        bot.chat(`[team] Deposited ${deposited} ${params.item} in chest at ${pos.x},${pos.y},${pos.z} for ${params.target}`);
    }
    else
    {
        await moveToward(bot, targetEntity.position, 3, 15000);
        await bot.lookAt(targetEntity.position.offset(0, 1, 0), true);

        let tossed = 0;
        for (const item of items)
        {
            const toToss = params.count ? Math.min(params.count - tossed, item.count) : item.count;
            if (toToss <= 0) continue;

            try
            {
                await bot.toss(item.type, item.metadata, toToss);
                tossed += toToss;
                await waitForNextTick(bot);
            }
            catch (err)
            {
                console.warn(`[give] Failed to toss ${item.name}: ${err}`);
            }

            if (params.count && tossed >= params.count) break;
        }

        bot.chat(`[team] Tossed ${tossed} ${params.item} to ${params.target}`);
    }
}

export async function handleDrop(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as DropParams;
    const itemName = params.item?.toLowerCase();

    if (!itemName || itemName === "all")
    {
        await clearInventory(bot);
        return;
    }

    const items = bot.inventory.items().filter((item) =>
        item.name.toLowerCase().includes(itemName)
    );

    if (items.length === 0)
    {
        console.log(`[drop] No ${params.item} found in inventory`);
        return;
    }

    let dropped = 0;
    for (const item of items)
    {
        const toDrop = params.count ? Math.min(params.count - dropped, item.count) : item.count;
        if (toDrop <= 0) continue;

        try
        {
            await bot.toss(item.type, item.metadata, toDrop);
            dropped += toDrop;
            await waitForNextTick(bot);
        }
        catch (err)
        {
            console.warn(`[drop] Failed to drop ${item.name}: ${err}`);
        }

        if (params.count && dropped >= params.count) break;
    }

    console.log(`[drop] Dropped ${dropped} ${params.item}`);
}

export async function handleEquip(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as EquipParams;
    if (!params.item) throw new Error("Equip requires item name");

    const destination = params.destination ?? "hand";
    const itemName = params.item.toLowerCase();
    const item = bot.inventory.items().find((entry) => entry.name.toLowerCase().includes(itemName));

    if (!item) throw new Error(`No ${params.item} in inventory`);

    await bot.equip(item, destination);
    await waitForNextTick(bot);
}

export async function clearInventory(bot: Bot): Promise<void>
{
    const items = bot.inventory.items();
    console.log(`[clearInventory] Dropping ${items.length} item stacks...`);

    for (const item of items)
    {
        try
        {
            await bot.tossStack(item);
            await waitForNextTick(bot);
        }
        catch (err)
        {
            console.warn(`[clearInventory] Failed to drop ${item.name}: ${err}`);
        }
    }

    console.log("[clearInventory] Inventory cleared.");
}