import "dotenv/config";
import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import path from "node:path";
import fs from "node:fs";
import minecraftData from "minecraft-data";
import { pathfinder, Movements } from "mineflayer-pathfinder";
import { plugin as movementPlugin } from "mineflayer-movement";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as toolPlugin } from "mineflayer-tool";
import { loadBotConfig, ConfigError } from "./settings/config.js";
import { PerceptionCollector } from "./perception.js";
import { PerceptionSnapshot } from "./settings/types.js";
import { runSetupWizard } from "./settings/setup.js";
import { ActionExecutor } from "./actions/action-executor.js";
import { createDefaultActionHandlers } from "./actions/action-handlers.js";
import { wireChatBridge } from "./actions/chat-commands.js";
import { ReflectionLogger } from "./logger/reflection-log.js";
import { PlannerWorkerClient } from "./planner/planner-worker-client.js";
import { SessionLogger } from "./logger/session-logger.js";
import { goalNeedsBuildSite, scoutBuildSite } from "./scouting.js";
import { SafetyRails } from "./safety/safety-rails.js";

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

    const defaultRecipePath = path.resolve(process.cwd(), "..", "..", "py", "agent", "recipes");
    const RECIPES_PATH = process.env.RECIPES_DIR ?? defaultRecipePath;
    
    if (fs.existsSync(RECIPES_PATH))
    {
        console.log(`[startup] RAG Recipes enabled. Loading from: ${RECIPES_PATH}`);
    }
    else
    {
        console.warn(`[startup] WARNING: Recipe path not found at: ${RECIPES_PATH}`);
        console.warn(`[startup] RAG will be disabled. Ensure you are running from 'apps/bot'.`);
    }

    const sessionLogger = new SessionLogger();
    sessionLogger.info("startup", "MineAgent starting", { configPath, model: hfModel, backend: hfBackend });
    const safety = new SafetyRails({ config: cfg.safety, logger: sessionLogger });

    const bot = mineflayer.createBot(
    {
        host: cfg.connection.host,
        port: cfg.connection.port,
        username: cfg.connection.username,
        version: cfg.connection.version,
    });

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(movementPlugin);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(toolPlugin);

    bot.once("spawn", () =>
    {
        console.log("[bot] spawned");
        sessionLogger.info("bot.spawn", "Bot spawned", { position: bot.entity.position, dimension: bot.game.dimension });

        const mcData = minecraftData(bot.version);
        const movements = new Movements(bot);
        movements.allowSprinting = true;
        bot.pathfinder.setMovements(movements);

        const reflection = new ReflectionLogger(sessionLogger.directory);

        let planner: PlannerWorkerClient | null = null;
        try {
            planner = new PlannerWorkerClient(
            {
                options: {
                    model: hfModel,
                    token: hfToken,
                    cacheDir: hfCache,
                    backend: hfBackend,
                    recipesDir: RECIPES_PATH
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
            },
            safety
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

        const unwireChat = wireChatBridge(bot, executor, { safety });

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
                    let context = "You are currently in the game. React immediately.";
                    if (goalNeedsBuildSite(currentGoal)) {
                        const site = scoutBuildSite(bot, currentGoal);
                        if (site) {
                            context += ` Scouted build site: origin (${site.origin.x}, ${site.origin.y}, ${site.origin.z}), size ${site.size}x${site.size}, flatness ${site.flatness}, coverage ${Math.round(site.coverage * 100)}%, distance ${site.radius}. Move there before building.`;
                            sessionLogger.info("planner.scout.site", "Scouted build site", { goal: currentGoal, site });
                        } else {
                            context += " Scouting report: no suitable flat build site found nearby. Consider clearing or leveling terrain.";
                            sessionLogger.warn("planner.scout.none", "No suitable build site found", { goal: currentGoal });
                        }
                    }

                    const plan = await planner.createPlan({
                        goal: currentGoal,
                        perception: snap,
                        context
                    });

                    if (plan.knowledgeUsed && plan.knowledgeUsed.length > 0)
                    {
                        console.log(`[planner] RAG injected ${plan.knowledgeUsed.length} recipes.`);
                        sessionLogger.info("planner.rag", "Recipes injected", { recipes: plan.knowledgeUsed });
                    }
                    else
                    {
                         console.log(`[planner] No relevant recipes found for this goal.`);
                         sessionLogger.info("planner.rag", "No relevant recipes found for this goal");
                    }

                    console.log(`[planner] Plan generated! Intent: ${plan.intent}`);
                    console.log(`[planner] Raw steps:`, plan.steps);
                    sessionLogger.info("planner.result", "Plan generated", { intent: plan.intent, steps: plan.steps, backend: plan.backend, model: plan.model });

                    if (plan.steps.length === 0)
                    {
                        console.warn("[planner] Plan contained no steps; clearing goal.");
                        safeChat(bot, safety, "I couldn't figure out how to do that.", "planner.empty");
                        currentGoal = null;
                        sessionLogger.warn("planner.empty", "Plan contained no steps", { goal: currentGoal });
                    }
                    else
                    {
                        safeChat(bot, safety, plan.intent, "planner.intent");

                        executor.reset();

                        const results = await executor.executePlan(plan.steps);
                        const failed = results.find(r => r.status === "failed");

                        if (failed)
                        {
                            console.warn(`[planner] Plan execution failed at ${failed.id}: ${failed.reason ?? "unknown reason"}`);
                            safeChat(bot, safety, `I got stuck on step ${failed.id}.`, "planner.failed");
                            sessionLogger.warn("planner.execution.failed", "Plan execution failed", { failed });
                        }
                        else
                        {
                            console.log(`[planner] Plan execution completed for goal: "${currentGoal}"`);
                            safeChat(bot, safety, "I'm done!", "planner.complete");
                            sessionLogger.info("planner.execution.complete", "Plan execution completed", { goal: currentGoal });
                        }

                        currentGoal = null;
                    }
                } catch (error) {
                    console.error(`[planner] Error generating plan:`, error);
                    safeChat(bot, safety, "My brain hurts. I couldn't make a plan.", "planner.error");
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

function safeChat(bot: Bot, safety: SafetyRails, message: string, source: string): void
{
    const result = safety.checkOutgoingChat(message, source);
    if (!result.allowed)
    {
        return;
    }

    bot.chat(result.message);
}