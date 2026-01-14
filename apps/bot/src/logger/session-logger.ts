import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import type { ActionLogEntry } from "../actions/action-executor.js";
import type { PlanRequest, PlanResult } from "../planner/planner.js";

interface BaseEntry
{
    ts: string;
    level: "info" | "warn" | "error";
    event: string;
    message?: string;
    data?: object;
}

function isoNow(): string
{
    return new Date().toISOString();
}

function safeStringify(value: unknown): string
{
    try
    {
        return JSON.stringify(value);
    }
    catch
    {
        return String(value);
    }
}

export class SessionLogger
{
    public readonly sessionDir: string;

    constructor(existingSessionDir?: string)
    {
        if (existingSessionDir)
        {
            this.sessionDir = existingSessionDir;
        }
        else
        {
            const now = new Date();
            const dateStr = now.toISOString().split("T")[0];
            const timeStr = now.toISOString().replace(/[:.]/g, "-");

            const base = path.join(process.cwd(), "logs", "sessions", dateStr);
            
            if (!fs.existsSync(base))
            {
                fs.mkdirSync(base, { recursive: true });
            }

            this.sessionDir = path.join(base, `session-${timeStr}`);
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

    get directory(): string
    {
        return this.sessionDir;
    }

    installGlobalHandlers(): void
    {
        const levels = ["log", "warn", "error", "debug"] as const;

        for (const level of levels)
        {
            const original = (console as any)[level];
            if (typeof original !== "function") continue;

            (console as any)[level] = (...args: any[]) =>
            {
                original.apply(console, args);

                const message = util.format(...args);
                const event = `console.${level}`;

                if (level === "error")
                {
                    this.error(event, message);
                }
                else if (level === "warn")
                {
                    this.warn(event, message);
                }
                else
                {
                    this.info(event, message);
                }
            };
        }

        process.on("uncaughtException", (err) =>
        {
            const msg = err instanceof Error ? err.stack ?? err.message : String(err);
            console.error("[CRASH] Uncaught Exception:", msg);
        });

        process.on("unhandledRejection", (reason) =>
        {
            const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
            console.error("[CRASH] Unhandled Rejection:", msg);
        });
    }

    info(event: string, message?: string, data?: Record<string, unknown>): void
    {
        this.append("session.log", { level: "info", event, message, data });
    }

    warn(event: string, message?: string, data?: Record<string, unknown>): void
    {
        this.append("session.log", { level: "warn", event, message, data });
    }

    error(event: string, message?: string, data?: Record<string, unknown>): void
    {
        this.append("errors.log", { level: "error", event, message, data });
    }

    logAction(entry: ActionLogEntry): void
    {
        this.append("actions.log", { level: "info", event: "action", data: entry });
    }

    logPerceptionSnapshot(summary: Record<string, unknown>): void
    {
        this.append("perception.log", { level: "info", event: "perception", data: summary });
    }

    logPlannerPrompt(prompt: string, request: PlanRequest): void
    {
        this.append("planner.log", { level: "info", event: "planner.prompt", data: { goal: request.goal, context: request.context ?? "", perceptionIncluded: Boolean(request.perception), prompt } });
    }

    logPlannerResponse(raw: string, meta: { backend: "local" | "remote"; model: string }): void
    {
        this.append("planner.log", { level: "info", event: "planner.response", data: { raw, backend: meta.backend, model: meta.model } });
    }

    logPlannerParsed(plan: Omit<PlanResult, "backend"> & { backend?: "local" | "remote" }): void
    {
        this.append("planner.log", { level: "info", event: "planner.parsed", data: { intent: plan.intent, steps: plan.steps, model: plan.model, backend: plan.backend, raw: plan.raw } });
    }

    logPlannerError(error: unknown, context: { prompt: string; request: PlanRequest }): void
    {
        const errString = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : safeStringify(error);
        this.append("planner.log", { level: "error", event: "planner.error", data: { error: errString, goal: context.request.goal, prompt: context.prompt } });
    }

    logSafety(event: string, message?: string, data?: Record<string, unknown>, level: "info" | "warn" = "info"): void
    {
        this.append("safety.log", { level, event, message, data });
    }

    private append(fileName: string, entry: Omit<BaseEntry, "ts">): void
    {
        const payload: BaseEntry = { ...entry, ts: isoNow() };
        const line = safeStringify(payload) + "\n";
        const filePath = path.join(this.sessionDir, fileName);
        
        try {
            fs.appendFileSync(filePath, line, "utf8");
        } catch (err) {
            process.stdout.write(`[LOGGER FAIL] Could not write to ${filePath}\n`);
        }
    }
}