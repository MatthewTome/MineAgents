export type AgentRole =
    | "miner"
    | "builder"
    | "guide"
    | "guard"
    | "generalist";

export type MentorMode = "none" | "teacher" | "learner";

export interface RoleDefinition
{
    id: AgentRole;
    label: string;
    description: string;
    planningFocus: string;
    mentoringFocus: string;
}

const ROLE_DEFINITIONS: Record<AgentRole, RoleDefinition> =
{
    miner: {
        id: "miner",
        label: "Miner",
        description: "Prioritize resource gathering, mining, and tool upgrades.",
        planningFocus: "Gather ore, keep tools ready, and maintain a safe inventory buffer.",
        mentoringFocus: "Share efficient mining routes, tool progression, and safety tips."
    },
    builder: {
        id: "builder",
        label: "Builder",
        description: "Focus on shelter construction, crafting, and base improvements.",
        planningFocus: "Select build sites, gather materials, and complete structures.",
        mentoringFocus: "Offer building sequences, material lists, and layout tips."
    },
    guide: {
        id: "guide",
        label: "Guide",
        description: "Coordinate tasks, provide instructions, and support teammates.",
        planningFocus: "Explain next steps clearly and watch overall progress.",
        mentoringFocus: "Give concise, actionable advice tailored to the learner."
    },
    guard: {
        id: "guard",
        label: "Guard",
        description: "Keep the team safe by watching for hazards and mobs.",
        planningFocus: "Monitor threats, stock food, and secure the perimeter.",
        mentoringFocus: "Warn about dangers and recommend defensive actions."
    },
    generalist: {
        id: "generalist",
        label: "Generalist",
        description: "Flexible helper with balanced priorities.",
        planningFocus: "Balance gathering, crafting, and safety depending on the goal.",
        mentoringFocus: "Provide balanced advice across gathering, building, and safety."
    }
};

const ROLE_ALIASES: Record<string, AgentRole> =
{
    miner: "miner",
    builder: "builder",
    guide: "guide",
    guard: "guard",
    generalist: "generalist",
    default: "generalist",
    general: "generalist",
    helper: "generalist"
};

export function resolveRole(input?: string | null): AgentRole | null
{
    if (!input)
    {
        return null;
    }

    const cleaned = input.trim().toLowerCase();
    return ROLE_ALIASES[cleaned] ?? null;
}

export function getRoleDefinition(role: AgentRole): RoleDefinition
{
    return ROLE_DEFINITIONS[role];
}

export class RoleManager
{
    private role: AgentRole;

    constructor(initialRole: AgentRole)
    {
        this.role = initialRole;
    }

    setRole(next: AgentRole): void
    {
        this.role = next;
    }

    getRole(): AgentRole
    {
        return this.role;
    }

    getDefinition(): RoleDefinition
    {
        return ROLE_DEFINITIONS[this.role];
    }

    buildPlannerContext(): string
    {
        const def = this.getDefinition();
        return [
            `Role: ${def.label}.`,
            def.description,
            `Planning focus: ${def.planningFocus}`
        ].join(" ");
    }

    buildMentorContext(mode: MentorMode): string
    {
        const def = this.getDefinition();
        if (mode === "none")
        {
            return "";
        }

        const prefix = mode === "teacher" ? "Mentor mode: teacher." : "Mentor mode: learner.";
        return [
            prefix,
            `Mentoring focus: ${def.mentoringFocus}`,
            "Advice must be short and tagged with [advice]."
        ].join(" ");
    }
}

export function listRoleNames(): AgentRole[]
{
    return Object.keys(ROLE_DEFINITIONS) as AgentRole[];
}