export class PlanNarrator {
    lastNarrationAt = Number.NEGATIVE_INFINITY;
    options;
    constructor(options) {
        this.options =
            {
                maxLength: options?.maxLength ?? 140,
                minIntervalMs: options?.minIntervalMs ?? 1000,
                formatter: options?.formatter
            };
    }
    maybeNarrate(plan, now = Date.now()) {
        if (now - this.lastNarrationAt < this.options.minIntervalMs) {
            return null;
        }
        const summary = this.format(plan);
        this.lastNarrationAt = now;
        return summary;
    }
    format(plan) {
        const formatter = this.options.formatter ?? defaultFormatter;
        const raw = formatter(plan).replace(/\s+/g, " ").trim();
        return this.trimToLimit(raw, this.options.maxLength);
    }
    trimToLimit(text, limit) {
        if (text.length <= limit) {
            return text;
        }
        if (limit <= 3) {
            return text.slice(0, limit);
        }
        return `${text.slice(0, limit - 3)}...`;
    }
}
function defaultFormatter(plan) {
    if (plan.intent) {
        return plan.intent;
    }
    const steps = plan.steps ?? [];
    const primary = steps[0];
    const stepSummary = primary ? `${primary.action}${primary.description ? `: ${primary.description}` : ""}` : "planning actions";
    const goal = plan.goal ? ` for ${plan.goal}` : "";
    const count = steps.length > 1 ? ` (${steps.length} steps)` : "";
    return `${stepSummary}${goal}${count}`;
}