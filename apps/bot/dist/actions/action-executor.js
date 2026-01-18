const DEFAULT_OPTIONS = {
    maxAttempts: 3,
    baseBackoffMs: 250,
    logger: undefined,
    safety: undefined
};
const BUILT_IN_HANDLERS = {
    chat: async (bot, step) => {
        const message = String(step.params?.message ?? "").trim();
        if (!message) {
            throw new Error("Chat action missing message");
        }
        bot.chat(message);
    }
};
export class ActionExecutor {
    bot;
    handlers;
    executed = new Set();
    executing = new Set();
    log = [];
    options;
    safety;
    constructor(bot, handlers, options) {
        this.bot = bot;
        this.handlers = new Map(Object.entries(BUILT_IN_HANDLERS));
        if (handlers) {
            for (const [key, handler] of Object.entries(handlers)) {
                this.handlers.set(key, handler);
            }
        }
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.safety = this.options.safety;
    }
    reset() {
        this.executed.clear();
        this.executing.clear();
        this.log = [];
    }
    setSafety(safety) {
        this.safety = safety;
    }
    async executePlan(steps) {
        const results = [];
        for (const step of steps) {
            const result = await this.executeStep(step);
            results.push(result);
        }
        return results;
    }
    getLogs() {
        return [...this.log];
    }
    hasExecuted(stepId) {
        return this.executed.has(stepId);
    }
    async executeStep(step) {
        if (this.executed.has(step.id)) {
            const entry = this.logEntry(step, "skipped", 0, "duplicate action id already succeeded");
            return this.toResult(entry);
        }
        if (this.executing.has(step.id)) {
            const entry = this.logEntry(step, "skipped", 0, "duplicate action id already in progress");
            return this.toResult(entry);
        }
        const safetyCheck = this.applySafety(step);
        if (safetyCheck && !safetyCheck.allowed) {
            const entry = this.logEntry(step, "failed", 0, safetyCheck.reason ?? "blocked by safety rails");
            return this.toResult(entry);
        }
        const guardedStep = safetyCheck?.step ?? step;
        const handler = this.handlers.get(guardedStep.action);
        if (!handler) {
            const entry = this.logEntry(step, "failed", 0, `unsupported action '${step.action}'`);
            return this.toResult(entry);
        }
        this.executing.add(guardedStep.id);
        this.logEntry(guardedStep, "started", 1, undefined);
        let attempts = 0;
        let lastReason;
        while (attempts < this.options.maxAttempts) {
            attempts++;
            try {
                await handler(this.bot, guardedStep);
                this.executed.add(guardedStep.id);
                const entry = this.logEntry(guardedStep, "success", attempts, undefined);
                this.executing.delete(guardedStep.id);
                return this.toResult(entry);
            }
            catch (err) {
                lastReason = err?.message ?? String(err);
                const hasMore = attempts < this.options.maxAttempts;
                const status = hasMore ? "retry" : "failed";
                this.logEntry(guardedStep, status, attempts, lastReason);
                if (!hasMore) {
                    this.executing.delete(guardedStep.id);
                    return { id: guardedStep.id, action: guardedStep.action, status: "failed", attempts, reason: lastReason };
                }
                const delay = this.backoffMs(attempts);
                await this.sleep(delay);
            }
        }
        this.executing.delete(guardedStep.id);
        return { id: guardedStep.id, action: guardedStep.action, status: "failed", attempts, reason: lastReason };
    }
    applySafety(step) {
        if (!this.safety) {
            return undefined;
        }
        return this.safety.checkStep(step);
    }
    logEntry(step, status, attempts, reason) {
        const entry = {
            id: step.id,
            action: step.action,
            status,
            attempts,
            reason,
            ts: Date.now(),
            description: step.description
        };
        this.log.push(entry);
        if (this.options.logger) {
            this.options.logger(entry);
        }
        return entry;
    }
    toResult(entry) {
        return {
            id: entry.id,
            action: entry.action,
            status: entry.status,
            attempts: entry.attempts,
            reason: entry.reason
        };
    }
    backoffMs(attempt) {
        const pow = Math.max(0, attempt - 1);
        return this.options.baseBackoffMs * Math.pow(2, pow);
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
