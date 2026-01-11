import { Filter } from "bad-words";
class RateLimiter {
    timestamps = new Map();
    consume(key, limit, now) {
        const bucket = this.timestamps.get(key) ?? [];
        const cutoff = now - limit.windowMs;
        const fresh = bucket.filter((ts) => ts > cutoff);
        if (fresh.length >= limit.max) {
            this.timestamps.set(key, fresh);
            return false;
        }
        fresh.push(now);
        this.timestamps.set(key, fresh);
        return true;
    }
}
export class SafetyRails {
    config;
    logger;
    rateLimiter = new RateLimiter();
    filter;
    constructor(options) {
        this.config = options.config;
        this.logger = options.logger;
        this.filter = new Filter({ placeHolder: '*' });
        if (this.config.customProfanityList && this.config.customProfanityList.length > 0) {
            this.filter.addWords(...this.config.customProfanityList);
        }
    }
    checkStep(step) {
        const action = step.action;
        const allowedActions = this.config.allowedActions.map((entry) => entry.toLowerCase());
        if (!allowedActions.includes(action.toLowerCase())) {
            const reason = `action '${action}' is not approved`;
            this.logBlocked(reason, { action, stepId: step.id });
            return { allowed: false, reason };
        }
        const unsafe = this.findUnsafeMaterial(step);
        if (unsafe) {
            const reason = `blocked unsafe material '${unsafe}'`;
            this.logBlocked(reason, { action, stepId: step.id, material: unsafe });
            return { allowed: false, reason };
        }
        const filtered = this.applyProfanityFilter(step);
        if (!this.consumeRateLimit(action)) {
            const reason = `rate limit exceeded for '${action}'`;
            this.logBlocked(reason, { action, stepId: step.id });
            return { allowed: false, reason };
        }
        return { allowed: true, step: filtered.step };
    }
    checkOutgoingChat(message, source = "system") {
        const { message: filteredMessage, matches } = this.filterText(message);
        let finalMessage = filteredMessage.trim();
        if (!finalMessage) {
            finalMessage = "[filtered]";
        }
        if (matches.length > 0) {
            this.logFiltered(matches, { source, original: message, filtered: finalMessage });
        }
        if (!this.consumeRateLimit("chat")) {
            const reason = "rate limit exceeded for 'chat'";
            this.logBlocked(reason, { action: "chat", source });
            return { allowed: false, message: finalMessage, reason };
        }
        return { allowed: true, message: finalMessage };
    }
    applyProfanityFilter(step) {
        if (step.action !== "chat") {
            return { step };
        }
        const rawMessage = String(step.params?.message ?? "");
        const { message, matches } = this.filterText(rawMessage);
        const sanitized = message.trim() || "[filtered]";
        if (matches.length > 0) {
            this.logFiltered(matches, { action: step.action, stepId: step.id, original: rawMessage, filtered: sanitized });
        }
        const nextStep = {
            ...step,
            params: {
                ...(step.params ?? {}),
                message: sanitized
            }
        };
        return { step: nextStep };
    }
    consumeRateLimit(action) {
        const now = Date.now();
        const globalLimit = this.config.rateLimits.global;
        if (globalLimit && !this.rateLimiter.consume("global", globalLimit, now)) {
            return false;
        }
        const perAction = this.config.rateLimits.perAction?.[action];
        if (perAction && !this.rateLimiter.consume(`action:${action}`, perAction, now)) {
            return false;
        }
        return true;
    }
    findUnsafeMaterial(step) {
        const haystack = this.collectParamText(step);
        const blocked = this.config.blockedMaterials.map((entry) => entry.toLowerCase());
        for (const entry of haystack) {
            const lowered = entry.toLowerCase();
            const match = blocked.find((term) => lowered.includes(term));
            if (match) {
                return match;
            }
        }
        return null;
    }
    collectParamText(step) {
        const params = step.params ?? {};
        const values = [];
        const fields = ["block", "item", "recipe", "material", "target"];
        for (const field of fields) {
            const value = params[field];
            if (typeof value === "string" && value.trim()) {
                values.push(value.trim());
            }
        }
        return values;
    }
    filterText(message) {
        if (!message || !message.trim()) {
            return { message, matches: [] };
        }
        const isProfane = this.filter.isProfane(message);
        if (!isProfane) {
            return { message, matches: [] };
        }
        const cleaned = this.filter.clean(message);
        return {
            message: cleaned,
            matches: ["profanity_detected"]
        };
    }
    logBlocked(reason, data) {
        this.logger?.logSafety("safety.blocked", reason, data, "warn");
    }
    logFiltered(matches, data) {
        this.logger?.logSafety("safety.filtered", "filtered profanity", { matches, ...data }, "warn");
    }
}
