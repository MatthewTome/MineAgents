from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List

from .index import HowToIndex, KnowledgeEntry, SearchResult


class RecipeValidationError(ValueError):
    pass


@dataclass
class RecipeStep:
    title: str
    action: str
    details: str
    checks: List[str] = field(default_factory=list)


@dataclass
class Recipe:
    name: str
    goal: str
    steps: List[RecipeStep]
    tags: List[str] = field(default_factory=list)
    required_items: List[str] = field(default_factory=list)
    optional_items: List[str] = field(default_factory=list)
    environment: List[str] = field(default_factory=list)
    hazards: List[str] = field(default_factory=list)
    notes: str = ""

    def as_entry(self) -> KnowledgeEntry:
        text_chunks = [
            self.name,
            self.goal,
            " ".join(self.tags),
            " ".join(self.required_items),
            " ".join(self.optional_items),
            " ".join(self.environment),
            " ".join(self.hazards),
            self.notes,
        ]

        for step in self.steps:
            text_chunks.extend([step.title, step.action, step.details, " ".join(step.checks)])

        text = "\n".join(chunk for chunk in text_chunks if chunk)
        return KnowledgeEntry(
            key=self.name,
            text=text,
            source="recipe",
            metadata={"goal": self.goal, "tags": ",".join(self.tags)},
        )


def _require_field(data: Dict, field_name: str, parent: str, path: Path) -> None:
    if field_name not in data:
        raise RecipeValidationError(f"Invalid recipe {path}: missing required field '{parent}.{field_name}'")


def _parse_step(step_data: Dict, path: Path) -> RecipeStep:
    _require_field(step_data, "title", "steps[]", path)
    _require_field(step_data, "action", "steps[]", path)
    _require_field(step_data, "details", "steps[]", path)

    title = step_data["title"]
    action = step_data["action"]
    details = step_data["details"]

    if not isinstance(title, str) or not title.strip():
        raise RecipeValidationError(f"Invalid recipe {path}: steps[].title must be a non-empty string")

    if not isinstance(action, str) or not action.strip():
        raise RecipeValidationError(f"Invalid recipe {path}: steps[].action must be a non-empty string")

    if not isinstance(details, str) or not details.strip():
        raise RecipeValidationError(f"Invalid recipe {path}: steps[].details must be a non-empty string")

    checks = step_data.get("checks", [])
    if not isinstance(checks, list) or any(not isinstance(item, str) for item in checks):
        raise RecipeValidationError(f"Invalid recipe {path}: steps[].checks must be a list of strings if provided")

    return RecipeStep(title=title.strip(), action=action.strip(), details=details.strip(), checks=[item.strip() for item in checks])


def _parse_recipe(data: Dict, path: Path) -> Recipe:
    _require_field(data, "name", "recipe", path)
    _require_field(data, "goal", "recipe", path)
    _require_field(data, "steps", "recipe", path)

    name = data["name"]
    goal = data["goal"]
    steps_raw = data["steps"]

    if not isinstance(name, str) or not name.strip():
        raise RecipeValidationError(f"Invalid recipe {path}: name must be a non-empty string")

    if not isinstance(goal, str) or not goal.strip():
        raise RecipeValidationError(f"Invalid recipe {path}: goal must be a non-empty string")

    if not isinstance(steps_raw, list):
        raise RecipeValidationError(f"Invalid recipe {path}: steps must be a list")

    steps = [_parse_step(step_data, path) for step_data in steps_raw]

    def _string_list(key: str) -> List[str]:
        value = data.get(key, [])
        if value is None:
            return []
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise RecipeValidationError(f"Invalid recipe {path}: {key} must be a list of strings if provided")
        return [item.strip() for item in value if item.strip()]

    tags = _string_list("tags")
    required_items = _string_list("required_items")
    optional_items = _string_list("optional_items")
    environment = _string_list("environment")
    hazards = _string_list("hazards")

    notes = data.get("notes", "")
    if notes is None:
        notes = ""
    if not isinstance(notes, str):
        raise RecipeValidationError(f"Invalid recipe {path}: notes must be a string if provided")

    return Recipe(
        name=name.strip(),
        goal=goal.strip(),
        steps=steps,
        tags=tags,
        required_items=required_items,
        optional_items=optional_items,
        environment=environment,
        hazards=hazards,
        notes=notes.strip(),
    )


def load_recipe_file(path: Path) -> Recipe:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise RecipeValidationError(f"Invalid recipe {path}: JSON decode error at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc

    return _parse_recipe(data, path)


def load_recipes_from_dir(directory: Path) -> List[Recipe]:
    if not directory.exists():
        raise FileNotFoundError(f"Recipe directory does not exist: {directory}")

    recipes: List[Recipe] = []
    for path in sorted(directory.rglob("*.json")):
        recipes.append(load_recipe_file(path))
    return recipes


class RecipeLibrary:
    def __init__(self, recipes: Iterable[Recipe]):
        self.recipes: List[Recipe] = list(recipes)
        self.index = HowToIndex([recipe.as_entry() for recipe in self.recipes])
        self.index.build()

    @classmethod
    def from_directory(cls, directory: Path) -> "RecipeLibrary":
        recipes = load_recipes_from_dir(directory)
        return cls(recipes)

    def add_recipe(self, recipe: Recipe) -> None:
        self.recipes.append(recipe)
        self.index.add_entry(recipe.as_entry())
        self.index.build()

    def search(self, query: str, top_k: int = 3) -> List[SearchResult]:
        return self.index.search(query, top_k=top_k)

    def top_recipes(self, query: str, top_k: int = 3) -> List[Recipe]:
        results = self.search(query, top_k=top_k)
        matched_names = {result.entry.key for result in results}
        name_to_recipe = {recipe.name: recipe for recipe in self.recipes}
        ordered: List[Recipe] = []
        for result in results:
            recipe = name_to_recipe.get(result.entry.key)
            if recipe:
                ordered.append(recipe)
        return ordered