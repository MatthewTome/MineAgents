import type { ActionStep } from "./action-executor.js";

export interface PlanIntent
{
    intent?: string;
    goal?: string;
    steps?: ActionStep[];
}

export interface PlanNarratorOptions
{
    maxLength: number;
    minIntervalMs: number;
    formatter?: (plan: PlanIntent) => string;
}

export class PlanNarrator
{
    private lastNarrationAt = Number.NEGATIVE_INFINITY;
    private readonly options: PlanNarratorOptions;

    constructor(options?: Partial<PlanNarratorOptions>)
    {
        this.options =
        {
            maxLength: options?.maxLength ?? 140,
            minIntervalMs: options?.minIntervalMs ?? 1000,
            formatter: options?.formatter
        } as PlanNarratorOptions;
    }

    maybeNarrate(plan: PlanIntent, now: number = Date.now()): string | null
    {
        if (now - this.lastNarrationAt < this.options.minIntervalMs)
        {
            return null;
        }

        const summary = this.format(plan);
        this.lastNarrationAt = now;
        return summary;
    }

    private format(plan: PlanIntent): string
    {
        const formatter = this.options.formatter ?? defaultFormatter;
        const raw = formatter(plan).replace(/\s+/g, " ").trim();
        return this.trimToLimit(raw, this.options.maxLength);
    }

    private trimToLimit(text: string, limit: number): string
    {
        if (text.length <= limit)
        {
            return text;
        }

        if (limit <= 3)
        {
            return text.slice(0, limit);
        }

        return `${text.slice(0, limit - 3)}...`;
    }
}

function defaultFormatter(plan: PlanIntent): string
{
    if (plan.intent)
    {
        return plan.intent;
    }

    const steps = plan.steps ?? [];
    const primary = steps[0];
    const stepSummary = primary ? `${primary.action}${primary.description ? `: ${primary.description}` : ""}` : "planning actions";
    const goal = plan.goal ? ` for ${plan.goal}` : "";
    const count = steps.length > 1 ? ` (${steps.length} steps)` : "";
    return `${stepSummary}${goal}${count}`;
}