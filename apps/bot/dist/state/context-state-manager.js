export class ContextStateManager {
    mainGoalId = null;
    currentAction = null;
    actionHistory = [];
    interrupts = [];
    setMainGoal(id) {
        if (!id.trim()) {
            throw new Error("Main goal id must be a non-empty string.");
        }
        this.mainGoalId = id;
    }
    getMainGoalId() {
        return this.mainGoalId;
    }
    setCurrentAction(action) {
        if (!action.trim()) {
            throw new Error("Current action must be a non-empty string.");
        }
        this.currentAction = action;
        this.actionHistory.push(action);
    }
    clearCurrentAction() {
        this.currentAction = null;
    }
    recordInterrupt(description) {
        if (!description.trim()) {
            throw new Error("Interrupt description must be a non-empty string.");
        }
        this.interrupts.push(description);
    }
    snapshot() {
        return {
            mainGoalId: this.mainGoalId,
            currentAction: this.currentAction,
            actionHistory: [...this.actionHistory],
            interrupts: [...this.interrupts]
        };
    }
}
