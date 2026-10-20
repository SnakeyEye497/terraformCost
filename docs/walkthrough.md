# Feature walkthrough

[← Docs index](../README.md)

Hands-on steps for each feature, run in the Extension Development Host (see [Getting started](getting-started.md)).

## Commands to try

Open the Command Palette in the Dev Host window (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search **"Terraform Cost"**:

| Command | What you'll see |
|---|---|
| **Terraform Cost: Calculate Costs** | Forces an immediate recalculation of the active file; shows an info toast "Terraform costs calculated!" |
| **Terraform Cost: Refresh Cost Estimates** | Clears the cost cache first, then recalculates everything open — use this after changing settings like currency or region |
| **Terraform Cost: Toggle Cost Display** | Hides/shows the inline `💰 ...` decorations next to resources |
| **Terraform Cost: Toggle Total Cost Header** | Hides/shows the summary line at the top of the file |
| **Terraform Cost: Show Cost Dashboard** | Opens a webview with a cost-breakdown donut chart, a per-provider bar chart, and a 12-month forecast chart (plus a budget meter if `terraform.budget.json` applies) — see below |
| **Terraform Cost: Show Workspace Cost Dashboard** | Same dashboard, opened straight into "Whole workspace" scope — see below |
| **Terraform Cost: Get AI Cost Optimization Suggestions** | Asks your configured AI provider for suggestions on the active file, shown in the dashboard — see below |
| **Terraform Cost: Set AI Provider API Key** | Pick Gemini/Claude/GPT and securely save its API key |
| **Terraform Cost: Set Capacity & Scaling Inputs** | Short wizard for expected users/requests/growth, saved to `terraform.capacity.json` |
| **Terraform Cost: Get Scaling Suggestions** | Asks your AI provider whether the active file's resources are right-sized for that expected load — see below |
| **Terraform Cost: Export Cost Report (Excel)** | Prompts for scope, then saves a multi-sheet `.xlsx` via a native Save As dialog — see below |
| **Terraform Cost: Set Budget Alert Webhook (Slack/Teams)** | Save an incoming webhook URL for budget-threshold alerts — see below |
| **Terraform Cost: Clear Budget Alert Webhook** | Remove the saved webhook |
| **Terraform Cost: Calculate Costs from Terraform Plan** | Pick a real `terraform show -json` plan and cost exactly what it'll create — see below |
| **Terraform Cost: Record Cost Snapshot** | Appends the current scope's total to a real cost-history trend chart — see below |

The full list is in [Commands](commands.md).

### Trying the cost dashboard

1. With [`examples/example.tf`](../examples/example.tf) open and active, run **Terraform Cost: Show Cost Dashboard** (or click the graph icon at the top-right of the editor).
2. It opens beside your file and fills in: total monthly/yearly/hourly cost, a donut of cost-by-resource-type, a bar chart of cost-by-provider (AWS/GCP/Azure — `example.tf` has all three), and a 12-month forecast chart. Hover the forecast chart for a tooltip; click "View as table" under a chart for an accessible table view.
3. Edit/save `example.tf` (e.g. bump `instance_type` to `m5.xlarge`) — the dashboard updates itself, no need to re-run the command.

You can also change settings live and watch it react: `Ctrl+,` → search "Terraform Cost" → try changing `terraformCost.currency` to `EUR` or `terraformCost.expensiveThreshold` to `10`, and switch back to your `.tf` file — it updates automatically.

### Trying the workspace-wide dashboard

1. In the Dev Host window, make sure a folder (not just a loose file) is open — File → Open Folder → [test/fixtures/complex-project](../test/fixtures/complex-project) is the one built for exactly this (11 files, ~26 resources across AWS/GCP/Azure, real non-zero costs verified against the actual calculator — see its own [README](../test/fixtures/complex-project/README.md) for the full breakdown and what to expect). Any real multi-file Terraform project works too.
2. Click the **Whole workspace** button at the top of the dashboard (or run **Terraform Cost: Show Workspace Cost Dashboard** directly). It scans every `.tf` file, so it takes a moment on a large project — the header shows "Scanning workspace…" while that happens.
3. Everything updates to span all files: the hero total, donut, provider bars, forecast — plus a new **Cost by file/module** bar chart that isn't there in file scope, showing which file is actually driving the bill.
4. Edit and save any `.tf` file in the project — the workspace view refreshes automatically (on save only, not on every keystroke, since re-scanning the whole project on every keystroke would be wasteful).
5. Switch back to **This file** any time to return to the single-file view.

Note: the AI suggestions and scaling cards follow the dashboard's **current scope** — switch to "Whole workspace" first, then ask, and it reasons over every resource across the project (tagging each suggestion with its source file), not just the active file.

### Trying AI cost optimization suggestions

1. Run **Terraform Cost: Set AI Provider API Key**, pick a provider, and paste in a key. This is stored securely, not in `settings.json`.
   - Cheapest to start with: **[Groq](https://console.groq.com/)** — genuinely free tier, no card required.
   - Also cheap: **[DeepSeek](https://platform.deepseek.com/)** — pay-as-you-go, fractions of a cent per request, no minimum spend.
   - Gemini/Claude/GPT also work — for Gemini specifically, use a plain key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) rather than one provisioned through Cloud/Vertex billing, which may demand a prepay balance before it'll generate anything.
2. With `example.tf` open, run **Terraform Cost: Get AI Cost Optimization Suggestions** (or open the dashboard and click "✨ Ask AI for suggestions").
3. The dashboard opens/updates with a spinner, then a list of suggestion cards — each names a resource, a category (rightsizing/reserved capacity/storage/architecture), the suggestion itself, and an estimated monthly saving when the model gives one.
4. Try it again after editing a resource (e.g. bumping an instance to something oversized) to see the suggestions change.

### Trying capacity & scaling suggestions

Uses the same AI provider/key you just set up above — no separate setup needed.

1. Run **Terraform Cost: Set Capacity & Scaling Inputs** (or click **Set capacity inputs** in the new "📈 Capacity & scaling suggestions" card). It asks four questions one at a time — expected daily users, requests/day, peak requests/second, growth %/month — press Enter to accept, leave blank + Enter to skip any of them, or Escape to cancel the whole thing.
   - [test/fixtures/complex-project](../test/fixtures/complex-project) already ships a `terraform.capacity.json` — you can skip this step and go straight to step 2 there. It's currently tuned quite small (a few hundred users, low four-figure requests/day), which makes nearly every beefy instance in the fixture a plausible scale-down candidate, not just the 3 deliberately-oversized ones — a sharper test than a load that only catches the intentional bait. Feel free to hand-edit it to whatever load tells the story you want (see "Editing the config files directly" below). Against plain `example.tf`, try something that'll produce an obvious mismatch, e.g. requests/day in the millions (should suggest scaling up) or a tiny number like 50 (should suggest scaling down something).
2. Run **Terraform Cost: Get Scaling Suggestions** (or click **Get scaling suggestions** in the card).
3. You'll see suggestion cards with a **Scale up** / **Scale down** / **Keep as-is** badge per resource, a suggested change (e.g. `t3.medium -> t3.large`), and the model's reasoning referencing the actual numbers you gave it.
4. The card also shows a compact summary of your saved inputs (e.g. "5,000 users · 200,000 req/day · +10%/mo growth") any time the dashboard is open, without needing to click anything.
5. Re-run **Set Capacity & Scaling Inputs** any time to change the numbers — it pre-fills your previous answers.

### Trying workspace-wide AI suggestions

The AI cost/scaling cards follow whatever scope the dashboard is currently in — no separate toggle.

1. In [test/fixtures/complex-project](../test/fixtures/complex-project)'s dashboard, click **Whole workspace**, then **Ask AI for suggestions**.
2. It reasons over all ~26 resources across the project at once (capped at 150 highest-cost resources for a much larger project) — notice each suggestion card now shows a `📄 modules/compute/main.tf`-style file tag so you know exactly where to go make the change, looked up from the actual resource list rather than trusted from the model's own response.
3. Click **This file** to switch back — ask again, and it's back to just the active file's resources.

### Trying the Excel export

1. In [test/fixtures/complex-project](../test/fixtures/complex-project), run **Terraform Cost: Get AI Cost Optimization Suggestions** and **Get Scaling Suggestions** first (optional, but their results get included in the report if you have them — see steps 6–7 of the 5-minute tour above).
2. Run **Terraform Cost: Export Cost Report (Excel)** (or click **Export** in the dashboard's topbar). Choose **Whole workspace** when prompted.
3. A Save As dialog opens with a default filename like `complex-project-cost-report-2026-09-14.xlsx`. Save it anywhere.
4. Click **Reveal in Folder** on the confirmation toast, then open the file in Excel (or LibreOffice Calc, Google Sheets, etc.). You should see 10 sheets: Summary, Resources (~26 rows, sorted by cost), By Provider, By Resource Type, By File-Module, 12-Month Forecast, Budget, Capacity Inputs, and — if you did step 1 — AI Cost Suggestions and AI Scaling Suggestions (now with a Source File column too).
5. Try it again with **This file** scope on a single module file (e.g. `modules/compute/main.tf`) — notice the Resources sheet drops the Source File column and there's no By File-Module sheet, since those only make sense workspace-wide.

### Trying budget alert webhooks

1. Get a webhook URL. Step-by-step instructions for Slack and Teams are in [Budget alerts](features/budget-alerts.md#setting-up-a-webhook).
2. Run **Terraform Cost: Set Budget Alert Webhook (Slack/Teams)**, pick the platform, paste the URL, then click **Send Test Alert** to confirm a sample message arrives.
3. To see a real alert, go to [test/fixtures/complex-project](../test/fixtures/complex-project), edit `terraform.budget.json` to lower a limit below the current ~$1,330/mo total (or bump a resource's size up), then save the `.tf` file — the existing popup should appear, and your Slack/Teams channel should get a matching message within a second or two.
4. Run **Terraform Cost: Clear Budget Alert Webhook** to turn it back off.

### Trying terraform plan-based costing

Static parsing can't resolve everything real Terraform can (`count`/`for_each` expressions, module outputs, provider defaults) — a real `terraform plan` already has all of that evaluated. This feature costs the *actual* plan instead of guessing.

1. If you have the `terraform` CLI installed, cost any real project's plan directly:
   ```bash
   cd path/to/some/terraform/project
   terraform init
   terraform plan -out=plan.tfplan
   terraform show -json plan.tfplan > plan.json
   ```
2. Back in the Dev Host window, run **Terraform Cost: Calculate Costs from Terraform Plan** and pick that `plan.json` (or the binary `plan.tfplan` — Matali will try to run `terraform show -json` on it for you if the `terraform` CLI is on your `PATH`).
3. The dashboard opens straight into "plan" scope: same hero total/donut/provider charts as file or workspace scope, but the subtitle reads **📋 Terraform plan: plan.json** and every resource is tagged with its module address instead of a file path.
4. No real project handy? [test/fixtures/sample-plan](../test/fixtures/sample-plan) ships a genuine plan (`plan.json`, produced from its own `main.tf` via the real steps above, no cloud credentials needed) — pick that and you should land on **$98.16/mo** across 4 resources.
5. Don't have the `terraform` CLI at all? You can still pick `plan.json` files directly (skip steps 1–2) — only the binary-`.tfplan`-to-JSON conversion in step 2 needs the CLI.

### Trying cost history tracking

1. Open the dashboard in any scope (file, workspace, or a loaded plan) and look for the **Cost History** card near the bottom.
2. Click **Record snapshot** (or run **Terraform Cost: Record Cost Snapshot**) — it appends today's total for the current scope to `terraform-cost-history.json` next to your project. The first snapshot alone just shows "record another to see a trend."
3. Change something that affects cost (bump an instance size, add a resource) and save, then record a second snapshot. The card now renders a real line chart with actual dates on the X-axis — hover any point for an exact date/cost/label tooltip.
4. History is scoped the same way everything else is: recording from "Whole workspace" tracks the whole project's trend; recording from a single file or a loaded plan tracks just that. Switch scope in the dashboard to see each one's independent history.
5. `terraform-cost-history.json` is plain JSON, capped at the 200 most recent snapshots per scope — safe to delete if you want to start a trend over.

### Trying the budget feature

[test/fixtures/complex-project](../test/fixtures/complex-project) already ships a `terraform.budget.json` tuned so its ~$1,330/mo total sits at "yellow, near limit" ($1,100 `limit_3`) by default — open it and its workspace dashboard should already show that state, no setup needed. Bump any instance size up to push it past the $1,500 `final_limit` and watch it turn red.

To try it from scratch on your own `.tf` file instead: add a `terraform.budget.json` next to it:
```json
{ "limit_1": 20, "final_limit": 50 }
```
Then edit your `.tf` file so the total crosses those numbers — the header should turn yellow, then red, and you'll get a popup + a diagnostic (red squiggle context) the first time each threshold is crossed.

### Editing the config files directly

`terraform.budget.json` and `terraform.capacity.json` are both just plain JSON — the **Set Capacity & Scaling Inputs** wizard and manually writing/editing the budget file are two paths to the exact same thing, not different features. If you already know the field names, editing the file directly and saving is faster than the wizard; the dashboard picks either up the same way (on save). This is exactly what tuning the fixture's `terraform.capacity.json` down to a smaller load (as it currently is) looks like — hand-edit, save, re-ask for suggestions.

### Resetting to a clean state

- **Remove a saved AI key**: `Terraform Cost: Clear AI Provider API Key`.
- **Stop using budget/capacity inputs for a project**: delete `terraform.budget.json` / `terraform.capacity.json` — the extension only looks for them, it doesn't require them.
- **Force a full recalculation** (e.g. after changing `terraformCost.region` or suspecting stale cached costs): `Terraform Cost: Refresh Cost Estimates`.
- **Reset the workspace dashboard back to file scope**: click **This file** in its scope toggle, or just close and reopen the panel.
