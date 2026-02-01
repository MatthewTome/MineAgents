import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { dump as dumpYaml } from "js-yaml";
import type { Bot } from "mineflayer";
import type { SafetyRails } from "../safety/safety-rails.js";
import type { GoalDefinition, ResearchCondition } from "../research/goals.js";
import type { AgentRole, MentorMode } from "../teamwork/roles.js";
import { type BotConfig, createDefaultBotConfig } from "../settings/config.js";

export type FeatureFlags =
{
    ragEnabled: boolean;
    narrationEnabled: boolean;
    safetyEnabled: boolean;
};

export function parseEnvBoolean(value?: string): boolean | null
{
    if (value === undefined) { return null; }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enable", "enabled"].includes(normalized)) { return true; }

    if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) { return false; }

    return null;
}

export function toOptionalInt(value?: string): number | null
{
    if (!value) { return null; }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

export function resolveMentorMode(value?: string | null): MentorMode | null
{
    if (!value) { return null; }

    const normalized = value.trim().toLowerCase();
    if (["none", "off", "disabled"].includes(normalized)) { return "none"; }
    if (["teacher", "mentor"].includes(normalized)) { return "teacher"; }
    if (["learner", "student"].includes(normalized)) { return "learner"; }

    return null;
}

export function buildGoalMetadata(options:
{
    role: AgentRole;
    mentorMode: MentorMode;
    features: FeatureFlags;
    agentId: number | null;
    agentCount: number | null;
    seed: string | undefined;
    trialId: string | undefined;
}): GoalDefinition["metadata"]
{
    const condition: ResearchCondition =
    {
        role: options.role,
        mentorMode: options.mentorMode,
        ragEnabled: options.features.ragEnabled,
        narrationEnabled: options.features.narrationEnabled,
        safetyEnabled: options.features.safetyEnabled
    };

    if (options.agentId !== null) { condition.agentId = options.agentId; }
    if (options.agentCount !== null) { condition.agentCount = options.agentCount; }
    if (options.seed) { condition.seed = options.seed; }
    if (options.trialId) { condition.trialId = options.trialId; }

    return { condition };
}

export function safeChat(bot: Bot, safety: SafetyRails | undefined, message: string, source: string): void
{
    if (!safety)
    {
        bot.chat(message);
        return;
    }

    const result = safety.checkOutgoingChat(message, source);
    if (!result.allowed) { return; }

    bot.chat(result.message);
}

export async function runSetupWizard(destinationPath: string): Promise<void>
{
    console.clear();
    console.log("\n" + "=".repeat(60));
    console.log("WELCOME TO MINEAGENTS!");
    console.log("=".repeat(60));
    console.log("   It looks like this is your first time running the bot.");
    console.log("   I need to know where your Minecraft server is located.");
    console.log("");
    console.log("   INSTRUCTIONS:");
    console.log("   - If the default value (shown in brackets) is correct,");
    console.log("     simply press the [ENTER] key.");
    console.log("   - Otherwise, type the correct value and press [ENTER].");
    console.log("=".repeat(60) + "\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (title: string, description: string, defaultValue: string): Promise<string> =>
    {
        return new Promise((resolve) => {
            console.log(`\nQUESTION: ${title}`);
            console.log(`   ${description}`);

            rl.question(`   Type value or press ENTER to accept [${defaultValue}]: `, (answer) => {
                const finalValue = answer.trim() || defaultValue;
                console.log(`Selected: ${finalValue}`);
                resolve(finalValue);
            });
        });
    };

    const defaults = createDefaultBotConfig();
    const host = await ask(
        "Server IP Address",
        "What is the IP address of your Minecraft server?\n   (If the server is running on this same computer, keep 127.0.0.1)",
        defaults.connection.host
    );

    const portStr = await ask(
        "Server Port",
        "What port is the server listening on?\n   (Java Edition defaults to 25565)",
        String(defaults.connection.port)
    );

    const username = await ask(
        "Bot Name",
        "What should this agent be called in-game?",
        defaults.connection.username
    );

    const version = await ask(
        "Minecraft Version",
        "Which version of Minecraft is the server running?",
        defaults.connection.version
    );

    rl.close();

    console.log("\n" + "-".repeat(60));
    console.log("Saving configuration...");

    const config: BotConfig = {
        ...defaults,
        connection: {
            host,
            port: parseInt(portStr, 10),
            username,
            version
        }
    };

    const dir = path.dirname(destinationPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const yamlStr = dumpYaml(config);
    fs.writeFileSync(destinationPath, yamlStr, "utf8");

    console.log(`Setup complete! Settings saved to:`);
    console.log(`   ${destinationPath}`);
    console.log("-".repeat(60));
    console.log("Starting bot now...\n");
}