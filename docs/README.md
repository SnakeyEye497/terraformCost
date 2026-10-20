# Matali documentation

[← Project README](../README.md)

## Start here

- [Getting started](getting-started.md): install the extension or run it from source, plus a 5-minute tour
- [Feature walkthrough](walkthrough.md): try each feature step by step
- [Troubleshooting](troubleshooting.md)

## Reference

- [Commands](commands.md): every Command Palette command
- [Configuration](configuration.md): settings, `terraform.budget.json` and the other project files
- [Pricing and supported resources](pricing.md): where numbers come from, what's covered, and the usage assumptions
- [Known limitations](known-limitations.md)

## Features

| Feature | What it does |
|---|---|
| [Cost dashboard](features/dashboard.md) | Charts for the active file, the whole workspace, or a loaded plan |
| [Module resolution](features/module-resolution.md) | Follows local and remote modules, including `count`/`for_each` on modules |
| [Plan-based costing](features/plan-costing.md) | Costs a real `terraform show -json` plan |
| [AI cost & scaling suggestions](features/ai-suggestions.md) | Optimization and right-sizing ideas from Gemini, Claude, OpenAI, DeepSeek or Groq |
| [Budget alerts](features/budget-alerts.md) | Popups plus Slack/Teams webhooks when budget thresholds are crossed |
| [Cost history](features/cost-history.md) | Recorded snapshots shown as a trend chart |
| [Actual cloud spend](features/actual-spend.md) | Compares the estimate with AWS / Azure / GCP billing data |
| [Excel export](features/excel-export.md) | Multi-sheet `.xlsx` cost report |
| [CI: PR cost-diff comments](features/ci-pr-comments.md) | GitHub Action that comments each PR's cost change |

## Contributing

- [Architecture](architecture.md): source layout, data flow and design rules
- [Development](development.md): building, testing, CI and publishing
- [Changelog](../CHANGELOG.md)
- [Archive](archive/): historical design notes, kept for reference
