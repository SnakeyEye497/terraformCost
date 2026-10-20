# Pricing and supported resources

[← Docs index](README.md)

Every cost comes from one of three sources, shown in each resource's hover breakdown:

| Source | When |
|---|---|
| **Infracost** | The `infracost` CLI is installed and has an API key, either the `terraformCost.infracostApiKey` setting or the CLI's own `infracost auth login`. Prices are live and region-accurate. Results are matched by full resource address, including `module.x.` prefixes and summed `[index]` instances. |
| **Built-in (fallback)** | Infracost isn't available, or doesn't report that resource. Prices are approximate on-demand list prices for us-east-1 / us-central1 / eastus. |
| **Estimated** | A paid-looking resource type with no built-in price gets a flagged flat $7.30/mo estimate. |

## Built-in coverage

- **AWS**: EC2 (including root volume), RDS (including storage and Multi-AZ), Aurora / DocumentDB / Neptune instances, S3, EBS, EFS, NAT gateways, ALB/NLB/ELB, EKS clusters and node groups, ElastiCache clusters and replication groups, Lambda, DynamoDB, OpenSearch, Redshift, MSK, Elastic IPs, interface VPC endpoints, Site-to-Site VPN, Route 53 zones, KMS keys, Secrets Manager, ECR, CloudWatch Logs.
- **GCP**: Compute Engine, Cloud SQL (including `db-custom-*` tiers, HA and disk), Cloud Storage, persistent disks, GKE clusters (including the default node pool) and node pools, Memorystore, static IPs, forwarding rules, Cloud NAT, Cloud VPN.
- **Azure**: VMs and VM scale sets, SQL Database (`azurerm_sql_database` and `azurerm_mssql_database`), PostgreSQL / MySQL Flexible Server, Storage Accounts, Managed Disks, AKS clusters (Free / Standard tier, plus the default node pool) and node pools, Azure Cache for Redis, App Service plans, public IPs, Standard load balancers, NAT gateways, Container Registry, VNet gateways.

The price tables are in `initializeDefaultPricing()` in `src/core/cost-calculator.js`. Adding a resource type means adding a `case` to `calculateAWSCost` / `calculateGCPCost` / `calculateAzureCost`, a pricing method, and a test in `test/suite/cost-calculator.test.js`.

## Free resources

Resources with no direct charge are priced at **$0**, not estimated: VPCs, subnets, route tables, internet gateways, security groups and rules, IAM, subnet/parameter groups, VPN gateway attachments, flow logs, S3 bucket sub-resources, GCP networks/firewalls/IAM bindings, Azure resource groups/VNets/NSGs/role assignments, and utility providers (`random_*`, `null_*`, `tls_*`, `time_*`, …). The list is `FREE_RESOURCE_PATTERNS` at the top of `src/core/cost-calculator.js`.

## How attributes are read

- **Instance counts.** A literal `count` or a literal `for_each` list/map multiplies the cost, and `count = 0` makes it free. Expressions (`var.enabled ? 1 : 0`, `toset(...)`) count as one instance. See [Known limitations](known-limitations.md).
- **Nested blocks.** Attributes are found whether they sit at the top level (static HCL parsing) or inside nested blocks (plan JSON, e.g. `scaling_config[0].desired_size`).
- **Spot / preemptible.** `spot`, `market_type = "spot"`, `capacity_type = "SPOT"`, `priority = "Spot"` and `preemptible = true` apply a ~70% discount.

## Usage-based assumptions

Some services are billed on usage that Terraform doesn't describe. The built-in estimates assume:

| Service | Assumption |
|---|---|
| Lambda | 1M invocations/month at 200 ms, at the configured `memory_size` |
| S3, Cloud Storage, Blob Storage, EFS | 100 GB stored |
| CloudWatch Logs | 5 GB ingested/month |
| ECR | 10 GB stored |
| DynamoDB | 1 GB stored; on-demand request charges not estimated |

For real usage numbers, compare against your bill with [Actual cloud spend](features/actual-spend.md).
