from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ..knowledge import Recipe, RecipeLibrary, SearchResult
from .prompts import render_planner_prompt

LOGGER = logging.getLogger(__name__)


@dataclass
class PlannerKnowledgeContext:
    """Container for retrieved knowledge injected into planner prompts."""

    query: str
    facts: List[str]
    results: List[SearchResult]


def _format_recipe_fact(recipe: Recipe, max_steps: int) -> str:
    step_chunks: List[str] = []
    for step in recipe.steps[:max_steps]:
        detail = step.details
        if len(detail) > 180:
            detail = f"{detail[:177]}..."

        checks = f" Checks: {', '.join(step.checks[:2])}" if step.checks else ""
        step_chunks.append(f"{step.title} – {step.action}: {detail}{checks}")

    steps_text = " | ".join(step_chunks) if step_chunks else "No steps provided"
    tags = f" Tags: {', '.join(recipe.tags)}." if recipe.tags else ""
    return f"{recipe.name} — goal: {recipe.goal}.{tags} Steps: {steps_text}"


def _snapshot_hints(snapshot: Dict[str, Any], max_fields: int = 6) -> str:
    hints: List[str] = []
    for key, value in list(snapshot.items())[:max_fields]:
        if isinstance(value, (str, int, float)):
            hints.append(f"{key}: {value}")
        elif isinstance(value, list):
            preview = ", ".join(str(item) for item in value[:3])
            if preview:
                hints.append(f"{key}: {preview}")
        elif isinstance(value, dict):
            nested = ", ".join(f"{k}={v}" for k, v in list(value.items())[:3])
            if nested:
                hints.append(f"{key}: {nested}")
    return "; ".join(hints)


def retrieve_planning_knowledge(
    goal: str,
    snapshot: Dict[str, Any],
    library: RecipeLibrary,
    *,
    context: Optional[str] = None,
    query: Optional[str] = None,
    top_k: int = 3,
    max_steps: int = 3,
    logger: Optional[logging.Logger] = None,
) -> PlannerKnowledgeContext:
    """Search the recipe library and return formatted facts for planner prompts."""

    active_logger = logger or LOGGER

    snapshot_hint = _snapshot_hints(snapshot)
    search_query = query or "\n".join(part for part in [goal, context, snapshot_hint] if part)

    results = library.search(search_query, top_k=top_k)
    name_to_recipe = {recipe.name: recipe for recipe in library.recipes}

    facts: List[str] = []
    for result in results:
        recipe = name_to_recipe.get(result.entry.key)
        if not recipe:
            active_logger.debug("[planner.rag] Missing recipe for key '%s'", result.entry.key)
            continue

        facts.append(_format_recipe_fact(recipe, max_steps=max_steps))

    active_logger.debug(
        "[planner.rag] Retrieved %s knowledge entries for query '%s': %s",
        len(facts),
        search_query,
        [result.entry.key for result in results],
    )

    return PlannerKnowledgeContext(query=search_query, facts=facts, results=results)


def build_planner_prompt_with_knowledge(
    goal: str,
    snapshot: Dict[str, Any],
    library: RecipeLibrary,
    *,
    context: Optional[str] = None,
    top_k: int = 3,
    max_steps: int = 3,
    logger: Optional[logging.Logger] = None,
) -> tuple[str, PlannerKnowledgeContext]:
    """Render a planner prompt that includes retrieved how-to snippets."""

    knowledge = retrieve_planning_knowledge(
        goal,
        snapshot,
        library,
        context=context,
        top_k=top_k,
        max_steps=max_steps,
        logger=logger,
    )

    prompt = render_planner_prompt(
        goal=goal,
        snapshot=snapshot,
        context=context,
        retrieved_facts=knowledge.facts,
    )

    active_logger = logger or LOGGER
    active_logger.debug("[planner.rag] Planner prompt with knowledge:\n%s", prompt)

    return prompt, knowledge