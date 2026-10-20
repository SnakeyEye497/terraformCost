# Exporting a cost report

[← Docs index](../README.md)

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
- **Cost History** — only if you've recorded at least one snapshot (see [Cost history](cost-history.md))
- **AI Cost Suggestions**, **AI Scaling Suggestions** — only if you've actually run either this session; the export never triggers a fresh AI call itself, it just includes the last successful result if there is one

**Design notes:**
- Built with [`exceljs`](https://www.npmjs.com/package/exceljs) (`src/export/excel-exporter.js`) — the one runtime dependency this project has beyond `debounce`. Adding a real `.xlsx` writer isn't something worth hand-rolling; a plain CSV would satisfy "opens in Excel" but not really what "export an Excel report" means for something meant to be shared with stakeholders.
- `src/export/excel-exporter.js` has zero knowledge of `vscode`, the parser, or the calculator — it's handed a plain data object and lays out whatever's in it. Verified end-to-end (built a workbook, wrote it, reopened it with `exceljs`'s own reader, checked every sheet round-tripped correctly) before wiring it into the command.
- By-provider/by-type sheets are computed fresh from the full resource list at export time, not reused from the dashboard's aggregates — the dashboard intentionally truncates "by type" to top-5-plus-Other for chart legibility, but a report shouldn't silently drop data.
