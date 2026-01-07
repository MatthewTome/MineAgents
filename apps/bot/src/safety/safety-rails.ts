import { Filter } from "bad-words";
import type { ActionStep } from "../actions/action-executor.js";
import type { SessionLogger } from "../logger/session-logger.js";

export interface RateLimitConfig
{
    max: number;
    windowMs: number;
}

export interface SafetyRailsConfig
{
    allowedActions: string[];
    blockedMaterials: string[];
    customProfanityList: string[];
    rateLimits:
    {
        global?: RateLimitConfig;
        perAction?: Record<string, RateLimitConfig>;
    };
}

export interface SafetyCheckResult
{
    allowed: boolean;
    reason?: string;
    step?: ActionStep;
}

export interface SafetyChatResult
{
    allowed: boolean;
    message: string;
    reason?: string;
}

export interface SafetyRailsOptions
{
    config: SafetyRailsConfig;
    logger?: SessionLogger;
}

interface FilterResult
{
    message: string;
    matches: string[];
}

class RateLimiter
{
    private readonly timestamps = new Map<string, number[]>();

    consume(key: string, limit: RateLimitConfig, now: number): boolean
    {
        const bucket = this.timestamps.get(key) ?? [];
        const cutoff = now - limit.windowMs;
        const fresh = bucket.filter((ts) => ts > cutoff);

        if (fresh.length >= limit.max)
        {
            this.timestamps.set(key, fresh);
            return false;
        }

        fresh.push(now);
        this.timestamps.set(key, fresh);
        return true;
    }
}

export class SafetyRails
{
    private readonly config: SafetyRailsConfig;
    private readonly logger?: SessionLogger;
    private readonly rateLimiter = new RateLimiter();
    private readonly filter: Filter;

    constructor(options: SafetyRailsOptions)
    {
        this.config = options.config;
        this.logger = options.logger;
        this.filter = new Filter({ placeHolder: '*' });
        if (this.config.customProfanityList && this.config.customProfanityList.length > 0)
        {
            this.filter.addWords(...this.config.customProfanityList);
        }
    }

    checkStep(step: ActionStep): SafetyCheckResult
    {
        const action = step.action;
        const allowedActions = this.config.allowedActions.map((entry) => entry.toLowerCase());

        if (!allowedActions.includes(action.toLowerCase()))
        {
            const reason = `action '${action}' is not approved`;
            this.logBlocked(reason, { action, stepId: step.id });
            return { allowed: false, reason };
        }

        const unsafe = this.findUnsafeMaterial(step);
        if (unsafe)
        {
            const reason = `blocked unsafe material '${unsafe}'`;
            this.logBlocked(reason, { action, stepId: step.id, material: unsafe });
            return { allowed: false, reason };
        }

        const filtered = this.applyProfanityFilter(step);

        if (!this.consumeRateLimit(action))
        {
            const reason = `rate limit exceeded for '${action}'`;
            this.logBlocked(reason, { action, stepId: step.id });
            return { allowed: false, reason };
        }

        return { allowed: true, step: filtered.step };
    }

    checkOutgoingChat(message: string, source: string = "system"): SafetyChatResult
    {
        const { message: filteredMessage, matches } = this.filterText(message);
        let finalMessage = filteredMessage.trim();

        if (!finalMessage)
        {
            finalMessage = "[filtered]";
        }

        if (matches.length > 0)
        {
            this.logFiltered(matches, { source, original: message, filtered: finalMessage });
        }

        if (!this.consumeRateLimit("chat"))
        {
            const reason = "rate limit exceeded for 'chat'";
            this.logBlocked(reason, { action: "chat", source });
            return { allowed: false, message: finalMessage, reason };
        }

        return { allowed: true, message: finalMessage };
    }

    private applyProfanityFilter(step: ActionStep): { step: ActionStep }
    {
        if (step.action !== "chat")
        {
            return { step };
        }

        const rawMessage = String(step.params?.message ?? "");
        const { message, matches } = this.filterText(rawMessage);
        const sanitized = message.trim() || "[filtered]";

        if (matches.length > 0)
        {
            this.logFiltered(matches, { action: step.action, stepId: step.id, original: rawMessage, filtered: sanitized });
        }

        const nextStep: ActionStep =
        {
            ...step,
            params:
            {
                ...(step.params ?? {}),
                message: sanitized
            }
        };

        return { step: nextStep };
    }

    private consumeRateLimit(action: string): boolean
    {
        const now = Date.now();
        const globalLimit = this.config.rateLimits.global;
        if (globalLimit && !this.rateLimiter.consume("global", globalLimit, now))
        {
            return false;
        }

        const perAction = this.config.rateLimits.perAction?.[action];
        if (perAction && !this.rateLimiter.consume(`action:${action}`, perAction, now))
        {
            return false;
        }

        return true;
    }

    private findUnsafeMaterial(step: ActionStep): string | null
    {
        const haystack = this.collectParamText(step);
        const blocked = this.config.blockedMaterials.map((entry) => entry.toLowerCase());

        for (const entry of haystack)
        {
            const lowered = entry.toLowerCase();
            const match = blocked.find((term) => lowered.includes(term));
            if (match) { return match; }
        }

        return null;
    }

    private collectParamText(step: ActionStep): string[]
    {
        const params = step.params ?? {};
        const values: string[] = [];
        const fields = ["block", "item", "recipe", "material", "target"];

        for (const field of fields)
        {
            const value = params[field] as string | undefined;
            if (typeof value === "string" && value.trim())
            {
                values.push(value.trim());
            }
        }

        return values;
    }

    private filterText(message: string): FilterResult
    {
        if (!message || !message.trim())
        { return { message, matches: [] }; }

        const isProfane = this.filter.isProfane(message);
        if (!isProfane) { return { message, matches: [] }; }

        const cleaned = this.filter.clean(message);
        return { 
            message: cleaned, 
            matches: ["profanity_detected"] 
        };
    }

    private logBlocked(reason: string, data: Record<string, unknown>): void
    {
        this.logger?.logSafety("safety.blocked", reason, data, "warn");
    }

    private logFiltered(matches: string[], data: Record<string, unknown>): void
    {
        this.logger?.logSafety("safety.filtered", "filtered profanity", { matches, ...data }, "warn");
    }
}