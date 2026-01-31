import "dotenv/config";
import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import minecraftData from "minecraft-data";
import pathfinderPkg from "mineflayer-pathfinder";
import { plugin as movementPlugin } from "mineflayer-movement";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as toolPlugin } from "mineflayer-tool";
import { loadBotConfig, ConfigError } from "./settings/config.js";
import { PerceptionCollector } from "./perception/perception.js";
import { PerceptionSnapshot } from "./settings/types.js";
import { runSetupWizard } from "./settings/setup.js";
import { ActionExecutor } from "./actions/action-executor.js";
import { createDefaultActionHandlers, clearInventory } from "./actions/action-handlers.js";
import { wireChatBridge } from "./actions/chat/chat-commands.js";
import { ReflectionLogger } from "./logger/reflection-log.js";
import { PlannerWorkerClient } from "./planner/planner-worker-client.js";
import { SessionLogger } from "./logger/session-logger.js";
import { DebugTracer } from "./logger/debug-trace.js";
import { goalNeedsBuildSite, scoutBuildSite } from "./actions/building/scouting.js";
import { SafetyRails } from "./safety/safety-rails.js";
import { RecipeLibrary } from "./planner/knowledge.js";
import { GoalTracker, GoalDefinition, type ResearchCondition } from "./research/goals.js";
import { PlanNarrator } from "./actions/chat/narration.js";
import { MentorProtocol } from "./teamwork/mentor-protocol.js";
import { RoleManager, resolveRole, listRoleNames, type AgentRole, type MentorMode } from "./teamwork/roles.js";
import { StandbyManager, canRolePlanIndependently } from "./teamwork/standby-manager.js";
import { ResourceLockManager, resolveLeaderForGoal } from "./teamwork/coordination.js";
import {
    advancePlanningTurn,
    claimPlanningTurn,
    initTeamPlanFile,
    isTeamPlanReady,
    isTeamPlanComplete,
    getTeamPlanProgress,
    markStepsComplete,
    listClaimedSteps,
    readTeamPlanFile,
    recordTeamPlanClaim,
    releaseTeamPlanLock,
    summarizeTeamPlan,
    tryAcquireTeamPlanLock,
    writeTeamPlanFile,
    type TeamPlanFile
} from "./teamwork/team-plan.js";
import { readRoster, validateRoster, writeRoster, updateAgentInventory, teamHasItem, getRawMaterialsFor, type InventoryItem } from "./teamwork/roster.js";
import { assignStepsToAgents } from "./teamwork/step-assignment.js";
import { Vec3 } from "vec3";

const { pathfinder, Movements } = pathfinderPkg;

