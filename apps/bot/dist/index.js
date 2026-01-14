import "dotenv/config";
import mineflayer from "mineflayer";
import path from "node:path";
import fs from "node:fs";
import minecraftData from "minecraft-data";
import pathfinderPkg from "mineflayer-pathfinder";
import { plugin as movementPlugin } from "mineflayer-movement";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as toolPlugin } from "mineflayer-tool";
import { loadBotConfig, ConfigError } from "./settings/config.js";
import { PerceptionCollector } from "./perception/perception.js";
import { runSetupWizard } from "./settings/setup.js";
import { ActionExecutor } from "./actions/action-executor.js";
import { createDefaultActionHandlers } from "./actions/action-handlers.js";
import { wireChatBridge } from "./actions/chat/chat-commands.js";
import { ReflectionLogger } from "./logger/reflection-log.js";
import { PlannerWorkerClient } from "./planner/planner-worker-client.js";
import { SessionLogger } from "./logger/session-logger.js";
import { goalNeedsBuildSite, scoutBuildSite } from "./actions/building/scouting.js";
import { SafetyRails } from "./safety/safety-rails.js";
import { RecipeLibrary } from "./planner/knowledge.js";
import { GoalTracker } from "./research/goals.js";
import { PlanNarrator } from "./actions/chat/narration.js";
const { pathfinder, Movements } = pathfinderPkg;
async function createBot() {
    const sessionLogger = new SessionLogger();
    sessionLogger.installGlobalHandlers();
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
    const defaultRecipePath = path.resolve(process.cwd(), "..", "..", "py", "agent", "recipes");
    const RECIPES_PATH = process.env.RECIPES_DIR ?? defaultRecipePath;
    let recipeLibrary = null;
    if (fs.existsSync(RECIPES_PATH)) {
        console.log(`[startup] RAG Recipes enabled. Loading from: ${RECIPES_PATH}`);
        recipeLibrary = new RecipeLibrary(RECIPES_PATH);
        recipeLibrary.loadAll();
    }
    else {
        console.warn(`[startup] WARNING: Recipe path not found at: ${RECIPES_PATH}`);
        console.warn(`[startup] RAG will be disabled. Ensure you are running from 'apps/bot'.`);
    }
    sessionLogger.info("startup", "MineAgent starting", { configPath, model: hfModel, backend: hfBackend });
    const safety = new SafetyRails({ config: cfg.safety, logger: sessionLogger });
    const goalTracker = new GoalTracker();
    const narrator = new PlanNarrator({ maxLength: 200, minIntervalMs: 5000 });
    const bot = mineflayer.createBot({
        host: cfg.connection.host,
        port: cfg.connection.port,
        username: cfg.connection.username,
        version: cfg.connection.version,
    });
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(movementPlugin);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(toolPlugin);
    bot.once("spawn", () => {
        console.log("[bot] spawned");
        sessionLogger.info("bot.spawn", "Bot spawned", { position: bot.entity.position, dimension: bot.game.dimension });
        const mcData = minecraftData(bot.version);
        const movements = new Movements(bot);
        movements.allowSprinting = true;
        movements.allow1by1towers = true;
        movements.canDig = false;
        const scafoldingItems = [
            bot.registry.itemsByName['scaffolding']?.id,
            bot.registry.itemsByName['dirt']?.id,
            bot.registry.itemsByName['cobblestone']?.id,
            bot.registry.itemsByName['oak_planks']?.id
        ].filter((id) => id !== undefined);
        movements.scafoldingBlocks.push(...scafoldingItems);
        bot.pathfinder.setMovements(movements);
        const reflection = new ReflectionLogger(sessionLogger.directory);
        let planner = null;
        try {
            planner = new PlannerWorkerClient({
                options: {
                    model: hfModel,
                    token: hfToken,
                    cacheDir: hfCache,
                    backend: hfBackend,
                    recipesDir: RECIPES_PATH
                },
                logDir: sessionLogger.directory
            });
            void planner.ready.then(({ backend, model }) => {
                const source = backend === "local" ? "local transformers (quantized where available)" : "remote Hugging Face API";
                console.log(`[planner] Ready using ${source} (${model ?? hfModel}).`);
                sessionLogger.info("planner.ready", "Planner ready", { backend, model: model ?? hfModel });
            }).catch((err) => {
                console.error("[planner] Planner backend failed to initialize:", err);
                sessionLogger.error("planner.ready", "Planner backend failed to initialize", { error: err instanceof Error ? err.message : String(err) });
            });
        }
        catch (err) {
            console.error(`[planner] Failed to initialize planner ${hfModel}:`, err);
            sessionLogger.error("planner.init", "Planner initialization failed", { error: err instanceof Error ? err.message : String(err) });
        }
        const initialGoal = process.env.BOT_GOAL ?? null;
        if (initialGoal) {
            console.log(`[planner] Default goal configured: "${initialGoal}"`);
            const def = {
                name: initialGoal,
                steps: [],
                successSignal: { type: "event", channel: "planner.success" },
                failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                timeoutMs: 600000
            };
            const id = goalTracker.addGoal(def);
            sessionLogger.info("goal.default", "Default goal configured", { goal: initialGoal, id });
        }
        let isPlanning = false;
        const handlers = createDefaultActionHandlers();
        const executor = new ActionExecutor(bot, handlers, {
            logger: (entry) => {
                reflection.record(entry);
                const reason = entry.reason ? ` (${entry.reason})` : "";
                sessionLogger.logAction(entry);
                console.log(`[action] ${entry.action}#${entry.id} -> ${entry.status}${reason}`);
            },
            safety
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
        const unwireChat = wireChatBridge(bot, executor, { safety });
        bot.on("chat", (username, message) => {
            if (username === bot.username)
                return;
            if (message.startsWith("!goal ")) {
                const newGoal = message.replace("!goal ", "").trim();
                console.log(`[bot] Goal received via chat: "${newGoal}"`);
                const def = {
                    name: newGoal,
                    steps: [],
                    successSignal: { type: "event", channel: "planner.success" },
                    failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                    timeoutMs: 600000
                };
                const id = goalTracker.addGoal(def);
                sessionLogger.info("goal.received", "Goal received via chat", { from: username, goal: newGoal, id });
                safeChat(bot, safety, `New research goal tracked: ${newGoal}`, "goal.ack");
            }
        });
        perception.start(async (snap) => {
            const goalEvents = goalTracker.ingestSnapshot(snap);
            for (const event of goalEvents) {
                console.log(`[goal] ${event.name} -> ${event.status} (${event.reason})`);
                sessionLogger.info("goal.update", "Goal status changed", { id: event.id, name: event.name, status: event.status, reason: event.reason, durationMs: event.durationMs });
                if (event.status === "pass") {
                    safeChat(bot, safety, `Goal complete: ${event.name} (${Math.round((event.durationMs ?? 0) / 1000)}s)`, "goal.success");
                }
                else if (event.status === "fail") {
                    safeChat(bot, safety, `Goal failed: ${event.name} - ${event.reason}`, "goal.fail");
                }
            }
            const activeGoalObj = goalTracker.goals.values().next().value;
            const currentGoal = (activeGoalObj && activeGoalObj.status === "pending") ? activeGoalObj.definition.name : null;
            if (currentGoal && !isPlanning && planner) {
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
                        }
                        else {
                            context += " Scouting report: no suitable flat build site found nearby. Consider clearing or leveling terrain.";
                            sessionLogger.warn("planner.scout.none", "No suitable build site found", { goal: currentGoal });
                        }
                    }
                    const plan = await planner.createPlan({
                        goal: currentGoal,
                        perception: snap,
                        context
                    });
                    if (plan.knowledgeUsed && plan.knowledgeUsed.length > 0) {
                        console.log(`[planner] RAG injected ${plan.knowledgeUsed.length} recipes.`);
                        sessionLogger.info("planner.rag", "Recipes injected", { recipes: plan.knowledgeUsed });
                    }
                    else {
                        console.log(`[planner] No relevant recipes found for this goal.`);
                        sessionLogger.info("planner.rag", "No relevant recipes found for this goal");
                    }
                    console.log(`[planner] Plan generated! Intent: ${plan.intent}`);
                    console.log(`[planner] Raw steps:`, plan.steps);
                    sessionLogger.info("planner.result", "Plan generated", { intent: plan.intent, steps: plan.steps, backend: plan.backend, model: plan.model });
                    if (plan.steps.length === 0) {
                        console.warn("[planner] Plan contained no steps; clearing goal.");
                        safeChat(bot, safety, "I couldn't figure out how to do that.", "planner.empty");
                        const events = goalTracker.notifyEvent("planner.fatal_error", {});
                        events.forEach(e => sessionLogger.info("goal.update", "Goal failed due to empty plan", { ...e }));
                    }
                    else {
                        const narrative = narrator.maybeNarrate({ intent: plan.intent, goal: currentGoal, steps: plan.steps });
                        if (narrative) {
                            safeChat(bot, safety, narrative, "planner.narration");
                            sessionLogger.info("planner.narration", "Plan narrated", { message: narrative });
                        }
                        executor.reset();
                        const results = await executor.executePlan(plan.steps);
                        const failed = results.find(r => r.status === "failed");
                        if (failed) {
                            console.warn(`[planner] Plan execution failed at ${failed.id}: ${failed.reason ?? "unknown reason"}`);
                            const recovered = await attemptRecovery({
                                bot,
                                planner,
                                executor,
                                recipeLibrary,
                                goal: currentGoal,
                                perception: snap,
                                baseContext: context,
                                failed,
                                safety,
                                narrator,
                                sessionLogger
                            });
                            if (!recovered) {
                                safeChat(bot, safety, `I got stuck on step ${failed.id}.`, "planner.failed");
                                sessionLogger.warn("planner.execution.failed", "Plan execution failed", { failed });
                                const events = goalTracker.notifyEvent("planner.fatal_error", { reason: failed.reason });
                                events.forEach(e => sessionLogger.info("goal.update", "Goal failed execution", { ...e }));
                            }
                        }
                        else {
                            console.log(`[planner] Plan execution completed for goal: "${currentGoal}"`);
                            safeChat(bot, safety, "I'm done!", "planner.complete");
                            sessionLogger.info("planner.execution.complete", "Plan execution completed", { goal: currentGoal });
                            const events = goalTracker.notifyEvent("planner.success", {});
                            events.forEach(e => sessionLogger.info("goal.update", "Goal succeeded via execution", { ...e }));
                        }
                    }
                }
                catch (error) {
                    console.error(`[planner] Error generating plan:`, error);
                    safeChat(bot, safety, "My brain hurts. I couldn't make a plan.", "planner.error");
                    sessionLogger.error("planner.error", "Error generating plan", { error: error instanceof Error ? error.message : String(error) });
                    const events = goalTracker.notifyEvent("planner.fatal_error", {});
                    events.forEach(e => sessionLogger.info("goal.update", "Goal failed due to planner error", { ...e }));
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
                sessionLogger.logPerceptionSnapshot(minimal);
            }
        });
        bot.on("kicked", (reason) => {
            console.error("[bot] kicked:", reason);
            sessionLogger.error("bot.kicked", "Bot kicked", { reason: String(reason) });
            perception.stop();
            unwireChat();
            const summaryPath = reflection.writeSummaryFile();
            console.log(`[reflection] summary written to ${summaryPath}`);
            process.exit(0);
        });
        bot.on("error", (err) => {
            console.error("[bot] error:", err);
            sessionLogger.error("bot.error", "Bot encountered an error", { error: err instanceof Error ? err.message : String(err) });
        });
        bot.on("end", () => {
            perception.stop();
            unwireChat();
            const summaryPath = reflection.writeSummaryFile();
            console.log(`[reflection] summary written to ${summaryPath}`);
            sessionLogger.info("session.end", "Bot ended", { summaryPath });
        });
    });
    return bot;
}
createBot().catch(console.error);
function safeChat(bot, safety, message, source) {
    const result = safety.checkOutgoingChat(message, source);
    if (!result.allowed) {
        return;
    }
    bot.chat(result.message);
}
async function attemptRecovery(options) {
    if (!options.recipeLibrary) {
        return false;
    }
    const query = `${options.goal} ${options.failed.reason ?? ""}`.trim();
    const recipes = options.recipeLibrary.search(query).slice(0, 3);
    if (recipes.length === 0) {
        return false;
    }
    for (const recipe of recipes) {
        const context = [
            options.baseContext,
            `Recovery attempt: previous plan failed at ${options.failed.id} (${options.failed.reason ?? "unknown reason"}).`,
            options.recipeLibrary.formatRecipeFact(recipe, 8)
        ].join(" ");
        const plan = await options.planner.createPlan({
            goal: options.goal,
            perception: options.perception,
            context
        });
        if (plan.steps.length === 0) {
            continue;
        }
        const narrative = options.narrator.narrateRecovery({ intent: plan.intent, goal: options.goal, steps: plan.steps }, options.failed.id);
        if (narrative) {
            safeChat(options.bot, options.safety, narrative, "planner.narration.recovery");
            options.sessionLogger.info("planner.narration", "Recovery plan narrated", { message: narrative });
        }
        options.executor.reset();
        const results = await options.executor.executePlan(plan.steps);
        const failed = results.find(r => r.status === "failed");
        if (!failed) {
            return true;
        }
    }
    return false;
}
