export type AgentRole =
    | "gatherer"
    | "builder"
    | "supervisor"
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
    gatherer: {
        id: "gatherer",
        label: "Gatherer",
        description: "Always ready to gather supplies and provide them to the team.",
        planningFocus: "Continuously monitor team needs, gather resources proactively, maintain inventory buffer.",
        mentoringFocus: "Share efficient gathering routes, resource locations, and inventory management."
    },
    builder: {
        id: "builder",
        label: "Builder",
        description: "Always working on construction when tasks are available.",
        planningFocus: "Execute building tasks continuously, request materials as needed, complete structures efficiently.",
        mentoringFocus: "Offer building sequences, material lists, and layout tips."
    },
    supervisor: {
        id: "supervisor",
        label: "Supervisor",
        description: "Coordinates team, assigns work, stays out of the way to avoid interfering with labor.",
        planningFocus: "Create comprehensive team plans, assign tasks based on roles, monitor progress from safe distance.",
        mentoringFocus: "Provide strategic guidance, coordinate team efforts, delegate effectively."
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
    gatherer: "gatherer",
    supervisor: "supervisor",
    builder: "builder",
    guard: "guard",
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