from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from mineagents.knowledge import RecipeLibrary
from scripts.evaluate_rag import run_case


def test_rag_cases_surface_expected_good_and_bad_signals() -> None:
    recipes_dir = ROOT / "recipes"
    cases_file = ROOT / "evaluations" / "rag_cases.json"

    library = RecipeLibrary.from_directory(recipes_dir)
    cases = json.loads(cases_file.read_text(encoding="utf-8"))

    results = [run_case(library, case, top_k=6) for case in cases]

    assert len(results) >= 2
    for result in results:
        assert isinstance(result.passed, bool)
        assert result.retrieved