from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from mineagents.knowledge import RecipeLibrary

GOAL_PREFIX_RE = re.compile(r"^\s*!goal\s*", re.IGNORECASE)

@dataclass
class RagCaseResult:
    case_id: str
    prompt: str
    normalized_prompt: str
    retrieved: list[str]
    expect_good: list[str]
    expect_bad: list[str]
    missing_good: list[str]
    retrieved_bad: list[str]

    @property
    def passed(self) -> bool:
        return not self.missing_good and not self.retrieved_bad


def normalize_prompt(prompt: str) -> str:
    lines = [line.strip() for line in prompt.replace("\r", "").split("\n")]
    normalized_lines: list[str] = []
    for line in lines:
        if not line:
            continue
        normalized = GOAL_PREFIX_RE.sub("", line)
        if normalized:
            normalized_lines.append(normalized)
    return " ".join(normalized_lines).strip() or prompt.strip()


def _validate_string_list(raw: Any, field_name: str, case_id: str) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list) or any(not isinstance(item, str) for item in raw):
        raise ValueError(f"Case '{case_id}' has invalid '{field_name}': expected list[str]")
    return [item.strip() for item in raw if item.strip()]


def validate_case(case: dict[str, Any], index: int) -> dict[str, Any]:
    if not isinstance(case, dict):
        raise ValueError(f"Case at index {index} is invalid: expected object")

    if "id" not in case:
        raise ValueError(f"Case at index {index} is invalid: missing 'id'")
    case_id = str(case["id"]).strip()
    if not case_id:
        raise ValueError(f"Case at index {index} is invalid: empty 'id'")

    if "prompt" not in case:
        raise ValueError(f"Case '{case_id}' is invalid: missing 'prompt'")
    prompt = str(case["prompt"]).strip()
    if not prompt:
        raise ValueError(f"Case '{case_id}' is invalid: empty 'prompt'")

    expect_good = _validate_string_list(case.get("expect_good", []), "expect_good", case_id)
    expect_bad = _validate_string_list(case.get("expect_bad", []), "expect_bad", case_id)

    top_k = case.get("top_k")
    if top_k is not None:
        if not isinstance(top_k, int) or top_k <= 0:
            raise ValueError(f"Case '{case_id}' has invalid 'top_k': expected positive int")

    return {
        "id": case_id,
        "prompt": prompt,
        "expect_good": expect_good,
        "expect_bad": expect_bad,
        "top_k": top_k,
    }


def run_case(library: RecipeLibrary, case: dict[str, Any], default_top_k: int) -> RagCaseResult:
    prompt = case["prompt"]
    case_id = case["id"]
    expect_good = case["expect_good"]
    expect_bad = case["expect_bad"]
    top_k = case.get("top_k") or default_top_k

    normalized_prompt = normalize_prompt(prompt)
    retrieved_results = library.search(normalized_prompt, top_k=top_k)
    retrieved = [result.entry.key for result in retrieved_results]

    retrieved_set = set(retrieved)
    missing_good = [name for name in expect_good if name not in retrieved_set]
    retrieved_bad = [name for name in expect_bad if name in retrieved_set]

    return RagCaseResult(
        case_id=case_id,
        prompt=prompt,
        normalized_prompt=normalized_prompt,
        retrieved=retrieved,
        expect_good=expect_good,
        expect_bad=expect_bad,
        missing_good=missing_good,
        retrieved_bad=retrieved_bad,
    )


def write_csv(results: list[RagCaseResult], csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "case_id",
                "passed",
                "prompt",
                "normalized_prompt",
                "retrieved",
                "expect_good",
                "expect_bad",
                "missing_good",
                "retrieved_bad",
            ],
        )
        writer.writeheader()
        for result in results:
            writer.writerow(
                {
                    "case_id": result.case_id,
                    "passed": result.passed,
                    "prompt": result.prompt,
                    "normalized_prompt": result.normalized_prompt,
                    "retrieved": " | ".join(result.retrieved),
                    "expect_good": " | ".join(result.expect_good),
                    "expect_bad": " | ".join(result.expect_bad),
                    "missing_good": " | ".join(result.missing_good),
                    "retrieved_bad": " | ".join(result.retrieved_bad),
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run independent RAG retrieval evaluation and export results.")
    parser.add_argument("--recipes-dir", type=Path, default=Path("py/agent/recipes"))
    parser.add_argument("--cases", type=Path, default=Path("py/agent/evaluations/rag_cases.json"))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--csv", type=Path, default=Path("py/agent/evaluations/results/rag_eval_results.csv"))
    parser.add_argument("--json", type=Path, default=Path("py/agent/evaluations/results/rag_eval_results.json"))
    args = parser.parse_args()

    if args.top_k <= 0:
        raise SystemExit("--top-k must be a positive integer")

    library = RecipeLibrary.from_directory(args.recipes_dir)
    raw_cases = json.loads(args.cases.read_text(encoding="utf-8"))
    if not isinstance(raw_cases, list):
        raise SystemExit("Cases file must contain a JSON array")

    validated_cases = [validate_case(case, index) for index, case in enumerate(raw_cases)]
    case_ids = [case["id"] for case in validated_cases]
    if len(case_ids) != len(set(case_ids)):
        raise SystemExit("Cases file contains duplicate case ids")

    results = [run_case(library, case, args.top_k) for case in validated_cases]
    passed = sum(1 for result in results if result.passed)

    write_csv(results, args.csv)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(
        json.dumps(
            {
                "summary": {
                    "total": len(results),
                    "passed": passed,
                    "failed": len(results) - passed,
                    "pass_rate": round(passed / len(results), 4) if results else 0.0,
                },
                "results": [
                    {
                        "case_id": result.case_id,
                        "passed": result.passed,
                        "normalized_prompt": result.normalized_prompt,
                        "retrieved": result.retrieved,
                        "missing_good": result.missing_good,
                        "retrieved_bad": result.retrieved_bad,
                    }
                    for result in results
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"RAG evaluation complete: {passed}/{len(results)} passed")
    print(f"CSV: {args.csv}")
    print(f"JSON: {args.json}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())