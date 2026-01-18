import { describe, expect, it } from "vitest";
import { ContextStateManager } from "../../src/state/context-state-manager.js";

describe("ContextStateManager", () =>
{
    it("retains main goal id while current action changes repeatedly", () =>
    {
        const manager = new ContextStateManager();
        manager.setMainGoal("goal-123");

        const actions = ["scan area", "gather wood", "craft tools", "build shelter", "place torch", "rest"];
        for (const action of actions)
        {
            manager.setCurrentAction(action);
        }

        const snapshot = manager.snapshot();
        expect(snapshot.mainGoalId).toBe("goal-123");
        expect(snapshot.actionHistory).toHaveLength(actions.length);
        expect(snapshot.currentAction).toBe(actions[actions.length - 1]);
    });

    it("does not clear the main goal when interrupted", () =>
    {
        const manager = new ContextStateManager();
        manager.setMainGoal("goal-456");
        manager.setCurrentAction("mining");

        manager.recordInterrupt("mob spawned nearby");

        const snapshot = manager.snapshot();
        expect(snapshot.mainGoalId).toBe("goal-456");
        expect(snapshot.interrupts).toEqual(["mob spawned nearby"]);
        expect(snapshot.currentAction).toBe("mining");
    });
});