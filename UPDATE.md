# Update: Visual Cost Dashboard

This document is for whoever pulls this branch next (hi 👋) — it explains **what
was added, where the code lives, and exact steps to test every command** in the
extension, old and new. Read [README.md](README.md) for the project overview and
[RUNNING.md](RUNNING.md) for the general "how to launch this" walkthrough — this
file is the changelog + test script for this specific update.

---

## 1. What's new, in one paragraph

The extension already estimated Terraform costs inline as you type. This update
adds a **visual Cost Dashboard** — a `Terraform Cost: Show Cost Dashboard` command
that opens a panel with a cost-breakdown donut chart, a cost-by-provider bar
chart, a 12-month cost forecast chart, and a budget meter — so the numbers are
easy to present/screenshot instead of only living as inline annotations. It's
built from scratch with plain HTML/CSS/SVG/JS (no chart library, no network
calls, works fully offline), and it live-updates as you edit, save, or switch
between Terraform files.

## 2. Where the code lives

| File | Status | What changed |
|---|---|---|
| [src/cost-dashboard.js](src/cost-dashboard.js) | **New** | The whole dashboard: `CostDashboardPanel` class (manages the `vscode.WebviewPanel`) + the HTML/CSS/JS the panel renders (three charts + budget meter, all hand-rolled SVG/vanilla JS). |
| [extension.js](extension.js) | Modified | Registers the `terraformCost.showCostDashboard` command; adds `buildDashboardAggregate()` (turns already-computed resource costs into chart-ready data: totals, cost-by-provider, cost-by-type, 12-month forecast, budget status) and `updateDashboard()` / `refreshDashboard()` which push that data into the panel whenever costs get recalculated (i.e. it rides the same edit/save/switch-editor events the inline decorations already use — no new listeners). |
| [package.json](package.json) | Modified | Adds the `terraformCost.showCostDashboard` command + a graph icon (`$(graph)`) in the editor title bar for `.tf` files. |
| [example.tf](example.tf) | Modified | Added a couple of GCP and Azure resources so the provider bar chart has more than one bar to show out of the box. |
| [README.md](README.md) / [RUNNING.md](RUNNING.md) / [CHANGELOG.md](CHANGELOG.md) | Modified | Documented the new command/feature. |

Nothing about the existing pipeline (`src/terraform-parser.js`, `src/cost-calculator.js`,
`src/cost-decorator.js`, `src/status-bar-manager.js`, `src/budget-manager.js`) was
changed — the dashboard is a pure consumer of the same cost data those already produce.

## 3. What the dashboard actually shows

Open it via **Command Palette → `Terraform Cost: Show Cost Dashboard`**, or the
graph icon at the top-right of a `.tf` file's editor tab bar.

- **Hero number** — total monthly cost (animated count-up), with yearly/hourly/
  resource-count/provider-count stat tiles underneath.
- **Budget meter** — only appears if a `terraform.budget.json` applies to the
  file; shows spend vs. your configured limits, color-coded.
- **Donut chart** — "Cost breakdown by resource type," top 5 types + an "Other"
  bucket for the rest, with a legend and a **"View as table"** toggle (accessible
  table view of the same data).
- **Bar chart** — "Cost by cloud provider" (AWS / GCP / Azure), also with a table
  toggle.
- **Forecast chart** — 12 months of cumulative cost, two lines: "if usage stays
  flat" vs. an illustrative "if usage grows ~5%/month" scenario. Hover it for a
  crosshair + tooltip with exact numbers per month.

It refreshes itself automatically (no manual action needed) whenever you edit/
save the tracked file, or make a different `.tf` file the active editor. There's
also a manual **Refresh** button in the panel's top-right corner.

## 4. Getting it running from scratch

```bash
git clone <this-repo-url>
cd terraformCost
git checkout fix/windows-dev-setup-and-docs   # or whatever branch this landed on
npm install
```

