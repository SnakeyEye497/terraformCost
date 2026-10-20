# Complex multi-file Terraform project (test fixture)

A realistic, multi-module, multi-provider Terraform project that exists purely to exercise Matali's features that a single `.tf` file (like [`example.tf`](../../../examples/example.tf)) can't: workspace-wide scanning, cost-by-file/module attribution, budget thresholds, and AI cost/scaling suggestions with real, deliberately-imperfect sizing for them to actually catch.

Every instance type / tier / size used here is a real key in `src/core/cost-calculator.js`'s fallback pricing table, so nothing here silently prices at $0 or falls back to an "unknown resource" estimate — every number on the dashboard should be real and traceable back to a specific line in these files.

## Structure

```
complex-project/
├── providers.tf, variables.tf, main.tf, outputs.tf   (root — main.tf calls every module below)
├── terraform.budget.json
├── terraform.capacity.json
└── modules/
    ├── networking/   AWS: VPC, 2 subnets, 2 NAT gateways (one per AZ), 1 ALB
    ├── compute/      AWS: 3 EC2 instances (one via a variable, two hardcoded)
    ├── database/     AWS: Multi-AZ RDS, an RDS cluster, an ElastiCache cluster
    ├── storage/      AWS: 2 S3 buckets, 2 EBS volumes
    ├── kubernetes/   AWS: 1 EKS cluster
    ├── gcp/          GCP: 2 Compute instances, 1 disk, Cloud SQL, Cloud Storage, 1 GKE cluster
    └── azure/        Azure: 2 VMs, SQL Database, Storage Account, a Premium managed disk, 1 AKS cluster
```

11 `.tf` files, ~26 cost-relevant resources (plus a handful of free supporting resources — VPC/subnets/EIPs) across all three providers.

**Note on the module blocks in `main.tf`**: the workspace scanner follows them (`src/core/module-resolver.js`) — the root directory is scanned directly and each `modules/*` directory is resolved through its call site, the way real Terraform does. None of the calls pass overrides, so every module resolves with its own defaults.

**Note on the one `variable` block** (in `modules/compute/main.tf`): Matali's parser resolves `var.x` references only from `variable` blocks in the *same file* — it parses and resolves each file independently, not across a module's own files the way real Terraform does. So unlike a real project, variables can't be split into a separate `variables.tf` per module here and still resolve to real costs. Known limitation of the current parser, not something this fixture works around silently — worth knowing if a suggestion or cost looks like $0 for something referencing a variable.

## Expected numbers (via built-in fallback pricing, no Infracost needed)

These aren't hand-calculated — verified by actually running `src/core/terraform-parser.js` + `src/core/cost-calculator.js` against every file here (stubbing `vscode` to run outside the extension host):

| Module | Monthly (verified) |
|---|---|
| networking | $89.43 |
| compute | $231.26 |
| database | $185.24 |
| storage | $70.60 |
| kubernetes | $73.00 |
| gcp | $344.32 |
| azure | $336.20 |
| **Total** | **$1,330.05/mo across 31 resources** |

`terraform.budget.json` is tuned so this sits **just past `limit_3` ($1,100) but under `final_limit` ($1,500)** by default — the dashboard/header should show **yellow, "near limit"** out of the box. Bump any one instance size up (e.g. `batch_processor` to something bigger) to push it past `final_limit` and watch it turn red — a good live demo of the escalation without having to build the whole budget-crossing scenario from scratch.

**Note on `networking`**: `aws_vpc` and `aws_subnet` are priced at $0 (they have no direct AWS charge — see `FREE_RESOURCE_PATTERNS` in `src/core/cost-calculator.js`), and each `aws_eip` at the public-IPv4 rate ($3.65/mo). Earlier versions priced all three at a flat $7.30/mo "unknown resource type" estimate, which is why older docs quoted $118.62 for this module and $1,345.81 overall.

## Deliberate AI-suggestion bait

Three resources are sized bigger than their apparent purpose suggests, specifically so `Terraform Cost: Get AI Cost Optimization Suggestions` and `Get Scaling Suggestions` have something real to catch instead of a clean bill of health:

- `aws_instance.batch_processor` — `m5.xlarge` for what's named/tagged as a batch job
- `google_compute_instance.legacy_batch` — `n1-standard-4`, similarly oversized
- `azurerm_windows_virtual_machine.legacy_app` — `Standard_D4s_v3`, a "legacy" box nobody's resized

`terraform.capacity.json`'s expected load is intentionally modest — not enough to justify any of the three above, so `Get Scaling Suggestions` should plausibly flag them as scale-down candidates. (It's plain JSON — hand-edit the actual numbers to whatever load tells the story you want; don't trust a specific figure written in prose here to still match the file.)

## How to use it

1. In the Extension Development Host window (see [Getting started](../../../docs/getting-started.md)), **File → Open Folder** → this `complex-project` folder (not the whole `terraformCost` repo — opening it as its own workspace root is what makes `terraform.budget.json`/`terraform.capacity.json` resolve cleanly and keeps the cost-by-file chart's paths short and readable).
2. Open any file under `modules/` to see single-file inline decorations + that module's own total-cost header.
3. Run **Terraform Cost: Show Workspace Cost Dashboard** to see everything aggregated — donut/bars/forecast across all ~26 resources, the budget meter at "near limit", and the new **Cost by file/module** chart (this is the one thing a single-file fixture like `example.tf` can never demonstrate).
4. Try **Get AI Cost Optimization Suggestions** and **Get Scaling Suggestions** (needs an AI provider key set up first — see [AI suggestions](../../../docs/features/ai-suggestions.md)) against `modules/compute/main.tf` or `modules/azure/main.tf` specifically, where the bait resources live.
