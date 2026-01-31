import type { PerceptionSnapshot } from "../settings/types.js";
import type { ActionStep } from "../actions/action-executor.js";
import type { SessionLogger } from "../logger/session-logger.js";
import type { DebugTracer } from "../logger/debug-trace.js";
import { RecipeLibrary } from "./knowledge.js";

export interface PlanRequest
{
    goal: string;
    perception?: PerceptionSnapshot;
    context?: string;
    ragEnabled?: boolean;
    teamPlan?: unknown;
    claimedSteps?: string[];
    assignedSteps?: string[];
    planningMode?: "single" | "team" | "individual";
}

export interface PlanResult
{
    intent: string;
    steps: ActionStep[];
    model: string;
    backend: "local" | "remote";
    raw: string;
    knowledgeUsed?: string[];
    teamPlan?: unknown;
    claimedStepIds?: string[];
}

const SUPPORTED_ACTIONS: Record<string, string> =
{
    chat: "Send a chat message. params: { message }",
    perceive: "Check inventory or surroundings. params: { check: string }",
    craft: "Craft an item. params: { recipe: string, count?: number, craftingTable?: {x,y,z} }", 
    move: "Move. params: { position:{x,y,z} } or { entityName?: string, range?: number }",
    mine: "Break block. params: { block?:string, position:{x,y,z} }",
    gather: "Collect items by mining, looting chests, or picking drops. params: { item?:string }",
    build: "Place structure. params: { structure: 'platform'|'wall'|'walls'|'tower'|'roof'|'door', origin?:{x,y,z}, material?:string, width?:number, height?:number, length?:number, door?:boolean }",
    loot: "Open a nearby chest and inspect/withdraw contents. params: { position?:{x,y,z}, maxDistance?: number, item?: string, count?: number }",
    eat: "Eat a food item from inventory. params: { item?: string }",
    smith: "Use an anvil to combine or rename items. params: { item1: string, item2?: string, name?: string }",
    hunt: "Hunt mob.",
    fight: "Fight mob.",
    fish: "Fish.",
    give: "Give items to a teammate. params: { target: string, item: string, count?: number, method?: 'drop'|'chest' }",
    drop: "Drop items on ground. params: { item?: string, count?: number } - use item:'all' to drop everything",
    requestResource: "Request items from team via chat. params: { item: string, count?: number, urgent?: boolean }",
    pickup: "Pick up nearby dropped items. params: { item?: string }"
};

export interface HuggingFacePlannerOptions
{
    model: string;
    temperature: number;
    maxTokens: number;
    cacheDir?: string;
    device?: "auto" | "cpu" | "gpu";
    token?: string;
    inferenceEndpoint?: string;
    backend?: "auto" | "local" | "remote";
    quantized?: boolean;
    remoteMode?: "inference_api" | "hf_api";
    logger?: SessionLogger;
    tracer?: DebugTracer;
    recipesDir?: string;
}

export class HuggingFacePlanner
{
    private readonly options: HuggingFacePlannerOptions;
    private readonly generatorPromise: Promise<{ generate: (prompt: string) => Promise<string>; backend: "local" | "remote" }>;
    private readonly logger?: SessionLogger;
    private readonly tracer?: DebugTracer;
    private readonly library?: RecipeLibrary;

    constructor(options?: Partial<HuggingFacePlannerOptions>)
    {
        this.options =
        {
            model: options?.model ?? "ServiceNow-AI/Apriel-1.6-15b-Thinker:together",
            temperature: options?.temperature ?? 0.2,
            maxTokens: options?.maxTokens ?? 4096,
            cacheDir: options?.cacheDir,
            device: options?.device ?? "auto",
            token: options?.token,
            inferenceEndpoint: options?.inferenceEndpoint,
            backend: options?.backend ?? "auto",
            quantized: options?.quantized ?? true,
            remoteMode: options?.remoteMode ?? "inference_api",
            logger: options?.logger,
            tracer: options?.tracer,
            recipesDir: options?.recipesDir
        } satisfies HuggingFacePlannerOptions;

        this.logger = this.options.logger;
        this.tracer = this.options.tracer;
        if (this.options.recipesDir)
        {
            this.library = new RecipeLibrary(this.options.recipesDir);
            this.library.loadAll();
        }
        this.generatorPromise = this.buildGenerator();
    }

    get modelName(): string
    {
        return this.options.model;
    }

    async backend(): Promise<"local" | "remote">
    {
        const gen = await this.generatorPromise;
        return gen.backend;
    }

