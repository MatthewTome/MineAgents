from __future__ import annotations

import json
from typing import Any, Dict, List

from jsonschema import Draft7Validator

from .tools import TOOLS

PLAN_SCHEMA_VERSION = "1.0.0"

def build_plan_schema() -> Dict[str, Any]:
    step_schemas = [tool.as_step_schema() for tool in TOOLS]
    team_step_schema = {
        "type": "object",
        "required": ["id", "task", "role"],
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "task": {"type": "string"},
            "role": {"type": "string", "description": "builder|miner|generalist|other"},
            "assigned_agent": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["unclaimed", "claimed", "in_progress", "done"]
            },
            "announce": {
                "type": "string",
                "description": "Short chat message announcing step ownership"
            }
        }
    }
    team_plan_schema = {
        "type": "object",
        "required": ["summary", "steps"],
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string"},
            "blueprint": {
                "type": "string",
                "description": "Shared build blueprint or layout notes"
            },
            "steps": {
                "type": "array",
                "minItems": 1,
                "items": team_step_schema
            }
        }
    }
    individual_plan_schema = {
        "type": "object",
        "required": ["agent", "role", "intent", "steps"],
        "additionalProperties": False,
        "properties": {
            "agent": {"type": "string"},
            "role": {"type": "string"},
            "intent": {"type": "string"},
            "claimed_steps": {
                "type": "array",
                "items": {"type": "string"}
            },
            "announcements": {
                "type": "array",
                "items": {"type": "string"}
            },
            "steps": {
                "type": "array",
                "minItems": 1,
                "items": {"oneOf": step_schemas}
            }
        }
    }

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "MineAgents Planner Plan",
        "type": "object",
        "required": ["version", "goal", "steps"],
        "additionalProperties": False,
        "properties": {
            "version": {"type": "string", "const": PLAN_SCHEMA_VERSION},
            "goal": {"type": "string", "minLength": 1},
            "summary": {
                "type": "string",
                "description": "One-line human readable summary of the plan"
            },
            "hazard_avoidance": {
                "type": "array",
                "description": "List of hazards to actively avoid (lava, ravine, etc.)",
                "items": {"type": "string"}
            },
            "team_plan": team_plan_schema,
            "individual_plan": individual_plan_schema,
            "steps": {
                "type": "array",
                "minItems": 1,
                "items": {"oneOf": step_schemas}
            },
            "stop_condition": {
                "type": "string",
                "description": "Condition that ends the plan early (e.g., inventory full, nightfall)"
            },
            "post_conditions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Checklist of what should be true after the plan"
            },
            "metadata": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "snapshot_tick": {"type": "integer"},
                    "planner": {"type": "string"},
                    "latency_ms": {"type": "number"}
                }
            }
        }
    }

PLAN_SCHEMA: Dict[str, Any] = build_plan_schema()

def plan_schema_json(indent: int = 2) -> str:
    return json.dumps(PLAN_SCHEMA, indent=indent, sort_keys=True)

def validate_plan(plan: Dict[str, Any]) -> None:
    """Validate a plan object against the JSON Schema and allowed tools."""

    Draft7Validator.check_schema(PLAN_SCHEMA)
    Draft7Validator(PLAN_SCHEMA).validate(plan)

def allowed_tool_names() -> List[str]:
    return [tool.name for tool in TOOLS]

def example_plan(goal: str = "gather oak wood") -> Dict[str, Any]:
    """Return a minimal, schema-valid example plan."""

    return {
        "version": PLAN_SCHEMA_VERSION,
        "goal": goal,
        "summary": "Collect nearby oak logs safely and prepare planks",
        "hazard_avoidance": ["lava", "deep_drop"],
        "team_plan": {
            "summary": "Gather wood and craft planks while staying safe",
            "blueprint": "Shared woodland gathering; avoid hazardous drops.",
            "steps": [
                {
                    "id": "team-1",
                    "task": "Collect oak logs near spawn",
                    "role": "miner",
                    "assigned_agent": "MineAgent",
                    "status": "claimed",
                    "announce": "Claiming log collection near spawn."
                },
                {
                    "id": "team-2",
                    "task": "Craft planks from gathered logs",
                    "role": "builder",
                    "status": "unclaimed",
                    "announce": "Need a builder to craft planks."
                }
            ]
        },
        "individual_plan": {
            "agent": "MineAgent",
            "role": "miner",
            "intent": "Collect oak logs and prepare planks safely",
            "claimed_steps": ["team-1"],
            "announcements": ["Claiming log collection near spawn."],
            "steps": [
                {
                    "id": "step-1",
                    "action": "look",
                    "args": {"target": {"x": 2, "y": 0, "z": 4}},
                    "reason": "Scan for the closest oak tree and ensure path is clear",
                    "expected_outcome": "Tree trunk located in view"
                },
                {
                    "id": "step-2",
                    "action": "move",
                    "args": {"target": {"x": 4, "y": 0, "z": 8}, "approx": True},
                    "reason": "Walk to the tree while steering clear of hazards",
                    "after": ["step-1"],
                    "expected_outcome": "Close enough to start mining"
                },
                {
                    "id": "step-3",
                    "action": "mine",
                    "args": {
                        "target": {"x": 4, "y": 0, "z": 8},
                        "block": "oak_log",
                        "count": 4
                    },
                    "reason": "Harvest enough logs for planks and tools",
                    "after": ["step-2"],
                    "expected_outcome": "At least 4 oak logs collected"
                },
                {
                    "id": "step-4",
                    "action": "craft",
                    "args": {"recipe": "oak_planks", "count": 16},
                    "reason": "Convert logs into planks for future crafting",
                    "after": ["step-3"],
                    "expected_outcome": "Oak planks added to inventory"
                }
            ]
        },
        "steps": [
            {
                "id": "step-1",
                "action": "look",
                "args": {"target": {"x": 2, "y": 0, "z": 4}},
                "reason": "Scan for the closest oak tree and ensure path is clear",
                "expected_outcome": "Tree trunk located in view"
            },
            {
                "id": "step-2",
                "action": "move",
                "args": {"target": {"x": 4, "y": 0, "z": 8}, "approx": True},
                "reason": "Walk to the tree while steering clear of hazards",
                "after": ["step-1"],
                "expected_outcome": "Close enough to start mining"
            },
            {
                "id": "step-3",
                "action": "mine",
                "args": {
                    "target": {"x": 4, "y": 0, "z": 8},
                    "block": "oak_log",
                    "count": 4
                },
                "reason": "Harvest enough logs for planks and tools",
                "after": ["step-2"],
                "expected_outcome": "At least 4 oak logs collected"
            },
            {
                "id": "step-4",
                "action": "craft",
                "args": {"recipe": "oak_planks", "count": 16},
                "reason": "Convert logs into planks for future crafting",
                "after": ["step-3"],
                "expected_outcome": "Oak planks added to inventory"
            }
        ],
        "post_conditions": [
            "Inventory has >=16 oak_planks",
            "No damage taken during gathering"
        ],
        "stop_condition": "Stop early if inventory is full or hostile mob approaches",
        "metadata": {"planner": "Qwen3-VL-2B-Instruct"}
    }