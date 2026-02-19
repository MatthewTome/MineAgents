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

        ALLOWED ACTIONS (use ONLY these):
        {tool_names}

        CRITICAL RULES:
        - Output ONLY valid JSON (no prose, code fences, or comments).
        - Follow the JSON schema exactly. Do not invent fields.
        - DO NOT create new actions. Actions like "calculate", "analyze", "think", "plan", or "check" do NOT exist.
        - If you need to calculate something (e.g., material counts), do it internally and put the result in params.
        - Use "perceive" to check inventory/surroundings, NOT a made-up "calculate" or "analyze" action.
        - Ensure steps read like a sensible short-term plan.
        - Prefer safety: avoid lava, fire, void, and risky drops unless the goal demands it.
        - If multiple agents are present, include team_plan and individual_plan sections with role-based step claims.
        - If only one agent is present, team_plan can be omitted but steps still required.

        MATERIAL CALCULATIONS (do these yourself, don't create steps for them):
        - 7x7 platform = 49 blocks
        - 7x7x4 walls (perimeter only) = ~96 blocks
        - 7x7 roof = 49 blocks
        - Total for 7x7 shelter ≈ 200 planks (mine ~50 logs, craft into planks)

        Schema (Draft-07):
        {plan_schema_json(indent=2)}

        Validation expectations:
        - Every step must include action, args, and reason.
        - The "action" field MUST be one of: {tool_names}
        - Keep reasons concise (≤100 chars) and grounded in the snapshot.
        - Align goals and post_conditions; if the goal is met early, include a stop_condition.
        - Verify inventory quantities against estimated build requirements. Gather and craft materials first if inventory is insufficient.
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