    async createPlan(request: PlanRequest): Promise<PlanResult>
    {
        const run = async () =>
        {
            const { generate, backend } = await this.generatorPromise;
            let knowledgeSnippets: string[] = [];
            if (this.library && request.ragEnabled !== false)
            {
                const recipes = this.library.search(request.goal);
                knowledgeSnippets = recipes.map(r => this.library!.formatRecipeFact(r, 12));
            }

            const prompt = this.tracer
                ? this.tracer.trace("HuggingFacePlanner.buildPrompt", { goal: request.goal, knowledgeCount: knowledgeSnippets.length }, () => this.buildPrompt(request, knowledgeSnippets))
                : this.buildPrompt(request, knowledgeSnippets);
        
            this.logger?.logPlannerPrompt(prompt, request);
            this.tracer?.highlight("planner.started", "Planner request started", {
                goal: request.goal,
                ragEnabled: request.ragEnabled !== false,
                knowledgeCount: knowledgeSnippets.length
            });

            try
            {
                const rawText = await generate(prompt);
                this.logger?.logPlannerResponse(rawText, { backend, model: this.options.model });

                const parsed = this.tracer
                    ? this.tracer.trace("HuggingFacePlanner.parsePlan", { goal: request.goal }, () => this.parsePlan(rawText))
                    : this.parsePlan(rawText);
                this.logger?.logPlannerParsed({ ...parsed, backend });
                this.tracer?.highlight("planner.completed", "Planner response parsed", {
                    goal: request.goal,
                    stepCount: parsed.steps.length,
                    intent: parsed.intent
                });

                return {
                    intent: parsed.intent,
                    steps: parsed.steps,
                    model: this.options.model,
                    backend,
                    raw: rawText,
                    knowledgeUsed: knowledgeSnippets,
                    teamPlan: parsed.teamPlan,
                    claimedStepIds: parsed.claimedStepIds
                };
            }
            catch (error)
            {
                this.logger?.logPlannerError(error, { prompt, request });
                throw error;
            }
        };

            if (this.tracer)
            {
                return this.tracer.traceAsync("HuggingFacePlanner.createPlan", { goal: request.goal }, run);
            }

        return run();
    }

    private async buildGenerator(): Promise<{ generate: (prompt: string) => Promise<string>; backend: "local" | "remote" }>
    {
        const run = async () =>
        {
            const preferLocal = this.options.backend !== "remote";
            const preferRemote = this.options.backend === "remote";

            if (preferLocal)
            {
                try
                {
                    const local = await this.buildLocalGenerator();
                    if (local)
                    {
                        return { ...local, backend: "local" as const };
                    }
                }
                catch (err)
                {
                    console.warn("[planner] Local transformers pipeline unavailable, falling back to remote inference:", err);
                    if (this.options.backend === "local")
                    {
                        throw err;
                    }
                }
            }

            if (preferRemote || this.options.backend === "auto")
            {
                const remote = await this.buildRemoteGenerator();
                return { ...remote, backend: "remote" as const };
            }

            throw new Error("No available planner backend.");
        };

        if (this.tracer)
        {
            return this.tracer.traceAsync("HuggingFacePlanner.buildGenerator", { backend: this.options.backend }, run);
        }

        return run();
    }

    private async buildLocalGenerator(): Promise<{ generate: (prompt: string) => Promise<string> } | null>
    {
        const run = async () =>
        {
            let transformers: typeof import("@huggingface/transformers");
            try
            {
                transformers = await import("@huggingface/transformers");
            }
            catch
            {
                return null;
            }

            if (this.options.cacheDir)
            {
                transformers.env.cacheDir = this.options.cacheDir;
            }

            transformers.env.allowLocalModels = true;

            const generator = await transformers.pipeline("text-generation", this.options.model,
            {
                device: this.options.device,
                token: this.options.token,
                quantized: this.options.quantized,
                revision: "main" 
            });

            return {
                generate: async (prompt: string) =>
                {
                    const outputs = await generator(prompt,
                    {
                        temperature: this.options.temperature,
                        max_new_tokens: this.options.maxTokens
                    });

                    return this.extractText(outputs);
                }
            };
        };

        if (this.tracer)
        {
            return this.tracer.traceAsync("HuggingFacePlanner.buildLocalGenerator", { model: this.options.model }, run);
        }

        return run();
    }

