import type { Bot } from "mineflayer";
import { ActionExecutor, type ActionResult, type ActionStep } from "../action-executor.js";
import type { SafetyRails } from "../../safety/safety-rails.js";

export interface PlanIntent
{
    intent?: string;
    goal?: string;
    steps?: ActionStep[];
}

export interface PlanNarratorOptions
{
    maxLength: number;
    minIntervalMs: number;
    formatter?: (plan: PlanIntent) => string;
}

export class PlanNarrator
{
    private lastNarrationAt = Number.NEGATIVE_INFINITY;
    private readonly options: PlanNarratorOptions;

    constructor(options?: Partial<PlanNarratorOptions>)
    {
        this.options =
        {
            maxLength: options?.maxLength ?? 140,
            minIntervalMs: options?.minIntervalMs ?? 1000,
            formatter: options?.formatter
        } as PlanNarratorOptions;
    }

    maybeNarrate(plan: PlanIntent, now: number = Date.now()): string | null
    {
        if (now - this.lastNarrationAt < this.options.minIntervalMs)
        {
            return null;
        }

        const summary = this.format(plan);
        this.lastNarrationAt = now;
        return summary;
    }

    narrateRecovery(plan: PlanIntent, failedStepId: string): string
    {
        const base = this.format(plan);
        const text = `Adapting plan (stuck on ${failedStepId}): ${base}`;
        this.lastNarrationAt = Date.now();
        return this.trimToLimit(text, this.options.maxLength);
    }

    private format(plan: PlanIntent): string
    {
        const formatter = this.options.formatter ?? defaultFormatter;
        const raw = formatter(plan).replace(/\s+/g, " ").trim();
        return this.trimToLimit(raw, this.options.maxLength);
    }

    private trimToLimit(text: string, limit: number): string
    {
        if (text.length <= limit)
        {
            return text;
        }

        if (limit <= 3)
        {
            return text.slice(0, limit);
        }

        return `${text.slice(0, limit - 3)}...`;
    }
}

function defaultFormatter(plan: PlanIntent): string
{
    if (plan.intent)
    {
        return plan.intent;
    }

    const steps = plan.steps ?? [];
    const primary = steps[0];
    const stepSummary = primary ? `${primary.action}${primary.description ? `: ${primary.description}` : ""}` : "planning actions";
    const goal = plan.goal ? ` for ${plan.goal}` : "";
    const count = steps.length > 1 ? ` (${steps.length} steps)` : "";
    return `${stepSummary}${goal}${count}`;
}

export interface ChatBridgeOptions
{
    prefix?: string;
    safety?: SafetyRails;
}

export async function handleChatCommand(bot: Bot, executor: ActionExecutor, username: string, message: string, options?: ChatBridgeOptions): Promise<boolean>
{
    const prefix = options?.prefix ?? "!";

    if (!message.startsWith(prefix))
    {
        return false;
    }

    const trimmed = message.trim();
    const sayCmd = `${prefix}say`;
    const actCmd = `${prefix}act`;

    if (trimmed.startsWith(sayCmd))
    {
        const handled = await handleSay(bot, executor, username, trimmed, sayCmd, options?.safety);
        return handled;
    }

    if (trimmed.startsWith(actCmd))
    {
        const handled = await handleAct(bot, executor, username, trimmed, actCmd, options?.safety);
        return handled;
    }

    return false;
}

export function wireChatBridge(bot: Bot, executor: ActionExecutor, options?: ChatBridgeOptions): () => void
{
    const listener = async (username: string, message: string) =>
    {
        if (username === bot.username)
        {
            return;
        }

        try
        {
            const handled = await handleChatCommand(bot, executor, username, message, options);
            if (!handled)
            {
                return;
            }
        }
        catch (err)
        {
            console.error("[chat-bridge] failed to handle command", err);
            bot.chat("Command error; check server logs.");
        }
    };

    bot.on("chat", listener);

    return () => bot.removeListener("chat", listener);
}

async function handleSay(bot: Bot, executor: ActionExecutor, username: string, trimmed: string, sayCmd: string, safety?: SafetyRails): Promise<boolean>
{
    const withoutCmd = trimmed.replace(new RegExp(`^${escapeRegExp(sayCmd)}\\s*`), "");
    if (!withoutCmd)
    {
        safeChat(bot, safety, `Usage: ${sayCmd} <message>`, "chat.command.usage");
        return true;
    }

    const { id, payload } = parseIdAndPayload(withoutCmd);
    const step: ActionStep =
    {
        id: id ?? `say-${Date.now()}`,
        action: "chat",
        params: { message: payload },
        description: `chat command from ${username}`
    };

    await executeAndReport(bot, executor, step, safety);
    return true;
}

async function handleAct(bot: Bot, executor: ActionExecutor, username: string, trimmed: string, actCmd: string, safety?: SafetyRails): Promise<boolean>
{
    const rest = trimmed.replace(new RegExp(`^${escapeRegExp(actCmd)}\\s*`), "").trim();
    if (!rest)
    {
        safeChat(bot, safety, `Usage: ${actCmd} [id=my-id] <action> {jsonParams}`, "chat.command.usage");
        return true;
    }

    const tokens = rest.split(" ");
    let id: string | undefined;
    let action = tokens.shift();

    if (!action)
    {
        safeChat(bot, safety, `Usage: ${actCmd} [id=my-id] <action> {jsonParams}`, "chat.command.usage");
        return true;
    }

    if (action.startsWith("id="))
    {
        id = action.slice(3);
        action = tokens.shift();
    }

    if (!action)
    {
        safeChat(bot, safety, `Usage: ${actCmd} [id=my-id] <action> {jsonParams}`, "chat.command.usage");
        return true;
    }

    const jsonText = tokens.join(" ").trim();

    let params: Record<string, unknown> | undefined;
    if (jsonText)
    {
        try
        {
            params = JSON.parse(jsonText);
        }
        catch (err: any)
        {
            safeChat(bot, safety, `Param parse error: ${err?.message ?? String(err)}`, "chat.command.error");
            return true;
        }
    }

    const step: ActionStep =
    {
        id: id ?? `${action}-${Date.now()}`,
        action,
        params,
        description: `chat command from ${username}`
    };

    await executeAndReport(bot, executor, step, safety);
    return true;
}

function parseIdAndPayload(input: string): { id?: string; payload: string }
{
    const tokens = input.trim().split(" ");
    if (tokens[0]?.startsWith("id="))
    {
        const id = tokens.shift()?.slice(3);
        return { id, payload: tokens.join(" ") };
    }

    return { payload: input };
}

async function executeAndReport(bot: Bot, executor: ActionExecutor, step: ActionStep, safety?: SafetyRails): Promise<void>
{
    const results = await executor.executePlan([step]);
    const result: ActionResult | undefined = results[0];

    if (!result)
    {
        safeChat(bot, safety, "No result", "chat.command.result");
        return;
    }

    const reason = result.reason ? ` (${result.reason})` : "";
    safeChat(bot, safety, `[${result.status}] ${result.action}#${result.id}${reason}`, "chat.command.result");
}

function escapeRegExp(str: string): string
{
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeChat(bot: Bot, safety: SafetyRails | undefined, message: string, source: string): void
{
    if (!safety)
    {
        bot.chat(message);
        return;
    }

    const result = safety.checkOutgoingChat(message, source);
    if (!result.allowed)
    {
        return;
    }

    bot.chat(result.message);
}