import type { Bot } from "mineflayer";
import type { SafetyRails, SafetyCheckResult } from "../safety/safety-rails.js";
import type { DebugTracer } from "../logger/debug-trace.js";

export type ActionHandler = (bot: Bot, step: ActionStep) => Promise<void>;

export interface ActionStep
{
    id: string;
    action: string;
    params?: Record<string, unknown>;
    description?: string;
}

export interface ActionExecutorOptions
{
    maxAttempts: number;
    baseBackoffMs: number;
    logger?: (entry: ActionLogEntry) => void;
    safety?: SafetyRails;
    tracer?: DebugTracer;
}

export type ActionStatus = "success" | "failed" | "skipped" | "retry" | "started" | "aborted";

export interface ActionResult
{
    id: string;
    action: string;
    status: Exclude<ActionStatus, "retry" | "started">;
    attempts: number;
    reason?: string;
}

export interface ActionLogEntry
{
    id: string;
    action: string;
    status: ActionStatus;
    attempts: number;
    reason?: string;
    ts: number;
    description?: string;
}

const DEFAULT_OPTIONS: ActionExecutorOptions =
{
    maxAttempts: 3,
    baseBackoffMs: 250,
    logger: undefined,
    safety: undefined
};

const BUILT_IN_HANDLERS: Record<string, ActionHandler> =
{
    chat: async (bot, step) =>
    {
        const message = String(step.params?.message ?? "").trim();
        if (!message)
        {
            throw new Error("Chat action missing message");
        }
        bot.chat(message);
    }
};

export class ActionExecutor
{
    private bot: Bot;
    private handlers: Map<string, ActionHandler>;
    private executed: Set<string> = new Set();
    private executing: Set<string> = new Set();
    private log: ActionLogEntry[] = [];
    private options: ActionExecutorOptions;
    private safety?: SafetyRails;
    private tracer?: DebugTracer;
    private aborted = false;

    constructor(bot: Bot, handlers?: Record<string, ActionHandler>, options?: Partial<ActionExecutorOptions>)
    {
        this.bot = bot;
        this.handlers = new Map<string, ActionHandler>(Object.entries(BUILT_IN_HANDLERS));

        if (handlers)
        {
            for (const [key, handler] of Object.entries(handlers))
            {
                this.handlers.set(key, handler);
            }
        }

        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.safety = this.options.safety;
        this.tracer = this.options.tracer;
    }

    reset(): void
    {
        this.abort();
        this.executed.clear();
        this.executing.clear();
        this.log = [];
    }

    abort(): void
    {
        this.aborted = true;
        try {
            this.bot.pathfinder?.stop();
        } catch {}
    }

    setSafety(safety?: SafetyRails): void
    {
        this.safety = safety;
    }

    async executePlan(steps: ActionStep[]): Promise<ActionResult[]>
    {
        const run = async () =>
        {
            this.aborted = false; 
            const results: ActionResult[] = [];

            for (const step of steps)
            {
                if (this.aborted)
                {
                    const entry = this.logEntry(step, "aborted", 0, "Plan execution aborted externally");
                    results.push(this.toResult(entry));
                    break;
                }

                const result = await this.executeStep(step);
                results.push(result);
                
                if (this.aborted) break;
            }

            return results;
        };

        if (this.tracer)
        {
            return this.tracer.traceAsync("ActionExecutor.executePlan", { stepCount: steps.length }, run);
        }

        return run();
    }

    getLogs(): ActionLogEntry[]
    {
        return [...this.log];
    }

    hasExecuted(stepId: string): boolean
    {
        return this.executed.has(stepId);
    }

