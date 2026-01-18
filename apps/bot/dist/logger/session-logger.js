import fs from "node:fs";
import path from "node:path";
import util from "node:util";
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
    constructor(existingSessionDir) {
        if (existingSessionDir) {
            this.sessionDir = existingSessionDir;
        }
        else {
            const now = new Date();
            const dateStr = now.toISOString().split("T")[0];
            const timeStr = now.toISOString().replace(/[:.]/g, "-");
            const botName = process.env.BOT_NAME ?? "MineAgent";
            const base = path.join(process.cwd(), "logs", "sessions", dateStr);
            if (!fs.existsSync(base)) {
                fs.mkdirSync(base, { recursive: true });
            }
            this.sessionDir = path.join(base, `${botName}_${timeStr}`);
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }
    get directory() {
        return this.sessionDir;
    }
    installGlobalHandlers() {
        const levels = ["log", "warn", "error", "debug"];
        for (const level of levels) {
            const original = console[level];
            if (typeof original !== "function")
                continue;
            console[level] = (...args) => {
                original.apply(console, args);
                const message = util.format(...args);
                const event = `console.${level}`;
                if (level === "error") {
                    this.error(event, message);
                }
                else if (level === "warn") {
                    this.warn(event, message);
                }
                else {
                    this.info(event, message);
                }
            };
        }
        process.on("uncaughtException", (err) => {
            const msg = err instanceof Error ? err.stack ?? err.message : String(err);
            console.error("[CRASH] Uncaught Exception:", msg);
        });
        process.on("unhandledRejection", (reason) => {
            const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
            console.error("[CRASH] Unhandled Rejection:", msg);
        });
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
    logSafety(event, message, data, level = "info") {
        this.append("safety.log", { level, event, message, data });
    }
    append(fileName, entry) {
        const payload = { ...entry, ts: isoNow() };
        const line = safeStringify(payload) + "\n";
        const filePath = path.join(this.sessionDir, fileName);
        try {
            fs.appendFileSync(filePath, line, "utf8");
        }
        catch (err) {
            process.stdout.write(`[LOGGER FAIL] Could not write to ${filePath}\n`);
        }
    }
}
