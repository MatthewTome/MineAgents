import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, YAMLException } from "js-yaml";
import { z } from "zod";
import { resolveRole, type AgentRole } from "../teamwork/roles.js";

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
    agent:
    {
        role: "gatherer" | "builder" | "supervisor" | "generalist";
    };
    features:
    {
        ragEnabled: boolean;
        narrationEnabled: boolean;
        safetyEnabled: boolean;
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

const DEFAULTS = {
    connection: {
        host: "127.0.0.1",
        port: 25565,
        username: "MineAgent",
        version: "1.21"
    },
    perception: {
        hz: 8,
        nearbyRange: 24,
        blockSampleRadiusXY: 4,
        blockSampleHalfHeight: 2,
        maxNearbyEntities: 48,
        chatBuffer: 20
    },
    safety: {
        allowedActions: [
            "analyzeInventory",
            "build",
            "chat",
            "craft",
            "drop",
            "equip",
            "gather",
            "give",
            "loot",
            "mine",
            "move",
            "perceive",
            "pickup",
            "place",
            "requestResource",
            "smelt",
        ],
        blockedMaterials: [
            "tnt", "lava", "flint_and_steel", "fire_charge", "fire"
        ],
        customProfanityList: [
            "kys", "kill yourself"
        ],
        rateLimits: {
            global: { max: 24, windowMs: 10000 },
            perAction: {
                chat: { max: 10, windowMs: 2000 },
                build: { max: 50, windowMs: 5000 },
                mine: { max: 50, windowMs: 5000 }
            }
        }
    },
    agent: {
        role: "generalist" as const
    },
    features: {
        ragEnabled: true,
        narrationEnabled: true,
        safetyEnabled: true
    }
};

export const DEFAULT_BOT_CONFIG: BotConfig =
{
    connection: { ...DEFAULTS.connection },
    perception: { ...DEFAULTS.perception },
    safety: {
        ...DEFAULTS.safety,
        rateLimits: {
            global: { ...DEFAULTS.safety.rateLimits.global },
            perAction: { ...DEFAULTS.safety.rateLimits.perAction }
        }
    },
    agent: {
        role: DEFAULTS.agent.role,
    },
    features: { ...DEFAULTS.features }
};

export function createDefaultBotConfig(): BotConfig
{
    return structuredClone(DEFAULT_BOT_CONFIG);
}

const configSchema = z.object(
{
    connection: z.object(
    {
        host: z.string().default(DEFAULTS.connection.host),
        port: z.number().int().positive().default(DEFAULTS.connection.port),
        username: z.string().min(1).default(DEFAULTS.connection.username),
        version: z.string().min(1).default(DEFAULTS.connection.version)
    }).default(DEFAULTS.connection),
    perception: z.object(
    {
        hz: z.number().positive().max(120).default(DEFAULTS.perception.hz),
        nearbyRange: z.number().positive().default(DEFAULTS.perception.nearbyRange),
        blockSampleRadiusXY: z.number().int().nonnegative().default(DEFAULTS.perception.blockSampleRadiusXY),
        blockSampleHalfHeight: z.number().int().nonnegative().default(DEFAULTS.perception.blockSampleHalfHeight),
        maxNearbyEntities: z.number().int().positive().default(DEFAULTS.perception.maxNearbyEntities),
        chatBuffer: z.number().int().positive().default(DEFAULTS.perception.chatBuffer)
    }).default(DEFAULTS.perception),
    safety: z.object(
    {
        allowedActions: z.array(z.string()).default(DEFAULTS.safety.allowedActions),
        blockedMaterials: z.array(z.string()).default(DEFAULTS.safety.blockedMaterials),
        customProfanityList: z.array(z.string()).default(DEFAULTS.safety.customProfanityList),
        rateLimits: z.object(
        {
            global: z.object(
            {
                max: z.number().int().positive().default(DEFAULTS.safety.rateLimits.global.max),
                windowMs: z.number().int().positive().default(DEFAULTS.safety.rateLimits.global.windowMs)
            }).default(DEFAULTS.safety.rateLimits.global),
            perAction: z.record(z.string(), z.object(
            {
                max: z.number().int().positive(),
                windowMs: z.number().int().positive()
            })).default(DEFAULTS.safety.rateLimits.perAction)
        }).default(DEFAULTS.safety.rateLimits)
    }).default(DEFAULTS.safety),
    agent: z.object(
    {
        role: z.enum(["gatherer", "builder", "supervisor", "generalist", "miner"])
            .default(DEFAULTS.agent.role)
            .transform((val): AgentRole => {
                const resolved = resolveRole(val);
                if (!resolved) {
                    throw new Error(`Invalid role: ${val}`);
                }
                return resolved;
            })
    }).default(DEFAULTS.agent),
    features: z.object(
    {
        ragEnabled: z.boolean().default(DEFAULTS.features.ragEnabled),
        narrationEnabled: z.boolean().default(DEFAULTS.features.narrationEnabled),
        safetyEnabled: z.boolean().default(DEFAULTS.features.safetyEnabled)
    }).default(DEFAULTS.features)
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
        const line = lineForKey(raw, issue.path as (string | number)[]);
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