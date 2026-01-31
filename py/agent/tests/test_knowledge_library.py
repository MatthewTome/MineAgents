from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from mineagents.knowledge import RecipeLibrary, RecipeValidationError, load_recipe_file


def test_recipes_load_from_repo_data() -> None:
    data_dir = ROOT / "recipes"
    library = RecipeLibrary.from_directory(data_dir)

    names = {recipe.name for recipe in library.recipes}
    assert "Build a wooden shelter" in names
    assert "Iron tools pipeline" in names
    assert len(names) >= 2


def test_invalid_recipe_has_actionable_error(tmp_path: Path) -> None:
    bad_file = tmp_path / "bad.json"
    bad_file.write_text('{"goal": "missing name", "steps": []}')

    with pytest.raises(RecipeValidationError) as exc:
        load_recipe_file(bad_file)

    assert "missing required field 'recipe.name'" in str(exc.value)


def test_sample_query_returns_expected_top_hits() -> None:
    data_dir = ROOT / "recipes"
    library = RecipeLibrary.from_directory(data_dir)

    shelter_results = library.search("build a wooden shelter before nightfall", top_k=2)
    assert shelter_results
    assert shelter_results[0].entry.key == "Build a wooden shelter"

    iron_results = library.search("iron tools pipeline", top_k=1)
    assert iron_results
    assert iron_results[0].entry.key == "Iron tools pipeline"