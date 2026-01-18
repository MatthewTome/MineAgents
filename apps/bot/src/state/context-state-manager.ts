export interface ContextStateSnapshot
{
    mainGoalId: string | null;
    currentAction: string | null;
    actionHistory: string[];
    interrupts: string[];
}

export class ContextStateManager
{
    private mainGoalId: string | null = null;
    private currentAction: string | null = null;
    private readonly actionHistory: string[] = [];
    private readonly interrupts: string[] = [];

    setMainGoal(id: string): void
    {
        if (!id.trim())
        {
            throw new Error("Main goal id must be a non-empty string.");
        }
        this.mainGoalId = id;
    }

    getMainGoalId(): string | null
    {
        return this.mainGoalId;
    }

    setCurrentAction(action: string): void
    {
        if (!action.trim())
        {
            throw new Error("Current action must be a non-empty string.");
        }

        this.currentAction = action;
        this.actionHistory.push(action);
    }

    clearCurrentAction(): void
    {
        this.currentAction = null;
    }

    recordInterrupt(description: string): void
    {
        if (!description.trim())
        {
            throw new Error("Interrupt description must be a non-empty string.");
        }
        this.interrupts.push(description);
    }

    snapshot(): ContextStateSnapshot
    {
        return {
            mainGoalId: this.mainGoalId,
            currentAction: this.currentAction,
            actionHistory: [...this.actionHistory],
            interrupts: [...this.interrupts]
        };
    }
}