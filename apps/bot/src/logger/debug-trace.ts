import type { SessionLogger } from "./session-logger.js";

interface TraceHandle
{
    name: string;
    callId: string;
    count: number;
    startedAt: number;
}

type TraceDetails = Record<string, unknown> | undefined;

function safeSummary(value: unknown): string
{
    if (value === null || value === undefined)
    {
        return String(value);
    }

    if (typeof value === "string")
    {
        return value.length > 200 ? `${value.slice(0, 200)}...` : value;
    }

    if (typeof value === "number" || typeof value === "boolean")
    {
        return String(value);
    }

    if (Array.isArray(value))
    {
        return `Array(${value.length})`;
    }

    if (typeof value === "object")
    {
        const keys = Object.keys(value as object);
        return `Object(${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", ..." : ""})`;
    }

    return String(value);
}

export class DebugTracer
{
    private readonly logger: SessionLogger;
    private readonly counts = new Map<string, number>();
    private sequence = 0;

    constructor(logger: SessionLogger)
    {
        this.logger = logger;
    }

    enter(name: string, details?: TraceDetails): TraceHandle
    {
        const nextCount = (this.counts.get(name) ?? 0) + 1;
        this.counts.set(name, nextCount);

        const callId = `${name}#${this.sequence++}`;
        this.logger.debug("trace.enter", `→ ${name}`, {
            name,
            callId,
            count: nextCount,
            details
        });

        return {
            name,
            callId,
            count: nextCount,
            startedAt: Date.now()
        };
    }

    exit(handle: TraceHandle, details?: TraceDetails, status: "success" | "error" = "success"): void
    {
        const durationMs = Date.now() - handle.startedAt;
        this.logger.debug("trace.exit", `← ${handle.name}`, {
            name: handle.name,
            callId: handle.callId,
            count: handle.count,
            status,
            durationMs,
            details
        });
    }

    highlight(event: string, message: string, details?: TraceDetails): void
    {
        this.logger.info(`trace.${event}`, message, details);
    }

    async traceAsync<T>(name: string, details: TraceDetails, fn: () => Promise<T>): Promise<T>
    {
        const handle = this.enter(name, details);

        try
        {
            const result = await fn();
            this.exit(handle, { result: safeSummary(result) }, "success");
            return result;
        }
        catch (error)
        {
            const errMessage = error instanceof Error ? error.message : safeSummary(error);
            this.exit(handle, { error: errMessage }, "error");
            throw error;
        }
    }

    trace<T>(name: string, details: TraceDetails, fn: () => T): T
    {
        const handle = this.enter(name, details);

        try
        {
            const result = fn();
            this.exit(handle, { result: safeSummary(result) }, "success");
            return result;
        }
        catch (error)
        {
            const errMessage = error instanceof Error ? error.message : safeSummary(error);
            this.exit(handle, { error: errMessage }, "error");
            throw error;
        }
    }
}