    private async executeStep(step: ActionStep): Promise<ActionResult>
    { 
        const run = async (): Promise<ActionResult> =>
        {
            if (this.aborted)
            {
                const entry = this.logEntry(step, "aborted", 0, "Plan execution aborted");
                return this.toResult(entry);
            }

            if (this.executed.has(step.id))
            {
                const entry = this.logEntry(step, "skipped", 0, "duplicate action id already succeeded");
                return this.toResult(entry);
            }

            if (this.executing.has(step.id))
            {
                const entry = this.logEntry(step, "skipped", 0, "duplicate action id already in progress");
                return this.toResult(entry);
            }

            const safetyCheck = this.applySafety(step);
            if (safetyCheck && !safetyCheck.allowed)
            {
                const entry = this.logEntry(step, "failed", 0, safetyCheck.reason ?? "blocked by safety rails");
                return this.toResult(entry);
            }

            const guardedStep = safetyCheck?.step ?? step;
            const handler = this.handlers.get(guardedStep.action);

            if (!handler)
            {
                const entry = this.logEntry(step, "failed", 0, `unsupported action '${step.action}'`);
                return this.toResult(entry);
            }

            this.executing.add(guardedStep.id);
            
            this.logEntry(guardedStep, "started", 1, undefined);
            this.tracer?.highlight("action.started", "Action started", {
                id: guardedStep.id,
                action: guardedStep.action,
                description: guardedStep.description
            });

            let attempts = 0;
            let lastReason: string | undefined;

            while (attempts < this.options.maxAttempts)
            {
                if (this.aborted)
                {
                    this.executing.delete(guardedStep.id);
                    return { id: guardedStep.id, action: guardedStep.action, status: "aborted", attempts, reason: "Aborted during retry loop" };
                }

                attempts++;

                try
                {
                    await handler(this.bot, guardedStep);
                    
                    if (this.aborted)
                    {
                        this.executing.delete(guardedStep.id);
                        return { 
                            id: guardedStep.id, 
                            action: guardedStep.action, 
                            status: "aborted", 
                            attempts, 
                            reason: "Aborted immediately after execution" 
                        };
                    }

                    this.executed.add(guardedStep.id);
                    const entry = this.logEntry(guardedStep, "success", attempts, undefined);
                    this.tracer?.highlight("action.completed", "Action completed", {
                        id: guardedStep.id,
                        action: guardedStep.action,
                        attempts,
                        status: "success"
                    });
                    this.executing.delete(guardedStep.id);
                    return this.toResult(entry);
                }
                catch (err: any)
                {
                    if (this.aborted)
                    {
                         this.executing.delete(guardedStep.id);
                         return { id: guardedStep.id, action: guardedStep.action, status: "aborted", attempts, reason: "Aborted during execution error" };
                    }

                    lastReason = err?.message ?? String(err);
                    const hasMore = attempts < this.options.maxAttempts;
                    const status: ActionStatus = hasMore ? "retry" : "failed";
                    this.logEntry(guardedStep, status, attempts, lastReason);

                    if (!hasMore)
                    {
                        this.tracer?.highlight("action.completed", "Action completed", {
                            id: guardedStep.id,
                            action: guardedStep.action,
                            attempts,
                            status: "failed",
                            reason: lastReason
                        });
                        this.executing.delete(guardedStep.id);
                        return { id: guardedStep.id, action: guardedStep.action, status: "failed", attempts, reason: lastReason };
                    }

                    const delay = this.backoffMs(attempts);
                    await this.sleep(delay);
                }
            }

            this.executing.delete(guardedStep.id);
            return { id: guardedStep.id, action: guardedStep.action, status: "failed", attempts, reason: lastReason };
        };

        if (this.tracer)
        {
            return this.tracer.traceAsync("ActionExecutor.executeStep", {
                stepId: step.id,
                action: step.action,
                description: step.description
            }, run);
        }

        return run();
    }

    private applySafety(step: ActionStep): SafetyCheckResult | undefined
    {
        if (!this.safety)
        {
            return undefined;
        }

        return this.safety.checkStep(step);
    }

    private logEntry(step: ActionStep, status: ActionStatus, attempts: number, reason?: string): ActionLogEntry
    {
        const entry: ActionLogEntry =
        {
            id: step.id,
            action: step.action,
            status,
            attempts,
            reason,
            ts: Date.now(),
            description: step.description
        };

        this.log.push(entry);

        if (this.options.logger)
        {
            this.options.logger(entry);
        }

        return entry;
    }

    private toResult(entry: ActionLogEntry): ActionResult
    {
        return { 
            id: entry.id, 
            action: entry.action, 
            status: entry.status as ActionResult["status"], 
            attempts: entry.attempts, 
            reason: entry.reason 
        };
    }

    private backoffMs(attempt: number): number
    {
        const pow = Math.max(0, attempt - 1);
        return this.options.baseBackoffMs * Math.pow(2, pow);
    }

    private sleep(ms: number): Promise<void>
    {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}