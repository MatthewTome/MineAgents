import "dotenv/config";
import mineflayer from "mineflayer";
import path from "node:path";
import fs from "node:fs";
import { loadBotConfig, ConfigError } from "./config.js";
import { PerceptionCollector } from "./perception.js";
import { runSetupWizard } from "./setup.js";
import { ActionExecutor } from "./action-executor.js";
import { createDefaultActionHandlers } from "./action-handlers.js";
import { wireChatBridge } from "./chat-commands.js";
import { ReflectionLogger } from "./reflection-log.js";
import { PlannerWorkerClient } from "./planner-worker-client.js";
async function createBot() {
    const defaultPath = path.join(process.cwd(), "config", "bot.config.yaml");
    const configPath = process.env.BOT_CONFIG ?? defaultPath;
    const hfToken = process.env.HF_TOKEN;
    const hfModel = process.env.HF_MODEL ?? "Xenova/Qwen2.5-1.5B-Instruct";
    const hfCache = process.env.HF_CACHE_DIR;
    const hfBackend = process.env.LLM_MODE ?? "auto";
    if (!fs.existsSync(configPath) && !process.env.BOT_CONFIG) {
        try {
            await runSetupWizard(configPath);
        }
        catch (err) {
            console.error("Setup failed:", err);
            process.exit(1);
        }
    }
    let cfg;
    try {
        cfg = loadBotConfig(configPath);
    }
    catch (err) {
        if (err instanceof ConfigError) {
            console.error(`[config] ${err.message}`);
        }
        else {
            console.error("[config] Unexpected error", err);
        }
        process.exit(1);
    }
    const bot = mineflayer.createBot({
        host: cfg.connection.host,
        port: cfg.connection.port,
        username: cfg.connection.username,
        version: cfg.connection.version,
    });
    bot.once("spawn", () => {
        console.log("[bot] spawned");
        const reflection = new ReflectionLogger();
        let planner = null;
        try {
            planner = new PlannerWorkerClient({
                options: {
                    model: hfModel,
                    token: hfToken,
                    cacheDir: hfCache,
                    backend: hfBackend
                }
            });
            void planner.ready.then(({ backend, model }) => {
                const source = backend === "local" ? "local transformers (quantized where available)" : "remote Hugging Face API";
                console.log(`[planner] Ready using ${source} (${model ?? hfModel}).`);
            }).catch((err) => {
                console.error("[planner] Planner backend failed to initialize:", err);
            });
        }
        catch (err) {
            console.error(`[planner] Failed to initialize planner ${hfModel}:`, err);
        }
        const initialGoal = process.env.BOT_GOAL ?? null;
        if (initialGoal) {
            console.log(`[planner] Default goal configured: "${initialGoal}"`);
        }
        let currentGoal = initialGoal;
        let isPlanning = false;
        const handlers = createDefaultActionHandlers();
        const executor = new ActionExecutor(bot, handlers, {
            logger: (entry) => {
                reflection.record(entry);
                const reason = entry.reason ? ` (${entry.reason})` : "";
                console.log(`[action] ${entry.action}#${entry.id} -> ${entry.status}${reason}`);
            }
        });
        const perception = new PerceptionCollector(bot, {
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
            if (username === bot.username)
                return;
            if (message.startsWith("!goal ")) {
                const newGoal = message.replace("!goal ", "").trim();
                console.log(`[bot] Goal received via chat: "${newGoal}"`);
                currentGoal = newGoal;
            }
        });
        perception.start(async (snap) => {
            if (currentGoal && !isPlanning && planner) {
                isPlanning = true;
                console.log(`[planner] Generating plan with ${planner.modelName} for goal: "${currentGoal}"...`);
                try {
                    const plan = await planner.createPlan({
                        goal: currentGoal,
                        perception: snap,
                        context: "You are currently in the game. React immediately."
                    });
                    console.log(`[planner] Plan generated! Intent: ${plan.intent}`);
                    console.log(`[planner] Raw steps:`, plan.steps);
                    if (plan.steps.length === 0) {
                        console.warn("[planner] Plan contained no steps; clearing goal.");
                        bot.chat("I couldn't figure out how to do that.");
                        currentGoal = null;
                    }
                    else {
                        bot.chat(plan.intent);
                        executor.reset();
                        const results = await executor.executePlan(plan.steps);
                        const failed = results.find(r => r.status === "failed");
                        if (failed) {
                            console.warn(`[planner] Plan execution failed at ${failed.id}: ${failed.reason ?? "unknown reason"}`);
                            bot.chat(`I got stuck on step ${failed.id}.`);
                        }
                        else {
                            console.log(`[planner] Plan execution completed for goal: "${currentGoal}"`);
                            bot.chat("I'm done!");
                        }
                        currentGoal = null;
                    }
                }
                catch (error) {
                    console.error(`[planner] Error generating plan:`, error);
                    bot.chat("My brain hurts. I couldn't make a plan.");
                    currentGoal = null;
                }
                finally {
                    isPlanning = false;
                }
            }
            const now = Date.now();
            if (now - lastLog > 1000) {
                lastLog = now;
                const minimal = {
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
            }
        });
        bot.on("end", () => {
            perception.stop();
            unwireChat();
            const summaryPath = reflection.writeSummaryFile();
            console.log(`[reflection] summary written to ${summaryPath}`);
        });
    });
    bot.on("kicked", (reason) => {
        console.error("[bot] kicked:", reason);
    });
    bot.on("error", (err) => {
        console.error("[bot] error:", err);
    });
    return bot;
}
createBot().catch(console.error);