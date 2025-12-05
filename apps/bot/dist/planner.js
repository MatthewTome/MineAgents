export class HuggingFacePlanner {
    token;
    options;
    fetcher;
    constructor(token, options) {
        if (!token) {
            throw new Error("Hugging Face token is required for planning");
        }
        this.token = token;
        this.options =
            {
                model: options?.model ?? "Qwen/Qwen3-VL-2B-Instruct",
                temperature: options?.temperature ?? 0.2,
                maxTokens: options?.maxTokens ?? 256,
                fetcher: options?.fetcher
            };
        this.fetcher = this.options.fetcher ?? fetch;
    }
    async createPlan(request) {
        const body = {
            inputs: this.buildPrompt(request),
            parameters: {
                temperature: this.options.temperature,
                max_new_tokens: this.options.maxTokens
            },
            options: {
                wait_for_model: true
            }
        };
        const response = await this.fetcher(this.endpoint(), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(`Planner HTTP ${response.status}`);
        }
        const json = await response.json();
        const rawText = this.extractText(json);
        const parsed = this.parsePlan(rawText);
        return {
            intent: parsed.intent,
            steps: parsed.steps,
            model: this.options.model,
            raw: rawText
        };
    }
    endpoint() {
        const encodedModel = encodeURIComponent(this.options.model);
        return `https://api-inference.huggingface.co/models/${encodedModel}`;
    }
    buildPrompt(request) {
        const perception = request.perception ? JSON.stringify(request.perception) : "";
        const context = request.context ?? "";
        return [
            "You are MineAgent, a Minecraft planning assistant.",
            "Return JSON with fields intent (short string) and steps (array of {id, action, params?, description?}).",
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
            return {
                id: String(s.id ?? `step-${idx}`),
                action: String(s.action ?? "unknown"),
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
