from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict

PositionSchema: Dict[str, Any] = {
    "type": "object",
    "required": ["x", "y", "z"],
    "properties": {
        "x": {"type": "number"},
        "y": {"type": "number"},
        "z": {"type": "number"}
    },
    "additionalProperties": False
}

@dataclass
class ToolSpec:
    name: str
    description: str
    args_schema: Dict[str, Any] = field(default_factory=dict)

    def as_step_schema(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "required": ["action", "args", "reason"],
            "additionalProperties": False,
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Unique identifier per step, e.g., step-1"
                },
                "action": {"const": self.name},
                "args": self.args_schema,
                "reason": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Why this action is needed"
                },
                "after": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional step ids that must finish before this runs"
                },
                "expected_outcome": {
                    "type": "string",
                    "description": "What success looks like for this step"
                }
            }
        }

def make_tools() -> list[ToolSpec]:
    """List of allowed planner tools with their argument schemas."""

    return [
        ToolSpec(
            name="move",
            description="Travel to a coordinate while avoiding hazards",
            args_schema={
                "type": "object",
                "required": ["target"],
                "additionalProperties": False,
                "properties": {
                    "target": PositionSchema,
                    "approx": {
                        "type": "boolean",
                        "description": "Allow stopping near the coordinate instead of exact"
                    },
                    "avoid": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Blocks or biomes to route around"
                    }
                }
            }
        ),
        ToolSpec(
            name="look",
            description="Rotate view toward a coordinate or entity position",
            args_schema={
                "type": "object",
                "required": ["target"],
                "additionalProperties": False,
                "properties": {"target": PositionSchema}
            }
        ),
        ToolSpec(
            name="mine",
            description="Break a block to collect drops",
            args_schema={
                "type": "object",
                "required": ["target"],
                "additionalProperties": False,
                "properties": {
                    "target": PositionSchema,
                    "block": {
                        "type": "string",
                        "description": "Expected block type, e.g., oak_log"
                    },
                    "count": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "How many times to mine similar blocks nearby"
                    }
                }
            }
        ),
        ToolSpec(
            name="place",
            description="Place a block from inventory at a position",
            args_schema={
                "type": "object",
                "required": ["target", "block"],
                "additionalProperties": False,
                "properties": {
                    "target": PositionSchema,
                    "block": {"type": "string", "description": "Inventory block name"}
                }
            }
        ),
        ToolSpec(
            name="craft",
            description="Craft an item using crafting grid or table",
            args_schema={
                "type": "object",
                "required": ["recipe", "count"],
                "additionalProperties": False,
                "properties": {
                    "recipe": {
                        "type": "string",
                        "description": "Recipe or item name to craft"
                    },
                    "count": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Number of items to craft"
                    },
                    "use_crafting_table": {
                        "type": "boolean",
                        "description": "True if a crafting table is required"
                    }
                }
            }
        ),
        ToolSpec(
            name="smelt",
            description="Smelt an item in a furnace",
            args_schema={
                "type": "object",
                "required": ["input", "count"],
                "additionalProperties": False,
                "properties": {
                    "input": {"type": "string", "description": "Item to smelt"},
                    "count": {
                        "type": "integer",
                        "minimum": 1
                    },
                    "fuel_hint": {
                        "type": "string",
                        "description": "Preferred fuel, e.g., coal"
                    }
                }
            }
        ),
        ToolSpec(
            name="equip",
            description="Equip an item into hand or armor slot",
            args_schema={
                "type": "object",
                "required": ["item"],
                "additionalProperties": False,
                "properties": {
                    "item": {"type": "string"},
                    "slot": {
                        "type": "string",
                        "enum": ["main_hand", "off_hand", "head", "chest", "legs", "feet"]
                    }
                }
            }
        ),
        ToolSpec(
            name="eat",
            description="Consume food to restore hunger",
            args_schema={
                "type": "object",
                "required": [],
                "additionalProperties": False,
                "properties": {
                    "item": {"type": "string", "description": "Preferred food item"}
                }
            }
        ),
        ToolSpec(
            name="wait",
            description="Pause briefly, often to let effects apply or hazards pass",
            args_schema={
                "type": "object",
                "required": ["reason"],
                "additionalProperties": False,
                "properties": {
                    "reason": {"type": "string"},
                    "seconds": {"type": "number", "minimum": 1, "maximum": 10}
                }
            }
        )
    ]

TOOLS: list[ToolSpec] = make_tools()