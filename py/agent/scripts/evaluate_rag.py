from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from mineagents.knowledge import RecipeLibrary


@dataclass
class RagCaseResult:
    case_id: str
    prompt: str
    retrieved: list[str]
    expect_good: list[str]
    expect_bad: list[str]
    missing_good: list[str]
    retrieved_bad: list[str]

    @property
    def passed(self) -> bool:
        return not self.missing_good and not self.retrieved_bad


def run_case(library: RecipeLibrary, case: dict[str, Any], top_k: int) -> RagCaseResult:
    prompt = str(case["prompt"])
    case_id = str(case["id"])
    expect_good = [str(name) for name in case.get("expect_good", [])]
    expect_bad = [str(name) for name in case.get("expect_bad", [])]

    retrieved_results = library.search(prompt, top_k=top_k)
    retrieved = [result.entry.key for result in retrieved_results]

    retrieved_set = set(retrieved)
    missing_good = [name for name in expect_good if name not in retrieved_set]
    retrieved_bad = [name for name in expect_bad if name in retrieved_set]

    return RagCaseResult(
        case_id=case_id,
        prompt=prompt,
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

    library = RecipeLibrary.from_directory(args.recipes_dir)
    cases = json.loads(args.cases.read_text(encoding="utf-8"))

    results = [run_case(library, case, args.top_k) for case in cases]
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
                },
                "results": [
                    {
                        "case_id": result.case_id,
                        "passed": result.passed,
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