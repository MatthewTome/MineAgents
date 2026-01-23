const ROLE_DEFINITIONS = {
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
const ROLE_ALIASES = {
    miner: "miner",
    builder: "builder",
    guide: "guide",
    guard: "guard",
    generalist: "generalist",
    default: "generalist",
    general: "generalist",
    helper: "generalist"
};
export function resolveRole(input) {
    if (!input) {
        return null;
    }
    const cleaned = input.trim().toLowerCase();
    return ROLE_ALIASES[cleaned] ?? null;
}
export function getRoleDefinition(role) {
    return ROLE_DEFINITIONS[role];
}
export class RoleManager {
    role;
    constructor(initialRole) {
        this.role = initialRole;
    }
    setRole(next) {
        this.role = next;
    }
    getRole() {
        return this.role;
    }
    getDefinition() {
        return ROLE_DEFINITIONS[this.role];
    }
    buildPlannerContext() {
        const def = this.getDefinition();
        return [
            `Role: ${def.label}.`,
            def.description,
            `Planning focus: ${def.planningFocus}`,
            "Stay within your role unless the team plan explicitly assigns you otherwise."
        ].join(" ");
    }
    buildMentorContext(mode) {
        const def = this.getDefinition();
        if (mode === "none") {
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
export function listRoleNames() {
    return Object.keys(ROLE_DEFINITIONS);
}
