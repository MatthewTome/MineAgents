import { RecipeLibrary } from "./knowledge.js";
import { buildPlannerPrompt } from "./prompt.js";
import { extractText, parsePlan } from "./parsing.js";
import type { HuggingFacePlannerOptions, PlanRequest, PlanResult } from "./types.js";
import type { SessionLogger } from "../logger/session-logger.js";
import type { DebugTracer } from "../logger/debug-trace.js";

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
            
            if (this.library && request.ragEnabled !== false && request.perception)
            {
                const recipes = this.library.search(request.goal, request.perception);
                knowledgeSnippets = recipes.map(r => this.library!.formatRecipeFact(r, 200));
            }

            const prompt = this.tracer
                ? this.tracer.trace("HuggingFacePlanner.buildPrompt", { goal: request.goal, knowledgeCount: knowledgeSnippets.length }, () => buildPlannerPrompt(this.options, request, knowledgeSnippets))
                : buildPlannerPrompt(this.options, request, knowledgeSnippets);
        
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
                    ? this.tracer.trace("HuggingFacePlanner.parsePlan", { goal: request.goal }, () => parsePlan(rawText, this.options.model))
                    : parsePlan(rawText, this.options.model);
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

                    return extractText(outputs);
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
                    return extractText(json);
                }
            };
        };

        if (this.tracer)
        {
            return this.tracer.traceAsync("HuggingFacePlanner.buildRemoteGenerator", { remoteMode: this.options.remoteMode }, run);
        }

        return run();
    }
}