# Cost history

[← Docs index](../README.md)

The 12-month forecast chart is a projection ("if usage stays flat vs. grows ~5%/month"), never real data. This is the actual-data counterpart: `Terraform Cost: Record Cost Snapshot` (or the **Record snapshot** button in the dashboard's new Cost History card) appends `{ timestamp, scope, label, totalMonthly, resourceCount }` to `terraform-cost-history.json`, and once there are 2+ recorded snapshots, the dashboard renders them as a real trend line — hover for the exact date/cost/resource-count at any point.

**Design notes:**
- **Explicitly user-triggered, never automatic** — same boundary as AI suggestions and export. There's no background scheduler recording a snapshot on every save; you decide when a data point is worth capturing (e.g. before/after a change, or periodically).
- Follows whichever scope the dashboard currently shows (file/workspace/plan) — same `resolveAiAnalysisTarget()` used by AI suggestions supplies the current total, so there's one shared notion of "what am I looking at right now" across all three features, not three separate ones.
- Capped at 200 entries per project (oldest dropped first) to avoid unbounded file growth.
- `terraform-cost-history.json` is plain JSON at the workspace root (or the active file's/plan's own directory if no workspace is open) — commit it to track cost over time alongside the infrastructure changes that caused it, or gitignore it if you'd rather keep it purely local; the extension doesn't take a position on that for you.
- **Verified via `src/config/cost-history-manager.js`'s own standalone tests** (append/reload round-trips correctly; the 200-entry cap prunes oldest-first and keeps the newest) and an Excel round-trip test for the new Cost History sheet — not just syntax-checked.
