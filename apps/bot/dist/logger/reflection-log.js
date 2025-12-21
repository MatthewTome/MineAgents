import fs from "node:fs";
import path from "node:path";
export class ReflectionLogger {
    entries = [];
    sessionStarted = Date.now();
    logDir;
    constructor(logDir) {
        this.logDir = logDir ?? path.join(process.cwd(), "logs");
        fs.mkdirSync(this.logDir, { recursive: true });
    }
    record(log) {
        const entry = {
            ts: log.ts,
            id: log.id,
            action: log.action,
            status: log.status,
            attempts: log.attempts,
            description: log.description,
            reason: log.reason
        };
        this.entries.push(entry);
    }
    getEntries() {
        return [...this.entries];
    }
    writeSummaryFile(label) {
        const iso = new Date(this.sessionStarted).toISOString().replace(/[:]/g, "-");
        const baseName = label ? sanitizeLabel(label) : `session-${iso}`;
        const filePath = path.join(this.logDir, `${baseName}.log`);
        const lines = [];
        lines.push(`Session started: ${new Date(this.sessionStarted).toISOString()}`);
        lines.push(`Entries: ${this.entries.length}`);
        for (const entry of this.entries) {
            const stamp = new Date(entry.ts).toISOString();
            const desc = entry.description ? ` desc="${entry.description}"` : "";
            const reason = entry.reason ? ` reason="${entry.reason}"` : "";
            lines.push(`[${stamp}] id=${entry.id} action=${entry.action} status=${entry.status} attempts=${entry.attempts}${desc}${reason}`);
        }
        fs.writeFileSync(filePath, lines.join("\n"), "utf8");
        return filePath;
    }
}
function sanitizeLabel(label) {
    return label
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9-_]/g, "")
        .toLowerCase()
        || "session";
}
