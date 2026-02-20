# apps/dashboard

React + Node dashboard for MineAgents operations, replay, and research analytics.

## What this app does

- tails active session logs for near real-time status,
- computes trial summaries from completed session logs,
- computes aggregate research metrics,
- exports trial tables as CSV/JSON for offline analysis.

## Server behavior

The server scans:

- `DASHBOARD_LOG_DIR/sessions` for all recorded runs,
- `DASHBOARD_LOG_DIR/evaluations/test-runs` for explicitly tagged evaluation runs.

By default, API endpoints only return tagged evaluation runs.

### Include all runs override

Add `?includeAll=1` to:

- `/trials`
- `/metrics`
- `/exports/trials.csv`
- `/exports/trials.json`

## Evaluation run tagging workflow

### Recommended structure

```text
apps/bot/logs/
  sessions/
    2026-01-01/
      AgentA_....../
  evaluations/
    test-runs/
      run-001 -> ../../sessions/2026-01-01/AgentA_....../
      run-002/
        AgentB_....../
          session.log
          planner.log
          ...
```

Any directory under `test-runs/` that contains `session.log` (or has one nested level deeper) is treated as an evaluation run.

## Metrics methodology

Per trial fields are derived from logs:

- duration: first vs last `session.log` timestamp,
- success: `planner.execution.complete` vs `planner.execution.failed`,
- condition: baseline vs mineagents via startup features/team events,
- LLM calls: `planner.prompt` count,
- memory retrievals: planner prompts containing injected knowledge section,
- action count/attempts: deduplicated action ids and max attempt values,
- plan steps: max parsed planner step length.

Aggregations per condition include:

- success rate,
- average duration,
- average action steps,
- average attempts,
- average plan steps,
- average LLM calls,
- box-plot stats,
- RAG retrieval effectiveness scatter points.

## Running

```bash
pnpm -C apps/dashboard dev
```

## Testing

```bash
pnpm -C apps/dashboard test
```