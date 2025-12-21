from __future__ import annotations

from pathlib import Path

from mineagents.knowledge import RecipeLibrary
from mineagents.planner import build_planner_prompt_with_knowledge


def test_prompt_includes_retrieved_knowledge(tmp_path: Path, caplog):
    recipes_dir = Path(__file__).parent.parent / "recipes"
    library = RecipeLibrary.from_directory(recipes_dir)

    goal = "build a shelter before nightfall"
    snapshot = {"time_of_day": "sunset", "inventory": ["oak_planks", "oak_log"]}

    prompt, context = build_planner_prompt_with_knowledge(
        goal=goal,
        snapshot=snapshot,
        library=library,
        max_steps=2,
        logger=None,
    )

    assert context.facts, "should surface knowledge facts"
    assert "Helpful knowledge:" in prompt
    assert any("Build a wooden shelter" in fact for fact in context.facts)
    assert "Build a wooden shelter" in prompt

    with caplog.at_level("DEBUG"):
        build_planner_prompt_with_knowledge(goal=goal, snapshot=snapshot, library=library)