Open the folder in VS Code, then **press F5** (or Run and Debug → "Run
Extension"). A second **[Extension Development Host]** window opens with the
extension loaded — do all testing in *that* window.

## 5. Full command reference — test steps for every command

Open the Command Palette in the Dev Host window (`Ctrl+Shift+P` / `Cmd+Shift+P`)
and type "Terraform Cost" to find these. Test them in this order against
[example.tf](example.tf) (**File → Open File → example.tf**).

### 5.1 `Terraform Cost: Calculate Costs`
1. Open `example.tf`, make sure it's the active editor.
2. Run the command.
3. **Expect:** an info toast "Terraform costs calculated!" and inline `💰 ...`
   costs next to each resource (they normally appear automatically too — this
   just forces an immediate recalculation).

### 5.2 `Terraform Cost: Toggle Cost Display`
1. Run the command once.
2. **Expect:** all inline `💰 ...` annotations disappear; toast "Cost display disabled".
3. Run it again.
4. **Expect:** annotations come back; toast "Cost display enabled".

### 5.3 `Terraform Cost: Toggle Total Cost Header`
1. Run the command once.
2. **Expect:** the `💰 TOTAL INFRASTRUCTURE COST: ...` line at the top of the
   file disappears.
3. Run it again — it comes back.

### 5.4 `Terraform Cost: Refresh Cost Estimates`
1. Run the command.
2. **Expect:** toast "Refreshing costs..." then "Cost estimates refreshed!" —
   clears the internal cost cache and recalculates every open `.tf` file. Use
   this after changing settings like currency/region.

### 5.5 `Terraform Cost: Show Cost Dashboard` ⬅ new, the main thing to check
1. With `example.tf` active, run the command (or click the graph icon,
   top-right of the editor tab bar).
2. **Expect:** a new panel opens beside your file, titled "📊 Terraform Cost
   Dashboard", and within ~1 second fills in:
   - Hero total monthly cost (counts up from 0)
   - Stat tiles: yearly, hourly, resource count, provider count
   - Donut chart with a legend (multiple resource types, colored slices)
   - Bar chart with three rows: AWS, Google Cloud, Microsoft Azure
   - Forecast chart with two colored lines, gridlines, and $ axis labels
3. **Table toggle:** click "View as table" under the donut chart → it swaps to
   a plain table; click it again ("View as chart") → swaps back. Same for the
   provider bar chart.
4. **Hover tooltip:** move your mouse across the forecast chart → a vertical
   crosshair line should follow it, and a small tooltip near the cursor should
   show that month's flat vs. growth numbers.
5. **Manual refresh:** click the **Refresh** button (top-right of the panel) →
   nothing visually changes (data's already current) but no errors either.
6. **Live-update test:** without closing the dashboard, edit `example.tf` —
   e.g. change `instance_type = "t3.medium"` to `"m5.xlarge"` — and save.
   **Expect:** the dashboard's numbers update on their own within a couple
   seconds (no need to re-run the command).
7. **Switch-file test:** open or create a different `.tf` file with at least
   one resource and make it the active editor. **Expect:** the dashboard
   switches to show that file's numbers. Click back into your original
   `.tf` tab — it switches back.
8. **Empty state:** open a `.tf` file with no resources (or a non-Terraform
   file) and make it active, then click Refresh in the dashboard.
   **Expect:** the dashboard shows "No cost data yet" rather than erroring.

### 5.6 `Terraform Cost: Clear Error Log` / `Terraform Cost: Export Error Log`
These exist in code (`src/error-handler.js`) but aren't in `package.json`'s
`contributes.commands`, so they only show up in the palette under their raw id
(`terraformCost.clearErrorLog`, `terraformCost.exportErrorLog`) rather than a
friendly title — pre-existing, not part of this update. Still functional:
run `terraformCost.exportErrorLog` and it'll prompt you to save an error log
file; `terraformCost.clearErrorLog` clears it with a confirmation toast.

## 6. Budget feature (also drives the dashboard's budget meter)

1. In the same folder as `example.tf`, create `terraform.budget.json`:
   ```json
   { "limit_1": 20, "final_limit": 80 }
   ```
2. **Expect (inline):** the total-cost header turns yellow once cost crosses
   $20/mo, red past $80/mo, with a warning/error popup the first time each
   threshold is crossed.
3. **Expect (dashboard):** reopen or refresh the dashboard — a **budget meter**
   card appears above the charts, its fill bar colored by how close you are
   (green → yellow → orange → red) and labeled with current spend vs. limit.
4. Delete `terraform.budget.json` — both the header color and the dashboard's
   budget card should go back to normal/disappear.

## 7. Settings worth trying (`Ctrl+,` → search "Terraform Cost")

| Setting | Try | Expect |
|---|---|---|
| `terraformCost.currency` | Set to `EUR` | Inline costs and the dashboard both switch to `€` after a refresh |
| `terraformCost.expensiveThreshold` | Set to `10` | More resources highlighted orange/red inline |
| `terraformCost.showTotalCostHeader` | Toggle | Same effect as the toggle command above |
| `terraformCost.updateInterval` | Set to `500` | Inline costs (and the dashboard, since it rides the same recalculation) update faster while typing |

## 8. Notes / known limitations

- The dashboard's forecast is **illustrative**, not a real prediction — it just
  projects the current monthly total flat vs. compounding at a fixed ~5%/month,
  clearly labeled as such in the panel's footnote.
- No external network calls or bundled chart library — everything renders from
  inline SVG/CSS/JS, so it works with no internet access (Infracost, if
  configured, is still used for the underlying cost numbers same as before).
- If the dashboard panel ever looks stuck/blank after a code change, run
  **Developer: Reload Window** in the Dev Host window — same as any other
  extension change.

## 9. If something looks wrong

- Nothing appears in a chart card → open the Dev Host's **Help → Toggle
  Developer Tools → Console** and look for an error; webview JS errors show up
  there (this is how a broken-markup bug in the forecast card was caught and
  fixed during development of this feature).
- Dashboard says "No cost data yet" but your file has resources → make sure the
  file's language mode is "Terraform" (bottom-right of the status bar) and that
  `terraformCost.enabled` is `true`.
