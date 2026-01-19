import type { PerceptionSnapshot } from "../settings/types.js";
import type { ActionStep } from "../actions/action-executor.js";
import type { SessionLogger } from "../logger/session-logger.js";
import { RecipeLibrary } from "./knowledge.js";

export interface PlanRequest
{
    goal: string;
    perception?: PerceptionSnapshot;
    context?: string;
    ragEnabled?: boolean;
    teamPlan?: unknown;
    claimedSteps?: string[];
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
    fish: "Fish."
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
    recipesDir?: string;
}

export class HuggingFacePlanner
{
    private readonly options: HuggingFacePlannerOptions;
    private readonly generatorPromise: Promise<{ generate: (prompt: string) => Promise<string>; backend: "local" | "remote" }>;
    private readonly logger?: SessionLogger;
    private readonly library?: RecipeLibrary;

    constructor(options?: Partial<HuggingFacePlannerOptions>)
    {
        this.options =
        {
            model: options?.model ?? "onnx-community/Qwen2.5-0.5B-Instruct",
            temperature: options?.temperature ?? 0.2,
            maxTokens: options?.maxTokens ?? 2000,
            cacheDir: options?.cacheDir,
            device: options?.device ?? "auto",
            token: options?.token,
            inferenceEndpoint: options?.inferenceEndpoint,
            backend: options?.backend ?? "auto",
            quantized: options?.quantized ?? true,
            remoteMode: options?.remoteMode ?? "inference_api",
            logger: options?.logger,
            recipesDir: options?.recipesDir
        } satisfies HuggingFacePlannerOptions;

        this.logger = this.options.logger;
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
        const { generate, backend } = await this.generatorPromise;
        let knowledgeSnippets: string[] = [];
        if (this.library && request.ragEnabled !== false)
        {
            const recipes = this.library.search(request.goal);
            knowledgeSnippets = recipes.map(r => this.library!.formatRecipeFact(r, 12));
        }

        const prompt = this.buildPrompt(request, knowledgeSnippets);

        this.logger?.logPlannerPrompt(prompt, request);

        try
        {
            const rawText = await generate(prompt);
            this.logger?.logPlannerResponse(rawText, { backend, model: this.options.model });

            const parsed = this.parsePlan(rawText);
            this.logger?.logPlannerParsed({ ...parsed, backend });

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
    }

    private async buildGenerator(): Promise<{ generate: (prompt: string) => Promise<string>; backend: "local" | "remote" }>
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
                    return { ...local, backend: "local" };
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
            return { ...remote, backend: "remote" };
        }

        throw new Error("No available planner backend.");
    }

    private async buildLocalGenerator(): Promise<{ generate: (prompt: string) => Promise<string> } | null>
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
    }

    private async buildRemoteGenerator(): Promise<{ generate: (prompt: string) => Promise<string> }>
    {
        const token = this.options.token ?? process.env.HF_TOKEN;
        if (!token)
        {
            throw new Error("HF_TOKEN is required for remote planning and no local transformers pipeline is available.");
        }

        const endpoint = "https://router.huggingface.co/v1/chat/completions";

        return {
            generate: async (prompt: string) =>
            {
                const response = await fetch(endpoint,
                {
                    method: "POST",
                    headers:
                    {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(
                    {
                        model: this.options.model,
                        messages: [
                            { role: "user", content: prompt }
                        ],
                        temperature: this.options.temperature,
                        max_tokens: this.options.maxTokens,
                        stream: false
                    })
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

        const planningModeRules = planningMode === "team"
            ? [
                "TEAM PLAN MODE:",
                "- You are the team lead. Output JSON with team_plan describing the full team plan.",
                "- team_plan must include intent and steps. Each step must include a unique id and owner_role (miner|builder|guide|guard|generalist).",
                "- Also include individual_plan with a brief intent and a chat announcement summarizing the team plan.",
                "- Keep step descriptions concise and actionable."
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
            "Return JSON with fields intent (short string) and steps (array of {id, action, params?, description?}).",
            "Only use these actions (others will fail):",
            actionsList,
            knowledgeSection,
            teamPlanSection,
            claimedStepsSection,
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
            
            let fixed = block
                .replace(/\/\/.*$/gm, "") 
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/([{,]\s*)'([a-zA-Z0-9_]+)'(\s*:)/g, '$1"$2"$3');

            try
            {
                parsed = JSON.parse(fixed);
            }
            catch (finalErr)
            {
                console.error("[planner] FATAL: Could not parse JSON. Raw output below:");
                console.error(text);
                throw new Error(`Planner response was not valid JSON: ${finalErr}`);
            }
        }

        const teamPlan = parsed.team_plan ?? parsed.teamPlan;
        const individualPlan = parsed.individual_plan ?? parsed.individualPlan;
        const planSource = individualPlan ?? parsed;
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

    private extractJsonBlock(text: string): string
    {
        const fenceMatch = /```json\s*([\s\S]*?)```/i.exec(text);
        if (fenceMatch?.[1])
        {
            return fenceMatch[1].trim();
        }

        const genericFence = /```\s*([\s\S]*?)```/i.exec(text);
        if (genericFence?.[1]) 
        {
             if (genericFence[1].trim().startsWith("{")) {
                 return genericFence[1].trim();
             }
        }

        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");

        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace)
        {
            return text.slice(firstBrace, lastBrace + 1);
        }

        return text;
    }
}