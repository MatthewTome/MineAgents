# MineAgents
MineAgents is a monorepo for running autonomous Minecraft agents, collecting structured logs, and evaluating performance across research conditions.

This repository is intentionally split into independent building blocks so you can:

1. run agents in Minecraft,
2. evaluate the retrieval (RAG) layer outside Minecraft,
3. evaluate the LLM-to-action contract outside Minecraft,
4. inspect metrics and export CSV/JSON from a dashboard.

## Repository map

- `apps/bot/` — TypeScript Mineflayer agent runtime, planner integration, action execution, and bot-side research instrumentation.
- `apps/dashboard/` — Dashboard UI + server for loading session logs, computing metrics, and exporting trial datasets.
- `py/agent/` — Python RAG/planning sidecar, recipe corpus, and standalone RAG evaluation tooling.

## Quick start

### 1) Install dependencies

```bash
pnpm install
python -m pip install -e .
```

### 2) Run the bot

```bash
pnpm dev:bot
```

The bot will create configuration if missing and write logs under `apps/bot/logs/`.

### 3) Run dashboard

From `apps/dashboard`:

```bash
pnpm dev
```

Dashboard server reads bot logs and serves metrics/export endpoints.

---

## Research & evaluation methodology (transparent flow)

MineAgents computes evaluation metrics from immutable JSONL logs produced per session (`session.log`, `planner.log`, `actions.log`, `perception.log`).

### Data pipeline

1. **Bot runtime logs events** for startup, planner prompts/responses, actions, and completion status.
2. **Dashboard server loads sessions** from `apps/bot/logs/sessions/<date>/<session>/`.
3. **Trial summaries are derived** (duration, success/failure, action count, attempts, plan steps, LLM calls, memory retrieval count).
4. **Condition assignment** is transparent:
   - `baseline`: RAG disabled and no multi-agent collaboration.
   - `mineagents`: any run with RAG and/or collaboration features.
5. **Metrics are computed per condition**:
   - success rate,
   - average completion time,
   - average action steps,
   - average attempts,
   - average plan steps,
   - average LLM calls,
   - RAG retrieval-vs-success scatter points.
6. **Exports are generated** as downloadable CSV/JSON from dashboard.

### Marking which runs are evaluation test runs

By default, dashboard analytics now includes **only explicitly tagged evaluation runs**.

To tag a run for evaluation, place a copy/symlink of the run folder under:

```text
apps/bot/logs/evaluations/test-runs/
```

Supported layout patterns:

- `test-runs/<run-folder-with-session.log>/...`
- `test-runs/<alias>/<actual-session-folder-with-session.log>/...`

Use `?includeAll=1` on `/trials`, `/metrics`, and export endpoints if you need every session (including non-evaluation runs).

---

## Independent building-block evaluations

### RAG-only evaluation (no Minecraft required)

Runs retrieval against prompt fixtures with expected good/bad recipe hits.

```bash
pnpm eval:rag
```

Outputs:

- `py/agent/evaluations/results/rag_eval_results.csv`
- `py/agent/evaluations/results/rag_eval_results.json`

### LLM plan contract evaluation (no Minecraft required)

Parses fixture model outputs and validates action compatibility with supported bot actions.

```bash
pnpm eval:llm
```

Outputs:

- `apps/bot/evaluations/results/llm_plan_eval_results.csv`
- `apps/bot/evaluations/results/llm_plan_eval_results.json`

### Mineflayer integration tests

MineAgents includes unit tests by default and is structured so you can add Mineflayer `bot.test` integration suites for full client/server validation.

Recommended usage:

- Use fixture-based LLM contract eval first (`pnpm eval:llm`) to catch schema/action errors quickly.
- Then run Mineflayer integration tests in a dedicated environment to validate packet-level behavior against a live test server.

---

## Testing

- Bot tests: `pnpm test:bot`
- Dashboard tests: `pnpm -C apps/dashboard test`
- Python tests: `pytest py/agent/tests`

## Where to view results

- Live + historical analysis: Dashboard UI (`apps/dashboard`).
- Downloadable run datasets: dashboard “Download CSV/JSON” buttons.
- Independent evaluator outputs: CSV/JSON paths listed above.