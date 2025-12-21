import fs from "node:fs";
import path from "node:path";
import { ActionLogEntry, ActionStatus } from "../actions/action-executor.js";

export interface ReflectionEntry
{
    ts: number;
    id: string;
    action: string;
    status: ActionStatus;
    attempts: number;
    description?: string;
    reason?: string;
}

export class ReflectionLogger
{
    private entries: ReflectionEntry[] = [];
    private readonly sessionStarted: number = Date.now();
    private readonly logDir: string;

    constructor(logDir?: string)
    {
        this.logDir = logDir ?? path.join(process.cwd(), "logs");
        fs.mkdirSync(this.logDir, { recursive: true });
    }

    record(log: ActionLogEntry): void
    {
        const entry: ReflectionEntry =
        {
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

    getEntries(): ReflectionEntry[]
    {
        return [...this.entries];
    }

    writeSummaryFile(label?: string): string
    {
        const iso = new Date(this.sessionStarted).toISOString().replace(/[:]/g, "-");
        const baseName = label ? sanitizeLabel(label) : `session-${iso}`;
        const filePath = path.join(this.logDir, `${baseName}.log`);

        const lines: string[] = [];
        lines.push(`Session started: ${new Date(this.sessionStarted).toISOString()}`);
        lines.push(`Entries: ${this.entries.length}`);

        for (const entry of this.entries)
        {
            const stamp = new Date(entry.ts).toISOString();
            const desc = entry.description ? ` desc="${entry.description}"` : "";
            const reason = entry.reason ? ` reason="${entry.reason}"` : "";
            lines.push(`[${stamp}] id=${entry.id} action=${entry.action} status=${entry.status} attempts=${entry.attempts}${desc}${reason}`);
        }

        fs.writeFileSync(filePath, lines.join("\n"), "utf8");

        return filePath;
    }
}

function sanitizeLabel(label: string): string
{
    return label
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9-_]/g, "")
        .toLowerCase()
        || "session";
}