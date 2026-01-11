import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, YAMLException } from "js-yaml";
import { z } from "zod";

export interface BotConfig
{
    connection:
    {
        host: string;
        port: number;
        username: string;
        version: string;
    };
    perception:
    {
        hz: number;
        nearbyRange: number;
        blockSampleRadiusXY: number;
        blockSampleHalfHeight: number;
        maxNearbyEntities: number;
        chatBuffer: number;
    };
    safety:
    {
        allowedActions: string[];
        blockedMaterials: string[];
        customProfanityList: string[];
        rateLimits:
        {
            global?: { max: number; windowMs: number };
            perAction?: Record<string, { max: number; windowMs: number }>;
        };
    };
}

export class ConfigError extends Error
{
    public readonly line?: number;
    public readonly field?: string;

    constructor(message: string, field?: string, line?: number)
    {
        const lineInfo = line ? ` (line ${line})` : "";
        const fieldInfo = field ? `${field}: ` : "";
        super(`${fieldInfo}${message}${lineInfo}`);
        this.line = line;
        this.field = field;
    }
}

const configSchema = z.object(
{
    connection: z.object(
    {
        host: z.string().default("127.0.0.1"),
        port: z.number().int().positive().default(25565),
        username: z.string().min(1).default("MineAgent"),
        version: z.string().min(1).default("1.21")
    }).default({}),
    perception: z.object(
    {
        hz: z.number().positive().max(120).default(8),
        nearbyRange: z.number().positive().default(24),
        blockSampleRadiusXY: z.number().int().nonnegative().default(4),
        blockSampleHalfHeight: z.number().int().nonnegative().default(2),
        maxNearbyEntities: z.number().int().positive().default(48),
        chatBuffer: z.number().int().positive().default(20)
        }).default({}),
    safety: z.object(
    {
        allowedActions: z.array(z.string()).default([
            "chat",
            "perceive",
            "analyzeInventory",
            "move",
            "mine",
            "gather",
            "craft",
            "smelt",
            "build",
            "loot",
            "eat",
            "smith",
            "hunt",
            "fight",
            "fish"
        ]),
        blockedMaterials: z.array(z.string()).default([
            "tnt",
            "lava",
            "flint_and_steel",
            "fire_charge",
            "fire"
        ]),
        customProfanityList: z.array(z.string()).default([
            "kys",
            "kill yourself"
        ]),
        rateLimits: z.object(
        {
            global: z.object(
            {
                max: z.number().int().positive().default(24),
                windowMs: z.number().int().positive().default(10000)
            }).default({}),
            perAction: z.record(z.object(
            {
                max: z.number().int().positive(),
                windowMs: z.number().int().positive()
            })).default({
                chat: { max: 4, windowMs: 2000 },
                build: { max: 2, windowMs: 2000 },
                mine: { max: 6, windowMs: 2000 }
            })
        }).default({})
    }).default({})
});

type ConfigShape = z.infer<typeof configSchema>;

export function loadBotConfig(configPath: string): BotConfig
{
    const resolved = path.resolve(configPath);

    if (!fs.existsSync(resolved))
    {
        throw new ConfigError(`Config file not found at ${resolved}`);
    }

    const raw = fs.readFileSync(resolved, "utf8");
    const ext = path.extname(resolved).toLowerCase();

    const isYaml = ext === ".yaml" || ext === ".yml";
    const isJson = ext === ".json";

    if (!isYaml && !isJson)
    {
        throw new ConfigError(`Unsupported config format '${ext || "unknown"}'. Use .yaml, .yml, or .json.`);
    }

    let parsed: unknown;

    try
    {
        if (isYaml)
        {
            parsed = loadYaml(raw);
        }
        else
        {
            parsed = JSON.parse(raw);
        }
    }
    catch (err: any)
    {
        if (err instanceof ConfigError)
        {
            throw err;
        }

        if (err instanceof YAMLException)
        {
            const line = typeof err.mark?.line === "number" ? err.mark.line + 1 : undefined;
            throw new ConfigError(err.message, undefined, line);
        }

        if (err instanceof SyntaxError && isJson)
        {
            const posMatch = /position (\d+)/i.exec(err.message ?? "");
            const offset = posMatch ? Number(posMatch[1]) : undefined;
            const line = offset !== undefined ? offsetToLine(raw, offset) : undefined;
            throw new ConfigError(`Invalid JSON: ${err.message}`, undefined, line);
        }

        throw new ConfigError(`Unable to parse config: ${String(err)}`);
    }

    const result = configSchema.safeParse(parsed);
    if (!result.success)
    {
        const issue = result.error.issues[0];
        const field = issue.path.join(".") || "root";
        const line = lineForKey(raw, issue.path);
        throw new ConfigError(issue.message, field, line);
    }

    const withDefaults: ConfigShape = result.data;
    return withDefaults as BotConfig;
}

function offsetToLine(raw: string, offset: number): number
{
    const upToOffset = raw.slice(0, offset);
    return upToOffset.split(/\r?\n/).length;
}

function lineForKey(raw: string, path: (string | number)[]): number | undefined
{
    const key = path[path.length - 1];
    if (typeof key !== "string")
    {
        return undefined;
    }

    const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(?:\"${escaped}\"|${escaped})\s*:`, "i");
    const match = regex.exec(raw);

    if (!match)
    {
        return undefined;
    }

    const offset = match.index;
    return offsetToLine(raw, offset);
}