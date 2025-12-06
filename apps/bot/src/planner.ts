import type { PerceptionSnapshot } from "./types.js";
import type { ActionStep } from "./action-executor.js";

export interface PlanRequest
{
    goal: string;
    perception?: PerceptionSnapshot;
    context?: string;
}

export interface PlanResult
{
    intent: string;
    steps: ActionStep[];
    model: string;
    backend: "local" | "remote";
    raw: string;
}

const SUPPORTED_ACTIONS: Record<string, string> =
{
    chat: "Send a chat message. params: { message }",
    move: "Move toward a position or entity. params: { position:{x,y,z}? entityName?:string, range?:number, timeoutMs?:number }",
    mine: "Break a block. params: { block?:string, position?:{x,y,z}, maxDistance?:number, attempts?:number }",
    gather: "Collect dropped items nearby. params: { item?:string, maxDistance?:number, timeoutMs?:number }",
    build: "Place blocks to form a structure. params: { structure:'platform'|'base'|'house'|'nether_portal', origin?:{x,y,z}, material?:string }",
    hunt: "Seek and hunt a mob. params: { target?:string, range?:number, timeoutMs?:number }",
    fight: "Attack a mob or player. params: { target?:string, aggression?:'passive'|'aggressive'|'any', timeoutMs?:number }",
    fish: "Use a fishing rod. params: { casts?:number }"
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
}

export class HuggingFacePlanner
{
    private readonly options: HuggingFacePlannerOptions;
    private readonly generatorPromise: Promise<{ generate: (prompt: string) => Promise<string>; backend: "local" | "remote" }>;

    constructor(options?: Partial<HuggingFacePlannerOptions>)
    {
        this.options =
        {
            model: options?.model ?? "onnx-community/Qwen2.5-0.5B-Instruct",
            temperature: options?.temperature ?? 0.2,
            maxTokens: options?.maxTokens ?? 256,
            cacheDir: options?.cacheDir,
            device: options?.device ?? "auto",
            token: options?.token,
            inferenceEndpoint: options?.inferenceEndpoint,
            backend: options?.backend ?? "auto",
            quantized: options?.quantized ?? true,
            remoteMode: options?.remoteMode ?? "inference_api"
        } satisfies HuggingFacePlannerOptions;

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
        const rawText = await generate(this.buildPrompt(request));
        const parsed = this.parsePlan(rawText);

        return {
            intent: parsed.intent,
            steps: parsed.steps,
            model: this.options.model,
            backend,
            raw: rawText
        };
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

    private buildPrompt(request: PlanRequest): string
    {
        const perception = request.perception ? JSON.stringify(request.perception) : "";
        const context = request.context ?? "";

        const actionsList = Object.entries(SUPPORTED_ACTIONS)
            .map(([name, desc]) => `- ${name}: ${desc}`)
            .join("\n");

        return [
            "You are MineAgent, a Minecraft planning assistant.",
            "Return JSON with fields intent (short string) and steps (array of {id, action, params?, description?}).",
            "Only use these actions (others will fail):",
            actionsList,
            "Prefer 1-4 concise steps with stable ids like step-1, step-2.",
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

        if (typeof parsed.intent !== "string" || !Array.isArray(parsed.steps))
        {
            throw new Error("Planner response missing intent or steps");
        }

        const steps: ActionStep[] = parsed.steps.map((s: any, idx: number) =>
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
            intent: parsed.intent.trim(),
            steps,
            model: this.options.model,
            raw: text
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