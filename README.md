# Matali - Terraform Cost Calculator

> **Ride the cloud, not the cost**

A VS Code extension that estimates the monthly/yearly cost of your Terraform infrastructure **as you write it** — inline next to each resource, as a total-cost header at the top of the file, and as a running total in the status bar. Supports AWS, GCP, and Azure, with optional [Infracost](https://www.infracost.io) integration for accurate live pricing (falls back to built-in estimated pricing if no API key is configured).

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-Apache--2.0-green)

---

## What this project is

It's a plain-JavaScript VS Code extension (no TypeScript, no bundler required to run it) built around a small pipeline:

```
.tf file text (active file; every .tf file via src/workspace-scanner.js,
   which resolves local module calls via src/module-resolver.js; or a
   `terraform show -json` plan via src/plan-parser.js)
   -> src/terraform-parser.js       parses HCL into resources/variables
   -> src/cost-calculator.js        looks up/estimates monthly cost per resource
        (optionally via src/infracost-integration.js, the Infracost CLI)
   -> src/cost-decorator.js         renders inline decorations + total-cost header
   -> src/status-bar-manager.js     shows the running total in the status bar
   -> src/cost-dashboard.js         charts for the active file, the whole workspace, or a loaded plan
   -> src/budget-manager.js         compares total cost against terraform.budget.json
        (optionally -> src/notification-manager.js, posts Slack/Teams alerts on threshold crossings)
   -> src/capacity-manager.js       reads expected load from terraform.capacity.json
   -> src/cost-history-manager.js   reads/appends recorded snapshots in terraform-cost-history.json
   -> src/ai-advisor.js             (optional) asks Gemini/Claude/GPT/DeepSeek/Groq for cost AND scaling suggestions
   -> src/excel-exporter.js         builds a multi-sheet .xlsx report from all of the above
   -> src/billing-integration.js    pulls ACTUAL spend (AWS Cost Explorer / Azure Cost Management /
                                    GCP BigQuery billing export) to compare against the estimate
   -> src/error-handler.js          centralizes error logging/reporting

scripts/ci-cost-report.js reuses terraform-parser.js + cost-calculator.js
headlessly (outside the extension host) for .github/workflows/terraform-cost.yml
```

All of this is wired together in [extension.js](extension.js), the extension's entry point. For the packaged extension, webpack bundles it (plus `debounce` and `exceljs`) into `dist/extension.js`.

## What's currently implemented

✅ **Working and test-covered** (76 tests passing under `npm test`: parser, cost calculator, module resolver, plan costing, budget/capacity/history managers, webhooks, AI advisor with a stubbed API, Excel export, billing integration, and an activation test that checks every declared command is registered):

- **Terraform/HCL parsing**: resources, variables, numeric/boolean attributes, and variable-reference resolution.
- **Cost calculation** with built-in fallback pricing for 60+ resource types, including:
  - **AWS**: EC2 (incl. root volume), RDS (incl. storage + Multi-AZ), Aurora/DocumentDB/Neptune instances, S3, EBS, EFS, NAT gateways, load balancers, EKS clusters and node groups, ElastiCache clusters and replication groups, Lambda, DynamoDB, OpenSearch, Redshift, MSK, Elastic IPs, interface VPC endpoints, Site-to-Site VPN, Route 53 zones, KMS keys, Secrets Manager, ECR, CloudWatch Logs
  - **GCP**: Compute Engine, Cloud SQL (incl. `db-custom-*` tiers, HA, disk), Cloud Storage, persistent disks, GKE clusters and node pools, Memorystore, static IPs, forwarding rules, Cloud NAT, Cloud VPN
  - **Azure**: VMs and VM scale sets, SQL Database (`azurerm_sql_database` and `azurerm_mssql_database`), PostgreSQL/MySQL Flexible Server, Storage Accounts, Managed Disks, AKS clusters (Free/Standard tier) and node pools, Azure Cache for Redis, App Service plans, public IPs, Standard load balancers, NAT gateways, Container Registry, VNet gateways
  - **Free plumbing** (VPCs, subnets, security groups, route tables, IAM, subnet groups, resource groups, …) is priced at **$0** rather than a guess.
  - Literal **`count` / `for_each`** on a resource multiplies its cost. Spot/preemptible capacity gets a ~70% discount.
