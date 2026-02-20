import fs from "node:fs";
import path from "node:path";
import { parsePlan } from "../../planner/parsing.js";
import { SUPPORTED_ACTIONS } from "../../planner/supported-actions.js";

interface PlanCase {
    id: string;
    raw: string;
    model?: string;
    expectValid?: boolean;
    expectedActions?: string[];
}

interface PlanEvalResult {
    caseId: string;
    parsed: boolean;
    validActions: boolean;
    passed: boolean;
    expectValid: boolean;
    actions: string[];
    unsupportedActions: string[];
    parseError: string;
}

function csvEscape(value: unknown): string
{
    const text = value === undefined || value === null ? "" : String(value);
    if (/[",\n]/.test(text))
    {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function evaluateCase(testCase: PlanCase): PlanEvalResult
{
    const expectValid = testCase.expectValid ?? true;

    try
    {
        const parsed = parsePlan(testCase.raw, testCase.model ?? "fixture-model");
        const actions = parsed.steps.map(step => step.action);
        const unsupportedActions = actions.filter(action => !SUPPORTED_ACTIONS[action]);
        const validActions = unsupportedActions.length === 0;
        const parsedOk = true;
        const passed = expectValid ? parsedOk && validActions : !validActions;

        return {
            caseId: testCase.id,
            parsed: parsedOk,
            validActions,
            passed,
            expectValid,
            actions,
            unsupportedActions,
            parseError: ""
        };
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        return {
            caseId: testCase.id,
            parsed: false,
            validActions: false,
            passed: !expectValid,
            expectValid,
            actions: [],
            unsupportedActions: [],
            parseError: message
        };
    }
}

function writeCsv(results: PlanEvalResult[], outputPath: string): void
{
    const headers = [
        "case_id",
        "passed",
        "expect_valid",
        "parsed",
        "valid_actions",
        "actions",
        "unsupported_actions",
        "parse_error"
    ];

    const lines = [headers.join(",")];

    for (const result of results)
    {
        const row = [
            result.caseId,
            result.passed,
            result.expectValid,
            result.parsed,
            result.validActions,
            result.actions.join(" | "),
            result.unsupportedActions.join(" | "),
            result.parseError
        ].map(csvEscape);

        lines.push(row.join(","));
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf-8");
}

function main(): number
{
    const root = process.cwd();
    const casesPath = process.argv[2] ?? path.join(root, "evaluations", "llm_plan_cases.json");
    const csvPath = process.argv[3] ?? path.join(root, "evaluations", "results", "llm_plan_eval_results.csv");
    const jsonPath = process.argv[4] ?? path.join(root, "evaluations", "results", "llm_plan_eval_results.json");

    const cases = JSON.parse(fs.readFileSync(casesPath, "utf-8")) as PlanCase[];
    const results = cases.map(evaluateCase);
    const passed = results.filter(result => result.passed).length;

    writeCsv(results, csvPath);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ total: results.length, passed, results }, null, 2), "utf-8");

    console.log(`LLM plan evaluation complete: ${passed}/${results.length} passed`);
    console.log(`CSV: ${csvPath}`);
    console.log(`JSON: ${jsonPath}`);

    return passed === results.length ? 0 : 1;
}

process.exitCode = main();