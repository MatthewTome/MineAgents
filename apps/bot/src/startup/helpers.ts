import type { Bot } from "mineflayer";
import type { SafetyRails } from "../safety/safety-rails.js";
import type { GoalDefinition, ResearchCondition } from "../research/goals.js";
import type { AgentRole, MentorMode } from "../teamwork/roles.js";

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