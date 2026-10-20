# Cost dashboard

[← Docs index](../README.md)

`Terraform Cost: Show Cost Dashboard` (or the graph icon in a `.tf` file's editor toolbar) opens a webview panel with a **This file / Whole workspace** toggle at the top, and:

- A **hero total** (monthly/yearly/hourly cost, resource + provider counts — plus a files-scanned count in workspace scope), animated on every update.
- A **donut chart** — cost broken down by resource type (top 5 + "Other"), with a legend and a "View as table" toggle.
- A **bar chart** — cost by cloud provider (AWS / GCP / Azure).
- **Workspace scope only**: a **cost-by-file/module** bar chart — which file in a multi-file project is actually driving the bill.
- A **12-month forecast** — cumulative spend if usage stays flat vs. an illustrative ~5%/month growth scenario, with a hover crosshair/tooltip.
- A **budget meter** (only shown when a `terraform.budget.json` applies) showing spend against your configured limits.

**File scope** reuses the same cost calculation the inline decorations use, and re-renders automatically whenever you edit/save the tracked file or switch to another Terraform file (see `buildDashboardAggregate` / `updateDashboard` in [extension.js](../../src/extension.js)).

**Workspace scope** is powered by `src/core/workspace-scanner.js`, which finds every `.tf` file in the workspace (excluding `.terraform/`, `node_modules/`, `.git/`), resolves resources the way real Terraform would — following `module` calls (see [Module-graph resolution](module-resolution.md)) — and tags each with its source file. Because scanning every file is more expensive than recalculating one, workspace scope only refreshes on file save, on switching into that scope, or the panel's manual **Refresh** button — not on every keystroke the way file scope does.

Both scopes share the same rendering code (`src/ui/cost-dashboard.js`, a `vscode.WebviewPanel`, vanilla HTML/CSS/SVG/JS — no chart library, no network calls); only the data feeding it differs.
