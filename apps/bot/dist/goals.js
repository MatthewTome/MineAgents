export class InMemoryGoalDashboard {
    events = [];
    record(event) {
        this.events.push(event);
    }
    getEvents() {
        return [...this.events];
    }
    latestFor(goalId) {
        return [...this.events].reverse().find(e => e.id === goalId);
    }
}
export class GoalTracker {
    goals = new Map();
    dashboard;
    counter = 0;
    constructor(dashboard) {
        this.dashboard = dashboard ?? new InMemoryGoalDashboard();
    }
    addGoal(definition, now = Date.now()) {
        const id = `goal-${++this.counter}`;
        const tracked = {
            id,
            definition,
            status: "pending",
            startedAt: now
        };
        this.goals.set(id, tracked);
        return id;
    }
    getDashboard() {
        return this.dashboard;
    }
    ingestSnapshot(snapshot, now = Date.now()) {
        const events = [];
        for (const goal of this.goals.values()) {
            if (goal.status !== "pending") {
                continue;
            }
            if (goal.definition.timeoutMs && now - goal.startedAt >= goal.definition.timeoutMs) {
                const event = this.recordEvent(goal, "fail", now, "Timed out");
                events.push(event);
                continue;
            }
            if (this.signalMatched(goal.definition.successSignal, snapshot)) {
                const reason = goal.definition.successSignal.description ?? "Success criteria met";
                const event = this.recordEvent(goal, "pass", now, reason);
                events.push(event);
                continue;
            }
            if (goal.definition.failureSignals) {
                const failed = goal.definition.failureSignals.find(sig => this.signalMatched(sig, snapshot));
                if (failed) {
                    const reason = failed.description ?? "Failure criteria met";
                    const event = this.recordEvent(goal, "fail", now, reason);
                    events.push(event);
                }
            }
        }
        return events;
    }
    notifyEvent(channel, payload, now = Date.now()) {
        const events = [];
        for (const goal of this.goals.values()) {
            if (goal.status !== "pending") {
                continue;
            }
            const matched = goal.definition.successSignal.type === "event"
                && goal.definition.successSignal.channel === channel
                && (!goal.definition.successSignal.match || goal.definition.successSignal.match(payload));
            if (matched) {
                const reason = goal.definition.successSignal.description ?? `Signal ${channel} matched`;
                events.push(this.recordEvent(goal, "pass", now, reason));
            }
        }
        return events;
    }
    recordEvent(goal, status, ts, reason) {
        goal.status = status;
        const event = {
            id: goal.id,
            name: goal.definition.name,
            status,
            ts,
            reason
        };
        this.dashboard.record(event);
        return event;
    }
    signalMatched(signal, snapshot) {
        if (signal.type === "predicate") {
            return signal.test(snapshot);
        }
        if (signal.type === "chat") {
            const messages = snapshot.chatWindow.lastMessages.join("\n");
            if (signal.includes instanceof RegExp) {
                return signal.includes.test(messages);
            }
            return messages.includes(signal.includes);
        }
        return false;
    }
}