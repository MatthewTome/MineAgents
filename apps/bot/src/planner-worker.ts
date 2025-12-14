import { parentPort, workerData } from "node:worker_threads";
import { HuggingFacePlanner, type PlanRequest, type PlanResult, type HuggingFacePlannerOptions } from "./planner.js";
import { SessionLogger } from "./session-logger.js";

interface WorkerInit
{
    options?: Partial<HuggingFacePlannerOptions>;
    logDir?: string;
}

const data = workerData as WorkerInit;
const logger = new SessionLogger(data.logDir);
const planner = new HuggingFacePlanner({ ...data.options, logger });

async function initialize()
{
    try
    {
        const backend = await planner.backend();
        parentPort?.postMessage({ type: "ready", backend, model: planner.modelName });
    }
    catch (err)
    {
        parentPort?.postMessage({ type: "ready", error: serializeError(err) });
    }
}

parentPort?.on("message", async (msg: any) =>
{
    if (msg?.type === "plan")
    {
        const { id, request } = msg as { id: number; request: PlanRequest };
        try
        {
            const plan = await planner.createPlan(request);
            parentPort?.postMessage({ type: "plan-result", id, result: plan });
        }
        catch (err)
        {
            parentPort?.postMessage({ type: "plan-error", id, error: serializeError(err) });
        }
    }
});

void initialize();

function serializeError(err: unknown)
{
    if (err instanceof Error)
    {
        return { message: err.message, stack: err.stack };
    }

    return { message: String(err) };
}