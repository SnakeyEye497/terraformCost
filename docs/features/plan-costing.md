# Terraform plan-based costing

[← Docs index](../README.md)

Static parsing (inline costs, file and workspace scope) can't evaluate `count`/`for_each`, conditionals, function calls, or module outputs — it leaves those as unresolved placeholders. A real Terraform plan has already evaluated all of that. `Terraform Cost: Calculate Costs from Terraform Plan` loads one and costs exactly what will exist after it applies, using the *exact same* `src/core/cost-calculator.js` every other scope uses — plan JSON just feeds it fully-resolved attributes instead of static-parser output, so there's no second pricing engine to keep in sync.

**Setup:**
1. Generate a plan JSON: `terraform plan -out=plan.tfplan && terraform show -json plan.tfplan > plan.json`.
2. Run `Terraform Cost: Calculate Costs from Terraform Plan` and pick the `.json` file — or pick the binary `.tfplan` directly, and the extension will run `terraform show -json` for you automatically *if* the `terraform` CLI is on your PATH (if it isn't, you'll get a clear message asking you to run step 1 yourself and pick the resulting `.json` instead — it never fails silently or guesses).
3. The dashboard opens in a new **plan** scope — same donut/bars/forecast/budget charts as file/workspace scope, plus AI suggestions and Excel export both follow it too (a plan resource's module address shows up the same way a workspace resource's source file does).

**Design notes:**
- Only resources that will actually exist *after* the plan applies are included — a pure delete (`change.after === null`) contributes nothing to the post-apply total and is excluded; create/update/no-op all count.
- **Verified against a genuine `terraform init && terraform plan && terraform show -json` run** (`test/fixtures/sample-plan/`, included in the repo along with the `.tf` that generated it), not a hand-authored synthetic JSON — the resulting cost matched a hand-calculated expected total exactly. Worth knowing while testing this yourself: `terraform plan` piped through something like `| tail -N` masks its real exit code with the pipe's — check the exit code directly, or you'll see a false "success" even when plan failed with schema errors.
- Budget/capacity/cost-history for plan scope are looked up relative to the *plan file's own directory*, since a loaded plan isn't tied to a specific workspace folder the way file/workspace scope are.
