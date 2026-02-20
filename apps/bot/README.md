# apps/bot

TypeScript Mineflayer runtime for MineAgents.

This app is responsible for:

- connecting to Minecraft,
- perception snapshots,
- planning calls (LLM + optional RAG snippets),
- action execution,
- safety rails,
- structured session logging for research.

## Core architecture

- `src/index.ts` — boot flow, config load, feature flags, planner wiring.
- `src/settings/` — config schema/defaults and parsing.
- `src/planner/` — prompt construction, model call, response parsing.
- `src/actions/` — executable bot actions (mine/craft/build/chat/etc).
- `src/research/goals/` — research goal tracking utilities.
- `src/logger/` — JSONL logs used by dashboard analytics.

## Running

```bash
pnpm -C apps/bot dev
```

## Important environment variables

- `HF_TOKEN` — required for remote model calls.
- `HF_MODEL` — planner model id.
- `LLM_MODE` — `auto`, `local`, or `remote`.
- `BOT_CONFIG` — optional path to bot config YAML/JSON.
- `BOT_ENABLE_RAG` — override RAG on/off.
- `BOT_ENABLE_NARRATION` — override narration on/off.
- `BOT_ENABLE_SAFETY` — override safety on/off.

## Logs and research data produced

Logs are written per session as JSONL files and are the ground truth for evaluation:

- `session.log`
- `planner.log`
- `actions.log`
- `perception.log`
- `errors.log`
- `safety.log`

These feed dashboard metrics and exports.

## Independent building-block evaluators

### 1) LLM plan contract evaluator

Purpose: verify that model outputs can be parsed and map to supported bot actions without launching Minecraft.

```bash
pnpm -C apps/bot eval:llm
```

Input fixture:

- `apps/bot/evaluations/llm_plan_cases.json`

Outputs:

- `apps/bot/evaluations/results/llm_plan_eval_results.csv`
- `apps/bot/evaluations/results/llm_plan_eval_results.json`

Pass criteria per case:

- JSON parse succeeds,
- actions are in `SUPPORTED_ACTIONS`,
- expected validity matches result.

### 2) Standard unit tests

```bash
pnpm -C apps/bot test
```

Covers planner parsing, action handlers, config, safety rails, coordination logic, and evaluator integration.

## Evaluation run tagging for dashboard

To include a session in official evaluation analytics, mark it as a test run by placing it under:

```text
apps/bot/logs/evaluations/test-runs/
```

Only tagged runs are included by default in dashboard `/trials`, `/metrics`, and export endpoints.

Use `includeAll=1` query param to include every run.

## Mineflayer `bot.test` integration guidance

For full end-to-end contract validation:

1. Keep fixture-level checks (`eval:llm`) as a fast preflight.
2. Add Mineflayer `bot.test` suites to run planner-produced steps against a live test server.
3. Compare packet-level behavior and session logs to verify execution correctness.

This two-stage approach separates schema/contract failures from environment/network failures.