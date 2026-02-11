import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { HuggingFacePlannerOptions, PlanRequest, PlanResult } from "./types.js";

interface WorkerReady
{
    type: "ready";
    backend?: "local" | "remote";
    model?: string;
    error?: { message: string; stack?: string };
}

interface WorkerPlanResult
{
    type: "plan-result";
    id: number;
    result: PlanResult;
}

interface WorkerPlanError
{
    type: "plan-error";
    id: number;
    error: { message: string; stack?: string };
}

export interface PlannerWorkerInit
{
    options?: Partial<HuggingFacePlannerOptions>;
    logDir?: string;
}

export class PlannerWorkerClient
{
    private readonly worker: Worker;
    private readonly readyPromise: Promise<{ backend: "local" | "remote"; model: string }>;
    private readonly pending = new Map<number, { resolve: (plan: PlanResult) => void; reject: (err: unknown) => void }>();
    private requestId = 0;
    private model: string | null = null;

    private readyResolve: ((v: { backend: "local" | "remote"; model: string }) => void) | null = null;
    private readyReject: ((err: unknown) => void) | null = null;

    constructor(init?: PlannerWorkerInit)
    {
        const workerUrl = resolveWorkerEntry();
        const execArgv = workerUrl.pathname.endsWith(".ts") ? ["--import", "tsx"] : undefined;

        this.readyPromise = new Promise((resolve, reject) =>
        {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        this.worker = new Worker(workerUrl, { workerData: init, execArgv });

        this.worker.on("error", (err) =>
        {
            this.failAll(err);
        });

        this.worker.on("exit", (code) =>
        {
            if (code !== 0)
            {
                this.failAll(new Error(`Planner worker exited with code ${code}`));
            }
        });

        this.worker.on("message", (msg: WorkerReady | WorkerPlanResult | WorkerPlanError) =>
        {
            if (msg.type === "ready")
            {
                if (msg.error)
                {
                    this.failAll(new Error(msg.error.message));
                }
                else
                {
                    this.model = msg.model ?? "unknown";
                    this.readyResolve?.({ backend: msg.backend ?? "remote", model: this.model });
                }
            }
            else if (msg.type === "plan-result")
            {
                const pending = this.pending.get(msg.id);
                if (pending)
                {
                    pending.resolve(msg.result);
                    this.pending.delete(msg.id);
                }
            }
            else if (msg.type === "plan-error")
            {
                const pending = this.pending.get(msg.id);
                if (pending)
                {
                    const error = new Error(msg.error?.message ?? "Unknown planner error");
                    error.stack = msg.error?.stack;
                    pending.reject(error);
                    this.pending.delete(msg.id);
                }
            }
        });

        this.readyPromise.catch((err) =>
        {
            this.failAll(err);
        });
    }

    get modelName(): string
    {
        return this.model ?? "unknown";
    }

    get ready(): Promise<{ backend: "local" | "remote"; model: string }>
    {
        return this.readyPromise;
    }

    async createPlan(request: PlanRequest): Promise<PlanResult>
    {
        await this.readyPromise;
        const id = ++this.requestId;

        const result = new Promise<PlanResult>((resolve, reject) =>
        {
            this.pending.set(id, { resolve, reject });
        });

        this.worker.postMessage({ type: "plan", id, request });
        return result;
    }

    async dispose(): Promise<void>
    {
        await this.worker.terminate();
    }

    private failAll(err: unknown)
    {
        this.readyReject?.(err);
        for (const [, pending] of this.pending)
        {
            pending.reject(err);
        }
        this.pending.clear();
    }
}

function resolveWorkerEntry(): URL
{
    const jsPath = fileURLToPath(new URL("./planner-worker.js", import.meta.url));
    if (fs.existsSync(jsPath))
    {
        return pathToFileURL(jsPath);
    }

    const tsPath = fileURLToPath(new URL("./planner-worker.ts", import.meta.url));
    if (fs.existsSync(tsPath))
    {
        return pathToFileURL(tsPath);
    }

    throw new Error("Unable to locate planner worker entry file.");
}