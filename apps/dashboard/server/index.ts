import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { Server } from "socket.io";

interface AgentStatus {
  sessionId: string;
  name: string;
  intent?: string;
  currentGoal?: string;
  currentAction?: string;
  activeTool?: string;
  thoughtState?: string;
  location?: { x: number; y: number; z: number };
  health?: number;
  food?: number;
  inventory?: { name: string; count: number }[];
  lastActionAt?: number;
  lastSuccessAt?: number;
  lastUpdated?: number;
}

interface NarrationEvent {
  sessionId: string;
  message: string;
  ts: number;
  name?: string;
}

interface TrialSummary {
  sessionId: string;
  name: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  success?: boolean;
  condition: "baseline" | "mineagents";
  ragEnabled?: boolean;
  multiAgent?: boolean;
  role?: string;
  llmCalls?: number;
  actionCount?: number;
  memoryRetrievals?: number;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const port = Number(process.env.DASHBOARD_PORT ?? 4000);
const logDir = process.env.DASHBOARD_LOG_DIR ?? path.resolve(process.cwd(), "..", "bot", "logs");
const sessionsRoot = path.join(logDir, "sessions");

const agentStatuses = new Map<string, AgentStatus>();
const narrations: NarrationEvent[] = [];
const sessionPaths = new Map<string, string>();

const knownTailers = new Map<string, LogTailer>();

export function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

export function readJsonLines(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function getSessionName(sessionDir: string): string {
  const base = path.basename(sessionDir);
  const index = base.lastIndexOf("_");
  if (index > 0) {
    return base.slice(0, index);
  }
  return base;
}

export function encodeSessionId(sessionDir: string): string {
  const relative = path.relative(sessionsRoot, sessionDir);
  return relative.split(path.sep).join("__");
}

export function decodeSessionId(sessionId: string): string | null {
  const relative = sessionId.split("__").join(path.sep);
  const candidate = path.join(sessionsRoot, relative);
  if (!candidate.startsWith(sessionsRoot)) {
    return null;
  }
  return candidate;
}

export function registerSessionPath(sessionDir: string): string {
  const sessionId = encodeSessionId(sessionDir);
  sessionPaths.set(sessionId, sessionDir);
  return sessionId;
}

export function discoverSessions(): string[] {
  const directories: string[] = [];
  if (!fs.existsSync(sessionsRoot)) {
    return directories;
  }
  const dateDirs = fs.readdirSync(sessionsRoot);
  for (const dateDir of dateDirs) {
    const datePath = path.join(sessionsRoot, dateDir);
    if (!safeStat(datePath)?.isDirectory()) {
      continue;
    }
    const sessionDirs = fs.readdirSync(datePath);
    for (const sessionDir of sessionDirs) {
      const sessionPath = path.join(datePath, sessionDir);
      if (safeStat(sessionPath)?.isDirectory()) {
        directories.push(sessionPath);
      }
    }
  }
  return directories;
}

function updateAgentStatus(sessionId: string, name: string, patch: Partial<AgentStatus>) {
  const prev = agentStatuses.get(sessionId) ?? { sessionId, name };
  const lastUpdated = patch.lastUpdated ?? Date.now();
  const next = { ...prev, ...patch, sessionId, name, lastUpdated };
  agentStatuses.set(sessionId, next);
  io.emit("agent.status", next);
}

function pushNarration(event: NarrationEvent) {
  narrations.unshift(event);
  if (narrations.length > 200) {
    narrations.splice(200);
  }
  io.emit("narration", event);
}

export function parsePacket(payload: any): { type: string; data: any } | null {
  if (!payload) {
    return null;
  }
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return { type: "Narration", data: payload };
    }
  }
  if (payload.type && payload.data) {
    return payload;
  }
  return null;
}

function handlePacket(sessionId: string, name: string, packet: { type: string; data: any }) {
  if (packet.type === "Observation") {
    const obs = packet.data ?? {};
    updateAgentStatus(sessionId, name, {
      location: obs.pose?.position ?? obs.pos,
      health: obs.pose?.health ?? obs.health,
      food: obs.pose?.food ?? obs.food,
      currentGoal: obs.currentGoal
    });
    return;
  }
  if (packet.type === "Plan") {
    const plan = packet.data ?? {};
    updateAgentStatus(sessionId, name, {
      intent: plan.intent,
      currentGoal: plan.goal ?? plan.intent,
      thoughtState: "Planning",
      currentAction: plan.currentStep
    });
    return;
  }
  if (packet.type === "Narration") {
    pushNarration({ sessionId, name, message: String(packet.data), ts: Date.now() });
  }
}

class LogTailer {
  private position = 0;
  private buffer = "";
  private watcher: fs.FSWatcher | null = null;

  constructor(private filePath: string, private onLine: (line: any) => void) {}

