export async function handleChatCommand(bot, executor, username, message, options) {
    const prefix = options?.prefix ?? "!";
    if (!message.startsWith(prefix)) {
        return false;
    }
    const trimmed = message.trim();
    const sayCmd = `${prefix}say`;
    const actCmd = `${prefix}act`;
    if (trimmed.startsWith(sayCmd)) {
        const handled = await handleSay(bot, executor, username, trimmed, sayCmd, options?.safety);
        return handled;
    }
    if (trimmed.startsWith(actCmd)) {
        const handled = await handleAct(bot, executor, username, trimmed, actCmd, options?.safety);
        return handled;
    }
    return false;
}
export function wireChatBridge(bot, executor, options) {
    const listener = async (username, message) => {
        if (username === bot.username) {
            return;
        }
        try {
            const handled = await handleChatCommand(bot, executor, username, message, options);
            if (!handled) {
                return;
            }
        }
        catch (err) {
            console.error("[chat-bridge] failed to handle command", err);
            bot.chat("Command error; check server logs.");
        }
    };
    bot.on("chat", listener);
    return () => bot.removeListener("chat", listener);
}
async function handleSay(bot, executor, username, trimmed, sayCmd, safety) {
    const withoutCmd = trimmed.replace(new RegExp(`^${escapeRegExp(sayCmd)}\\s*`), "");
    if (!withoutCmd) {
        safeChat(bot, safety, `Usage: ${sayCmd} <message>`, "chat.command.usage");
        return true;
    }
    const { id, payload } = parseIdAndPayload(withoutCmd);
    const step = {
        id: id ?? `say-${Date.now()}`,
        action: "chat",
        params: { message: payload },
        description: `chat command from ${username}`
    };
    await executeAndReport(bot, executor, step, safety);
    return true;
}
async function handleAct(bot, executor, username, trimmed, actCmd, safety) {
    const rest = trimmed.replace(new RegExp(`^${escapeRegExp(actCmd)}\\s*`), "").trim();
    if (!rest) {
        safeChat(bot, safety, `Usage: ${actCmd} [id=my-id] <action> {jsonParams}`, "chat.command.usage");
        return true;
    }
    const tokens = rest.split(" ");
    let id;
    let action = tokens.shift();
    if (!action) {
        safeChat(bot, safety, `Usage: ${actCmd} [id=my-id] <action> {jsonParams}`, "chat.command.usage");
        return true;
    }
    if (action.startsWith("id=")) {
        id = action.slice(3);
        action = tokens.shift();
    }
    if (!action) {
        safeChat(bot, safety, `Usage: ${actCmd} [id=my-id] <action> {jsonParams}`, "chat.command.usage");
        return true;
    }
    const jsonText = tokens.join(" ").trim();
    let params;
    if (jsonText) {
        try {
            params = JSON.parse(jsonText);
        }
        catch (err) {
            safeChat(bot, safety, `Param parse error: ${err?.message ?? String(err)}`, "chat.command.error");
            return true;
        }
    }
    const step = {
        id: id ?? `${action}-${Date.now()}`,
        action,
        params,
        description: `chat command from ${username}`
    };
    await executeAndReport(bot, executor, step, safety);
    return true;
}
function parseIdAndPayload(input) {
    const tokens = input.trim().split(" ");
    if (tokens[0]?.startsWith("id=")) {
        const id = tokens.shift()?.slice(3);
        return { id, payload: tokens.join(" ") };
    }
    return { payload: input };
}
async function executeAndReport(bot, executor, step, safety) {
    const results = await executor.executePlan([step]);
    const result = results[0];
    if (!result) {
        safeChat(bot, safety, "No result", "chat.command.result");
        return;
    }
    const reason = result.reason ? ` (${result.reason})` : "";
    safeChat(bot, safety, `[${result.status}] ${result.action}#${result.id}${reason}`, "chat.command.result");
}
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function safeChat(bot, safety, message, source) {
    if (!safety) {
        bot.chat(message);
        return;
    }
    const result = safety.checkOutgoingChat(message, source);
    if (!result.allowed) {
        return;
    }
    bot.chat(result.message);
}
