import mineflayer from "mineflayer";
import path from "node:path";
import fs from "node:fs";
import { loadBotConfig, ConfigError } from "./config.js";
import { PerceptionCollector } from "./perception.js";
import { PerceptionSnapshot } from "./types.js";
import { runSetupWizard } from "./setup.js";
import { ActionExecutor } from "./action-executor.js";
import { createDefaultActionHandlers } from "./action-handlers.js";
import { wireChatBridge } from "./chat-commands.js";
import { ReflectionLogger } from "./reflection-log.js";

async function createBot()
{
    const defaultPath = path.join(process.cwd(), "config", "bot.config.yaml");
    const configPath = process.env.BOT_CONFIG ?? defaultPath;

    if (!fs.existsSync(configPath) && !process.env.BOT_CONFIG)
    {
        try {
            await runSetupWizard(configPath);
        } catch (err) {
            console.error("Setup failed:", err);
            process.exit(1);
        }
    }

    let cfg;

    try
    {
        cfg = loadBotConfig(configPath);
    }
    catch (err)
    {
        if (err instanceof ConfigError)
        {
            console.error(`[config] ${err.message}`);
        }
        else
        {
            console.error("[config] Unexpected error", err);
        }
        process.exit(1);
    }

    const bot = mineflayer.createBot(
    {
        host: cfg.connection.host,
        port: cfg.connection.port,
        username: cfg.connection.username,
        version: cfg.connection.version,
    });

    bot.once("spawn", () =>
    {
        console.log("[bot] spawned");

        const reflection = new ReflectionLogger();
        const handlers = createDefaultActionHandlers();
        const executor = new ActionExecutor(bot, handlers,
        {
            logger: (entry) =>
            {
                reflection.record(entry);
                const reason = entry.reason ? ` (${entry.reason})` : "";
                console.log(`[action] ${entry.action}#${entry.id} -> ${entry.status}${reason}`);
            }
        });
        
        const perception = new PerceptionCollector(bot,
        {
            hz: cfg.perception.hz,
            nearbyRange: cfg.perception.nearbyRange,
            blockSampleRadiusXY: cfg.perception.blockSampleRadiusXY,
            blockSampleHalfHeight: cfg.perception.blockSampleHalfHeight,
            maxNearbyEntities: cfg.perception.maxNearbyEntities,
            chatBuffer: cfg.perception.chatBuffer
        });

        let lastLog = 0;

        const unwireChat = wireChatBridge(bot, executor);

        perception.start((snap: PerceptionSnapshot) =>
        {
            const now = Date.now();
            if (now - lastLog > 1000)
            {
                lastLog = now;

                const minimal =
                {
                    tickId: snap.tickId,
                    pos: snap.pose.position,
                    day: snap.environment.dayCycle,
                    dim: snap.environment.dimension,
                    health: snap.pose.health,
                    food: snap.pose.food,
                    nearby: snap.nearby.entities.slice(0, 3).map(e => ({ kind: e.kind, name: e.name, d: e.distance })),
                    hazards: snap.hazards
                };

                console.clear();
                console.log(JSON.stringify(minimal, null, 2));
            }
        });

        bot.on("end", () =>
        {
            perception.stop();
            unwireChat();
            const summaryPath = reflection.writeSummaryFile();
            console.log(`[reflection] summary written to ${summaryPath}`);
        });
    });

    bot.on("kicked", (reason: any) =>
    {
        console.error("[bot] kicked:", reason);
    });

    bot.on("error", (err: any) =>
    {
        console.error("[bot] error:", err);
    });

    return bot;
}

createBot().catch(console.error);