import "dotenv/config";
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
import { PlannerWorkerClient } from "./planner-worker-client.js";
import { SessionLogger } from "./session-logger.js";

async function createBot()
{
    const defaultPath = path.join(process.cwd(), "config", "bot.config.yaml");
    const configPath = process.env.BOT_CONFIG ?? defaultPath;

    const hfToken = process.env.HF_TOKEN;
    const hfModel = process.env.HF_MODEL ?? "Xenova/Qwen2.5-1.5B-Instruct";
    const hfCache = process.env.HF_CACHE_DIR;
    const hfBackend = (process.env.LLM_MODE as "local" | "remote" | "auto") ?? "auto";

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

    const sessionLogger = new SessionLogger();
    sessionLogger.info("startup", "MineAgent starting", { configPath, model: hfModel, backend: hfBackend });

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
        sessionLogger.info("bot.spawn", "Bot spawned", { position: bot.entity.position, dimension: bot.game.dimension });

        const reflection = new ReflectionLogger(sessionLogger.directory);

        let planner: PlannerWorkerClient | null = null;
        try {
            planner = new PlannerWorkerClient(
            {
                options: {
                    model: hfModel,
                    token: hfToken,
                    cacheDir: hfCache,
                    backend: hfBackend
                },
                logDir: sessionLogger.directory
            });
            void planner.ready.then(({ backend, model }) =>
            {
                const source = backend === "local" ? "local transformers (quantized where available)" : "remote Hugging Face API";
                console.log(`[planner] Ready using ${source} (${model ?? hfModel}).`);
                sessionLogger.info("planner.ready", "Planner ready", { backend, model: model ?? hfModel });
            }).catch((err) =>
            {
                console.error("[planner] Planner backend failed to initialize:", err);
                sessionLogger.error("planner.ready", "Planner backend failed to initialize", { error: err instanceof Error ? err.message : String(err) });
            });
        } catch (err) {
            console.error(`[planner] Failed to initialize planner ${hfModel}:`, err);
            sessionLogger.error("planner.init", "Planner initialization failed", { error: err instanceof Error ? err.message : String(err) });
        }

        const initialGoal = process.env.BOT_GOAL ?? null;
        if (initialGoal)
        {
            console.log(`[planner] Default goal configured: "${initialGoal}"`);
            sessionLogger.info("goal.default", "Default goal configured", { goal: initialGoal });
        }

        let currentGoal: string | null = initialGoal;
        let isPlanning = false;

        const handlers = createDefaultActionHandlers();
        const executor = new ActionExecutor(bot, handlers,
        {
            logger: (entry) =>
            {
                reflection.record(entry);
                const reason = entry.reason ? ` (${entry.reason})` : "";
                sessionLogger.logAction(entry);
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

        bot.on("chat", (username, message) => {
            if (username === bot.username) return;
            
            if (message.startsWith("!goal ")) {
                const newGoal = message.replace("!goal ", "").trim();
                console.log(`[bot] Goal received via chat: "${newGoal}"`);
                currentGoal = newGoal;
                sessionLogger.info("goal.received", "Goal received via chat", { from: username, goal: newGoal });
            }
        });

        perception.start(async (snap: PerceptionSnapshot) =>
        {
            if (currentGoal && !isPlanning && planner)
            {
                isPlanning = true;
                console.log(`[planner] Generating plan with ${planner.modelName} for goal: "${currentGoal}"...`);
                sessionLogger.info("planner.start", "Generating plan", { goal: currentGoal, tickId: snap.tickId });

                try {
                    const plan = await planner.createPlan({
                        goal: currentGoal,
                        perception: snap,
                        context: "You are currently in the game. React immediately."
                    });

                    console.log(`[planner] Plan generated! Intent: ${plan.intent}`);
                    console.log(`[planner] Raw steps:`, plan.steps);
                    sessionLogger.info("planner.result", "Plan generated", { intent: plan.intent, steps: plan.steps, backend: plan.backend, model: plan.model });

                    if (plan.steps.length === 0)
                    {
                        console.warn("[planner] Plan contained no steps; clearing goal.");
                        bot.chat("I couldn't figure out how to do that.");
                        currentGoal = null;
                        sessionLogger.warn("planner.empty", "Plan contained no steps", { goal: currentGoal });
                    }
                    else
                    {
                        bot.chat(plan.intent);

                        executor.reset();

                        const results = await executor.executePlan(plan.steps);
                        const failed = results.find(r => r.status === "failed");

                        if (failed)
                        {
                            console.warn(`[planner] Plan execution failed at ${failed.id}: ${failed.reason ?? "unknown reason"}`);
                            bot.chat(`I got stuck on step ${failed.id}.`);
                            sessionLogger.warn("planner.execution.failed", "Plan execution failed", { failed });
                        }
                        else
                        {
                            console.log(`[planner] Plan execution completed for goal: "${currentGoal}"`);
                            bot.chat("I'm done!");
                            sessionLogger.info("planner.execution.complete", "Plan execution completed", { goal: currentGoal });
                        }

                        currentGoal = null;
                    }
                } catch (error) {
                    console.error(`[planner] Error generating plan:`, error);
                    bot.chat("My brain hurts. I couldn't make a plan.");
                    sessionLogger.error("planner.error", "Error generating plan", { error: error instanceof Error ? error.message : String(error) });
                    currentGoal = null;
                } finally {
                    isPlanning = false;
                }
            }

            const now = Date.now();
            if (now - lastLog > 1000)
            {
                lastLog = now;

                const minimal: Record<string, unknown> =
                {
                    tickId: snap.tickId,
                    pos: snap.pose.position,
                    day: snap.environment.dayCycle,
                    currentGoal: currentGoal ?? "None",
                    isPlanning: isPlanning,
                    dim: snap.environment.dimension,
                    health: snap.pose.health,
                    food: snap.pose.food,
                    nearby: snap.nearby.entities.slice(0, 3).map(e => ({ kind: e.kind, name: e.name, d: e.distance })),
                    hazards: snap.hazards
                };

                console.clear();
                console.log(JSON.stringify(minimal, null, 2));
                sessionLogger.logPerceptionSnapshot(minimal);
            }
        });

        bot.on("end", () =>
        {
            perception.stop();
            unwireChat();
            const summaryPath = reflection.writeSummaryFile();
            console.log(`[reflection] summary written to ${summaryPath}`);
            sessionLogger.info("session.end", "Bot ended", { summaryPath });
        });
    });

    bot.on("kicked", (reason: any) =>
    {
        console.error("[bot] kicked:", reason);
        sessionLogger.error("bot.kicked", "Bot kicked", { reason: String(reason) });
    });

    bot.on("error", (err: any) =>
    {
        console.error("[bot] error:", err);
        sessionLogger.error("bot.error", "Bot encountered an error", { error: err instanceof Error ? err.message : String(err) });
    });

    return bot;
}

createBot().catch(console.error);