- **Inline cost decorations** next to each resource, live as you type (debounced, default 2s).
- **Total infrastructure cost header** at the top of the file (green/yellow/red depending on budget status).
- **Status bar total cost** display.
- **Infracost CLI integration** for real pricing data. It is used automatically when the `infracost` CLI is installed and has an API key (either `terraformCost.infracostApiKey` or the CLI's own `infracost auth login`). Otherwise the built-in prices are used. Infracost results are matched by full resource address, including `module.x.` prefixes and `[index]` instances.
- **Budget thresholds** via an optional `terraform.budget.json` file per workspace: `limit_1/2/3` turn the header yellow with a budget-message block, and `final_limit` turns it red and raises an error diagnostic and popup. Threshold crossing is watched live (budgets are re-evaluated when the file is created, changed or deleted).
- **AI cost optimization suggestions**: pick a provider (Gemini, Claude, GPT, DeepSeek, or Groq), save its API key securely, and get concrete, resource-specific suggestions. See [AI cost optimization](#ai-cost-optimization).
- **Workspace-wide dashboard**: a **This file / Whole workspace** toggle that scans every `.tf` file and re-aggregates the same charts, plus a cost-by-file/module breakdown. See [Cost dashboard](#cost-dashboard).
- **AI capacity & scaling suggestions** against expected load stored in `terraform.capacity.json`. See [Capacity & scaling](#capacity--scaling).
- **Excel cost report export**: a multi-sheet `.xlsx`. See [Exporting a cost report](#exporting-a-cost-report).
- **GitHub Action for PR cost-diff comments**. See [CI: PR cost-diff comments](#ci-pr-cost-diff-comments).
- **Slack/Teams budget alert webhooks** for both file-scope and whole-workspace threshold crossings. Teams alerts use Adaptive Cards, which work with both Teams Workflows webhooks and classic Incoming Webhooks. See [Budget alert webhooks](#budget-alert-webhooks).
- **Module-graph resolution**, covering local modules, **remote modules** (registry, git, …) after `terraform init`, and `count`/`for_each` on module blocks. See [Module-graph resolution](#module-graph-resolution).
- **`terraform plan`-based costing**. See [Terraform plan-based costing](#terraform-plan-based-costing).
- **Cost history tracking**. See [Cost history](#cost-history).
- **Estimated vs. actual cloud spend**: pulls last month's and month-to-date spend from AWS Cost Explorer, Azure Cost Management and the GCP BigQuery billing export through each provider's own CLI login, and compares it against the Terraform estimate. See [Actual cloud spend](#actual-cloud-spend).
- **Error handling and logging** via `src/error-handler.js`, with `Export Error Log` / `Clear Error Log` commands.
- **Packaging**: `npm run vsix` builds a ~355 KB `.vsix` (webpack-bundled, icon included). `npm audit` reports 0 vulnerabilities and ESLint reports 0 warnings.

⚠️ **Known gaps / not yet done:**

- **Not yet published to the Marketplace.** The package builds, but publishing needs a Marketplace publisher account and a Personal Access Token. `package.json` uses `publisher: "snakeyeye497"`, so change it if your publisher ID differs. See [Publishing](#publishing).
- **Static parsing can't evaluate expressions.** `count = var.enabled ? 1 : 0`, `local.*` values, function calls and `each.value` aren't evaluated, so such resources are costed as a single instance. Registry modules lean on these heavily (e.g. the AWS VPC module's optional VPN gateway). For exact numbers on such projects, use [plan-based costing](#terraform-plan-based-costing).
- **Usage-based services are estimates.** Lambda (1M invocations/mo at 200ms), S3/Cloud Storage/Blob/EFS (100 GB), CloudWatch Logs (5 GB ingested) and DynamoDB on-demand requests use stated assumptions, not real usage. Infracost has the same limitation without a usage file.
- **Built-in prices are approximate us-east-1 / us-central1 / eastus on-demand list prices.** The `terraformCost.region` setting doesn't change them. Use Infracost for region-accurate pricing.
- **Actual-spend comparison has only been tested against mocked CLI output**, covering the response parsing, period math, Windows/POSIX command running, temp-file cleanup and per-provider error isolation. It has not been run against a real AWS/Azure/GCP billing account. Note that AWS charges $0.01 per Cost Explorer request, and each comparison run makes 2.
- **The GitHub Action has never run on GitHub's runners.** Its logic is verified locally. The first PR touching a `.tf` file will be its first real run.
- **Slack/Teams webhooks have never posted to a real channel.** Payloads and error handling are tested against a stubbed `fetch`.

## Installation (cloning from GitHub)

```bash
git clone <this-repo-url>
cd terraformCost
npm install
```

That's it for getting the code runnable — `npm install` pulls in everything needed for linting, testing, and running the extension in a VS Code Extension Development Host (see [RUNNING.md](RUNNING.md)).

**Requirements:**
- [Node.js](https://nodejs.org) (tested on v22+) and npm
- VS Code `^1.85.0`
- Internet access the *first* time you run `npm test` — it downloads a standalone copy of VS Code (~330MB) to `.vscode-test/` to run the extension host tests in. Cached after that.
- (Optional) An [Infracost API key](https://www.infracost.io) for accurate live pricing — without one, the extension uses its built-in fallback pricing tables.
- (Optional) An API key for AI cost optimization suggestions — from [Google AI Studio](https://aistudio.google.com/apikey) (Gemini), [Anthropic](https://console.anthropic.com/) (Claude), [OpenAI](https://platform.openai.com/) (GPT), [DeepSeek](https://platform.deepseek.com/) (low-cost, no minimum spend), or [Groq](https://console.groq.com/) (genuinely free tier, no card required — the easiest one to try first). Note: a Gemini key created through Cloud/Vertex billing rather than the plain AI Studio flow may require a prepay balance before it can generate content at all; the free-tier AI Studio key usually doesn't.

There is no Marketplace listing yet. Either run it from source (see **[RUNNING.md](RUNNING.md)**: press F5, which builds `dist/` first), or build and install a `.vsix` locally:

```bash
npm run vsix                                     # -> terraform-cost-calculator-1.0.0.vsix
code --install-extension terraform-cost-calculator-1.0.0.vsix
```

## Configuration

Access via VS Code Settings (`Ctrl+,`) → search "Terraform Cost", or edit `settings.json` directly.

| Setting | Default | Description |
|---------|---------|-------------|
| `terraformCost.enabled` | `true` | Enable/disable extension |
| `terraformCost.useInfracost` | `true` | Use Infracost for accurate pricing |
| `terraformCost.infracostApiKey` | `""` | Your Infracost API key |
| `terraformCost.providers` | `["aws","gcp","azure"]` | Cloud providers to support |
| `terraformCost.currency` | `USD` | Display currency (USD, EUR, GBP, JPY) |
| `terraformCost.region` | `{aws:us-east-1, gcp:us-central1, azure:eastus}` | Default region per provider |
| `terraformCost.updateInterval` | `2000` | Delay before recalculating (ms) |
| `terraformCost.showInlineDecorations` | `true` | Show costs inline |
| `terraformCost.showStatusBar` | `true` | Show total in status bar |
| `terraformCost.showTotalCostHeader` | `true` | Show cost summary at top |
| `terraformCost.useSeparateBudgetDecoration` | `true` | Show budget messages as a separate block under the total header |
| `terraformCost.expensiveThreshold` | `100` | Threshold (USD/mo) to highlight expensive resources |
| `terraformCost.ai.provider` | `none` | AI provider for cost suggestions: `none`, `gemini`, `claude`, `openai`, `deepseek`, `groq` |
| `terraformCost.ai.model` | `""` | Override the default model id for the selected AI provider |
| `terraformCost.notifications.provider` | `none` | Budget alert webhook target: `none`, `slack`, `teams` (set via the webhook command) |
| `terraformCost.billing.awsProfile` | `""` | AWS CLI profile for the actual-spend comparison (blank = default credentials) |
| `terraformCost.billing.azureSubscriptionId` | `""` | Azure subscription for the actual-spend comparison (blank = `az account show` default) |
| `terraformCost.billing.gcpBillingExportTable` | `""` | BigQuery billing export table (`project.dataset.table`) for the GCP actual-spend comparison |

API keys for the AI provider are **not** a setting — set them via the `Terraform Cost: Set AI Provider API Key` command, which stores them in VS Code's SecretStorage rather than plain-text `settings.json` (unlike `infracostApiKey`, which currently is a plain string setting).

### Cost indicators

- 🟢 Green — < $10/month
- 🟡 Yellow — $10–50/month
- 🟠 Orange — $50–100/month
- 🔴 Red — > $100/month

### Optional budgeting (`terraform.budget.json`)

Drop a `terraform.budget.json` in your workspace root (or any parent folder of your `.tf` files):

```json
{
  "final_limit": 2000.00,
  "limit_1": 100.00,
  "limit_2": 500.00,
  "limit_3": 1000.00
}
```

- `limit_1/2/3` reached → header turns yellow, a budget-message block appears.
- `final_limit` reached → header turns red, an error diagnostic + popup appears.
- Notifications only fire when crossing into a *higher* threshold (no spam).
- Delete the file to disable the feature for that workspace.

## Commands

| Command | What it does |
|---|---|
| `Terraform Cost: Calculate Costs` | Manually (re-)calculate costs for the active file |
| `Terraform Cost: Refresh Cost Estimates` | Clears the cost cache and recalculates all open Terraform files |
| `Terraform Cost: Toggle Cost Display` | Show/hide inline cost decorations |
| `Terraform Cost: Toggle Total Cost Header` | Show/hide the total-cost header at the top of the file |
| `Terraform Cost: Show Cost Dashboard` | Opens a visual dashboard (see below), defaulting to the active Terraform file |
| `Terraform Cost: Show Workspace Cost Dashboard` | Same dashboard, opened straight into "whole workspace" scope |
| `Terraform Cost: Get AI Cost Optimization Suggestions` | Asks the configured AI provider for suggestions on whichever scope the dashboard currently shows (file or whole workspace) |
| `Terraform Cost: Set AI Provider API Key` | Pick a provider (Gemini/Claude/GPT/DeepSeek/Groq) and securely save its API key |
| `Terraform Cost: Clear AI Provider API Key` | Remove a saved AI provider API key |
| `Terraform Cost: Get Scaling Suggestions` | Asks the configured AI provider whether the current scope's resources are right-sized for your expected load |
| `Terraform Cost: Set Capacity & Scaling Inputs` | Interactive wizard for expected users/requests/growth, saved to `terraform.capacity.json` |
| `Terraform Cost: Export Cost Report (Excel)` | Prompts for scope, then saves a multi-sheet `.xlsx` cost report via a native save dialog |
| `Terraform Cost: Set Budget Alert Webhook (Slack/Teams)` | Pick Slack or Teams and securely save an incoming webhook URL for budget-threshold alerts |
| `Terraform Cost: Send Test Budget Alert` | Post a clearly-labelled sample alert to the saved webhook to confirm delivery |
| `Terraform Cost: Clear Budget Alert Webhook` | Remove the saved webhook and disable alerts |
| `Terraform Cost: Calculate Costs from Terraform Plan` | Pick a `terraform show -json` plan (or binary `.tfplan`) and cost every resource that will exist after it applies |
| `Terraform Cost: Record Cost Snapshot` | Append the current scope's total to `terraform-cost-history.json` for the dashboard's Cost History chart |
| `Terraform Cost: Compare Estimate with Actual Cloud Spend` | Pull real spend from AWS/Azure/GCP billing and open an estimate-vs-actual report |
| `Terraform Cost: Export Error Log` | Save the extension's internal error log to a file |
| `Terraform Cost: Clear Error Log` | Clear the internal error log |

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

## Cost dashboard

`Terraform Cost: Show Cost Dashboard` (or the graph icon in a `.tf` file's editor toolbar) opens a webview panel with a **This file / Whole workspace** toggle at the top, and:

- A **hero total** (monthly/yearly/hourly cost, resource + provider counts — plus a files-scanned count in workspace scope), animated on every update.
- A **donut chart** — cost broken down by resource type (top 5 + "Other"), with a legend and a "View as table" toggle.
- A **bar chart** — cost by cloud provider (AWS / GCP / Azure).
- **Workspace scope only**: a **cost-by-file/module** bar chart — which file in a multi-file project is actually driving the bill.
- A **12-month forecast** — cumulative spend if usage stays flat vs. an illustrative ~5%/month growth scenario, with a hover crosshair/tooltip.
- A **budget meter** (only shown when a `terraform.budget.json` applies) showing spend against your configured limits.

**File scope** reuses the same cost calculation the inline decorations use, and re-renders automatically whenever you edit/save the tracked file or switch to another Terraform file (see `buildDashboardAggregate` / `updateDashboard` in [extension.js](extension.js)).

**Workspace scope** is powered by `src/workspace-scanner.js`, which finds every `.tf` file in the workspace (excluding `.terraform/`, `node_modules/`, `.git/`), resolves resources the way real Terraform would — following local `module` calls (see [Module-graph resolution](#module-graph-resolution) below) — and tags each with its source file. Because scanning every file is more expensive than recalculating one, workspace scope only refreshes on file save, on switching into that scope, or the panel's manual **Refresh** button — not on every keystroke the way file scope does.

Both scopes share the same rendering code (`src/cost-dashboard.js`, a `vscode.WebviewPanel`, vanilla HTML/CSS/SVG/JS — no chart library, no network calls); only the data feeding it differs.

## Module-graph resolution

Workspace scope doesn't just flatten every file's resources into one list — `src/module-resolver.js` follows `module "x" { source = "..." }` calls the way real Terraform does:

- A module's variables come from what its caller actually passed in (`instance_type = "m5.xlarge"` in the `module` block), falling back to the module's own `default` only if the caller didn't pass one.
- A module instantiated **more than once** — e.g. `module "prod" { source = "./modules/app", instance_type = "m5.xlarge" }` and `module "dev" { source = "./modules/app", instance_type = "t3.micro" }` — produces **two independently-resolved resource sets**, not one shared/flattened one. (This needed a specific fix: the naive approach mutates parsed resource objects in place, so a second instantiation would silently inherit the first's already-resolved values — module-resolver.js deep-clones before resolving each instantiation to avoid that.)
- A caller can forward its own variable straight into a child module (`foo = var.bar`) and it resolves correctly against the caller's own scope.
- Nested modules (a module that itself calls further modules) work, with a cycle guard and a depth limit (12) against a module accidentally referencing itself.
- **`count` / `for_each` on a module block** instantiates it once per instance (`workers[0]`, `workers[1]`, `regional["eu"]`, …). This works for literal values and for values passed through `var.x`; `count = 0` removes the module.
- **Remote sources** (Terraform Registry, git, S3, …) are resolved through the `.terraform/modules/modules.json` manifest that `terraform init` (or `terraform get`) writes. The downloaded module source in `.terraform/modules/` is read even though that folder is otherwise excluded from scanning.
- Each resolved resource is tagged with a `modulePath` (e.g. `app.compute` for a nested call) shown throughout the dashboard, export, and AI suggestions alongside — or in place of — the source file.

**Limits**: a remote module that hasn't been downloaded yet (no `terraform init`) can't be resolved and is logged as unresolved rather than silently dropped. Expressions inside modules (`local.*`, conditionals, `each.value`) aren't evaluated. For a project that leans on those, load a real [`terraform` plan](#terraform-plan-based-costing) instead, because Terraform's own plan engine has already resolved all of it.

**Verification**: `src/module-resolver.js` has no `vscode` dependency, so it is unit-tested in `test/suite/module-resolver.test.js`. The tests cover overrides, multiple call sites, var passthrough, module `count`/`for_each` (including `count = 0`), remote and nested-remote modules via a manifest, unresolved remote modules, and roots-vs-modules. It was also run against the real `terraform-aws-modules/vpc/aws` 5.13.0 registry module downloaded with `terraform get`. All 77 of the module's resources resolved through the manifest, alongside a local module with `count = 2`.

## AI cost optimization

An "✨ AI cost optimization suggestions" card in the dashboard (and the `Terraform Cost: Get AI Cost Optimization Suggestions` command) sends the active file's resources + calculated costs to a user-chosen LLM and asks for concrete, resource-specific suggestions — rightsizing, reserved instances/savings plans, storage tier changes, architecture swaps (e.g. NAT Gateway → VPC endpoint) — each with an estimated monthly saving where the model can reasonably infer one.

**Setup:**
1. Run `Terraform Cost: Set AI Provider API Key`, pick **Gemini**, **Claude**, or **GPT**, and paste your key. This also sets `terraformCost.ai.provider` to match. Keys are stored via VS Code's `SecretStorage`, not in `settings.json`.
2. Run `Terraform Cost: Get AI Cost Optimization Suggestions` (or click "✨ Ask AI for suggestions" in the dashboard).

**Design notes:**
- **Explicitly user-triggered, never automatic** — it doesn't fire on every keystroke or file save, so it never silently burns API quota/cost.
- **Follows the dashboard's current scope** — analyzes the active file when the dashboard is in file scope, or every resource across the whole workspace when it's in workspace scope (no separate toggle to remember; whatever charts you're looking at is what gets analyzed). Workspace-scope calls cap at the 150 highest-cost resources to avoid silently blowing past a provider's context window on a very large project, and note the truncation in the prompt when it happens. Each suggestion is tagged with its source file (looked up from the original resource list, not trusted from the model's own response) so a workspace-wide suggestion is actually actionable — you know which file to go edit.
- **Provider-agnostic**: `src/ai-advisor.js` has one thin adapter per API shape (`fetch` calls to Gemini's `generateContent`, Anthropic's Messages API, and one shared OpenAI-compatible chat-completions adapter reused by OpenAI, DeepSeek, and Groq — no SDKs, keeps the extension small) behind a single `getSuggestions()` interface.
- **Defensive response parsing**: the model is asked to return strict JSON; if it doesn't, the raw text is still surfaced as a single suggestion rather than silently failing.
- Rendered suggestions are HTML-escaped in the webview before display, since they're untrusted model output.

## Capacity & scaling

A separate "📈 Capacity & scaling suggestions" card asks a different question than cost: *given this resource is a `t3.medium`, and I expect 50k requests/day and 500 concurrent users, is that the right size?* It reasons about under-provisioning (bottleneck risk) as well as over-provisioning (paying for headroom nobody uses).

**Setup:**
1. Run `Terraform Cost: Set Capacity & Scaling Inputs` (or click **Set capacity inputs** in the dashboard card). A short wizard asks for expected daily users, requests/day, peak requests/second, and expected growth %/month — all optional, leave any blank to skip. Saved to `terraform.capacity.json` at the workspace root (same directory-walk-up pattern as `terraform.budget.json`).
2. Run `Terraform Cost: Get Scaling Suggestions` (or click **Get scaling suggestions** in the dashboard). Uses the same AI provider/key as cost suggestions — no separate setup.

Example `terraform.capacity.json`:
```json
{
  "expected_users": 5000,
  "requests_per_day": 200000,
  "peak_requests_per_second": 50,
  "growth_rate_percent": 10
}
```

**Design notes:**
- **AI-required, deliberately no hardcoded sizing tables.** A hand-maintained "a `t3.medium` handles ~X req/s" lookup table would hit the exact same staleness problem the AI model-id defaults already did (see `src/ai-advisor.js`'s comments) — except with no live endpoint to catch it drifting. Letting the model reason over the numbers, clearly framed as a rough estimate, was judged more honest than a lookup table with false authority.
- Same explicitly-user-triggered, dashboard-scope-following behavior as cost suggestions (see [Scope-aware AI suggestions](#ai-cost-optimization) above) — follows file, workspace, or a loaded plan, whichever the dashboard currently shows.
- Response shape mirrors cost suggestions but with `action: "scale_up" | "scale_down" | "keep"` and `suggestedChange` instead of `category`/`estimatedMonthlySavings` — see `buildScalingPrompt` / `parseScalingSuggestions` in `src/ai-advisor.js`.

## Terraform plan-based costing

Static parsing (everything above) can't evaluate `count`/`for_each`, conditionals, function calls, or module outputs — it leaves those as unresolved placeholders. A real Terraform plan has already evaluated all of that. `Terraform Cost: Calculate Costs from Terraform Plan` loads one and costs exactly what will exist after it applies, using the *exact same* `cost-calculator.js` every other scope uses — plan JSON just feeds it fully-resolved attributes instead of static-parser output, so there's no second pricing engine to keep in sync.

**Setup:**
1. Generate a plan JSON: `terraform plan -out=plan.tfplan && terraform show -json plan.tfplan > plan.json`.
2. Run `Terraform Cost: Calculate Costs from Terraform Plan` and pick the `.json` file — or pick the binary `.tfplan` directly, and the extension will run `terraform show -json` for you automatically *if* the `terraform` CLI is on your PATH (if it isn't, you'll get a clear message asking you to run step 1 yourself and pick the resulting `.json` instead — it never fails silently or guesses).
3. The dashboard opens in a new **plan** scope — same donut/bars/forecast/budget charts as file/workspace scope, plus AI suggestions and Excel export both follow it too (a plan resource's module address shows up the same way a workspace resource's source file does).

**Design notes:**
- Only resources that will actually exist *after* the plan applies are included — a pure delete (`change.after === null`) contributes nothing to the post-apply total and is excluded; create/update/no-op all count.
- **Verified against a genuine `terraform init && terraform plan && terraform show -json` run** (`test-fixtures/sample-plan/`, included in the repo along with the `.tf` that generated it), not a hand-authored synthetic JSON — the resulting cost matched a hand-calculated expected total exactly. Worth knowing while testing this yourself: `terraform plan` piped through something like `| tail -N` masks its real exit code with the pipe's — check the exit code directly, or you'll see a false "success" even when plan failed with schema errors.
- Budget/capacity/cost-history for plan scope are looked up relative to the *plan file's own directory*, since a loaded plan isn't tied to a specific workspace folder the way file/workspace scope are.

## Exporting a cost report

`Terraform Cost: Export Cost Report (Excel)` (or the **Export** button in the dashboard's topbar) generates a real multi-sheet `.xlsx` — for sharing the numbers with someone who doesn't use VS Code, or as a snapshot to attach to a ticket/PR/report.

1. Run the command. If a workspace folder is open, you're asked **This file** or **Whole workspace** first (same two scopes as the dashboard).
2. It recomputes fresh data for that scope, then a native **Save As** dialog opens with a sensible default filename (`<project-name>-cost-report-<date>.xlsx`).
3. Once saved, a toast offers **Reveal in Folder**.

**Sheets included** (only the ones that actually apply to your project — an empty budget file doesn't produce an empty Budget sheet):
- **Summary** — project name, scope, generation date, total monthly/yearly/hourly cost, budget status, capacity inputs, all in one glance
- **Resources** — every resource, one row each: type, name, provider, source file (workspace scope), monthly/yearly cost, sorted highest-cost-first
- **By Provider**, **By Resource Type** — full breakdowns (not the dashboard's top-5-truncated chart versions)
- **By File/Module** — workspace scope only
- **12-Month Forecast** — the same flat vs. growth-scenario numbers as the dashboard's forecast chart
- **Budget**, **Capacity Inputs** — only if those config files exist for the project
- **Cost History** — only if you've recorded at least one snapshot (see [Cost history](#cost-history) below)
- **AI Cost Suggestions**, **AI Scaling Suggestions** — only if you've actually run either this session; the export never triggers a fresh AI call itself, it just includes the last successful result if there is one

**Design notes:**
- Built with [`exceljs`](https://www.npmjs.com/package/exceljs) (`src/excel-exporter.js`) — the one runtime dependency this project has beyond `debounce`. Adding a real `.xlsx` writer isn't something worth hand-rolling; a plain CSV would satisfy "opens in Excel" but not really what "export an Excel report" means for something meant to be shared with stakeholders.
- `src/excel-exporter.js` has zero knowledge of `vscode`, the parser, or the calculator — it's handed a plain data object and lays out whatever's in it. Verified end-to-end (built a workbook, wrote it, reopened it with `exceljs`'s own reader, checked every sheet round-tripped correctly) before wiring it into the command.
- By-provider/by-type sheets are computed fresh from the full resource list at export time, not reused from the dashboard's aggregates — the dashboard intentionally truncates "by type" to top-5-plus-Other for chart legibility, but a report shouldn't silently drop data.

## CI: PR cost-diff comments

`.github/workflows/terraform-cost.yml` runs on every pull request that touches a `.tf` file and comments the estimated monthly cost, plus the delta vs. the PR's base branch, directly on the PR — updating the same comment on subsequent pushes rather than spamming a new one each time.

```
💰 Terraform Cost Estimate
$1,384.74/mo (base: $1,330.05/mo) — 📈 +$54.69/mo

| Provider | Monthly |
|---|---|
| AWS | $700.30/mo |
| Microsoft Azure | $360.10/mo |
| Google Cloud | $340.10/mo |

32 cost-relevant resources across 11 file(s).
```

**How it works:** `scripts/ci-cost-report.js` is a small headless CLI wrapper that reuses `src/terraform-parser.js` + `src/cost-calculator.js` directly — the same production code the VS Code extension itself runs, not a second implementation to drift out of sync with the first. Both modules only ever touch `vscode.workspace.getConfiguration(...).get(key, default)`, never any other `vscode` API, as long as `TerraformCostCalculator.initialize()` is never called (which the CLI deliberately never does — that's what would otherwise try to shell out to a real `infracost` binary that won't exist in CI) — so a one-function stub returning the caller's own default for every config key is enough to run them standalone. The workflow checks out both the PR branch and its base into separate directories, runs the CLI against each, and diffs the totals.

**Try it**: `node scripts/ci-cost-report.js test-fixtures/complex-project` locally — should print the same `$1,330.05` total documented in that fixture's own README, since it's the identical calculation path.

**Honest limitation**: the CLI script and the PR-comment logic are both verified locally (the CLI against real fixtures with known-correct numbers; the comment-building/create-vs-update logic executed against mocked GitHub API calls) — but the workflow's actual execution on GitHub's runners has not been verified, since that requires pushing a branch and opening a real PR, which wasn't done autonomously. Open a test PR against a `.tf` file to see it run for real the first time.

## Budget alert webhooks

A budget threshold crossing (`terraform.budget.json`) can post to a Slack or Microsoft Teams incoming webhook, not just show the in-editor popup — useful for a team channel that doesn't have everyone in VS Code watching for it.

**Setup:**
1. Create an incoming webhook URL in Slack ([api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)) or Teams (recommended: a **Workflows** "When a Teams webhook request is received" flow; classic channel Incoming Webhooks also work), then run `Terraform Cost: Set Budget Alert Webhook (Slack/Teams)` and paste it in. Stored via `SecretStorage`, same as the AI provider keys — never in `settings.json`. This also sets `terraformCost.notifications.provider` to match.
2. Click **Send Test Alert** on the confirmation (or run `Terraform Cost: Send Test Budget Alert` any time) to confirm a sample message arrives.
3. From then on, whenever a threshold in `terraform.budget.json` is crossed, both the existing popup *and* the webhook fire together.

**Design notes:**
- **Same trigger point as the existing popup, not a parallel schedule.** `checkBudgetAndWarn()` already tracks "have we notified for this level yet" per file to avoid spamming a popup on every keystroke; the webhook fires from that exact same `level > prev` check, so there's one source of truth for "did we already alert on this," not two mechanisms that could drift out of sync.
- **Teams messages are Adaptive Cards** (a `message` with an `application/vnd.microsoft.card.adaptive` attachment). Teams Workflows webhooks require this format, and classic Incoming Webhooks accept it too. The legacy `MessageCard` format is no longer used.
- **Whole-workspace alerts too**: refreshing the dashboard's workspace scope evaluates the workspace total against the root `terraform.budget.json` and alerts on a crossing into a higher level, with the same anti-spam gate tracked separately from per-file alerts.
- **Tested against a stubbed `fetch`, not a real channel** (`test/suite/managers.test.js`). The tests cover both payload shapes, an HTTP error, and a missing URL.

## Cost history

The 12-month forecast chart is a projection ("if usage stays flat vs. grows ~5%/month"), never real data. This is the actual-data counterpart: `Terraform Cost: Record Cost Snapshot` (or the **Record snapshot** button in the dashboard's new Cost History card) appends `{ timestamp, scope, label, totalMonthly, resourceCount }` to `terraform-cost-history.json`, and once there are 2+ recorded snapshots, the dashboard renders them as a real trend line — hover for the exact date/cost/resource-count at any point.

**Design notes:**
- **Explicitly user-triggered, never automatic** — same boundary as AI suggestions and export. There's no background scheduler recording a snapshot on every save; you decide when a data point is worth capturing (e.g. before/after a change, or periodically).
- Follows whichever scope the dashboard currently shows (file/workspace/plan) — same `resolveAiAnalysisTarget()` used by AI suggestions supplies the current total, so there's one shared notion of "what am I looking at right now" across all three features, not three separate ones.
- Capped at 200 entries per project (oldest dropped first) to avoid unbounded file growth.
- `terraform-cost-history.json` is plain JSON at the workspace root (or the active file's/plan's own directory if no workspace is open) — commit it to track cost over time alongside the infrastructure changes that caused it, or gitignore it if you'd rather keep it purely local; the extension doesn't take a position on that for you.
- **Verified via `src/cost-history-manager.js`'s own standalone tests** (append/reload round-trips correctly; the 200-entry cap prunes oldest-first and keeps the newest) and an Excel round-trip test for the new Cost History sheet — not just syntax-checked.

## Actual cloud spend

`Terraform Cost: Compare Estimate with Actual Cloud Spend` asks which providers to query, then opens a Markdown report showing:

- the Terraform estimate per provider (a whole-workspace scan),
- **last full month's actual spend**,
- **month-to-date spend**, plus a straight-line projection for the full month and its difference from the estimate,
- the top 10 services by actual spend for each provider.

It runs each provider's own CLI under your existing login, and the extension stores no cloud credentials:

| Provider | How | Setup |
|---|---|---|
| AWS | `aws ce get-cost-and-usage` (Cost Explorer) | `aws configure` / SSO; optional `terraformCost.billing.awsProfile`. **AWS bills $0.01 per request; each run makes 2.** |
| Azure | Cost Management Query API via `az rest` | `az login`; optional `terraformCost.billing.azureSubscriptionId` |
| GCP | `bq query` against your [Cloud Billing BigQuery export](https://cloud.google.com/billing/docs/how-to/export-data-bigquery) | `gcloud auth login`; set `terraformCost.billing.gcpBillingExportTable` (you're prompted the first time) |

Actual spend covers **everything billed to that account, subscription or billing export**, including resources that this Terraform doesn't manage, so read big gaps with that in mind. If one provider fails (for example, not logged in), its error is shown in the report and the other providers' results still appear.

**Verification**: `src/billing-integration.js` has no `vscode` dependency and takes an injectable command runner. `test/suite/billing-integration.test.js` covers response parsing for all three providers, billing-period math (including year boundaries), BigQuery table-name validation, temp-file cleanup and the report output. It has **not** been run against a live billing account yet.

## Development

| Task | Command |
|---|---|
| Build `dist/extension.js` (dev) | `npm run compile` (or `npm run watch`) |
| Lint | `npm run lint` |
| Run tests (compiles + lints first; downloads a VS Code test instance on first run) | `npm test` |
| Build a `.vsix` | `npm run vsix` |
| Run the extension interactively | Press F5 (runs `npm: compile` first). See [RUNNING.md](RUNNING.md) |

The extension's entry point is `extension.js`, but VS Code loads the webpack bundle `dist/extension.js` (`"main"` in `package.json`). Re-run `npm run compile` (F5 does this for you) after changing code.

## Publishing

1. Create a publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and make sure its ID matches `"publisher"` in `package.json` (currently `snakeyeye497`).
2. Create an Azure DevOps Personal Access Token with the **Marketplace → Manage** scope.
3. `npx vsce login <publisher-id>`, then `npx vsce publish` (this runs the production webpack build via `vscode:prepublish`).

## License

Apache-2.0. See [LICENSE](LICENSE).

## Acknowledgments

- [Infracost](https://www.infracost.io) — accurate cloud cost data
- The VS Code extension API team

---

**Made for DevOps engineers who care about cloud costs.**