async function createBot()
{
    const sessionLogger = new SessionLogger();
    sessionLogger.installGlobalHandlers();
    const tracer = new DebugTracer(sessionLogger);

    const defaultPath = path.join(process.cwd(), "config", "bot.config.yaml");
    const configPath = process.env.BOT_CONFIG ?? defaultPath;

    const hfToken = process.env.HF_TOKEN;
    const hfModel = process.env.HF_MODEL ?? "ServiceNow-AI/Apriel-1.6-15b-Thinker:together";
    const hfCache = process.env.HF_CACHE_DIR;
    const hfBackend = (process.env.LLM_MODE as "local" | "remote" | "auto") ?? "auto";
    const envRole = resolveRole(process.env.BOT_ROLE);
    const envMentorMode = resolveMentorMode(process.env.BOT_MENTOR_MODE);
    const envMentorTarget = process.env.BOT_MENTOR_TARGET;
    const envAgentId = toOptionalInt(process.env.BOT_AGENT_ID);
    const envAgentCount = toOptionalInt(process.env.BOT_AGENT_COUNT);
    const envTrialId = process.env.BOT_TRIAL_ID;
    const envSeed = process.env.BOT_SEED;

    const envEnableRag = parseEnvBoolean(process.env.BOT_ENABLE_RAG);
    const envEnableNarration = parseEnvBoolean(process.env.BOT_ENABLE_NARRATION);
    const envEnableSafety = parseEnvBoolean(process.env.BOT_ENABLE_SAFETY);

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const coordinationDir = path.resolve(__dirname, ".", "teamwork", ".data");
    if (!fs.existsSync(coordinationDir)) {
        fs.mkdirSync(coordinationDir, { recursive: true });
    }
    const teamPlanPath = path.join(coordinationDir, "team-plan.json");
    const teamPlanLockPath = path.join(coordinationDir, "team-plan.lock");
    const coordinationPath = path.join(coordinationDir, "coordination.json");
    const coordinationLockPath = path.join(coordinationDir, "coordination.lock");
    const rosterPath = path.join(coordinationDir, "roster.json");
    const teamPlanLeadGraceMs = 15000;

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

    const features =
    {
        ragEnabled: envEnableRag ?? cfg.features.ragEnabled,
        narrationEnabled: envEnableNarration ?? cfg.features.narrationEnabled,
        safetyEnabled: envEnableSafety ?? cfg.features.safetyEnabled
    };

    let role: AgentRole = envRole ?? resolveRole(cfg.agent.role) ?? "generalist";

    if ((envAgentCount ?? 1) === 1 && role !== "generalist")
    {
        console.log(`[startup] Single agent session detected - overriding role "${role}" to "generalist"`);
        role = "generalist";
    }

    const mentorMode: MentorMode = envMentorMode ?? cfg.agent.mentor.mode ?? "none";
    const mentorTarget = envMentorTarget ?? cfg.agent.mentor.target;

    sessionLogger.info("startup", "MineAgent starting", {
        configPath,
        model: hfModel,
        backend: hfBackend,
        role,
        mentorMode,
        features
    });

    let safety = features.safetyEnabled ? new SafetyRails({ config: cfg.safety, logger: sessionLogger, tracer }) : undefined;
    const roleManager = new RoleManager(role);
    const mentorProtocol = new MentorProtocol({
        mode: mentorMode,
        targetName: mentorTarget,
        adviceCooldownMs: cfg.agent.mentor.adviceCooldownMs,
        requestCooldownMs: cfg.agent.mentor.requestCooldownMs
    });

    const defaultRecipePath = path.resolve(process.cwd(), "..", "..", "py", "agent", "recipes");
    const RECIPES_PATH = process.env.RECIPES_DIR ?? defaultRecipePath;
    const plannerRecipesDir = fs.existsSync(RECIPES_PATH) ? RECIPES_PATH : undefined;
    
    let recipeLibrary: RecipeLibrary | null = null;
    if (features.ragEnabled)
    {
        if (plannerRecipesDir)
        {
            console.log(`[startup] RAG Recipes enabled. Loading from: ${RECIPES_PATH}`);
            recipeLibrary = new RecipeLibrary(RECIPES_PATH);
            recipeLibrary.loadAll();
        }
        else
        {
            console.warn(`[startup] WARNING: Recipe path not found at: ${RECIPES_PATH}`);
            console.warn(`[startup] RAG will be disabled. Ensure you are running from 'apps/bot'.`);
        }
    }

    const goalTracker = new GoalTracker();
    const narrator = new PlanNarrator({ maxLength: 200, minIntervalMs: 5000 });

    const bot = mineflayer.createBot(
    {
        host: process.env.BOT_HOST ?? cfg.connection.host,
        port: toOptionalInt(process.env.BOT_PORT) ?? cfg.connection.port,
        username: process.env.BOT_NAME ?? cfg.connection.username,
        version: process.env.BOT_VERSION ?? cfg.connection.version,
    });

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(movementPlugin);
    bot.loadPlugin(collectBlock);
    bot.loadPlugin(toolPlugin);

    const standbyManager = new StandbyManager(role, bot.username);
    (bot as any).__roleName = role;

    bot.once("spawn", () =>
    {
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
        ].filter((id): id is number => id !== undefined);
        
        movements.scafoldingBlocks.push(...scafoldingItems);

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
                    recipesDir: plannerRecipesDir
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
            const def: GoalDefinition = {
                name: initialGoal,
                steps: [],
                successSignal: { type: "event", channel: "planner.success" },
                failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                timeoutMs: 600000,
                metadata: buildGoalMetadata({
                    role: roleManager.getRole(),
                    mentorMode: mentorProtocol.getConfig().mode,
                    features,
                    agentId: envAgentId,
                    agentCount: envAgentCount,
                    seed: envSeed,
                    trialId: envTrialId
                })
            };
            const id = goalTracker.addGoal(def);
            sessionLogger.info("goal.default", "Default goal configured", { goal: initialGoal, id });
            const adviceRequest = mentorProtocol.maybeRequestAdvice(initialGoal);
            if (adviceRequest)
            {
                safeChat(bot, safety, adviceRequest, "mentor.request");
            }
        }

        let isPlanning = false;
        let nextPlanningAttempt = 0;
        let currentGoal: string | null = null;
        let teamPlanWaitCount = 0;

        const agentKey = envAgentId !== null ? `agent-${envAgentId}` : `agent-${bot.username}`;
        const resourceLocks = new ResourceLockManager({
            filePath: coordinationPath,
            lockPath: coordinationLockPath,
            owner: agentKey
        });
        const handlers = createDefaultActionHandlers({ resourceLocks, tracer });
        const executor = new ActionExecutor(bot, handlers,
        {
            logger: (entry) =>
            {
                reflection.record(entry);
                const reason = entry.reason ? ` (${entry.reason})` : "";
                sessionLogger.logAction(entry);
                console.log(`[action] ${entry.action}#${entry.id} -> ${entry.status}${reason}`);
            },
            safety,
            tracer
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

        const multiAgentSession = (envAgentCount ?? 1) > 1;
        let teamPlanLeadWaitStartedAt: number | null = null;

        const ensureTeamPlan = async (goal: string, snap: PerceptionSnapshot, baseContext: string, scoutedOrigin?: { x: number, y: number, z: number }): Promise<{ plan: TeamPlanFile | null; fallbackToIndividual: boolean }> =>
        {
            if (!multiAgentSession || !planner) { return { plan: null, fallbackToIndividual: false }; }

            const existing = readTeamPlanFile(teamPlanPath);

            if (existing && existing.goal !== goal)
            {
                console.log(`[planner] Goal changed from "${existing.goal}" to "${goal}", clearing team plan...`);
                try { fs.unlinkSync(teamPlanPath); } catch {}
                try { fs.unlinkSync(teamPlanLockPath); } catch {}
            }

            if (isTeamPlanReady(existing, goal))
            {
                const allAgentsCompleted = existing.planning.mode === "agent-id"
                    && existing.planning.completedAgentIds
                    && existing.planning.agentCount
                    && existing.planning.completedAgentIds.length >= existing.planning.agentCount;

                if (allAgentsCompleted)
                {
                    console.log("[planner] Team plan fully completed, clearing for new planning cycle...");
                    try { fs.unlinkSync(teamPlanPath); } catch {}
                    try { fs.unlinkSync(teamPlanLockPath); } catch {}
                    return { plan: null, fallbackToIndividual: false };
                }

                return { plan: existing, fallbackToIndividual: false };
            }

            const currentPlan = existing as TeamPlanFile | null;

            if (currentPlan && currentPlan.goal === goal && currentPlan.status === "drafting")
            {
                return { plan: null, fallbackToIndividual: false };
            }

            const isPreferredLead = roleManager.getRole() === "supervisor";
            if (!isPreferredLead)
            {
                if (!teamPlanLeadWaitStartedAt || currentPlan?.goal !== goal)
                {
                    teamPlanLeadWaitStartedAt = Date.now();
                }
                if (Date.now() - teamPlanLeadWaitStartedAt < teamPlanLeadGraceMs)
                {
                    return { plan: null, fallbackToIndividual: false };
                }
            }

            const leaderResult = resolveLeaderForGoal({
                filePath: coordinationPath,
                lockPath: coordinationLockPath,
                goal,
                candidate: {
                    name: bot.username,
                    role: roleManager.getRole(),
                    agentId: envAgentId
                }
            });
            if (!leaderResult)
            {
                return { plan: null, fallbackToIndividual: false };
            }
            if (!leaderResult.isLeader)
            {
                return { plan: null, fallbackToIndividual: false };
            }

            if (!tryAcquireTeamPlanLock(teamPlanLockPath))
            {
                return { plan: null, fallbackToIndividual: false };
            }

            try
            {
                if (roleManager.getRole() === "supervisor")
                {
                    const roster = readRoster(rosterPath);
                    const expectedCount = envAgentCount ?? 1;

                    if (!validateRoster(roster, expectedCount))
                    {
                        console.warn("[planner] Team roster validation failed or missing");
                    }
                    else if (roster)
                    {
                        console.log("[planner] Team roster validated:", roster.agents.length, "agents");
                    }
                }

                const draft = initTeamPlanFile({
                    goal,
                    leader: {
                        name: leaderResult.leader.name,
                        role: leaderResult.leader.role as AgentRole,
                        agentId: leaderResult.leader.agentId
                    },
                    agentCount: envAgentCount,
                    origin: scoutedOrigin
                });
                writeTeamPlanFile(teamPlanPath, draft);
                safeChat(bot, safety, `Drafting team plan for "${goal}"...`, "team.plan.draft");

                const teamPlanContext = `${baseContext} You are the team lead. Produce a shared plan with role assignments.`;
                const plan = await planner.createPlan({
                    goal,
                    perception: snap,
                    context: teamPlanContext,
                    ragEnabled: features.ragEnabled,
                    planningMode: "team"
                });

                const resolvedTeamPlan = plan.teamPlan ?? { intent: plan.intent, steps: plan.steps };
                let readyPlan: TeamPlanFile = {
                    ...draft,
                    status: "ready",
                    teamPlan: resolvedTeamPlan,
                    updatedAt: new Date().toISOString()
                };

                if (draft.planning.mode === "supervisor-assigned" && resolvedTeamPlan)
                {
                    const roster = readRoster(rosterPath);
                    if (roster)
                    {
                        let steps = (resolvedTeamPlan as any).steps;
                        if (Array.isArray(steps))
                        {
                            const stepsToInsert: { index: number; step: any }[] = [];

                            for (let i = 0; i < steps.length; i++)
                            {
                                const step = steps[i];
                                if (step.action === "craft")
                                {
                                    const recipe = step.params?.recipe ?? step.description ?? "";
                                    const rawMaterials = getRawMaterialsFor(recipe);

                                    if (rawMaterials)
                                    {
                                        for (const mat of rawMaterials)
                                        {
                                            if (!teamHasItem(roster, mat.material, mat.count))
                                            {
                                                console.log(`[planner] Team missing ${mat.count} ${mat.material} for crafting ${recipe} - injecting gather step`);
                                                stepsToInsert.push({
                                                    index: i,
                                                    step: {
                                                        id: `gather-${mat.material}-${Date.now()}`,
                                                        action: "gather",
                                                        params: { item: mat.material },
                                                        description: `Gather ${mat.material} for crafting ${recipe}`,
                                                        owner_role: "gatherer"
                                                    }
                                                });
                                            }
                                        }
                                    }
                                }
                            }

                            for (const insertion of stepsToInsert.reverse())
                            {
                                steps.splice(insertion.index, 0, insertion.step);
                            }

                            if (stepsToInsert.length > 0)
                            {
                                console.log(`[planner] Injected ${stepsToInsert.length} gather steps for missing materials`);
                                (resolvedTeamPlan as any).steps = steps;
                            }

                            const { assignments, unassigned } = assignStepsToAgents(steps, roster);

                            if (unassigned.length > 0)
                            {
                                console.warn(`[planner] Warning: ${unassigned.length} steps could not be assigned:`, unassigned);
                            }

                            readyPlan.assignments = assignments;
                            console.log("[planner] Supervisor assigned steps:", assignments);
                        }
                    }
                }

                writeTeamPlanFile(teamPlanPath, readyPlan);
                safeChat(bot, safety, summarizeTeamPlan(readyPlan), "team.plan.ready");
                return { plan: readyPlan, fallbackToIndividual: false };
            }
            catch (error)
            {
                console.error("[planner] Team plan generation failed:", error);
                safeChat(bot, safety, "Team plan failed; falling back to individual planning.", "team.plan.error");
                // Clean up stale draft so other agents don't spin waiting for it
                try { fs.unlinkSync(teamPlanPath); } catch {}
                try { fs.unlinkSync(teamPlanLockPath); } catch {}
                return { plan: null, fallbackToIndividual: true };
            }
            finally
            {
                releaseTeamPlanLock(teamPlanLockPath);
            }
        };

        bot.on("chat", async (username, message) =>
        {
            if (username === bot.username) { return; }

            const myTag = `@${bot.username}`;
            const isAddressedToMe = message.includes(myTag);
            if (message.includes("@") && !isAddressedToMe) { return; }
            
            const cleanMessage = message.replace(myTag, "").trim();

            if (cleanMessage.startsWith("!goal "))
            {
                const newGoal = cleanMessage.replace("!goal ", "").trim();
                console.log(`[bot] Goal received via chat: "${newGoal}"`);

                standbyManager.resetAwaitingTeamPlan();
                teamPlanWaitCount = 0;

                const def: GoalDefinition = {
                    name: newGoal,
                    steps: [],
                    successSignal: { type: "event", channel: "planner.success" },
                    failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                    timeoutMs: 600000,
                    metadata: buildGoalMetadata({
                        role: roleManager.getRole(),
                        mentorMode: mentorProtocol.getConfig().mode,
                        features,
                        agentId: envAgentId,
                        agentCount: envAgentCount,
                        seed: envSeed,
                        trialId: envTrialId
                    })
                };

                const goalId = goalTracker.addGoal(def);
                sessionLogger.info("goal.added", "Goal added via chat", { goal: newGoal, id: goalId });

                if (multiAgentSession && standbyManager.isSpecialistRole())
                {
                    safeChat(bot, safety, `Goal acknowledged: ${newGoal}. Waiting for team plan...`, "goal.accept.specialist");
                    standbyManager.enterStandby(bot, "Specialist waiting for team plan");
                    sessionLogger.info("goal.standby", "Specialist entering standby for team plan", {
                        goal: newGoal,
                        role: roleManager.getRole()
                    });
                }
                else
                {
                    safeChat(bot, safety, `Goal accepted: ${newGoal}`, "goal.accept");
                    standbyManager.exitStandby("Goal received - ready to plan");

                    const adviceRequest = mentorProtocol.maybeRequestAdvice(newGoal);
                    if (adviceRequest)
                    {
                        safeChat(bot, safety, adviceRequest, "mentor.request");
                    }
                }
                return;
            }

            if (cleanMessage.startsWith("!role "))
            {
                const rawRole = cleanMessage.replace("!role ", "").trim();
                const nextRole = resolveRole(rawRole);
                if (!nextRole)
                {
                    safeChat(bot, safety, `Unknown role. Available: ${listRoleNames().join(", ")}`, "role.error");
                    return;
                }

                roleManager.setRole(nextRole);
                standbyManager.setRole(nextRole);
                standbyManager.resetAnnouncementFlag();
                sessionLogger.info("role.update", "Role updated via chat", { from: username, role: nextRole });
                safeChat(bot, safety, `Role updated to ${nextRole}.`, "role.update");
                return;
            }

            if (cleanMessage.startsWith("!mentor "))
            {
                const args = cleanMessage.replace("!mentor ", "").trim().split(/\s+/);
                const mode = resolveMentorMode(args[0]);
                if (!mode)
                {
                    safeChat(bot, safety, "Usage: !mentor <none|teacher|learner> [targetName]", "mentor.usage");
                    return;
                }

                const targetName = args[1];
                mentorProtocol.updateConfig({ mode, targetName });
                sessionLogger.info("mentor.update", "Mentor mode updated via chat", { from: username, mode, targetName });
                safeChat(bot, safety, `Mentor mode updated to ${mode}${targetName ? ` (target ${targetName})` : ""}.`, "mentor.update");
                return;
            }

            if (cleanMessage.startsWith("!feature "))
            {
                const args = cleanMessage.replace("!feature ", "").trim().split(/\s+/);
                const featureName = args[0]?.toLowerCase();
                const enabled = parseEnvBoolean(args[1]);
                if (!featureName || enabled === null)
                {
                    safeChat(bot, safety, "Usage: !feature <rag|narration|safety> <on|off>", "feature.usage");
                    return;
                }

                switch (featureName)
                {
                    case "rag":
                        features.ragEnabled = enabled;
                        if (!enabled)
                        {
                            recipeLibrary = null;
                        }
                        else if (!recipeLibrary)
                        {
                            if (plannerRecipesDir)
                            {
                                recipeLibrary = new RecipeLibrary(RECIPES_PATH);
                                recipeLibrary.loadAll();
                            }
                            else
                            {
                                console.warn(`[startup] WARNING: Recipe path not found at: ${RECIPES_PATH}`);
                            }
                        }
                        sessionLogger.info("feature.update", "RAG toggled via chat", { enabled });
                        safeChat(bot, safety, `RAG ${enabled ? "enabled" : "disabled"}.`, "feature.update");
                        break;
                    case "narration":
                        features.narrationEnabled = enabled;
                        sessionLogger.info("feature.update", "Narration toggled via chat", { enabled });
                        safeChat(bot, safety, `Narration ${enabled ? "enabled" : "disabled"}.`, "feature.update");
                        break;
                    case "safety":
                        features.safetyEnabled = enabled;
                        safety = enabled ? new SafetyRails({ config: cfg.safety, logger: sessionLogger, tracer }) : undefined;
                        executor.setSafety(safety);
                        sessionLogger.info("feature.update", "Safety toggled via chat", { enabled });
                        safeChat(bot, safety, `Safety rails ${enabled ? "enabled" : "disabled"}.`, "feature.update");
                        break;
                    default:
                        safeChat(bot, safety, "Usage: !feature <rag|narration|safety> <on|off>", "feature.usage");
                        break;
                }
                return;
            }

            if (cleanMessage === "!reset")
            {
                console.log(`[bot] Inventory reset requested by ${username}`);
                sessionLogger.info("command.reset", "Inventory reset requested", { from: username });

                try
                {
                    await clearInventory(bot);
                    safeChat(bot, safety, "Inventory cleared. Starting fresh!", "command.reset.success");
                }
                catch (err)
                {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    safeChat(bot, safety, `Failed to clear inventory: ${errMsg}`, "command.reset.error");
                }
                return;
            }

            if (standbyManager.shouldRespondToMessage(cleanMessage, username))
            {
                const resourceRequest = standbyManager.parseResourceRequest(cleanMessage);
                if (resourceRequest)
                {
                    const responseGoal = standbyManager.buildResponseGoal(resourceRequest);
                    console.log(`[standby] Responding to team request with goal: ${responseGoal}`);

                    standbyManager.startResponding();

                    const def: GoalDefinition = {
                        name: responseGoal,
                        steps: [],
                        successSignal: { type: "event", channel: "planner.success" },
                        failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                        timeoutMs: 300000,
                        metadata: buildGoalMetadata({
                            role: roleManager.getRole(),
                            mentorMode: mentorProtocol.getConfig().mode,
                            features,
                            agentId: envAgentId,
                            agentCount: envAgentCount,
                            seed: envSeed,
                            trialId: envTrialId
                        })
                    };

                    goalTracker.addGoal(def);
                    safeChat(bot, safety, `Responding to ${resourceRequest.requester}'s request for ${resourceRequest.item}`, "standby.respond");
                    return;
                }
            }

            const mentorReply = mentorProtocol.handleChat(cleanMessage,
            {
                role: roleManager.getDefinition(),
                goal: currentGoal,
                sender: username
            });
            if (mentorReply)
            {
                safeChat(bot, safety, mentorReply, "mentor.reply");
            }
        });

        perception.start(async (snap: PerceptionSnapshot) =>
        {
            const goalEvents = goalTracker.ingestSnapshot(snap);
            for (const event of goalEvents) {
                console.log(`[goal] ${event.name} -> ${event.status} (${event.reason})`);
                sessionLogger.info("goal.update", "Goal status changed", { id: event.id, name: event.name, status: event.status, reason: event.reason, durationMs: event.durationMs });
                
                if (event.status === "pass") {
                    safeChat(bot, safety, `Goal complete: ${event.name} (${Math.round((event.durationMs ?? 0)/1000)}s)`, "goal.success");
                } else if (event.status === "fail") {
                    safeChat(bot, safety, `Goal failed: ${event.name} - ${event.reason}`, "goal.fail");
                }
            }

            const activeGoalObj = (goalTracker as any).goals.values().next().value;
            currentGoal = (activeGoalObj && activeGoalObj.status === "pending") ? activeGoalObj.definition.name : null;

            if (!currentGoal && !isPlanning && standbyManager.getState() !== "standby")
            {
                standbyManager.enterStandby(bot, "No active goals");
            }
            else if (currentGoal && standbyManager.getState() === "standby")
            {
                if (roleManager.getRole() === "supervisor" && multiAgentSession)
                {
                    const latestPlan = readTeamPlanFile(teamPlanPath);
                    if (latestPlan && latestPlan.goal === currentGoal)
                    {
                        if (isTeamPlanComplete(latestPlan))
                        {
                            console.log("[supervisor] All team plan steps complete - marking goal as success");
                            safeChat(bot, safety, "All team tasks complete! Goal achieved.", "supervisor.complete");
                            const events = goalTracker.notifyEvent("planner.success", {});
                            events.forEach(e => sessionLogger.info("goal.update", "Goal succeeded via full team execution", { ...e }));
                            standbyManager.exitStandby("Team plan completed");
                        }
                        else
                        {
                            const progress = getTeamPlanProgress(latestPlan);
                            if (Date.now() % 10000 < 100)
                            {
                                console.log(`[supervisor] Monitoring: ${progress.success}/${progress.total} steps complete, ${progress.failed} failed`);
                            }
                        }
                    }
                }
                else if (!standbyManager.isAwaitingTeamPlan())
                {
                    standbyManager.exitStandby("New goal received");
                }
            }

            if (currentGoal && !isPlanning && planner && Date.now() >= nextPlanningAttempt)
            {
                if (multiAgentSession && standbyManager.isAwaitingTeamPlan())
                {
                    const existingPlan = readTeamPlanFile(teamPlanPath);
                    const hasAssignments = existingPlan?.assignments?.[agentKey]?.length ?? 0;

                    if (!isTeamPlanReady(existingPlan, currentGoal) || hasAssignments === 0)
                    {
                        teamPlanWaitCount++;
                        if (teamPlanWaitCount > 60)
                        {
                            console.warn(`[planner] Gave up waiting for team plan after ${teamPlanWaitCount} attempts, falling back to individual planning`);
                            standbyManager.acknowledgeTeamPlan();
                            standbyManager.exitStandby("Team plan wait timeout - falling back to individual planning");
                            teamPlanWaitCount = 0;
                        }
                        else
                        {
                            if (Date.now() % 5000 < 100)
                            {
                                console.log(`[planner] ${roleManager.getRole()} waiting for team plan assignments... (attempt ${teamPlanWaitCount}/60)`);
                            }
                            nextPlanningAttempt = Date.now() + 1000;
                            return;
                        }
                    }

                    console.log(`[planner] Team plan ready with ${hasAssignments} assignments for ${roleManager.getRole()}`);
                    standbyManager.acknowledgeTeamPlan();
                    standbyManager.exitStandby("Team plan received with assignments");
                }

                isPlanning = true;
                console.log(`[planner] Generating plan with ${planner.modelName} for goal: "${currentGoal}"...`);
                sessionLogger.info("planner.start", "Generating plan", { goal: currentGoal, tickId: snap.tickId });

                let activeTeamPlan: TeamPlanFile | null = null;
                let claimedTeamTurn = false;
                let wroteTeamPlan = false;

                try {
                    let context = "You are currently in the game. React immediately.";
                    const roleContext = roleManager.buildPlannerContext();
                    if (roleContext) { context += ` ${roleContext}`; }
                    const standbyContext = standbyManager.buildStandbyContext();
                    if (standbyContext) { context += ` ${standbyContext}`; }

                    const mentorContext = roleManager.buildMentorContext(mentorProtocol.getConfig().mode);
                    if (mentorContext) { context += ` ${mentorContext}`; }

                    let site = null;
                    if (goalNeedsBuildSite(currentGoal)) {
                        const existingPlan = readTeamPlanFile(teamPlanPath);

                        if (existingPlan && existingPlan.goal === currentGoal && existingPlan.sharedOrigin) {
                            const o = existingPlan.sharedOrigin;
                            console.log(`[planner] Using shared build site from team plan: ${o.x},${o.y},${o.z}`);
                            site = {
                                origin: new Vec3(o.x, o.y, o.z),
                                size: 7, radius: 0, flatness: 0, coverage: 1
                            };
                        } else {
                            site = scoutBuildSite(bot, currentGoal);
                        }

                        if (site) {
                            context += ` Scouted build site: origin (${site.origin.x}, ${site.origin.y}, ${site.origin.z}), size ${site.size}x${site.size}, flatness ${site.flatness}, coverage ${Math.round(site.coverage * 100)}%, distance ${site.radius}. Move there before building.`;
                            sessionLogger.info("planner.scout.site", "Scouted build site", { goal: currentGoal, site });
                        } else {
                            context += " Scouting report: no suitable flat build site found nearby. Consider clearing or leveling terrain.";
                            sessionLogger.warn("planner.scout.none", "No suitable build site found", { goal: currentGoal });
                        }
                    }

                    console.log("[planner] Context prepared. Checking multi-agent session...");

                    let planningMode: "single" | "individual" = "single";
                    let claimedSteps: string[] | undefined;
                    let assignedSteps: string[] | undefined;
                    if (multiAgentSession)
                    {
                        const teamPlanResult = await ensureTeamPlan(
                            currentGoal,
                            snap,
                            context,
                            site?.origin
                        );
                        activeTeamPlan = teamPlanResult.plan;

                        if (!activeTeamPlan && !teamPlanResult.fallbackToIndividual)
                        {
                            teamPlanWaitCount++;
                            if (teamPlanWaitCount > 60)
                            {
                                console.warn(`[planner] Gave up waiting for team plan after ${teamPlanWaitCount} attempts, proceeding individually`);
                                teamPlanWaitCount = 0;
                            }
                            else
                            {
                                console.log(`[planner] Waiting for team plan availability... (attempt ${teamPlanWaitCount}/60)`);
                                nextPlanningAttempt = Date.now() + 500;
                                return;
                            }
                        }

                        if (activeTeamPlan)
                        {
                            if (activeTeamPlan.planning.mode === "supervisor-assigned")
                            {
                                claimedTeamTurn = false;
                                planningMode = "individual";
                                assignedSteps = activeTeamPlan.assignments?.[agentKey] ?? [];
                                console.log(`[planner] My assigned steps:`, assignedSteps);
                                context += " Execute your assigned tasks from the supervisor.";
                            }
                            else
                            {
                                const claimResult = claimPlanningTurn(activeTeamPlan, agentKey, envAgentId);
                                activeTeamPlan = claimResult.plan;
                                if (activeTeamPlan.planning.mode === "name-lock")
                                {
                                    writeTeamPlanFile(teamPlanPath, activeTeamPlan);
                                    wroteTeamPlan = true;
                                }
                                if (!claimResult.allowed)
                                {
                                    console.log("[planner] Waiting for my planning turn...");
                                    nextPlanningAttempt = Date.now() + 1000;
                                    return;
                                }
                                claimedTeamTurn = true;
                                planningMode = "individual";
                                claimedSteps = listClaimedSteps(activeTeamPlan);
                                context += " Coordinate with the shared team plan and respect assigned roles.";
                            }
                        }
                    }

                    console.log("[planner] Calling createPlan...");
                    const plan = await planner.createPlan({
                        goal: currentGoal,
                        perception: snap,
                        context,
                        ragEnabled: features.ragEnabled,
                        teamPlan: activeTeamPlan?.teamPlan ?? undefined,
                        claimedSteps,
                        assignedSteps,
                        planningMode
                    });
                    console.log("[planner] createPlan returned.");

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
                    sessionLogger.info("planner.result", "Plan generated", { intent: plan.intent, steps: plan.steps, backend: plan.backend, model: plan.model });

                    if (plan.steps.length === 0)
                    {
                        console.warn("[planner] Plan contained no steps; clearing goal.");
                        safeChat(bot, safety, "I couldn't figure out how to do that.", "planner.empty");
                        
                        const events = goalTracker.notifyEvent("planner.fatal_error", {});
                        events.forEach(e => sessionLogger.info("goal.update", "Goal failed due to empty plan", { ...e }));
                    }
                    else
                    {
                        if (activeTeamPlan)
                        {
                            let claimIds = plan.claimedStepIds ?? [];

                            if (activeTeamPlan.planning.mode === "supervisor-assigned")
                            {
                                const assignedRaw = activeTeamPlan.assignments?.[agentKey] ?? [];
                                const assigned = assignedRaw.map((id: unknown) => String(id));
                                const invalidClaims = claimIds.filter(id => !assigned.includes(String(id)));

                                if (invalidClaims.length > 0)
                                {
                                    console.error(`[planner] ERROR: Agent tried to claim non-assigned steps:`, invalidClaims);
                                    console.error(`[planner] Assigned steps were:`, assigned);
                                    claimIds = claimIds.filter(id => assigned.includes(String(id)));
                                }

                                const originalStepCount = plan.steps.length;
                                plan.steps = plan.steps.filter(step =>
                                    step.action === "chat" || assigned.includes(String(step.id))
                                );

                                const filteredCount = originalStepCount - plan.steps.length;
                                if (filteredCount > 0)
                                {
                                    console.warn(`[planner] ENFORCED: Filtered out ${filteredCount} non-assigned steps from execution`);
                                    sessionLogger.warn("planner.assignment.enforced", "Filtered non-assigned steps", {
                                        agent: agentKey,
                                        assigned,
                                        originalCount: originalStepCount,
                                        filteredCount,
                                        remainingSteps: plan.steps.map(s => s.id)
                                    });
                                }
                            }

                            const claimSummary = claimIds.length > 0 ? claimIds.join(", ") : "support tasks";
                            const claimMessage = `[team] ${bot.username} (${roleManager.getRole()}) claiming: ${claimSummary}`;
                            const hasClaimChat = plan.steps.some(step =>
                                step.action === "chat" &&
                                typeof step.params?.message === "string" &&
                                step.params.message.toLowerCase().includes("claim"));
                            if (!hasClaimChat)
                            {
                                plan.steps.unshift({
                                    id: `team-claim-${Date.now()}`,
                                    action: "chat",
                                    params: { message: claimMessage },
                                    description: "Announce claimed team plan steps"
                                });
                            }
                            if (claimIds.length > 0)
                            {
                                activeTeamPlan = recordTeamPlanClaim(activeTeamPlan, agentKey, claimIds);
                                writeTeamPlanFile(teamPlanPath, activeTeamPlan);
                                wroteTeamPlan = true;
                            }
                        }

                        if (features.narrationEnabled)
                        {
                            const narrative = narrator.maybeNarrate({ intent: plan.intent, goal: currentGoal, steps: plan.steps });
                            if (narrative) {
                                safeChat(bot, safety, narrative, "planner.narration");
                                sessionLogger.info("planner.narration", "Plan narrated", { message: narrative });
                            }
                        }

                        if (roleManager.getRole() === "builder" || roleManager.getRole() === "generalist")
                        {
                            const buildSteps = plan.steps.filter((s: any) => s.action === "build");
                            for (const step of buildSteps)
                            {
                                const params = (step as any).params ?? {};
                                const material = params.material ?? "oak_planks";
                                const width = params.width ?? 5;
                                const length = params.length ?? 5;
                                const height = params.height ?? 3;
                                const structure = params.structure ?? "platform";

                                let estimatedNeeded = 0;
                                if (structure === "platform") estimatedNeeded = width * length;
                                else if (structure === "walls") estimatedNeeded = (width * 2 + length * 2) * height;
                                else if (structure === "wall") estimatedNeeded = width * height;
                                else if (structure === "roof") estimatedNeeded = width * length;
                                else estimatedNeeded = 20;

                                const inventoryItems = bot.inventory.items();
                                const materialLower = material.toLowerCase();
                                const materialNormalized = materialLower.replace(/_/g, "");

                                let materialCount = 0;
                                for (const item of inventoryItems)
                                {
                                    const itemName = item.name.toLowerCase();
                                    const itemNormalized = itemName.replace(/_/g, "");

                                    if (itemName === materialLower ||
                                        itemNormalized.includes(materialNormalized) ||
                                        materialNormalized.includes(itemNormalized))
                                    {
                                        materialCount += item.count;
                                    }
                                }

                                console.log(`[builder] Material check for '${material}': found ${materialCount} items, need ${estimatedNeeded}`);

                                if (materialCount < estimatedNeeded)
                                {
                                    const deficit = estimatedNeeded - materialCount;
                                    console.log(`[builder] Material shortage: need ${estimatedNeeded} ${material}, have ${materialCount}`);
                                    safeChat(bot, safety, `[team] ${bot.username} (${roleManager.getRole()}) needs ${deficit} ${material}`, "builder.material_request");
                                }
                                else
                                {
                                    console.log(`[builder] Material sufficient: have ${materialCount} ${material}, need ${estimatedNeeded}`);
                                }
                            }
                        }

                        executor.reset();

                        const results = await executor.executePlan(plan.steps);
                        const failed = results.find(r => r.status === "failed");
                        const succeeded = results.filter(r => r.status === "success").map(r => r.id);
                        const failedIds = results.filter(r => r.status === "failed").map(r => r.id);

                        if (activeTeamPlan && multiAgentSession)
                        {
                            let updatedPlan = activeTeamPlan;
                            if (succeeded.length > 0)
                            {
                                updatedPlan = markStepsComplete(updatedPlan, succeeded, "success");
                            }
                            if (failedIds.length > 0)
                            {
                                updatedPlan = markStepsComplete(updatedPlan, failedIds, "failed", failed?.reason);
                            }
                            writeTeamPlanFile(teamPlanPath, updatedPlan);
                            wroteTeamPlan = true;

                            const progress = getTeamPlanProgress(updatedPlan);
                            console.log(`[planner] Team plan progress: ${progress.success}/${progress.total} complete, ${progress.failed} failed`);
                            sessionLogger.info("team.plan.progress", "Team plan progress updated", progress);
                        }

                        if (failed)
                        {
                            console.warn(`[planner] Plan execution failed at ${failed.id}: ${failed.reason ?? "unknown reason"}`);
                            const recovered = await attemptRecovery({
                                bot,
                                planner,
                                executor,
                                recipeLibrary,
                                ragEnabled: features.ragEnabled,
                                narrationEnabled: features.narrationEnabled,
                                goal: currentGoal,
                                perception: snap,
                                baseContext: context,
                                failed,
                                safety,
                                narrator,
                                sessionLogger
                            });

                            if (!recovered)
                            {
                                safeChat(bot, safety, `I got stuck on step ${failed.id}.`, "planner.failed");
                                sessionLogger.warn("planner.execution.failed", "Plan execution failed", { failed });

                                if (roleManager.getRole() !== "supervisor")
                                {
                                    const events = goalTracker.notifyEvent("planner.fatal_error", { reason: failed.reason });
                                    events.forEach(e => sessionLogger.info("goal.update", "Goal failed execution", { ...e }));
                                }
                            }
                        }
                        else
                        {
                            console.log(`[planner] Plan execution completed for goal: "${currentGoal}"`);

                            if (roleManager.getRole() === "supervisor" && multiAgentSession)
                            {
                                const latestPlan = readTeamPlanFile(teamPlanPath);
                                if (latestPlan && !isTeamPlanComplete(latestPlan))
                                {
                                    const progress = getTeamPlanProgress(latestPlan);
                                    safeChat(bot, safety, `My tasks done. Monitoring team... (${progress.success}/${progress.total} steps complete)`, "supervisor.monitoring");
                                    sessionLogger.info("supervisor.monitoring", "Supervisor waiting for team completion", progress);
                                    standbyManager.enterStandby(bot, "Supervisor monitoring team progress");
                                }
                                else if (latestPlan && isTeamPlanComplete(latestPlan))
                                {
                                    safeChat(bot, safety, "All team tasks complete! Goal achieved.", "planner.complete");
                                    sessionLogger.info("planner.execution.complete", "Full team plan completed", { goal: currentGoal });
                                    const events = goalTracker.notifyEvent("planner.success", {});
                                    events.forEach(e => sessionLogger.info("goal.update", "Goal succeeded via full team execution", { ...e }));
                                }
                                else
                                {
                                    safeChat(bot, safety, "I'm done!", "planner.complete");
                                    const events = goalTracker.notifyEvent("planner.success", {});
                                    events.forEach(e => sessionLogger.info("goal.update", "Goal succeeded via execution", { ...e }));
                                }
                            }
                            else
                            {
                                safeChat(bot, safety, "I'm done!", "planner.complete");
                                sessionLogger.info("planner.execution.complete", "Plan execution completed", { goal: currentGoal });

                                if (!multiAgentSession)
                                {
                                    const events = goalTracker.notifyEvent("planner.success", {});
                                    events.forEach(e => sessionLogger.info("goal.update", "Goal succeeded via execution", { ...e }));
                                }
                            }
                        }
                    }
                } catch (error) {
                    try {
                        const errMsg = error instanceof Error ? error.message : String(error);
                        console.error(`[planner] CRITICAL ERROR: ${errMsg}`);
                        console.error(error); 
                        
                        sessionLogger.error("planner.error", "Error generating plan", { error: errMsg });
                        
                        try {
                            safeChat(bot, safety, "My brain hurts. I couldn't make a plan.", "planner.error");
                        } catch (chatErr) {
                            console.error("[planner] Failed to chat error message:", chatErr);
                        }
                        
                        const events = goalTracker.notifyEvent("planner.fatal_error", {});
                        events.forEach(e => sessionLogger.info("goal.update", "Goal failed due to planner error", { ...e }));
                    } catch (loggingError) {
                        console.error("[planner] DOUBLE FAULT: Error handler crashed:", loggingError);
                    }
                    
                    nextPlanningAttempt = Date.now() + 5000;
                    console.log("[planner] Backing off for 5 seconds...");
                } finally {
                    if (activeTeamPlan && claimedTeamTurn && activeTeamPlan.planning.mode !== "supervisor-assigned")
                    {
                        const advanced = advancePlanningTurn(activeTeamPlan, agentKey, envAgentId);
                        writeTeamPlanFile(teamPlanPath, advanced);
                        wroteTeamPlan = true;
                    }
                    if (wroteTeamPlan)
                    {
                        sessionLogger.info("team.plan.update", "Team plan updated", { goal: currentGoal, agentKey });
                    }
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
                    inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })),
                    nearby: snap.nearby.entities.slice(0, 3).map(e => ({ kind: e.kind, name: e.name, d: e.distance })),
                    hazards: snap.hazards
                };
                sessionLogger.logPerceptionSnapshot(minimal);

                if (multiAgentSession)
                {
                    try
                    {
                        const roster = readRoster(rosterPath);
                        if (roster)
                        {
                            const invItems: InventoryItem[] = bot.inventory.items().map(item => ({
                                name: item.name,
                                count: item.count
                            }));
                            const updatedRoster = updateAgentInventory(roster, agentKey, invItems);
                            writeRoster(rosterPath, updatedRoster);
                        }
                    }
                    catch (err) { }
                }
            }
        });

        bot.on("kicked", (reason: any) =>
        {
            console.error("[bot] kicked:", reason);
            sessionLogger.error("bot.kicked", "Bot kicked", { reason: String(reason) });
            perception.stop();
            unwireChat();
            const summaryPath = reflection.writeSummaryFile();
            console.log(`[reflection] summary written to ${summaryPath}`);
            process.exit(0); 
        });

        bot.on("error", (err: any) =>
        {
            console.error("[bot] error:", err);
            sessionLogger.error("bot.error", "Bot encountered an error", { error: err instanceof Error ? err.message : String(err) });
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

    return bot;
}

createBot().catch(console.error);

type FeatureFlags =
{
    ragEnabled: boolean;
    narrationEnabled: boolean;
    safetyEnabled: boolean;
};

function parseEnvBoolean(value?: string): boolean | null
{
    if (value === undefined)  { return null; }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized))  { return true; }

    if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) { return false; }

    return null;
}

