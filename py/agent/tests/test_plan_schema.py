from __future__ import annotations

import sys
from pathlib import Path

import pytest
from jsonschema import Draft7Validator, ValidationError

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from mineagents.planner.schema import PLAN_SCHEMA, example_plan, validate_plan
from mineagents.planner.tools import TOOLS

def test_schema_is_self_validating() -> None:
    Draft7Validator.check_schema(PLAN_SCHEMA)

def test_example_plan_passes_validation() -> None:
    plan = example_plan()
    validate_plan(plan)

def test_invalid_action_fails_validation() -> None:
    plan = example_plan()
    plan["steps"][0]["action"] = "fly"

    with pytest.raises(ValidationError):
        validate_plan(plan)

def test_allowed_tools_are_listed() -> None:
    names = [tool.name for tool in TOOLS]
    assert "move" in names
    assert len(names) == len(set(names))