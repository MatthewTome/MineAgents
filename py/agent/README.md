# py/agent

Python sidecar for recipe knowledge management (RAG corpus), planner prompt augmentation, schema checks, and standalone evaluation utilities.

## Responsibilities

- load/validate structured recipe JSON files,
- build searchable knowledge index,
- retrieve top recipe facts for a planning goal,
- render knowledge-aware planning prompts,
- provide independent RAG evaluation with CSV/JSON outputs.

## Project structure

- `mineagents/knowledge/` — recipe models, validation, indexing.
- `mineagents/planner/` — prompt building and RAG retrieval helpers.
- `recipes/` — canonical recipe dataset.
- `evaluations/rag_cases.json` — prompt-to-expected-hit fixtures.
- `scripts/evaluate_rag.py` — independent RAG evaluator.
- `tests/` — unit tests for schema, retrieval, and evaluator flow.

## RAG recipe quality flags (good/bad expectations)

Expected good/bad retrieval behavior is defined in `evaluations/rag_cases.json` per prompt:

- `expect_good`: recipes that should be retrieved,
- `expect_bad`: recipes that should not be retrieved.

This provides transparent, repeatable retrieval quality checks detached from Minecraft runtime.

## Run independent RAG evaluation

From repo root:

```bash
python py/agent/scripts/evaluate_rag.py
```

Optional arguments:

- `--recipes-dir`
- `--cases`
- `--top-k`
- `--csv`
- `--json`

Default outputs:

- `py/agent/evaluations/results/rag_eval_results.csv`
- `py/agent/evaluations/results/rag_eval_results.json`

CSV columns include:

- case id,
- pass/fail,
- prompt,
- retrieved recipes,
- expected good recipes,
- expected bad recipes,
- missing-good set,
- retrieved-bad set.

## Testing

```bash
pytest py/agent/tests
```

Includes:

- recipe loading/validation tests,
- retrieval behavior checks,
- prompt construction checks,
- evaluator sanity tests.