import type { Bot } from "mineflayer";
import { ActionExecutor, type ActionResult, type ActionStep } from "./action-executor.js";

export interface ChatBridgeOptions
{
    prefix?: string;
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
        const handled = await handleSay(bot, executor, username, trimmed, sayCmd);
        return handled;
    }

    if (trimmed.startsWith(actCmd))
    {
        const handled = await handleAct(bot, executor, username, trimmed, actCmd);
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

async function handleSay(bot: Bot, executor: ActionExecutor, username: string, trimmed: string, sayCmd: string): Promise<boolean>
{
    const withoutCmd = trimmed.replace(new RegExp(`^${escapeRegExp(sayCmd)}\\s*`), "");
    if (!withoutCmd)
    {
        bot.chat(`Usage: ${sayCmd} <message>`);
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

    await executeAndReport(bot, executor, step);
    return true;
}

async function handleAct(bot: Bot, executor: ActionExecutor, username: string, trimmed: string, actCmd: string): Promise<boolean>
{
    const rest = trimmed.replace(new RegExp(`^${escapeRegExp(actCmd)}\\s*`), "").trim();
    if (!rest)
    {
        bot.chat(`Usage: ${actCmd} [id=my-id] <action> {jsonParams}`);
        return true;
    }

    const tokens = rest.split(" ");
    let id: string | undefined;
    let action = tokens.shift();

    if (!action)
    {
        bot.chat(`Usage: ${actCmd} [id=my-id] <action> {jsonParams}`);
        return true;
    }

    if (action.startsWith("id="))
    {
        id = action.slice(3);
        action = tokens.shift();
    }

    if (!action)
    {
        bot.chat(`Usage: ${actCmd} [id=my-id] <action> {jsonParams}`);
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
            bot.chat(`Param parse error: ${err?.message ?? String(err)}`);
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

    await executeAndReport(bot, executor, step);
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

async function executeAndReport(bot: Bot, executor: ActionExecutor, step: ActionStep): Promise<void>
{
    const results = await executor.executePlan([step]);
    const result: ActionResult | undefined = results[0];

    if (!result)
    {
        bot.chat("No result");
        return;
    }

    const reason = result.reason ? ` (${result.reason})` : "";
    bot.chat(`[${result.status}] ${result.action}#${result.id}${reason}`);
}

function escapeRegExp(str: string): string
{
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}