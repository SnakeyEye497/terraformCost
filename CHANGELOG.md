# Change Log

All notable changes to the "terraform-cost-calculator" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- `Terraform Cost: Compare Estimate with Actual Cloud Spend`: pulls last-month and month-to-date spend from AWS Cost Explorer, Azure Cost Management and the GCP BigQuery billing export (via each provider's CLI) and compares it against the Terraform estimate. (`src/billing-integration.js`)
- Built-in pricing for ~35 more resource types, including EKS node groups, Aurora instances, ElastiCache replication groups, Lambda, DynamoDB, EFS, OpenSearch, Redshift, MSK, Elastic IPs, VPC endpoints, GKE node pools, Memorystore, Azure Flexible Servers, Redis, App Service plans, AKS node pools and VM scale sets, plus larger instance-size tables.
- Literal `count` / `for_each` on resources multiplies their cost; RDS and Cloud SQL now include storage; AKS/GKE include their node pools.
- Module resolution for remote (registry/git) modules via `.terraform/modules/modules.json`, and for `count` / `for_each` on module blocks.
- Workspace-scope budget alerts (popup + Slack/Teams webhook).
- `Export Error Log` / `Clear Error Log` now appear in the Command Palette.
- Extension icon, webpack bundling (`dist/extension.js`), `npm run vsix`, and shared `.vscode` launch/tasks configs.
- 57 new automated tests (76 total).

### Fixed
- Infracost integration never ran: the CLI availability check was commented out, and activation blocked on an "enter API key" notification. The CLI is now detected properly, its own configured API key is honored, and the prompt no longer blocks activation.
- Infracost results could be attributed to the wrong resource (loose name/type matching). They are now matched by full address, and `count` instances are summed.
- Free resources (VPCs, subnets, security groups, IAM, …) were priced at a flat $7.30/mo "unknown type" estimate; they are now $0.
- Budget file watcher didn't reload the right folder on Windows (backslash paths).
- Teams budget alerts now use Adaptive Cards (required by Teams Workflows webhooks) instead of the legacy `MessageCard` format.
- Corrected several fallback prices (e.g. GCP e2 machine types, Azure SQL Basic/Standard).

### Changed
- `npm audit`: 0 vulnerabilities (mocha 12, @vscode/vsce 4, `uuid` override for exceljs). ESLint: 0 warnings.
- `package.json`: publisher, repository URLs, Apache-2.0 license field (matching `LICENSE`).

## [Earlier]

- Added `Terraform Cost: Show Cost Dashboard` command — a webview panel with a cost-breakdown donut chart, a per-provider bar chart, a 12-month forecast chart, and a budget meter. Live-updates as you edit/save/switch Terraform files. (`src/cost-dashboard.js`)
- Initial release
