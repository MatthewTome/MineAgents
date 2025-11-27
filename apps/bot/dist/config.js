import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, YAMLException } from "js-yaml";
import { z } from "zod";

export class ConfigError extends Error {
    line;
    field;
    constructor(message, field, line) {
        const lineInfo = line ? ` (line ${line})` : "";
        const fieldInfo = field ? `${field}: ` : "";
        super(`${fieldInfo}${message}${lineInfo}`);
        this.line = line;
        this.field = field;
    }
}
const configSchema = z.object({
    connection: z.object({
        host: z.string().default("127.0.0.1"),
        port: z.number().int().positive().default(25565),
        username: z.string().min(1).default("MineAgent"),
        version: z.string().min(1).default("1.21")
    }).default({}),
    perception: z.object({
        hz: z.number().positive().max(120).default(5),
        nearbyRange: z.number().positive().default(12),
        blockSampleRadiusXY: z.number().int().nonnegative().default(2),
        blockSampleHalfHeight: z.number().int().nonnegative().default(1),
        maxNearbyEntities: z.number().int().positive().default(24),
        chatBuffer: z.number().int().positive().default(10)
    }).default({})
});

export function loadBotConfig(configPath) {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
        throw new ConfigError(`Config file not found at ${resolved}`);
    }
    const raw = fs.readFileSync(resolved, "utf8");
    const ext = path.extname(resolved).toLowerCase();
    const isYaml = ext === ".yaml" || ext === ".yml";
    const isJson = ext === ".json";
    if (!isYaml && !isJson) {
        throw new ConfigError(`Unsupported config format '${ext || "unknown"}'. Use .yaml, .yml, or .json.`);
    }
    let parsed;
    try {
        if (isYaml) {
            parsed = loadYaml(raw);
        }
        else {
            parsed = JSON.parse(raw);
        }
    }
    catch (err) {
        if (err instanceof ConfigError) {
            throw err;
        }
        if (err instanceof YAMLException) {
            const line = typeof err.mark?.line === "number" ? err.mark.line + 1 : undefined;
            throw new ConfigError(err.message, undefined, line);
        }
        if (err instanceof SyntaxError && isJson) {
            const posMatch = /position (\d+)/i.exec(err.message ?? "");
            const offset = posMatch ? Number(posMatch[1]) : undefined;
            const line = offset !== undefined ? offsetToLine(raw, offset) : undefined;
            throw new ConfigError(`Invalid JSON: ${err.message}`, undefined, line);
        }
        throw new ConfigError(`Unable to parse config: ${String(err)}`);
    }
    const result = configSchema.safeParse(parsed);
    if (!result.success) {
        const issue = result.error.issues[0];
        const field = issue.path.join(".") || "root";
        const line = lineForKey(raw, issue.path);
        throw new ConfigError(issue.message, field, line);
    }
    const withDefaults = result.data;
    return withDefaults;
}

function offsetToLine(raw, offset) {
    const upToOffset = raw.slice(0, offset);
    return upToOffset.split(/\r?\n/).length;
}

function lineForKey(raw, path) {
    const key = path[path.length - 1];
    if (typeof key !== "string") {
        return undefined;
    }
    const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(?:\"${escaped}\"|${escaped})\s*:`, "i");
    const match = regex.exec(raw);
    if (!match) {
        return undefined;
    }
    const offset = match.index;
    return offsetToLine(raw, offset);
}