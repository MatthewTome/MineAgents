import { Vec3 } from "vec3";
const BUILD_SITE_CLEARANCE = 5;
const PLANNER_ROLES = ["supervisor", "generalist"];
const SPECIALIST_ROLES = ["gatherer", "builder", "guard"];
const MOVE_REQUEST_PATTERN = /(?:please\s+move|you\s+are\s+in\s+(?:my\s+)?(?:way|build\s*path)|move\s+out\s+of\s+(?:the\s+)?way|@(\w+).*(?:move|blocking))/i;
const ROLE_STANDBY_BEHAVIORS = {
    supervisor: {
        listenPatterns: [
            /\[problem\]/i,
            /\[URGENT\]/i,
            /\[team\].*needs/i,
            /help.*needed/i,
            /stuck on/i,
            MOVE_REQUEST_PATTERN
        ],
        proactiveChecks: ["team_status", "pending_assignments"],
        standbyMessage: "Supervisor on standby - monitoring team for issues.",
        canRespondTo: ["builder", "gatherer", "guard", "generalist"]
    },
    gatherer: {
        listenPatterns: [
            /\[team\].*needs.*\d+/i,
            /need(?:s)?\s+(?:more\s+)?(?:\d+\s+)?(\w+)/i,
            /out of/i,
            /running low/i,
            /\[URGENT\].*needs/i,
            MOVE_REQUEST_PATTERN
        ],
        proactiveChecks: ["inventory_capacity", "nearby_resources"],
        standbyMessage: "Gatherer on standby - ready to collect resources.",
        canRespondTo: ["builder", "supervisor", "guard", "generalist"]
    },
    builder: {
        listenPatterns: [
            /build.*ready/i,
            /construction.*needed/i,
            /place.*structure/i,
            MOVE_REQUEST_PATTERN
        ],
        proactiveChecks: ["material_inventory", "build_site_status"],
        standbyMessage: "Builder on standby - ready to construct.",
        canRespondTo: ["supervisor", "generalist"]
    },
    guard: {
        listenPatterns: [
            /danger/i,
            /threat/i,
            /mob.*nearby/i,
            /attack/i,
            /help.*fight/i,
            MOVE_REQUEST_PATTERN
        ],
        proactiveChecks: ["nearby_threats", "team_safety"],
        standbyMessage: "Guard on standby - watching for threats.",
        canRespondTo: ["builder", "gatherer", "supervisor", "generalist"]
    },
    generalist: {
        listenPatterns: [
            /\[team\].*needs/i,
            /\[problem\]/i,
            /\[URGENT\]/i,
            /help/i,
            /stuck/i,
            MOVE_REQUEST_PATTERN
        ],
        proactiveChecks: ["team_status", "inventory_capacity"],
        standbyMessage: "Agent on standby - ready to assist.",
        canRespondTo: ["builder", "gatherer", "supervisor", "guard", "generalist"]
    }
};
export class StandbyManager {
    state = "standby";
    role;
    botName;
    lastAnnouncementTime = 0;
    announcementCooldownMs = 60000;
    hasAnnouncedStandby = false;
    awaitingTeamPlan = false;
    constructor(role, botName) {
        this.role = role;
        this.botName = botName;
        this.awaitingTeamPlan = SPECIALIST_ROLES.includes(role);
    }
    canPlanIndependently() {
        return PLANNER_ROLES.includes(this.role);
    }
    isSpecialistRole() {
        return SPECIALIST_ROLES.includes(this.role);
    }
    isAwaitingTeamPlan() {
        return this.awaitingTeamPlan && SPECIALIST_ROLES.includes(this.role);
    }
    acknowledgeTeamPlan() {
        if (this.awaitingTeamPlan) {
            console.log(`[standby] ${this.role} received team plan assignments, ready to execute`);
            this.awaitingTeamPlan = false;
        }
    }
    resetAwaitingTeamPlan() {
        this.awaitingTeamPlan = SPECIALIST_ROLES.includes(this.role);
    }
    getState() {
        return this.state;
    }
    setRole(role) {
        this.role = role;
    }
    enterStandby(bot, reason) {
        if (this.state === "standby") {
            return;
        }
        this.state = "standby";
        const behavior = ROLE_STANDBY_BEHAVIORS[this.role];
        if (!this.hasAnnouncedStandby) {
            console.log(`[standby] Entering standby mode: ${reason}`);
            bot.chat(behavior.standbyMessage);
            this.hasAnnouncedStandby = true;
            this.lastAnnouncementTime = Date.now();
        }
        else {
            console.log(`[standby] Re-entering standby mode: ${reason} (announcement suppressed)`);
        }
    }
    exitStandby(reason) {
        if (this.state !== "standby") {
            return;
        }
        this.state = "active";
        console.log(`[standby] Exiting standby mode${reason ? `: ${reason}` : ""}`);
    }
    startResponding() {
        if (this.state === "standby") {
            this.state = "responding";
            console.log("[standby] Responding to team request");
        }
    }
    finishResponding() {
        if (this.state === "responding") {
            this.state = "standby";
        }
    }
    shouldRespondToMessage(message, senderName, senderRole) {
        if (this.state !== "standby") {
            return false;
        }
        if (!message || typeof message !== 'string') {
            return false;
        }
        if (!senderName) {
            return false;
        }
        if (this.botName && senderName.toLowerCase() === this.botName.toLowerCase()) {
            return false;
        }
        const behavior = ROLE_STANDBY_BEHAVIORS[this.role];
        for (const pattern of behavior.listenPatterns) {
            if (pattern.test(message)) {
                if (senderRole && !behavior.canRespondTo.includes(senderRole)) {
                    continue;
                }
                console.log(`[standby] Message matched pattern: ${pattern}`);
                return true;
            }
        }
        return false;
    }
    parseResourceRequest(message) {
        const teamNeedsMatch = message.match(/\[team\]\s*(\w+)\s*\((\w+)\)\s*needs?\s*(\d+)?\s*(.+)/i);
        if (teamNeedsMatch) {
            return {
                requester: teamNeedsMatch[1],
                requesterRole: teamNeedsMatch[2],
                item: teamNeedsMatch[4].trim(),
                count: parseInt(teamNeedsMatch[3]) || 1,
                urgent: message.includes("[URGENT]")
            };
        }
        const simpleNeedsMatch = message.match(/(\w+)\s+needs?\s+(?:more\s+)?(\d+)?\s*(\w+)/i);
        if (simpleNeedsMatch) {
            return {
                requester: simpleNeedsMatch[1],
                item: simpleNeedsMatch[3],
                count: parseInt(simpleNeedsMatch[2]) || 1,
                urgent: message.includes("[URGENT]")
            };
        }
        return null;
    }
    buildStandbyContext() {
        if (this.state !== "standby") {
            return "";
        }
        const behavior = ROLE_STANDBY_BEHAVIORS[this.role];
        return [
            `Currently in STANDBY MODE.`,
            `Listening for: ${behavior.listenPatterns.map(p => p.source).join(", ")}`,
            `Ready to assist: ${behavior.canRespondTo.join(", ")}`,
            `When a teammate announces a problem matching your patterns, respond by creating a plan to help.`
        ].join(" ");
    }
    buildResponseGoal(request) {
        if (this.role === "gatherer") {
            return `Gather ${request.count} ${request.item} and give them to ${request.requester}`;
        }
        else if (this.role === "supervisor") {
            return `Assess the team situation and assign someone to help ${request.requester} get ${request.count} ${request.item}`;
        }
        else {
            return `Help ${request.requester} by getting ${request.count} ${request.item}`;
        }
    }
    resetAnnouncementFlag() {
        this.hasAnnouncedStandby = false;
    }
    isWithinBuildSite(bot, teamPlan) {
        if (!teamPlan?.sharedOrigin) {
            return false;
        }
        const origin = teamPlan.sharedOrigin;
        const botPos = bot.entity.position;
        const halfSize = 4 + BUILD_SITE_CLEARANCE;
        const withinX = botPos.x >= origin.x - halfSize && botPos.x <= origin.x + halfSize;
        const withinZ = botPos.z >= origin.z - halfSize && botPos.z <= origin.z + halfSize;
        const withinY = botPos.y >= origin.y - 2 && botPos.y <= origin.y + 10;
        return withinX && withinZ && withinY;
    }
    calculateSafeStandbyPosition(bot, teamPlan) {
        if (!teamPlan?.sharedOrigin) {
            return null;
        }
        const origin = new Vec3(teamPlan.sharedOrigin.x, teamPlan.sharedOrigin.y, teamPlan.sharedOrigin.z);
        const botPos = bot.entity.position;
        const dx = botPos.x - origin.x;
        const dz = botPos.z - origin.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const minDistance = 7 + BUILD_SITE_CLEARANCE;
        if (distance >= minDistance) {
            return null;
        }
        let normX = dx / (distance || 1);
        let normZ = dz / (distance || 1);
        if (distance < 1) {
            const angle = Math.random() * Math.PI * 2;
            normX = Math.cos(angle);
            normZ = Math.sin(angle);
        }
        const targetX = origin.x + normX * (minDistance + 2);
        const targetZ = origin.z + normZ * (minDistance + 2);
        return new Vec3(targetX, botPos.y, targetZ);
    }
    isMoveRequest(message, senderName) {
        if (!message || !senderName) {
            return false;
        }
        if (senderName.toLowerCase() === this.botName.toLowerCase()) {
            return false;
        }
        if (!MOVE_REQUEST_PATTERN.test(message)) {
            return false;
        }
        const mentionMatch = message.match(/@(\w+)/);
        if (mentionMatch) {
            const targetName = mentionMatch[1].toLowerCase();
            return targetName === this.botName.toLowerCase();
        }
        return true;
    }
    parseMoveRequest(message) {
        const match = message.match(/(?:Hey\s+)?@?(\w+).*(?:in\s+my\s+(?:build\s+)?path\s+at\s+)?(?:\()?(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)(?:\))?/i);
        if (match) {
            return {
                requester: match[1],
                targetPosition: new Vec3(parseInt(match[2]), parseInt(match[3]), parseInt(match[4]))
            };
        }
        const simpleMatch = message.match(/(?:Hey\s+)?@?(\w+)/);
        if (simpleMatch) {
            return { requester: simpleMatch[1] };
        }
        return null;
    }
    buildMoveAwayGoal(bot, teamPlan) {
        const safePos = this.calculateSafeStandbyPosition(bot, teamPlan);
        if (safePos) {
            return `Move to safe standby position at ${Math.floor(safePos.x)}, ${Math.floor(safePos.y)}, ${Math.floor(safePos.z)} (outside build area)`;
        }
        const angle = Math.random() * Math.PI * 2;
        const newX = Math.floor(bot.entity.position.x + Math.cos(angle) * 8);
        const newZ = Math.floor(bot.entity.position.z + Math.sin(angle) * 8);
        return `Move to ${newX}, ${Math.floor(bot.entity.position.y)}, ${newZ} to get out of the way`;
    }
}
export function getStandbyBehavior(role) {
    return ROLE_STANDBY_BEHAVIORS[role];
}
export function canRolePlanIndependently(role) {
    return PLANNER_ROLES.includes(role);
}
export function isSpecialistRole(role) {
    return SPECIALIST_ROLES.includes(role);
}
export function isMoveRequestMessage(message) {
    return MOVE_REQUEST_PATTERN.test(message);
}
export function calculateSafePosition(botPosition, buildOrigin, buildSize = 7) {
    const origin = new Vec3(buildOrigin.x, buildOrigin.y, buildOrigin.z);
    const dx = botPosition.x - origin.x;
    const dz = botPosition.z - origin.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const minDistance = (buildSize / 2) + BUILD_SITE_CLEARANCE + 2;
    let normX = dx / (distance || 1);
    let normZ = dz / (distance || 1);
    if (distance < 1) {
        const angle = Math.random() * Math.PI * 2;
        normX = Math.cos(angle);
        normZ = Math.sin(angle);
    }
    return new Vec3(origin.x + normX * minDistance, botPosition.y, origin.z + normZ * minDistance);
}