    private async buildRemoteGenerator(): Promise<{ generate: (prompt: string) => Promise<string> }>
    {
        const run = async () =>
        {
            const token = this.options.token ?? process.env.HF_TOKEN;
            if (!token)
            {
                throw new Error("HF_TOKEN is required for remote planning and no local transformers pipeline is available.");
            }

            const endpoint = "https://router.huggingface.co/v1/chat/completions";

            const isTogetherModel = this.options.model.includes(":together");

            return {
                generate: async (prompt: string) =>
                {
                    const body: Record<string, unknown> = {
                        model: this.options.model,
                        messages: [
                            {
                                role: "system",
                                content: "You are a JSON-only Minecraft planning API. You MUST respond with a single valid JSON object and absolutely nothing else. No reasoning, no explanations, no markdown. First character must be '{', last character must be '}'. If you are a thinker model, place all thinking inside <think></think> tags, then output only JSON."
                            },
                            { role: "user", content: prompt }
                        ],
                        temperature: this.options.temperature,
                        max_tokens: this.options.maxTokens,
                        stream: false
                    };

                    if (isTogetherModel)
                    {
                        body.response_format = { type: "json_object" };
                    }

                    const response = await fetch(endpoint,
                    {
                        method: "POST",
                        headers:
                        {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(body)
                    });

                    if (!response.ok)
                    {
                        const errorText = await response.text();
                        throw new Error(`HF inference failed with status ${response.status}: ${errorText}`);
                    }

                    const json = await response.json();
                    if (json.choices && json.choices[0] && json.choices[0].message) {

                        return json.choices[0].message.content;

                    }
                    return this.extractText(json);
                }
            };
        };

        if (this.tracer)
        {
            return this.tracer.traceAsync("HuggingFacePlanner.buildRemoteGenerator", { remoteMode: this.options.remoteMode }, run);
        }

        return run();
    }

    private buildPrompt(request: PlanRequest, knowledge: string[] = []): string
    {
        const perception = request.perception ? JSON.stringify(request.perception) : "";
        const context = request.context ?? "";
        const planningMode = request.planningMode ?? "single";

        const actionsList = Object.entries(SUPPORTED_ACTIONS)
            .map(([name, desc]) => `- ${name}: ${desc}`)
            .join("\n");

            const knowledgeSection = knowledge.length > 0
            ? `\nRELEVANT KNOW-HOW (Use these recipes to guide your steps):\n${knowledge.join("\n")}\n`
            : "";

        const teamPlanSection = request.teamPlan
            ? `\nTEAM PLAN (shared, do not modify):\n${JSON.stringify(request.teamPlan)}\n`
            : "";

        const claimedStepsSection = request.claimedSteps && request.claimedSteps.length > 0
            ? `\nAlready claimed step ids: ${request.claimedSteps.join(", ")}\n`
            : "";

        const assignedStepsSection = request.assignedSteps && request.assignedSteps.length > 0
            ? `\nSTEPS ASSIGNED TO YOU: ${request.assignedSteps.join(", ")}\n`
            : "";

        const planningModeRules = planningMode === "team"
            ? [
                "TEAM PLAN MODE:",
                "- You are the team lead. Output JSON with team_plan describing the full team plan.",
                "- team_plan must include intent and steps. Each step must include a unique id and owner_role (gatherer|builder|supervisor|guard|generalist).",
                "- Also include individual_plan with a brief intent and a chat announcement summarizing the team plan.",
                "- Keep step descriptions concise and actionable."
            ].join("\n")
            : request.assignedSteps && request.assignedSteps.length > 0
                ? [
                    "SUPERVISOR-ASSIGNED MODE:",
                    "- The supervisor has assigned specific steps to you.",
                    "- You may ONLY claim and execute the assigned step IDs.",
                    "- Return JSON with intent, steps, and claim_ids (must match your assigned steps).",
                    "- Do NOT claim steps assigned to other agents."
                ].join("\n")
                : request.teamPlan
                ? [
                    "TEAM EXECUTION MODE:",
                    "- Use the TEAM PLAN above to choose only steps that match your role and are not already claimed.",
                    "- Return JSON with intent, steps, and claim_ids (array of team plan step ids you will handle).",
                    "- The first step MUST be a chat action announcing your claimed steps to the team.",
                    "- Do NOT claim steps assigned to other roles unless absolutely necessary.",
                ].join("\n")
                : "";

        return [
            "You are MineAgent, a Minecraft planning assistant.",
            `YOUR RESPONSE LIMIT IS ${this.options.maxTokens} TOKENS. You MUST stay well within this limit.`,
            "RESPONSE FORMAT RULES (CRITICAL):",
            "- You MUST output ONLY a single valid JSON object. Nothing else.",
            "- Do NOT output reasoning steps, explanations, chain-of-thought, or any text before or after the JSON.",
            "- Do NOT wrap the JSON in markdown fences (no ```json or ```).",
            "- Do NOT start with phrases like 'Here are my reasoning steps' or 'Let me think'.",
            "- The very first character of your response MUST be '{' and the very last character MUST be '}'.",
            "- If you are a 'thinker' model, put all thinking inside <think> tags and output ONLY JSON after closing </think>.",
            "Return JSON with fields intent (short string) and steps (array of {id, action, params?, description?}).",
            "Only use these actions (others will fail):",
            actionsList,
            knowledgeSection,
            teamPlanSection,
            claimedStepsSection,
            assignedStepsSection,
            "CRITICAL RULES:",
            "1. For multi-part builds (house, base), you MUST pick a specific coordinate (e.g. x:0, y:63, z:0) and use it as the 'origin' for EVERY build step (platform, walls, roof). Do NOT omit the origin.",
            "2. If context includes a scouted build site, use its origin for build steps and move there before building.",
            "3. Be complete (include roof, door).",
            "4. Coordinates must be grounded in the provided Perception snapshot. Only use positions from Perception.pose, Perception.nearby/entities, Perception.blocks, or scouted build site. Do not invent random coordinates.",
            "5. If multiple agents are present (per Context or Perception), return JSON with team_plan and individual_plan fields. team_plan should list shared steps with role assignments, and individual_plan should include intent and steps for this agent plus any chat announcements. If only one agent is present, return intent and steps as usual.",
            planningModeRules,
            "Intent should be fewer than 140 characters.",
            `Goal: ${request.goal}`,
            context ? `Context: ${context}` : "",
            perception ? `Perception: ${perception}` : "",
            "Respond with only one JSON object."
        ].filter(Boolean).join("\n");
    }

    private extractText(json: unknown): string
    {
        if (Array.isArray(json) && json[0] && typeof json[0].generated_text === "string")
        {
            return json[0].generated_text as string;
        }

        if (typeof json === "object" && json && "generated_text" in json && typeof (json as any).generated_text === "string")
        {
            return (json as any).generated_text as string;
        }

        const asString = typeof json === "string" ? json : JSON.stringify(json);
        return asString;
    }

    private parsePlan(text: string): Omit<PlanResult, "backend">
    {
        const block = this.extractJsonBlock(text);

        let parsed: any;
        try
        {
            parsed = JSON.parse(block);
        }
        catch (err)
        {
            console.warn("[planner] JSON parse failed, attempting to repair...", err);
            parsed = this.repairAndParseJson(block, text);
        }

        const teamPlan = parsed.team_plan ?? parsed.teamPlan;
        const individualPlan = parsed.individual_plan ?? parsed.individualPlan;
        
        let planSource = individualPlan ?? parsed;

        if ((typeof planSource.intent !== "string" || !Array.isArray(planSource.steps)) && teamPlan)
        {
             console.warn("[planner] Response has team_plan but missing individual_plan. Generating default lead action.");
             planSource = {
                 intent: "Distribute team plan",
                 steps: [
                     {
                         action: "chat",
                         params: { message: "I have generated the team plan. Let's proceed." }
                     }
                 ]
             };
        }

        const rawClaimIds = planSource.claim_ids ?? planSource.claimed_step_ids ?? planSource.claimedSteps ?? planSource.claimIds;
        const claimedStepIds = Array.isArray(rawClaimIds) ? rawClaimIds.map((id: any) => String(id)) : [];

        if (typeof planSource.intent !== "string" || !Array.isArray(planSource.steps))
        {
            throw new Error("Planner response missing intent or steps");
        }

        const steps: ActionStep[] = planSource.steps.map((s: any, idx: number) =>
        {
            if (typeof s !== "object" || !s)
            {
                throw new Error(`Invalid step at index ${idx}`);
            }

            const action = String(s.action ?? "unknown");
            if (!SUPPORTED_ACTIONS[action])
            {
                console.warn(`[planner] Warning: Model suggested unsupported action '${action}'`);
            }

            return {
                id: String(s.id ?? `step-${idx}`),
                action,
                params: s.params,
                description: s.description
            } satisfies ActionStep;
        });

        return {
            intent: planSource.intent.trim(),
            steps,
            model: this.options.model,
            raw: text,
            teamPlan,
            claimedStepIds
        };
    }

    private repairAndParseJson(block: string, rawText: string): any
    {
        const strategies: Array<(s: string) => string> = [
            s => s
                .replace(/\/\/.*$/gm, "")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/([{,]\s*)'([a-zA-Z0-9_]+)'(\s*:)/g, '$1"$2"$3'),

            s => s
                .replace(/\/\/.*$/gm, "")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3'),

            s =>
            {
                let fixed = s
                    .replace(/\/\/.*$/gm, "")
                    .replace(/,\s*([}\]])/g, "$1")
                    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

                fixed = fixed.replace(/,\s*"[^"]*$/, "");
                fixed = fixed.replace(/,\s*$/, "");

                let braces = 0;
                let brackets = 0;
                let inStr = false;
                let esc = false;
                for (const ch of fixed)
                {
                    if (esc)           { esc = false; continue; }
                    if (ch === "\\")   { esc = true;  continue; }
                    if (ch === '"')    { inStr = !inStr; continue; }
                    if (inStr)         continue;
                    if (ch === "{")    braces++;
                    if (ch === "}")    braces--;
                    if (ch === "[")    brackets++;
                    if (ch === "]")    brackets--;
                }
                while (brackets > 0) { fixed += "]"; brackets--; }
                while (braces > 0)   { fixed += "}"; braces--;  }

                return fixed;
            },
        ];

        for (let i = 0; i < strategies.length; i++)
        {
            try
            {
                const fixed = strategies[i](block);
                return JSON.parse(fixed);
            }
            catch { }
        }

        const reExtracted = this.extractBalancedJson(rawText);
        if (reExtracted)
        {
            for (const strategy of strategies)
            {
                try { return JSON.parse(strategy(reExtracted)); }
                catch { }
            }
        }

        console.error("[planner] FATAL: Could not parse JSON after all repair strategies. Raw output below:");
        console.error(rawText);
        throw new Error("Planner response was not valid JSON after exhaustive repair attempts.");
    }

    private stripThinkingPreamble(text: string): string
    {
        let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");

        cleaned = cleaned.trim();
        if (cleaned.startsWith("{")) return cleaned;

        const lastBrace = cleaned.lastIndexOf("{");
        if (lastBrace !== -1)
        {
            const candidate = cleaned.slice(lastBrace);
            if (/"intent"/.test(candidate) || /"team_plan"/.test(candidate) || /"steps"/.test(candidate))
            {
                return candidate;
            }
        }

        cleaned = cleaned
            .replace(/^[\s\S]*?(?=\{)/m, "");

        return cleaned.trim();
    }

    private extractJsonBlock(text: string): string
    {
        const stripped = this.stripThinkingPreamble(text);

        const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped);
        if (fenceMatch?.[1])
        {
            const content = fenceMatch[1].trim();
            if (content.startsWith("{")) return content;
        }

        const result = this.extractBalancedJson(stripped);
        if (result) return result;

        const fallback = this.extractBalancedJson(text);
        if (fallback) return fallback;

        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace)
        {
            return text.slice(firstBrace, lastBrace + 1);
        }

        return text;
    }

    private extractBalancedJson(text: string): string | null
    {
        let start = -1;
        let depth = 0;
        let inString = false;
        let escape = false;

        const candidates: string[] = [];

        for (let i = 0; i < text.length; i++)
        {
            const ch = text[i];

            if (escape)            { escape = false; continue; }
            if (ch === "\\")       { escape = true;  continue; }
            if (ch === '"')        { inString = !inString; continue; }
            if (inString)          continue;

            if (ch === "{")
            {
                if (depth === 0) start = i;
                depth++;
            }
            else if (ch === "}")
            {
                depth--;
                if (depth === 0 && start !== -1)
                {
                    const candidate = text.slice(start, i + 1);
                    if (/"intent"/.test(candidate) || /"steps"/.test(candidate)
                        || /"team_plan"/.test(candidate) || /"individual_plan"/.test(candidate))
                    {
                        candidates.push(candidate);
                    }
                    start = -1;
                }
                if (depth < 0) depth = 0;
            }
        }

        if (candidates.length > 0)
        {
            return candidates[candidates.length - 1];
        }

        if (start !== -1)
        {
            const lastBrace = text.lastIndexOf("}");
            if (lastBrace > start)
            {
                return text.slice(start, lastBrace + 1);
            }
        }

        return null;
    }
}