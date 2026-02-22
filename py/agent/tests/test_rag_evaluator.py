from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from mineagents.knowledge import RecipeLibrary
from scripts.evaluate_rag import normalize_prompt, run_case, validate_case


def test_rag_cases_surface_expected_good_and_bad_signals() -> None:
    recipes_dir = ROOT / "recipes"
    cases_file = ROOT / "evaluations" / "rag_cases.json"

    library = RecipeLibrary.from_directory(recipes_dir)
    cases = json.loads(cases_file.read_text(encoding="utf-8"))

    validated_cases = [validate_case(case, index) for index, case in enumerate(cases)]
    results = [run_case(library, case, default_top_k=8) for case in validated_cases]

    assert len(results) == 30
    for result in results:
        assert isinstance(result.passed, bool)
        assert result.retrieved


def test_normalize_prompt_handles_goal_prefix_and_multiline() -> None:
    prompt = "!goal craft a wooden pickaxe\n  !goal mine 5 coal\n\n"
    assert normalize_prompt(prompt) == "craft a wooden pickaxe mine 5 coal"


def test_validate_case_rejects_invalid_expect_lists() -> None:
    with pytest.raises(ValueError):
        validate_case({"id": "bad", "prompt": "ok", "expect_good": "nope"}, 0)