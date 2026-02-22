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
    assert "Build a Small Wooden Shelter" in names
    assert "finalize_iron_tools_pipeline" in names
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

    shelter_results = library.search("build a wooden shelter before nightfall", top_k=5)
    assert shelter_results
    assert any(r.entry.key == "Build a Small Wooden Shelter" for r in shelter_results)

    iron_results = library.search("iron tools pipeline", top_k=3)
    assert iron_results
    assert any(r.entry.key == "finalize_iron_tools_pipeline" for r in iron_results)


def test_generalized_order_and_normalization_recipes_are_retrievable() -> None:
    data_dir = ROOT / "recipes"
    library = RecipeLibrary.from_directory(data_dir)

    order_results = library.search("what order should I follow from wood to diamonds", top_k=5)
    assert order_results
    assert any(r.entry.key == "resource_progression_order_of_operations" for r in order_results)

    normalization_results = library.search("scale the wall and create a weapon", top_k=5)
    assert normalization_results
    assert any(r.entry.key == "natural_language_action_normalization" for r in normalization_results)