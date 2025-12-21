import type { Bot } from "mineflayer";

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
}

export type ActionStatus = "success" | "failed" | "skipped" | "retry";

export interface ActionResult
{
    id: string;
    action: string;
    status: Exclude<ActionStatus, "retry">;
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
    logger: undefined
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
    }

    reset(): void
    {
        this.executed.clear();
        this.executing.clear();
        this.log = [];
    }

    async executePlan(steps: ActionStep[]): Promise<ActionResult[]>
    {
        const results: ActionResult[] = [];

        for (const step of steps)
        {
            const result = await this.executeStep(step);
            results.push(result);
        }

        return results;
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

        const handler = this.handlers.get(step.action);

        if (!handler)
        {
            const entry = this.logEntry(step, "failed", 0, `unsupported action '${step.action}'`);
            return this.toResult(entry);
        }

        this.executing.add(step.id);

        let attempts = 0;
        let lastReason: string | undefined;

        while (attempts < this.options.maxAttempts)
        {
            attempts++;

            try
            {
                await handler(this.bot, step);
                this.executed.add(step.id);
                const entry = this.logEntry(step, "success", attempts, undefined);
                this.executing.delete(step.id);
                return this.toResult(entry);
            }
            catch (err: any)
            {
                lastReason = err?.message ?? String(err);
                const hasMore = attempts < this.options.maxAttempts;
                const status: ActionStatus = hasMore ? "retry" : "failed";
                this.logEntry(step, status, attempts, lastReason);

                if (!hasMore)
                {
                    this.executing.delete(step.id);
                    return { id: step.id, action: step.action, status: "failed", attempts, reason: lastReason };
                }

                const delay = this.backoffMs(attempts);
                await this.sleep(delay);
            }
        }

        this.executing.delete(step.id);
        return { id: step.id, action: step.action, status: "failed", attempts, reason: lastReason };
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
        return { id: entry.id, action: entry.action, status: entry.status as Exclude<ActionStatus, "retry">, attempts: entry.attempts, reason: entry.reason };
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