  start() {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const content = fs.readFileSync(this.filePath, "utf-8");
    if (content) {
      this.processChunk(content);
      this.position = Buffer.byteLength(content);
    }
    this.watcher = fs.watch(this.filePath, event => {
      if (event === "change") {
        this.readNew();
      }
    });
  }

  stop() {
    this.watcher?.close();
    this.watcher = null;
  }

  private readNew() {
    const stats = safeStat(this.filePath);
    if (!stats) {
      return;
    }
    if (stats.size < this.position) {
      this.position = 0;
      this.buffer = "";
    }
    const stream = fs.createReadStream(this.filePath, {
      encoding: "utf-8",
      start: this.position,
      end: stats.size
    });
    let chunk = "";
    stream.on("data", data => {
      chunk += data;
    });
    stream.on("end", () => {
      if (chunk) {
        this.processChunk(chunk);
        this.position = stats.size;
      }
    });
  }

  private processChunk(chunk: string) {
    const content = this.buffer + chunk;
    const lines = content.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        this.onLine(parsed);
      } catch {
        continue;
      }
    }
  }
}

function attachTailers(sessionDir: string) {
  const sessionId = registerSessionPath(sessionDir);
  const name = getSessionName(sessionDir);
  const logFiles = ["perception.log", "actions.log", "planner.log", "session.log"];
  for (const file of logFiles) {
    const filePath = path.join(sessionDir, file);
    const key = `${sessionId}-${file}`;
    if (knownTailers.has(key)) {
      continue;
    }
    const tailer = new LogTailer(filePath, line => handleLogEntry(sessionId, name, file, line));
    knownTailers.set(key, tailer);
    tailer.start();
  }
}

function handleLogEntry(sessionId: string, name: string, file: string, entry: any) {
  const entryTs = entry.ts ? Date.parse(entry.ts) : Date.now();

  if (file === "perception.log") {
    const data = entry.data ?? {};
    updateAgentStatus(sessionId, name, {
      currentGoal: data.currentGoal,
      thoughtState: data.isPlanning ? "Planning" : "Executing",
      location: data.pos,
      health: data.health,
      food: data.food,
      inventory: data.inventory,
      lastUpdated: entryTs
    });
  }

  if (file === "actions.log") {
    const data = entry.data ?? {};
    const ts = data.ts ?? entryTs;
    const patch: Partial<AgentStatus> = {
      currentAction: data.description ?? data.action,
      activeTool: data.action,
      lastActionAt: ts,
      lastUpdated: ts
    };
    if (data.status === "success") {
      patch.lastSuccessAt = ts;
    }
    updateAgentStatus(sessionId, name, patch);
  }

  if (file === "planner.log") {
    if (entry.event === "planner.parsed") {
      updateAgentStatus(sessionId, name, {
        intent: entry.data?.intent,
        thoughtState: "Planning",
        lastUpdated: entryTs
      });
    }
  }

  if (file === "session.log" && entry.event === "planner.narration") {
    pushNarration({ sessionId, name, message: entry.data?.message ?? entry.message ?? "", ts: entryTs });
  }
}

