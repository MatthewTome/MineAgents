import type { RoleDefinition } from "./roles.js";
import type { MentorMode } from "./roles.js";

export interface MentorProtocolConfig
{
    mode: MentorMode;
    targetName?: string;
    adviceCooldownMs: number;
    requestCooldownMs: number;
}

export interface MentorContext
{
    role: RoleDefinition;
    goal?: string | null;
    sender?: string;
}

const ADVICE_TAG = "[advice]";
const REQUEST_TAG = "[request]";

const TOPIC_ADVICE: Array<{ keywords: string[]; advice: string }> =
[
    {
        keywords: ["shelter", "house", "base"],
        advice: "Secure a flat spot, place a platform, then add walls + roof before nightfall."
    },
    {
        keywords: ["iron", "tools", "ore"],
        advice: "Prioritize stone tools, mine iron near y≈16, smelt, then craft iron pick/axe/shovel."
    },
    {
        keywords: ["food", "hunger", "eat"],
        advice: "Keep food in hotbar; hunt passive mobs or collect crops before long tasks."
    },
    {
        keywords: ["safety", "mobs", "guard"],
        advice: "Light the area and avoid caves at night; back away if health drops below half."
    }
];

export class MentorProtocol
{
    private config: MentorProtocolConfig;
    private lastAdviceAt = 0;
    private lastRequestAt = 0;
    private lastRequestedGoal: string | null = null;

    constructor(config: MentorProtocolConfig)
    {
        this.config = config;
    }

    updateConfig(next: Partial<MentorProtocolConfig>): void
    {
        this.config = { ...this.config, ...next };
    }

    getConfig(): MentorProtocolConfig
    {
        return { ...this.config };
    }

    handleChat(message: string, context: MentorContext, now: number = Date.now()): string | null
    {
        if (this.config.mode !== "teacher")
        {
            return null;
        }

        if (now - this.lastAdviceAt < this.config.adviceCooldownMs)
        {
            return null;
        }

        const trimmed = message.trim();
        const isHelp = trimmed.startsWith("!help") || trimmed.startsWith("!advice");
        const isRequest = trimmed.toLowerCase().includes(REQUEST_TAG);

        if (!isHelp && !isRequest)
        {
            return null;
        }

        const topic = trimmed.replace(/^!(help|advice)\s*/i, "").trim();
        const advice = this.composeAdvice(topic, context);
        this.lastAdviceAt = now;
        return `${ADVICE_TAG} ${advice}`;
    }

    maybeRequestAdvice(goal: string | null | undefined, now: number = Date.now()): string | null
    {
        if (this.config.mode !== "learner")
        {
            return null;
        }

        if (!goal || goal.trim().length === 0)
        {
            return null;
        }

        if (now - this.lastRequestAt < this.config.requestCooldownMs && goal === this.lastRequestedGoal)
        {
            return null;
        }

        this.lastRequestAt = now;
        this.lastRequestedGoal = goal;
        const target = this.config.targetName ? ` @${this.config.targetName}` : "";
        return `${REQUEST_TAG}${target} advice needed for: ${goal}`;
    }

    private composeAdvice(topic: string, context: MentorContext): string
    {
        if (topic)
        {
            const match = TOPIC_ADVICE.find(entry =>
                entry.keywords.some(keyword => topic.toLowerCase().includes(keyword))
            );
            if (match)
            {
                return match.advice;
            }
        }

        if (context.goal)
        {
            const goalMatch = TOPIC_ADVICE.find(entry =>
                entry.keywords.some(keyword => context.goal?.toLowerCase().includes(keyword))
            );
            if (goalMatch)
            {
                return goalMatch.advice;
            }
        }

        return [
            context.role.mentoringFocus,
            "Keep steps short and safe."
        ].join(" ");
    }
}