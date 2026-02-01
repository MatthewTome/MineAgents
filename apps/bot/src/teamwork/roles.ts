export type AgentRole =
    | "gatherer"
    | "builder"
    | "supervisor"
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
    gatherer: {
        id: "gatherer",
        label: "Gatherer",
        description: "Always ready to gather supplies and provide them to the team.",
        planningFocus: "Listen for '[team] X needs Y' resource requests in chat. When a teammate announces they need materials, use the 'give' action to deliver items. Gather resources proactively and maintain inventory buffer. When idle with no goal, enter standby and wait for team requests.",
        mentoringFocus: "Share efficient gathering routes, resource locations, and inventory management."
    },
    builder: {
        id: "builder",
        label: "Builder",
        description: "Always working on construction when tasks are available.",
        planningFocus: "BEFORE starting any build, check if you have enough materials. If short on materials, use 'requestResource' action to announce your needs (e.g., '[team] Builder needs 20 oak_planks'). Continue with available work while waiting. Use 'give' to share excess materials with teammates.",
        mentoringFocus: "Offer building sequences, material lists, and layout tips."
    },
    supervisor: {
        id: "supervisor",
        label: "Supervisor",
        description: "Coordinates team, assigns work, stays out of the way to avoid interfering with labor.",
        planningFocus: "Monitor team chat for '[problem]' or '[URGENT]' messages. When team members announce issues, create new assignments or plans to resolve them. Stay in standby mode when not actively planning. Reassign tasks dynamically based on team needs.",
        mentoringFocus: "Provide strategic guidance, coordinate team efforts, delegate effectively."
    },
    generalist: {
        id: "generalist",
        label: "Generalist",
        description: "Flexible helper with balanced priorities.",
        planningFocus: "Balance gathering, crafting, building, and safety depending on the goal. Can respond to any team request. Use 'requestResource' when short on materials and 'give' to share with teammates.",
        mentoringFocus: "Provide balanced advice across gathering, building, and safety."
    }
};

const ROLE_ALIASES: Record<string, AgentRole> =
{
    gatherer: "gatherer",
    supervisor: "supervisor",
    builder: "builder",
    generalist: "generalist",

    miner: "gatherer",
    guide: "supervisor",

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
            `Planning focus: ${def.planningFocus}`,
            "Stay within your role unless the team plan explicitly assigns you otherwise."
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