function loadTrials(): TrialSummary[] {
  const sessions = discoverSessions();
  const trials: TrialSummary[] = [];

  for (const sessionDir of sessions) {
    const sessionId = registerSessionPath(sessionDir);
    const name = getSessionName(sessionDir);
    const sessionLog = readJsonLines(path.join(sessionDir, "session.log"));
    const plannerLog = readJsonLines(path.join(sessionDir, "planner.log"));
    const actionsLog = readJsonLines(path.join(sessionDir, "actions.log"));

    const startEntry = sessionLog[0];
    const endEntry = sessionLog[sessionLog.length - 1];

    const startedAt = startEntry?.ts;
    const endedAt = endEntry?.ts;
    const durationSec = startedAt && endedAt ? (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 : undefined;

    const startup = sessionLog.find(entry => entry.event === "startup");
    const features = startup?.data?.features ?? {};
    const ragEnabled = Boolean(features.ragEnabled);
    const multiAgent = sessionLog.some(entry => entry.event?.startsWith("team."));
    const condition = !ragEnabled && !multiAgent ? "baseline" : "mineagents";

    const llmCalls = plannerLog.filter(entry => entry.event === "planner.prompt").length;
    const memoryRetrievals = plannerLog
      .filter(entry => entry.event === "planner.prompt")
      .reduce((count, entry) => {
        const prompt = entry.data?.prompt ?? "";
        return typeof prompt === "string" && prompt.includes("RELEVANT KNOW-HOW") ? count + 1 : count;
      }, 0);

    const actionCount = actionsLog.filter(entry => entry.event === "action").length;

    const success = sessionLog.some(entry => entry.event === "planner.execution.complete")
      ? true
      : sessionLog.some(entry => entry.event === "planner.execution.failed")
        ? false
        : undefined;

    trials.push({
      sessionId,
      name,
      startedAt,
      endedAt,
      durationSec,
      success,
      condition,
      ragEnabled,
      multiAgent,
      role: startup?.data?.role,
      llmCalls,
      actionCount,
      memoryRetrievals
    });
  }

  return trials.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export function computeBoxPlot(values: number[]): { min: number; q1: number; median: number; q3: number; max: number } {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = (arr: number[]) => {
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
  };
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, mid);
  const upper = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  return {
    min: sorted[0],
    q1: median(lower),
    median: median(sorted),
    q3: median(upper),
    max: sorted[sorted.length - 1]
  };
}

export function computeMetrics(trials: TrialSummary[]) {
  const byCondition = trials.reduce<Record<string, TrialSummary[]>>((acc, trial) => {
    acc[trial.condition] = acc[trial.condition] ?? [];
    acc[trial.condition].push(trial);
    return acc;
  }, {});

  const conditions = Object.fromEntries(
    Object.entries(byCondition).map(([condition, items]) => {
      const successes = items.filter(item => item.success).length;
      const durations = items.map(item => item.durationSec ?? 0).filter(Boolean);
      const actions = items.map(item => item.actionCount ?? 0).filter(Boolean);
      const llmCalls = items.map(item => item.llmCalls ?? 0).filter(Boolean);
      return [condition, {
        successRate: items.length ? successes / items.length : 0,
        averageDurationSec: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        averageActions: actions.length ? actions.reduce((a, b) => a + b, 0) / actions.length : 0,
        averageLlmCalls: llmCalls.length ? llmCalls.reduce((a, b) => a + b, 0) / llmCalls.length : 0
      }];
    })
  );

  const boxPlot = Object.entries(byCondition).map(([condition, items]) => {
    const durations = items.map(item => item.durationSec ?? 0).filter(Boolean);
    return { condition, ...computeBoxPlot(durations) };
  });

  const actionUsage = Object.entries(byCondition).map(([condition, items]) => {
    const actions = items.map(item => item.actionCount ?? 0).filter(Boolean);
    const llmCalls = items.map(item => item.llmCalls ?? 0).filter(Boolean);
    return {
      condition,
      actions: actions.length ? Math.round(actions.reduce((a, b) => a + b, 0) / actions.length) : 0,
      llmCalls: llmCalls.length ? Math.round(llmCalls.reduce((a, b) => a + b, 0) / llmCalls.length) : 0
    };
  });

  const ragEffectiveness = {
    points: trials.map(trial => ({
      retrievals: trial.memoryRetrievals ?? 0,
      success: trial.success ? 1 : 0,
      condition: trial.condition
    }))
  };

  return { conditions, boxPlot, actionUsage, ragEffectiveness };
}

app.get("/health", (_, res) => {
  res.json({ status: "OK" });
});

app.get("/trials", (_, res) => {
  if (!fs.existsSync(sessionsRoot)) {
    res.status(404).json({ message: "Missing Trial Data: sessions directory not found." });
    return;
  }
  const trials = loadTrials();
  if (trials.length === 0) {
    res.status(404).json({ message: "Missing Trial Data: no sessions available." });
    return;
  }
  res.json({ trials });
});

app.get("/metrics", (_, res) => {
  if (!fs.existsSync(sessionsRoot)) {
    res.status(404).json({ message: "Missing Trial Data: sessions directory not found." });
    return;
  }
  const trials = loadTrials();
  if (trials.length === 0) {
    res.status(404).json({ message: "Missing Trial Data: no sessions available." });
    return;
  }
  const metrics = computeMetrics(trials);
  res.json({ trials, ...metrics });
});

app.get("/logs/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const sessionDir = sessionPaths.get(sessionId) ?? decodeSessionId(sessionId);
  if (!sessionDir || !fs.existsSync(sessionDir)) {
    res.status(404).json({ message: `Missing Trial Data for Session ID ${sessionId}` });
    return;
  }
  const files = ["session.log", "planner.log", "actions.log", "perception.log", "errors.log", "safety.log"];
  const entries = files.flatMap(file => {
    const filePath = path.join(sessionDir, file);
    return readJsonLines(filePath).map(entry => ({
      file,
      ts: entry.ts,
      level: entry.level,
      event: entry.event,
      message: entry.message,
      data: entry.data
    }));
  });
  res.json({ sessionId, entries });
});

io.on("connection", socket => {
  socket.emit("snapshot", { agents: Array.from(agentStatuses.values()), narrations });

  socket.on("agent.packet", payload => {
    const packet = parsePacket(payload);
    if (!packet) {
      return;
    }
    const sessionId = payload.sessionId ?? "manual";
    const name = payload.name ?? "ExternalAgent";
    handlePacket(sessionId, name, packet);
  });
});

if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const sessions = discoverSessions();
    sessions.forEach(attachTailers);
  }, 5000);

discoverSessions().forEach(attachTailers);
  server.listen(port, () => {
    console.log(`Dashboard server listening on ${port}`);
  });
}

export { app, server, io };