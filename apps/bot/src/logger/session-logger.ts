import fs from "node:fs";
import path from "node:path";
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

    constructor(sessionDir?: string)
    {
        const base = sessionDir ?? path.join(process.cwd(), "logs", "sessions");
        const resolved = sessionDir ?? path.join(base, `session-${isoNow().replace(/[:]/g, "-")}`);

        this.sessionDir = resolved;
        fs.mkdirSync(this.sessionDir, { recursive: true });
    }

    get directory(): string
    {
        return this.sessionDir;
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

    private append(fileName: string, entry: Omit<BaseEntry, "ts">): void
    {
        const payload: BaseEntry = { ...entry, ts: isoNow() };
        const line = safeStringify(payload) + "\n";
        const filePath = path.join(this.sessionDir, fileName);
        fs.appendFileSync(filePath, line, "utf8");
    }
}