function toOptionalInt(value?: string): number | null
{
    if (!value) { return null; }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolveMentorMode(value?: string | null): MentorMode | null
{
    if (!value) { return null; }

    const normalized = value.trim().toLowerCase();
    if (["none", "off", "disabled"].includes(normalized)) { return "none"; }
    if (["teacher", "mentor"].includes(normalized)) { return "teacher"; }
    if (["learner", "student"].includes(normalized)) { return "learner"; }

    return null;
}

function buildGoalMetadata(options:
{
    role: AgentRole;
    mentorMode: MentorMode;
    features: FeatureFlags;
    agentId: number | null;
    agentCount: number | null;
    seed: string | undefined;
    trialId: string | undefined;
}): GoalDefinition["metadata"]
{
    const condition: ResearchCondition =
    {
        role: options.role,
        mentorMode: options.mentorMode,
        ragEnabled: options.features.ragEnabled,
        narrationEnabled: options.features.narrationEnabled,
        safetyEnabled: options.features.safetyEnabled
    };

    if (options.agentId !== null) { condition.agentId = options.agentId; }
    if (options.agentCount !== null) { condition.agentCount = options.agentCount; }
    if (options.seed) { condition.seed = options.seed; }
    if (options.trialId)  { condition.trialId = options.trialId; }

    return { condition };
}

function safeChat(bot: Bot, safety: SafetyRails | undefined, message: string, source: string): void
{
    if (!safety)
    {
        bot.chat(message);
        return;
    }

    const result = safety.checkOutgoingChat(message, source);
    if (!result.allowed) { return; }

    bot.chat(result.message);
}

async function attemptRecovery(options:
{
    bot: Bot;
    planner: PlannerWorkerClient;
    executor: ActionExecutor;
    recipeLibrary: RecipeLibrary | null;
    ragEnabled: boolean;
    narrationEnabled: boolean;
    goal: string;
    perception: PerceptionSnapshot;
    baseContext: string;
    failed: { id: string; reason?: string };
    safety: SafetyRails | undefined;
    narrator: PlanNarrator;
    sessionLogger: SessionLogger;
}): Promise<boolean>
{
    if (!options.recipeLibrary) { return false; }

    const query = `${options.goal} ${options.failed.reason ?? ""}`.trim();
    const recipes = options.recipeLibrary.search(query).slice(0, 3);
    if (recipes.length === 0) { return false; }

    for (const recipe of recipes)
    {
        const context = [
            options.baseContext,
            `Recovery attempt: previous plan failed at ${options.failed.id} (${options.failed.reason ?? "unknown reason"}).`,
            options.recipeLibrary.formatRecipeFact(recipe, 8)
        ].join(" ");

        const plan = await options.planner.createPlan({
            goal: options.goal,
            perception: options.perception,
            context,
            ragEnabled: options.ragEnabled
        });

        if (plan.steps.length === 0) { continue; }

        if (options.narrationEnabled)
        {
            const narrative = options.narrator.narrateRecovery({ intent: plan.intent, goal: options.goal, steps: plan.steps }, options.failed.id);
            if (narrative) {
                safeChat(options.bot, options.safety, narrative, "planner.narration.recovery");
                options.sessionLogger.info("planner.narration", "Recovery plan narrated", { message: narrative });
            }
        }

        options.executor.reset();
        const results = await options.executor.executePlan(plan.steps);
        const failed = results.find(r => r.status === "failed");
        if (!failed) { return true; }
    }
    return false;
}