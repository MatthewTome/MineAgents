import fs from "node:fs";
import path from "node:path";
import { PerceptionSnapshot } from "../settings/types.js";

export interface RecipeStep
{
    title: string;
    action: string;
    details: string;
    checks?: string[];
}

export interface Recipe
{
    name: string;
    goal: string;
    tags: string[];
    prerequisites?: string[];
    completion_checks?: string[];
    steps: RecipeStep[];
}

export class RecipeLibrary
{
    private recipes: Recipe[] = [];

    constructor(private readonly directory: string)
    {
    }

    public loadAll(): void
    {
        if (!fs.existsSync(this.directory))
        {
            console.warn(`[knowledge] Recipe directory not found: ${this.directory}`);
            return;
        }

        const files = this.getFilesRecursively(this.directory).filter(f => f.endsWith(".json"));
        this.recipes = [];

        for (const filepath of files)
        {
            try
            {
                const raw = fs.readFileSync(filepath, "utf-8");
                const recipe = JSON.parse(raw) as Recipe;
                
                if (recipe.name && recipe.steps && Array.isArray(recipe.steps))
                {
                    this.recipes.push(recipe);
                }
            }
            catch (err)
            {
                console.error(`[knowledge] Failed to load recipe ${filepath}:`, err);
            }
        }

        console.log(`[knowledge] Loaded ${this.recipes.length} recipes from ${this.directory}`);
    }

    private getFilesRecursively(dir: string): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        
        for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            
            if (stat && stat.isDirectory()) {
                results = results.concat(this.getFilesRecursively(filePath));
            } else {
                results.push(filePath);
            }
        }
        return results;
    }

    public search(query: string, perception: PerceptionSnapshot, topK: number = 3): Recipe[]
    {
        if (this.recipes.length === 0) return [];

        const normalizedQuery = query.toLowerCase();

        const scored = this.recipes.map(recipe =>
        {
            const state = this.evaluateRecipeState(recipe, perception);
            
            if (state === "completed") return { recipe, score: -100 };
            if (state === "blocked") return { recipe, score: -50 };

            let score = 0;
            if (normalizedQuery.includes(recipe.name.toLowerCase())) score += 10;
            if (normalizedQuery.includes(recipe.goal.toLowerCase())) score += 5;
            
            for (const tag of recipe.tags || [])
            {
                if (normalizedQuery.includes(tag.toLowerCase())) score += 3;
            }

            return { recipe, score };
        });

        const results = scored
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map(item => item.recipe);

        return results;
    }

    public formatRecipeFact(recipe: Recipe, maxSteps: number = 10): string
    {
        const stepChunks: string[] = [];
        
        for (const step of recipe.steps.slice(0, maxSteps))
        {
            let detail = step.details;
            if (detail.length > 180)
            {
                detail = `${detail.slice(0, 177)}...`;
            }

            const checks = step.checks && step.checks.length > 0 
                ? ` Checks: ${step.checks.slice(0, 2).join(", ")}` 
                : "";
            
            stepChunks.push(`${step.title} – ${step.action}: ${detail}${checks}`);
        }

        const stepsText = stepChunks.length > 0 ? stepChunks.join(" | ") : "No steps provided";
        const tags = recipe.tags && recipe.tags.length > 0 ? ` Tags: ${recipe.tags.join(", ")}.` : "";

        return `RECIPE: ${recipe.name} — goal: ${recipe.goal}.${tags} Steps: ${stepsText}`;
    }

    private evaluateRecipeState(recipe: Recipe, perception: PerceptionSnapshot): "blocked" | "ready" | "completed"
    {
        if (recipe.completion_checks && recipe.completion_checks.length > 0)
        {
            const allComplete = recipe.completion_checks.every(check => this.checkCondition(check, perception));
            if (allComplete) return "completed";
        }

        if (recipe.prerequisites && recipe.prerequisites.length > 0)
        {
            const allPrereqsMet = recipe.prerequisites.every(req => this.checkCondition(req, perception));
            if (!allPrereqsMet) return "blocked";
        }

        return "ready";
    }

    private checkCondition(condition: string, perception: PerceptionSnapshot): boolean
    {
        const lower = condition.toLowerCase();

        const itemMatch = lower.match(/have (\d+) ([a-z0-9_]+)/);
        if (itemMatch)
        {
            const count = parseInt(itemMatch[1], 10);
            const item = itemMatch[2];
            const inInv = perception.inventory.items?.find(i => i.name.includes(item));
            return (inInv?.count ?? 0) >= count;
        }

        if (lower.includes("equipped"))
        {
            const item = lower.replace("have ", "").replace(" equipped", "").trim();
            const hotbarItem = perception.inventory.hotbar.find(s => s.name.includes(item));
            return !!hotbarItem;
        }
        
        if (lower.includes("nearby") || lower.includes("perceived"))
        {
            const thing = lower.replace(" nearby", "").replace(" is perceived", "").trim();
            const resource = perception.nearbyResources?.find(r => r.name.includes(thing));
            const block = perception.blocks.sample5x5.find(b => b.name?.includes(thing));
            return !!resource || !!block;
        }

        return false;
    }
}