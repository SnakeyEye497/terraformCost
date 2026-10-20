# Architecture

[← Docs index](README.md)

Matali is a plain-JavaScript VS Code extension (no TypeScript). The sources live in `src/`, and webpack bundles them, together with the runtime dependencies `debounce` and `exceljs`, into `dist/extension.js`. That bundle is what VS Code loads.

## Source layout

```
src/
├── extension.js              Entry point: activation, commands, events, wiring everything below
├── core/                     Parsing, resolution and pricing (no UI)
│   ├── terraform-parser.js   HCL text -> resources, variables, modules
│   ├── module-resolver.js    Follows module calls (local, remote via modules.json, count/for_each)
│   ├── workspace-scanner.js  Finds every .tf file in the workspace and runs the resolver
│   ├── plan-parser.js        `terraform show -json` plan -> the same resource shape
│   └── cost-calculator.js    Monthly/yearly/hourly cost per resource (Infracost first, built-in prices as fallback)
├── integrations/             Everything that talks to an external tool or API
│   ├── infracost-integration.js   Infracost CLI
│   ├── ai-advisor.js              Gemini / Claude / OpenAI / DeepSeek / Groq
│   ├── notification-manager.js    Slack / Teams webhooks
│   └── billing-integration.js     AWS Cost Explorer / Azure Cost Management / GCP BigQuery billing export
├── config/                   Optional per-project JSON files
│   ├── budget-manager.js          terraform.budget.json
│   ├── capacity-manager.js        terraform.capacity.json
│   └── cost-history-manager.js    terraform-cost-history.json
├── ui/                       What the user sees
│   ├── cost-decorator.js          Inline costs + total-cost header
│   ├── status-bar-manager.js      Status bar total
│   └── cost-dashboard.js          Webview dashboard (hand-rolled SVG charts, no chart library)
├── export/
│   └── excel-exporter.js          Multi-sheet .xlsx report
└── utils/
    └── error-handler.js           Central error logging (Export/Clear Error Log commands)
```

## Data flow

```
 .tf text (active file)            every .tf in the workspace          terraform show -json
        │                                   │                                 │
        ▼                                   ▼                                 ▼
 core/terraform-parser ──────► core/workspace-scanner ──► core/module-resolver    core/plan-parser
        │                                   │                                 │
        └──────────────┬────────────────────┴─────────────────────────────────┘
                       ▼
             core/cost-calculator  ◄── integrations/infracost-integration (when available)
                       │
      ┌────────────────┼──────────────────────┬──────────────────────┐
      ▼                ▼                      ▼                      ▼
 ui/cost-decorator  ui/status-bar   ui/cost-dashboard        export/excel-exporter
                       │
              config/budget-manager ──► integrations/notification-manager (Slack/Teams)
```

The AI advisor, capacity manager, cost history and billing integration all work from the same costed resource list the dashboard shows. Whatever scope the dashboard is in (file, workspace or plan) is what they analyze.

## Design rules

- **One pricing engine.** The inline costs, the dashboard, plan costing, the Excel export and the CI script (`scripts/ci-cost-report.js`) all call the same `core/cost-calculator.js`. There is no second implementation to drift out of sync.
- **Plain-Node testable core.** `core/module-resolver.js`, `integrations/billing-integration.js`, `integrations/notification-manager.js`, `core/plan-parser.js` and `export/excel-exporter.js` don't import `vscode`, so they are unit-tested directly. External calls (`fetch`, CLIs) are injectable or stubbed in tests.
- **Nothing costly happens automatically.** AI calls, billing API calls, exports and history snapshots run only when the user triggers them.
- **Secrets never go in settings.** AI keys and webhook URLs are stored in VS Code `SecretStorage`. Cloud billing uses each provider's existing CLI login.

## Other top-level folders

| Folder | Contents |
|---|---|
| `scripts/` | `ci-cost-report.js`, the headless cost report used by the GitHub Action |
| `test/` | `runTest.js` (launches VS Code), `suite/` (Mocha tests), `fixtures/` (sample Terraform projects and a real plan JSON) |
| `examples/` | `example.tf`, a small multi-cloud file to try the extension on |
| `docs/` | This documentation. `docs/archive/` holds historical notes |
| `images/` | The extension icon |
| `.github/workflows/` | The PR cost-diff GitHub Action |
