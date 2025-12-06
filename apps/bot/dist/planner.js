const SUPPORTED_ACTIONS = {
    chat: "Send a chat message. params: { message }",
    move: "Move toward a position or entity. params: { position:{x,y,z}? entityName?:string, range?:number, timeoutMs?:number }",
    mine: "Break a block. params: { block?:string, position?:{x,y,z}, maxDistance?:number, attempts?:number }",
    gather: "Collect dropped items nearby. params: { item?:string, maxDistance?:number, timeoutMs?:number }",
    build: "Place blocks to form a structure. params: { structure:'platform'|'base'|'house'|'nether_portal', origin?:{x,y,z}, material?:string }",
    hunt: "Seek and hunt a mob. params: { target?:string, range?:number, timeoutMs?:number }",
    fight: "Attack a mob or player. params: { target?:string, aggression?:'passive'|'aggressive'|'any', timeoutMs?:number }",
    fish: "Use a fishing rod. params: { casts?:number }"
};
export class HuggingFacePlanner {
    options;
    generatorPromise;
    constructor(options) {
        this.options =
            {
                model: options?.model ?? "Xenova/Qwen2.5-1.5B-Instruct",
                temperature: options?.temperature ?? 0.2,
                maxTokens: options?.maxTokens ?? 256,
                cacheDir: options?.cacheDir,
                device: options?.device ?? "auto",
                token: options?.token,
                inferenceEndpoint: options?.inferenceEndpoint
            };
        this.generatorPromise = this.buildGenerator();
    }
    get modelName() {
        return this.options.model;
    }
    async backend() {
        const gen = await this.generatorPromise;
        return gen.backend;
    }
    async createPlan(request) {
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
    async buildGenerator() {
        try {
            const local = await this.buildLocalGenerator();
            if (local) {
                return { ...local, backend: "local" };
            }
        }
        catch (err) {
            console.warn("[planner] Local transformers pipeline unavailable, falling back to remote inference:", err);
        }
        const remote = await this.buildRemoteGenerator();
        return { ...remote, backend: "remote" };
    }
    async buildLocalGenerator() {
        let transformers;
        try {
            transformers = await import("@huggingface/transformers");
        }
        catch {
            return null;
        }
        if (this.options.cacheDir) {
            transformers.env.cacheDir = this.options.cacheDir;
        }
        transformers.env.allowLocalModels = true;
        const generator = await transformers.pipeline("text-generation", this.options.model, {
            device: this.options.device,
            token: this.options.token
        });
        return {
            generate: async (prompt) => {
                const outputs = await generator(prompt, {
                    temperature: this.options.temperature,
                    max_new_tokens: this.options.maxTokens
                });
                return this.extractText(outputs);
            }
        };
    }
    async buildRemoteGenerator() {
        const token = this.options.token ?? process.env.HF_TOKEN;
        if (!token) {
            throw new Error("HF_TOKEN is required for remote planning and no local transformers pipeline is available.");
        }
        const endpoint = this.options.inferenceEndpoint ?? `https://api-inference.huggingface.co/models/${this.options.model}`;
        return {
            generate: async (prompt) => {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        inputs: prompt,
                        parameters: {
                            temperature: this.options.temperature,
                            max_new_tokens: this.options.maxTokens
                        }
                    })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HF inference failed with status ${response.status}: ${errorText}`);
                }
                const json = await response.json();
                return this.extractText(json);
            }
        };
    }
    buildPrompt(request) {
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
    extractText(json) {
        if (Array.isArray(json) && json[0] && typeof json[0].generated_text === "string") {
            return json[0].generated_text;
        }
        if (typeof json === "object" && json && "generated_text" in json && typeof json.generated_text === "string") {
            return json.generated_text;
        }
        const asString = typeof json === "string" ? json : JSON.stringify(json);
        return asString;
    }
    parsePlan(text) {
        const block = this.extractJsonBlock(text);
        let parsed;
        try {
            parsed = JSON.parse(block);
        }
        catch (err) {
            throw new Error(`Planner response was not valid JSON: ${err}`);
        }
        if (typeof parsed.intent !== "string" || !Array.isArray(parsed.steps)) {
            throw new Error("Planner response missing intent or steps");
        }
        const steps = parsed.steps.map((s, idx) => {
            if (typeof s !== "object" || !s) {
                throw new Error(`Invalid step at index ${idx}`);
            }
            const action = String(s.action ?? "unknown");
            if (!SUPPORTED_ACTIONS[action]) {
                throw new Error(`Unsupported action '${action}' in planner response`);
            }
            return {
                id: String(s.id ?? `step-${idx}`),
                action,
                params: s.params,
                description: s.description
            };
        });
        return {
            intent: parsed.intent.trim(),
            steps,
            model: this.options.model,
            raw: text
        };
    }
    extractJsonBlock(text) {
        const fenceMatch = /```json\s*([\s\S]*?)```/i.exec(text);
        if (fenceMatch?.[1]) {
            return fenceMatch[1];
        }
        const braceIndex = text.indexOf("{");
        if (braceIndex !== -1) {
            return text.slice(braceIndex);
        }
        throw new Error("Planner response did not contain JSON");
    }
}
