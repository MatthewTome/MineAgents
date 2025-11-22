from __future__ import annotations

import json
from textwrap import dedent
from typing import Any, Dict, List, Optional

from .schema import allowed_tool_names, plan_schema_json

def planner_system_prompt() -> str:
    """Fixed system instructions for the planner model."""

    tool_names = ", ".join(allowed_tool_names())

    return dedent(
        f"""
        You are MineAgents' structured planner. Produce a coherent Minecraft action plan in JSON.
        Hard rules:
        - Output ONLY valid JSON (no prose, code fences, or comments).
        - Follow the JSON schema exactly. Do not invent fields.
        - Use only allowed tools: {tool_names}.
        - Keep 1-8 steps and ensure they read like a sensible short-term plan.
        - Prefer safety: avoid lava, fire, void, and risky drops unless the goal demands it.

        Schema (Draft-07):
        {plan_schema_json(indent=2)}

        Validation expectations:
        - Every step must include action, args, and reason.
        - Keep reasons concise (≤100 chars) and grounded in the snapshot.
        - Align goals and post_conditions; if the goal is met early, include a stop_condition.
        """
    ).strip()

def render_planner_prompt(
    goal: str,
    snapshot: Dict[str, Any],
    context: Optional[str] = None,
    retrieved_facts: Optional[List[str]] = None,
) -> str:
    """Create the full prompt the LLM sees when planning."""

    parts = [planner_system_prompt(), "\n---\n", f"Goal: {goal}"]

    if context:
        parts.append(f"\nMission context: {context}")

    if retrieved_facts:
        facts = "\n".join(f"- {fact}" for fact in retrieved_facts)
        parts.append(f"\nHelpful knowledge:\n{facts}")

    snapshot_json = json.dumps(snapshot, indent=2, sort_keys=True)
    parts.append(f"\nCurrent snapshot (read-only):\n{snapshot_json}")

    parts.append(
        "\nRespond with a JSON object that matches the schema and only uses allowed tools."
    )

    return "".join(parts)