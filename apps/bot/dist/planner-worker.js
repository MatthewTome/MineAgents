import { parentPort, workerData } from "node:worker_threads";
import { HuggingFacePlanner } from "./planner.js";
const data = workerData;
const planner = new HuggingFacePlanner(data.options);
async function initialize() {
    try {
        const backend = await planner.backend();
        parentPort?.postMessage({ type: "ready", backend, model: planner.modelName });
    }
    catch (err) {
        parentPort?.postMessage({ type: "ready", error: serializeError(err) });
    }
}
parentPort?.on("message", async (msg) => {
    if (msg?.type === "plan") {
        const { id, request } = msg;
        try {
            const plan = await planner.createPlan(request);
            parentPort?.postMessage({ type: "plan-result", id, result: plan });
        }
        catch (err) {
            parentPort?.postMessage({ type: "plan-error", id, error: serializeError(err) });
        }
    }
});
void initialize();
function serializeError(err) {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack };
    }
    return { message: String(err) };
}