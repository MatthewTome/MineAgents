import fs from "node:fs";
import path from "node:path";
function isoNow() {
    return new Date().toISOString();
}
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
export class SessionLogger {
    sessionDir;
    constructor(sessionDir) {
        const base = sessionDir ?? path.join(process.cwd(), "logs", "sessions");
        const resolved = sessionDir ?? path.join(base, `session-${isoNow().replace(/[:]/g, "-")}`);
        this.sessionDir = resolved;
        fs.mkdirSync(this.sessionDir, { recursive: true });
    }
    get directory() {
        return this.sessionDir;
    }
    info(event, message, data) {
        this.append("session.log", { level: "info", event, message, data });
    }
    warn(event, message, data) {
        this.append("session.log", { level: "warn", event, message, data });
    }
    error(event, message, data) {
        this.append("errors.log", { level: "error", event, message, data });
    }
    logAction(entry) {
        this.append("actions.log", { level: "info", event: "action", data: entry });
    }
    logPerceptionSnapshot(summary) {
        this.append("perception.log", { level: "info", event: "perception", data: summary });
    }
    logPlannerPrompt(prompt, request) {
        this.append("planner.log", { level: "info", event: "planner.prompt", data: { goal: request.goal, context: request.context ?? "", perceptionIncluded: Boolean(request.perception), prompt } });
    }
    logPlannerResponse(raw, meta) {
        this.append("planner.log", { level: "info", event: "planner.response", data: { raw, backend: meta.backend, model: meta.model } });
    }
    logPlannerParsed(plan) {
        this.append("planner.log", { level: "info", event: "planner.parsed", data: { intent: plan.intent, steps: plan.steps, model: plan.model, backend: plan.backend, raw: plan.raw } });
    }
    logPlannerError(error, context) {
        const errString = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : safeStringify(error);
        this.append("planner.log", { level: "error", event: "planner.error", data: { error: errString, goal: context.request.goal, prompt: context.prompt } });
    }
    append(fileName, entry) {
        const payload = { ...entry, ts: isoNow() };
        const line = safeStringify(payload) + "\n";
        const filePath = path.join(this.sessionDir, fileName);
        fs.appendFileSync(filePath, line, "utf8");
    }
}
