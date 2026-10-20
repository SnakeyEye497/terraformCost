const vscode = require('vscode');
const InfracostIntegration = require('../integrations/infracost-integration');

const HOURS_PER_MONTH = 730;

// Resource types that carry no direct charge of their own (networking
// plumbing, IAM, config/association objects, and utility providers). Without
// this list they would fall through to the generic "unknown resource"
// estimate and inflate every project's total.
const FREE_RESOURCE_PATTERNS = [
    /^aws_(vpc|subnet|route|route_table|route_table_association|main_route_table_association|internet_gateway|egress_only_internet_gateway|security_group|security_group_rule|vpc_security_group_(ingress|egress)_rule|network_acl|network_acl_rule|network_acl_association|vpc_dhcp_options|vpc_dhcp_options_association|vpc_endpoint_route_table_association|key_pair|placement_group|launch_template|launch_configuration|autoscaling_policy|autoscaling_attachment|lb_listener|lb_listener_rule|lb_target_group|lb_target_group_attachment|alb_listener|alb_listener_rule|alb_target_group|alb_target_group_attachment|db_subnet_group|db_parameter_group|db_option_group|rds_cluster_parameter_group|elasticache_subnet_group|elasticache_parameter_group|ecs_cluster|ecs_task_definition|eks_addon|lambda_permission|lambda_alias|sns_topic_subscription|sqs_queue_policy|kms_alias|route53_record|ssm_parameter|cloudwatch_log_resource_policy|vpc_peering_connection|vpc_peering_connection_accepter)$/,
    /^aws_(iam|default)_/,
    /^aws_[a-z0-9_]*_subnet_group$/,
    /^aws_(vpc_ipv4_cidr_block_association|vpc_ipv6_cidr_block_association|vpn_gateway|vpn_gateway_attachment|vpn_gateway_route_propagation|customer_gateway|flow_log|ec2_tag|ebs_snapshot_copy_permission|volume_attachment|eip_association|lb_cookie_stickiness_policy|cloudwatch_log_stream|cloudwatch_event_target|sns_topic_policy|ecr_replication_configuration)$/,
    /^aws_s3_bucket_/,
    /^aws_ecr_(lifecycle|repository)_policy$/,
    /^aws_acm_certificate/,
    /^google_(project_service|compute_network|compute_subnetwork|compute_firewall|compute_route|compute_router|compute_instance_template|storage_bucket_object|sql_database|sql_user|service_account|service_account_key)$/,
    /^google_.*_iam_(member|binding|policy)$/,
    /^azurerm_(resource_group|virtual_network|subnet|network_security_group|network_security_rule|network_interface|route_table|route|role_assignment|role_definition|user_assigned_identity|storage_container|key_vault_secret|key_vault_access_policy|availability_set|mssql_server|sql_server|postgresql_flexible_server_database|postgresql_flexible_server_firewall_rule|mysql_flexible_server_database|mysql_flexible_server_firewall_rule|private_dns_zone_virtual_network_link|lb_rule|lb_probe|lb_backend_address_pool|virtual_network_peering)$/,
    /^azurerm_.*_association$/,
    /^(random|null|tls|local|time|template|archive|external|http|terraform)_/
];

function isFreeResourceType(resourceType) {
    return FREE_RESOURCE_PATTERNS.some((pattern) => pattern.test(resourceType));
}

class TerraformCostCalculator {
    constructor() {
        this.pricingCache = new Map();
        this.cacheExpiry = 60 * 60 * 1000; // 1 hour
        this.infracost = null;
        this.useInfracost = true;
        this.defaultPricing = this.initializeDefaultPricing();
        this.resourceCostMap = new Map(); // Track resource-to-cost mapping
    }

    async initialize(context) {
        this.infracost = new InfracostIntegration();
        await this.infracost.initialize(context);
        
        const config = vscode.workspace.getConfiguration('terraformCost');
        this.useInfracost = config.get('useInfracost', true);
        
        // Log status
        const status = this.infracost.getStatus();
        console.log('Cost Calculator initialized:', {
            useInfracost: this.useInfracost,
            infracostAvailable: status.available,
            hasApiKey: status.hasApiKey
        });
    }

    async calculateResourceCost(resource, filePath = null) {
        try {
            // Try Infracost first if enabled
            if (this.useInfracost && filePath && this.infracost) {
                const infracostData = await this.getCachedInfracostData(filePath);
                
                if (infracostData && infracostData.resources) {
                    const matches = this.findMatchingResources(infracostData.resources, resource);

                    if (matches.length > 0) {
                        // One match per instance when the block uses count/for_each.
                        const cost = matches.length === 1 ? matches[0].cost : {
                            hourly: matches.reduce((s, m) => s + m.cost.hourly, 0),
                            monthly: matches.reduce((s, m) => s + m.cost.monthly, 0),
                            yearly: matches.reduce((s, m) => s + m.cost.yearly, 0),
                            currency: 'USD',
                            breakdown: [...matches[0].cost.breakdown, `x${matches.length} instances`],
                            source: 'infracost'
                        };
                        this.resourceCostMap.set(this.getResourceKey(resource), cost);
                        return cost;
                    }
                }
            }

            // Fallback to default pricing
            const fallbackCost = await this.calculateResourceCostFallback(resource);
            return fallbackCost;
            
        } catch (error) {
            console.error('Error calculating resource cost:', error);
            return this.getErrorCost(error.message);
        }
    }

    async getCachedInfracostData(filePath) {
        const cacheKey = `infracost:${filePath}`;
        const cached = this.pricingCache.get(cacheKey);
        
        // Return cached if valid
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }

        // Fetch new data
        try {
            const infracostData = await this.infracost.calculateCostsForFile(filePath);
            
            if (infracostData) {
                this.pricingCache.set(cacheKey, {
                    data: infracostData,
                    timestamp: Date.now()
                });
                return infracostData;
            }
        } catch (error) {
            console.error('Infracost fetch failed:', error);
        }

        return null;
    }

    findMatchingResources(infracostResources, tfResource) {
        // Infracost names resources by their full address, e.g.
        // "aws_instance.web", "module.app.aws_instance.web" or
        // "aws_instance.web[0]". Match on that address only — never on a
        // looser name/type guess, which could hand one resource another
        // resource's cost; falling back to built-in pricing is more honest.
        const address = `${tfResource.type}.${tfResource.name}`;
        const stripIndex = (name) => name.replace(/\[[^\]]*\]$/, '');

        return infracostResources.filter((r) => {
            if (r.type !== tfResource.type || typeof r.name !== 'string' || !r.cost) return false;
            const name = stripIndex(r.name);
            return name === tfResource.name || name === address || name.endsWith(`.${address}`);
        });
    }

    getResourceKey(resource) {
        return `${resource.provider}:${resource.type}:${resource.name}`;
    }

    async calculateResourceCostFallback(resource) {
        const provider = resource.provider;
        const resourceType = resource.type;
        const attributes = resource.attributes || {};

        let cost;

        if (isFreeResourceType(resourceType)) {
            cost = this.getFreeCost(resourceType);
        } else {
            switch (provider) {
                case 'aws':
                    cost = this.calculateAWSCost(resourceType, attributes);
                    break;
                case 'gcp':
                    cost = this.calculateGCPCost(resourceType, attributes);
                    break;
                case 'azure':
                    cost = this.calculateAzureCost(resourceType, attributes);
                    break;
                default:
                    cost = this.getUnknownProviderCost();
            }
        }

        cost.currency = this.getCurrency();
        cost.source = cost.source || 'fallback';
        cost = this.applyPricingModifiers(cost, attributes);
        cost = this.applyInstanceCount(cost, attributes);
        return cost;
    }

    calculateAWSCost(resourceType, attributes) {
        switch (resourceType) {
            case 'aws_instance':
                return this.calculateEC2Cost(attributes);
            case 'aws_db_instance':
                return this.calculateRDSCost(attributes);
            case 'aws_s3_bucket':
                return this.calculateS3Cost();
            case 'aws_ebs_volume':
                return this.calculateEBSCost(attributes);
            case 'aws_nat_gateway':
                return this.calculateNATGatewayCost();
            case 'aws_lb':
            case 'aws_alb':
            case 'aws_nlb':
            case 'aws_elb':
                return this.calculateLoadBalancerCost();
            case 'aws_eks_cluster':
                return this.calculateEKSCost();
            case 'aws_eks_node_group':
                return this.calculateEKSNodeGroupCost(attributes);
            case 'aws_rds_cluster':
                return this.calculateRDSClusterCost(attributes);
            case 'aws_rds_cluster_instance':
            case 'aws_docdb_cluster_instance':
            case 'aws_neptune_cluster_instance':
                return this.calculateClusterInstanceCost(resourceType, attributes);
            case 'aws_elasticache_cluster':
                return this.calculateElastiCacheCost(attributes);
            case 'aws_elasticache_replication_group':
                return this.calculateElastiCacheReplicationGroupCost(attributes);
            case 'aws_lambda_function':
                return this.calculateLambdaCost(attributes);
            case 'aws_dynamodb_table':
                return this.calculateDynamoDBCost(attributes);
            case 'aws_efs_file_system':
                return this.calculateEFSCost();
            case 'aws_eip':
                return this.fixedCost('Elastic IP (public IPv4)', this.defaultPricing.aws.public_ipv4.hourly);
            case 'aws_vpc_endpoint':
                return this.calculateVPCEndpointCost(attributes);
            case 'aws_vpn_connection':
                return this.fixedCost('Site-to-Site VPN connection', this.defaultPricing.aws.vpn_connection.hourly);
            case 'aws_route53_zone':
                return this.monthlyCost('Route 53 hosted zone', 0.50);
            case 'aws_kms_key':
                return this.monthlyCost('KMS customer-managed key', 1.00);
            case 'aws_secretsmanager_secret':
                return this.monthlyCost('Secrets Manager secret', 0.40);
            case 'aws_opensearch_domain':
            case 'aws_elasticsearch_domain':
                return this.calculateOpenSearchCost(attributes);
            case 'aws_redshift_cluster':
                return this.calculateRedshiftCost(attributes);
            case 'aws_msk_cluster':
                return this.calculateMSKCost(attributes);
            case 'aws_ecr_repository':
                return this.storageCost('ECR repository', 10, this.defaultPricing.aws.ecr_storage.per_gb_month, true);
            case 'aws_cloudwatch_log_group':
                return this.storageCost('CloudWatch Logs ingestion', 5, this.defaultPricing.aws.cloudwatch_logs_ingest.per_gb, true);
            default:
                return this.getDefaultCost(`AWS ${resourceType}`);
        }
    }

    calculateGCPCost(resourceType, attributes) {
        switch (resourceType) {
            case 'google_compute_instance':
                return this.calculateGCECost(attributes);
            case 'google_sql_database_instance':
                return this.calculateCloudSQLCost(attributes);
            case 'google_storage_bucket':
                return this.calculateCloudStorageCost();
            case 'google_compute_disk':
                return this.calculateComputeDiskCost(attributes);
            case 'google_container_cluster':
                return this.calculateGKECost(attributes);
            case 'google_container_node_pool':
                return this.calculateGKENodePoolCost(attributes);
            case 'google_redis_instance':
                return this.calculateMemorystoreCost(attributes);
            case 'google_compute_address':
            case 'google_compute_global_address':
                return this.calculateGCPAddressCost(attributes);
            case 'google_compute_forwarding_rule':
            case 'google_compute_global_forwarding_rule':
                return this.fixedCost('Load balancer forwarding rule', this.defaultPricing.gcp.forwarding_rule.hourly);
            case 'google_compute_router_nat':
                return this.fixedCost('Cloud NAT gateway (est. up to 32 VMs)', this.defaultPricing.gcp.cloud_nat.hourly);
            case 'google_compute_vpn_gateway':
            case 'google_compute_ha_vpn_gateway':
                return this.fixedCost('Cloud VPN tunnel', this.defaultPricing.gcp.vpn_tunnel.hourly);
            default:
                return this.getDefaultCost(`GCP ${resourceType}`);
        }
    }

    calculateAzureCost(resourceType, attributes) {
        switch (resourceType) {
            case 'azurerm_virtual_machine':
            case 'azurerm_linux_virtual_machine':
            case 'azurerm_windows_virtual_machine':
                return this.calculateVMCost(attributes);
            case 'azurerm_linux_virtual_machine_scale_set':
            case 'azurerm_windows_virtual_machine_scale_set':
            case 'azurerm_orchestrated_virtual_machine_scale_set':
                return this.calculateVMSSCost(attributes);
            case 'azurerm_sql_database':
            case 'azurerm_mssql_database':
                return this.calculateSQLDatabaseCost(attributes);
            case 'azurerm_postgresql_flexible_server':
            case 'azurerm_mysql_flexible_server':
                return this.calculateFlexibleServerCost(resourceType, attributes);
            case 'azurerm_storage_account':
                return this.calculateStorageAccountCost();
            case 'azurerm_managed_disk':
                return this.calculateManagedDiskCost(attributes);
            case 'azurerm_kubernetes_cluster':
                return this.calculateAKSCost(attributes);
            case 'azurerm_kubernetes_cluster_node_pool':
                return this.calculateAKSNodePoolCost(attributes);
            case 'azurerm_redis_cache':
                return this.calculateAzureRedisCost(attributes);
            case 'azurerm_public_ip':
                return this.calculateAzurePublicIPCost(attributes);
            case 'azurerm_lb':
                return this.calculateAzureLBCost(attributes);
            case 'azurerm_nat_gateway':
                return this.fixedCost('NAT Gateway', this.defaultPricing.azure.nat_gateway.hourly);
            case 'azurerm_service_plan':
            case 'azurerm_app_service_plan':
                return this.calculateAppServicePlanCost(attributes);
            case 'azurerm_container_registry':
                return this.calculateContainerRegistryCost(attributes);
            case 'azurerm_virtual_network_gateway':
                return this.calculateVNetGatewayCost(attributes);
            default:
                return this.getDefaultCost(`Azure ${resourceType}`);
        }
    }

    // AWS Resource Calculations
    calculateEC2Cost(attributes) {
        const instanceType = this.getAttr(attributes, 'instance_type') || 't2.micro';
        const known = this.defaultPricing.aws[instanceType];
        const pricing = known || this.defaultPricing.aws['t2.micro'];
        const compute = this.fromHourly(pricing.hourly, `EC2 ${instanceType}${known ? '' : ' (unknown type, priced as t2.micro)'}`);

        // Root volume: 8GB gp3/gp2 is the AMI default when not specified.
        const rootSize = this.getAttr(attributes, 'volume_size');
        if (typeof rootSize === 'number' && rootSize > 0) {
            const volumeType = this.getAttr(attributes, 'volume_type') || 'gp3';
            const perGb = (this.defaultPricing.aws[`ebs_${volumeType}`] || this.defaultPricing.aws.ebs_gp3).per_gb_month;
            return this.combine([compute, this.storageCost(`Root volume ${volumeType} ${rootSize}GB`, rootSize, perGb)]);
        }
        return compute;
    }

    calculateRDSCost(attributes) {
        const instanceClass = this.getAttr(attributes, 'instance_class') || 'db.t3.micro';
        const multiAz = this.getAttr(attributes, 'multi_az') === true;
        const pricing = this.defaultPricing.aws[instanceClass] || this.defaultPricing.aws['db.t3.micro'];
        const azFactor = multiAz ? 2 : 1;

        const parts = [this.fromHourly(pricing.hourly * azFactor,
            `RDS ${instanceClass}${multiAz ? ' (Multi-AZ, x2)' : ''}`)];

        const storage = this.getAttr(attributes, 'allocated_storage');
        if (typeof storage === 'number' && storage > 0) {
            parts.push(this.storageCost(`RDS storage ${storage}GB${multiAz ? ' (Multi-AZ, x2)' : ''}`,
                storage * azFactor, this.defaultPricing.aws.rds_storage_gp2.per_gb_month));
        }
        return this.combine(parts);
    }

    calculateS3Cost() {
        return this.storageCost('S3 Storage', 100, this.defaultPricing.aws.s3_standard.per_gb_month, true);
    }

    calculateEBSCost(attributes) {
        const size = this.getAttr(attributes, 'size') || 8;
        const volumeType = this.getAttr(attributes, 'type') || 'gp2';
        const pricing = this.defaultPricing.aws[`ebs_${volumeType}`] || this.defaultPricing.aws.ebs_gp2;
        return this.storageCost(`EBS ${volumeType} ${size}GB`, size, pricing.per_gb_month);
    }

    calculateNATGatewayCost() {
        return this.fixedCost('NAT Gateway', this.defaultPricing.aws.nat_gateway.hourly);
    }

    calculateLoadBalancerCost() {
        return this.fixedCost('Load Balancer', this.defaultPricing.aws.application_load_balancer.hourly);
    }

    calculateEKSCost() {
        return this.fixedCost('EKS control plane', this.defaultPricing.aws.eks_cluster.hourly);
    }

    calculateEKSNodeGroupCost(attributes) {
        const instanceTypes = this.getAttr(attributes, 'instance_types');
        const instanceType = (Array.isArray(instanceTypes) && typeof instanceTypes[0] === 'string')
            ? instanceTypes[0] : 't3.medium';
        const nodes = this.firstNumber(attributes, ['desired_size', 'min_size'], 2);
        const pricing = this.defaultPricing.aws[instanceType] || this.defaultPricing.aws['t3.medium'];
        return this.fromHourly(pricing.hourly * nodes, `EKS node group (${nodes}x ${instanceType})`);
    }

    calculateRDSClusterCost(attributes) {
        const instanceCount = this.getAttr(attributes, 'cluster_instances') || 2;
        const instanceClass = this.getAttr(attributes, 'instance_class') || 'db.t3.medium';
        const pricing = this.defaultPricing.aws[instanceClass] || this.defaultPricing.aws['db.t3.micro'];
        return this.fromHourly(pricing.hourly * instanceCount, `RDS Cluster (${instanceCount}x ${instanceClass})`);
    }

    calculateClusterInstanceCost(resourceType, attributes) {
        const instanceClass = this.getAttr(attributes, 'instance_class') || 'db.t3.medium';
        const pricing = this.defaultPricing.aws[instanceClass] || this.defaultPricing.aws['db.t3.medium'];
        const label = {
            aws_rds_cluster_instance: 'Aurora instance',
            aws_docdb_cluster_instance: 'DocumentDB instance',
            aws_neptune_cluster_instance: 'Neptune instance'
        }[resourceType];
        return this.fromHourly(pricing.hourly, `${label} ${instanceClass}`);
    }

    calculateElastiCacheCost(attributes) {
        const nodeType = this.getAttr(attributes, 'node_type') || 'cache.t3.micro';
        const numNodes = this.getAttr(attributes, 'num_cache_nodes') || 1;
        const pricing = this.defaultPricing.aws[nodeType] || this.defaultPricing.aws['cache.t3.micro'];
        return this.fromHourly(pricing.hourly * numNodes, `ElastiCache (${numNodes}x ${nodeType})`);
    }

    calculateElastiCacheReplicationGroupCost(attributes) {
        const nodeType = this.getAttr(attributes, 'node_type') || 'cache.t3.micro';
        let nodes = this.getAttr(attributes, 'num_cache_clusters');
        if (typeof nodes !== 'number') {
            const shards = this.getAttr(attributes, 'num_node_groups');
            const replicas = this.getAttr(attributes, 'replicas_per_node_group');
            nodes = typeof shards === 'number' ? shards * ((typeof replicas === 'number' ? replicas : 0) + 1) : 2;
        }
        const pricing = this.defaultPricing.aws[nodeType] || this.defaultPricing.aws['cache.t3.micro'];
        return this.fromHourly(pricing.hourly * nodes, `ElastiCache replication group (${nodes}x ${nodeType})`);
    }

    calculateLambdaCost(attributes) {
        // Usage-based: assume 1M invocations/month at 200ms average duration.
        const memoryMb = this.getAttr(attributes, 'memory_size') || 128;
        const invocations = 1_000_000;
        const gbSeconds = invocations * 0.2 * (memoryMb / 1024);
        const p = this.defaultPricing.aws.lambda;
        const monthly = invocations / 1_000_000 * p.per_million_requests + gbSeconds * p.per_gb_second;
        return this.monthlyCost(`Lambda ${memoryMb}MB (est. 1M invocations/mo @ 200ms)`, monthly);
    }

    calculateDynamoDBCost(attributes) {
        const billingMode = this.getAttr(attributes, 'billing_mode') || 'PROVISIONED';
        const p = this.defaultPricing.aws.dynamodb;
        const storage = this.storageCost('DynamoDB storage', 1, p.storage_per_gb_month, true);
        if (billingMode === 'PAY_PER_REQUEST') {
            return this.combine([storage, this.monthlyCost('On-demand requests (usage-based, not estimated)', 0)]);
        }
        const rcu = this.getAttr(attributes, 'read_capacity') || 5;
        const wcu = this.getAttr(attributes, 'write_capacity') || 5;
        return this.combine([
            this.fromHourly(rcu * p.rcu_hourly + wcu * p.wcu_hourly, `DynamoDB provisioned ${rcu} RCU / ${wcu} WCU`),
            storage
        ]);
    }

    calculateEFSCost() {
        return this.storageCost('EFS Standard', 100, this.defaultPricing.aws.efs_standard.per_gb_month, true);
    }

    calculateVPCEndpointCost(attributes) {
        const endpointType = this.getAttr(attributes, 'vpc_endpoint_type') || 'Gateway';
        if (endpointType === 'Gateway') {
            return this.getFreeCost('aws_vpc_endpoint (Gateway)');
        }
        const subnets = this.getAttr(attributes, 'subnet_ids');
        const azs = Array.isArray(subnets) && subnets.length > 0 ? subnets.length : 1;
        return this.fromHourly(this.defaultPricing.aws.vpc_endpoint_interface.hourly * azs,
            `Interface VPC endpoint (${azs} AZ${azs > 1 ? 's' : ''})`);
    }

    calculateOpenSearchCost(attributes) {
        const instanceType = this.getAttr(attributes, 'instance_type') || 't3.small.search';
        const count = this.getAttr(attributes, 'instance_count') || 1;
        const pricing = this.defaultPricing.aws[instanceType] || this.defaultPricing.aws['t3.small.search'];
        const parts = [this.fromHourly(pricing.hourly * count, `OpenSearch (${count}x ${instanceType})`)];
        const volumeSize = this.getAttr(attributes, 'volume_size');
        if (typeof volumeSize === 'number' && volumeSize > 0) {
            parts.push(this.storageCost(`OpenSearch EBS ${volumeSize}GB x${count}`, volumeSize * count,
                this.defaultPricing.aws.opensearch_ebs.per_gb_month));
        }
        return this.combine(parts);
    }

    calculateRedshiftCost(attributes) {
        const nodeType = this.getAttr(attributes, 'node_type') || 'dc2.large';
        const nodes = this.getAttr(attributes, 'number_of_nodes') || 1;
        const pricing = this.defaultPricing.aws[nodeType] || this.defaultPricing.aws['dc2.large'];
        return this.fromHourly(pricing.hourly * nodes, `Redshift (${nodes}x ${nodeType})`);
    }

    calculateMSKCost(attributes) {
        const instanceType = this.getAttr(attributes, 'instance_type') || 'kafka.m5.large';
        const brokers = this.getAttr(attributes, 'number_of_broker_nodes') || 3;
        const pricing = this.defaultPricing.aws[instanceType] || this.defaultPricing.aws['kafka.m5.large'];
        const parts = [this.fromHourly(pricing.hourly * brokers, `MSK (${brokers}x ${instanceType})`)];
        const volumeSize = this.getAttr(attributes, 'volume_size');
        if (typeof volumeSize === 'number' && volumeSize > 0) {
            parts.push(this.storageCost(`MSK storage ${volumeSize}GB x${brokers}`, volumeSize * brokers,
                this.defaultPricing.aws.msk_storage.per_gb_month));
        }
        return this.combine(parts);
    }

    // GCP Resource Calculations
    calculateGCECost(attributes) {
        const machineType = this.getAttr(attributes, 'machine_type') || 'e2-micro';
        const hourly = this.gcpMachineHourly(machineType);
        return this.fromHourly(hourly, `GCE ${machineType}`);
    }

    calculateCloudSQLCost(attributes) {
        const tier = this.getAttr(attributes, 'tier') || 'db-n1-standard-1';
        const regional = this.getAttr(attributes, 'availability_type') === 'REGIONAL';
        const factor = regional ? 2 : 1;

        let hourly;
        const custom = /^db-custom-(\d+)-(\d+)$/.exec(tier);
        if (custom) {
            const p = this.defaultPricing.gcp.cloudsql_custom;
            hourly = Number(custom[1]) * p.vcpu_hourly + (Number(custom[2]) / 1024) * p.gb_ram_hourly;
        } else {
            hourly = (this.defaultPricing.gcp[tier] || this.defaultPricing.gcp['db-n1-standard-1']).hourly;
        }

        const parts = [this.fromHourly(hourly * factor, `Cloud SQL ${tier}${regional ? ' (HA, x2)' : ''}`)];
        const diskSize = this.getAttr(attributes, 'disk_size');
        if (typeof diskSize === 'number' && diskSize > 0) {
            parts.push(this.storageCost(`Cloud SQL SSD ${diskSize}GB${regional ? ' (HA, x2)' : ''}`,
                diskSize * factor, this.defaultPricing.gcp.cloudsql_ssd.per_gb_month));
        }
        return this.combine(parts);
    }

    calculateCloudStorageCost() {
        return this.storageCost('Cloud Storage', 100, this.defaultPricing.gcp.standard_storage.per_gb_month, true);
    }

    calculateComputeDiskCost(attributes) {
        const size = this.getAttr(attributes, 'size') || 10;
        const diskType = this.getAttr(attributes, 'type') || 'pd-standard';
        const pricingKey = diskType === 'pd-balanced' ? 'balanced_persistent_disk'
            : diskType.includes('ssd') ? 'ssd_persistent_disk' : 'standard_persistent_disk';
        return this.storageCost(`Compute Disk ${diskType} ${size}GB`, size, this.defaultPricing.gcp[pricingKey].per_gb_month);
    }

    calculateGKECost(attributes) {
        const parts = [this.fixedCost('GKE cluster management fee', this.defaultPricing.gcp.gke_cluster.hourly)];
        const removeDefault = this.getAttr(attributes, 'remove_default_node_pool') === true;
        const autopilot = this.getAttr(attributes, 'enable_autopilot') === true;
        const nodes = this.getAttr(attributes, 'initial_node_count');
        if (!removeDefault && !autopilot && typeof nodes === 'number' && nodes > 0) {
            const machineType = this.getAttr(attributes, 'machine_type') || 'e2-medium';
            parts.push(this.fromHourly(this.gcpMachineHourly(machineType) * nodes,
                `Default node pool (${nodes}x ${machineType})`));
        }
        return this.combine(parts);
    }

    calculateGKENodePoolCost(attributes) {
        const machineType = this.getAttr(attributes, 'machine_type') || 'e2-medium';
        const nodes = this.firstNumber(attributes, ['node_count', 'initial_node_count', 'min_node_count', 'total_min_node_count'], 1);
        return this.fromHourly(this.gcpMachineHourly(machineType) * nodes, `GKE node pool (${nodes}x ${machineType})`);
    }

    calculateMemorystoreCost(attributes) {
        const tier = this.getAttr(attributes, 'tier') || 'BASIC';
        const memoryGb = this.getAttr(attributes, 'memory_size_gb') || 1;
        const p = this.defaultPricing.gcp.memorystore;
        const perGbHour = tier === 'STANDARD_HA' ? p.standard_gb_hourly : p.basic_gb_hourly;
        return this.fromHourly(perGbHour * memoryGb, `Memorystore Redis ${tier} ${memoryGb}GB`);
    }

    calculateGCPAddressCost(attributes) {
        if (this.getAttr(attributes, 'address_type') === 'INTERNAL') {
            return this.getFreeCost('google_compute_address (internal)');
        }
        return this.fixedCost('Static external IP', this.defaultPricing.gcp.external_ip.hourly);
    }

    gcpMachineHourly(machineType) {
        const known = this.defaultPricing.gcp[machineType];
        if (known && known.hourly !== undefined) return known.hourly;
        return this.defaultPricing.gcp['e2-micro'].hourly;
    }

    // Azure Resource Calculations
    calculateVMCost(attributes) {
        const vmSize = this.getAttr(attributes, 'vm_size') || this.getAttr(attributes, 'size') || 'Standard_B1s';
        const pricing = this.defaultPricing.azure[vmSize] || this.defaultPricing.azure['Standard_B1s'];
        return this.fromHourly(pricing.hourly, `VM ${vmSize}`);
    }

    calculateVMSSCost(attributes) {
        const sku = this.getAttr(attributes, 'sku') || this.getAttr(attributes, 'sku_name') || 'Standard_B1s';
        const instances = this.getAttr(attributes, 'instances');
        const count = typeof instances === 'number' ? instances : 1;
        const pricing = this.defaultPricing.azure[sku] || this.defaultPricing.azure['Standard_B1s'];
        return this.fromHourly(pricing.hourly * count, `VM scale set (${count}x ${sku})`);
    }

    calculateSQLDatabaseCost(attributes) {
        const sku = this.getAttr(attributes, 'sku_name') ||
            this.getAttr(attributes, 'requested_service_objective_name') ||
            this.getAttr(attributes, 'edition') || 'Basic';
        const pricing = this.defaultPricing.azure.sql_database[sku] || this.defaultPricing.azure.sql_database['Basic'];
        return this.monthlyCost(`SQL Database ${sku}`, pricing.monthly);
    }

    calculateFlexibleServerCost(resourceType, attributes) {
        const sku = this.getAttr(attributes, 'sku_name') || 'B_Standard_B1ms';
        const pricing = this.defaultPricing.azure.flexible_server[sku] || this.defaultPricing.azure.flexible_server['B_Standard_B1ms'];
        const engine = resourceType === 'azurerm_mysql_flexible_server' ? 'MySQL' : 'PostgreSQL';
        const parts = [this.fromHourly(pricing.hourly, `${engine} Flexible Server ${sku}`)];

        const storageMb = this.getAttr(attributes, 'storage_mb');
        const storageGb = typeof storageMb === 'number' ? storageMb / 1024 : this.getAttr(attributes, 'size_gb');
        if (typeof storageGb === 'number' && storageGb > 0) {
            parts.push(this.storageCost(`${engine} storage ${Math.round(storageGb)}GB`, storageGb,
                this.defaultPricing.azure.flexible_server_storage.per_gb_month));
        }
        return this.combine(parts);
    }

    calculateStorageAccountCost() {
        return this.storageCost('Storage Account', 100, this.defaultPricing.azure.blob_storage_hot.per_gb_month, true);
    }

    calculateManagedDiskCost(attributes) {
        const size = this.getAttr(attributes, 'disk_size_gb') || 30;
        const storageType = this.getAttr(attributes, 'storage_account_type') || 'Standard_LRS';
        const pricingKey = storageType.includes('Premium') ? 'managed_disk_premium' : 'managed_disk_standard';
        return this.storageCost(`Managed Disk ${storageType} ${size}GB`, size, this.defaultPricing.azure[pricingKey].per_gb_month);
    }

    calculateAKSCost(attributes) {
        const skuTier = this.getAttr(attributes, 'sku_tier') || 'Free';
        const parts = [];
        if (skuTier === 'Standard' || skuTier === 'Paid' || skuTier === 'Premium') {
            parts.push(this.fixedCost(`AKS ${skuTier} tier control plane`, this.defaultPricing.azure.aks_standard_tier.hourly));
        } else {
            parts.push(this.monthlyCost('AKS Free tier control plane', 0));
        }
        const vmSize = this.getAttr(attributes, 'vm_size') || 'Standard_D2s_v3';
        const nodes = this.firstNumber(attributes, ['node_count', 'min_count'], 1);
        const pricing = this.defaultPricing.azure[vmSize] || this.defaultPricing.azure['Standard_D2s_v3'];
        parts.push(this.fromHourly(pricing.hourly * nodes, `Default node pool (${nodes}x ${vmSize})`));
        return this.combine(parts);
    }

    calculateAKSNodePoolCost(attributes) {
        const vmSize = this.getAttr(attributes, 'vm_size') || 'Standard_D2s_v3';
        const nodes = this.firstNumber(attributes, ['node_count', 'min_count'], 1);
        const pricing = this.defaultPricing.azure[vmSize] || this.defaultPricing.azure['Standard_D2s_v3'];
        return this.fromHourly(pricing.hourly * nodes, `AKS node pool (${nodes}x ${vmSize})`);
    }

    calculateAzureRedisCost(attributes) {
        const skuName = this.getAttr(attributes, 'sku_name') || 'Basic';
        const family = this.getAttr(attributes, 'family') || 'C';
        const capacity = this.getAttr(attributes, 'capacity') ?? 0;
        const key = `${skuName}_${family}${capacity}`;
        const pricing = this.defaultPricing.azure.redis[key] || this.defaultPricing.azure.redis['Basic_C0'];
        return this.monthlyCost(`Azure Cache for Redis ${skuName} ${family}${capacity}`, pricing.monthly);
    }

    calculateAzurePublicIPCost(attributes) {
        const sku = this.getAttr(attributes, 'sku') || 'Standard';
        const hourly = sku === 'Basic' ? this.defaultPricing.azure.public_ip_basic.hourly : this.defaultPricing.azure.public_ip_standard.hourly;
        return this.fixedCost(`Public IP (${sku})`, hourly);
    }

    calculateAzureLBCost(attributes) {
        const sku = this.getAttr(attributes, 'sku') || 'Basic';
        if (sku === 'Basic') {
            return this.monthlyCost('Load Balancer (Basic, no charge)', 0);
        }
        return this.fixedCost(`Load Balancer (${sku}, first 5 rules)`, this.defaultPricing.azure.lb_standard.hourly);
    }

    calculateAppServicePlanCost(attributes) {
        const sku = this.getAttr(attributes, 'sku_name') || this.getAttr(attributes, 'size') || 'B1';
        const pricing = this.defaultPricing.azure.app_service[sku];
        const workers = this.firstNumber(attributes, ['worker_count', 'capacity'], 1);
        if (!pricing) {
            return this.fromHourly(this.defaultPricing.azure.app_service['B1'].hourly * workers,
                `App Service plan ${sku} (unknown SKU, priced as B1)`);
        }
        return this.fromHourly(pricing.hourly * workers, `App Service plan ${sku}${workers > 1 ? ` x${workers}` : ''}`);
    }

    calculateContainerRegistryCost(attributes) {
        const sku = this.getAttr(attributes, 'sku') || 'Basic';
        const pricing = this.defaultPricing.azure.container_registry[sku] || this.defaultPricing.azure.container_registry['Basic'];
        return this.monthlyCost(`Container Registry ${sku}`, pricing.monthly);
    }

    calculateVNetGatewayCost(attributes) {
        const sku = this.getAttr(attributes, 'sku') || 'VpnGw1';
        const pricing = this.defaultPricing.azure.vnet_gateway[sku] || this.defaultPricing.azure.vnet_gateway['VpnGw1'];
        return this.fromHourly(pricing.hourly, `Virtual Network Gateway ${sku}`);
    }

    // Cost shape builders
    fromHourly(hourly, label) {
        const monthly = hourly * HOURS_PER_MONTH;
        return {
            hourly,
            monthly,
            yearly: monthly * 12,
            currency: 'USD',
            breakdown: [`${label}: ${monthly.toFixed(2)}/month`]
        };
    }

    fixedCost(label, hourly) {
        return this.fromHourly(hourly, label);
    }

    monthlyCost(label, monthly) {
        return {
            hourly: monthly / HOURS_PER_MONTH,
            monthly,
            yearly: monthly * 12,
            currency: 'USD',
            breakdown: [`${label}: ${monthly.toFixed(2)}/month`]
        };
    }

    storageCost(label, gb, perGbMonth, estimated = false) {
        return this.monthlyCost(estimated ? `${label} (est. ${gb}GB)` : label, gb * perGbMonth);
    }

    combine(parts) {
        return parts.reduce((acc, part) => ({
            hourly: acc.hourly + part.hourly,
            monthly: acc.monthly + part.monthly,
            yearly: acc.yearly + part.yearly,
            currency: 'USD',
            breakdown: acc.breakdown.concat(part.breakdown)
        }), { hourly: 0, monthly: 0, yearly: 0, currency: 'USD', breakdown: [] });
    }

    // Helper Methods
    resolveAttributeValue(value) {
        // Handle variable references
        if (typeof value === 'object' && value !== null) {
            if (value._ref === 'variable') {
                return null; // Can't resolve without context
            }
            if (value._function) {
                return null; // Can't evaluate functions
            }
        }
        return value;
    }

    /**
     * Looks an attribute up at the top level first, then one level down in
     * nested blocks. Static HCL parsing already flattens nested-block
     * attributes to the top level, but `terraform show -json` plans keep them
     * nested (e.g. `scaling_config: [{ desired_size: 2 }]`), so this lets
     * every pricing function read both shapes the same way.
     */
    getAttr(attributes, key) {
        if (!attributes) return undefined;
        if (attributes[key] !== undefined) return this.resolveAttributeValue(attributes[key]);

        for (const value of Object.values(attributes)) {
            const blocks = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
            for (const block of blocks) {
                if (block && typeof block === 'object' && !Array.isArray(block) && block[key] !== undefined) {
                    return this.resolveAttributeValue(block[key]);
                }
            }
        }
        return undefined;
    }

    firstNumber(attributes, keys, fallback) {
        for (const key of keys) {
            const value = this.getAttr(attributes, key);
            if (typeof value === 'number') return value;
        }
        return fallback;
    }

    /**
     * How many instances a single resource block creates: a literal `count`,
     * or the size of a literal `for_each` map/list. Anything that can't be
     * evaluated statically (variables, function calls) counts as 1.
     */
    getInstanceCount(attributes) {
        const count = this.resolveAttributeValue(attributes?.count);
        if (typeof count === 'number' && count >= 0) return Math.floor(count);

        const forEach = this.resolveAttributeValue(attributes?.for_each);
        if (Array.isArray(forEach)) return forEach.length;
        if (forEach && typeof forEach === 'object' && !forEach._ref) return Object.keys(forEach).length;
        return 1;
    }

    applyInstanceCount(cost, attributes) {
        const instances = this.getInstanceCount(attributes);
        if (instances === 1) return cost;

        const source = attributes.count !== undefined ? 'count' : 'for_each';
        return {
            ...cost,
            hourly: cost.hourly * instances,
            monthly: cost.monthly * instances,
            yearly: cost.yearly * instances,
            breakdown: [...cost.breakdown, `x${instances} instances (${source})`]
        };
    }

    getRegionForResource(resource) {
        const config = vscode.workspace.getConfiguration('terraformCost');
        const defaultRegions = config.get('region', {
            aws: 'us-east-1',
            gcp: 'us-central1',
            azure: 'eastus'
        });

        return defaultRegions[resource.provider] || 'us-east-1';
    }

    getCurrency() {
        return vscode.workspace.getConfiguration('terraformCost').get('currency', 'USD');
    }

    applyPricingModifiers(cost, attributes) {
        // Apply spot pricing discount if applicable
        const isSpot = this.resolveAttributeValue(attributes.spot) === true ||
                      this.getAttr(attributes, 'market_type') === 'spot' ||
                      this.getAttr(attributes, 'capacity_type') === 'SPOT' ||
                      this.getAttr(attributes, 'priority') === 'Spot' ||
                      this.getAttr(attributes, 'preemptible') === true ||
                      this.getAttr(attributes, 'spot') === true;

        if (isSpot && cost.monthly > 0) {
            cost.monthly *= 0.3; // ~70% discount for spot
            cost.hourly *= 0.3;
            cost.yearly *= 0.3;
            cost.breakdown.push('Spot pricing applied (~70% discount)');
        }

        return cost;
    }

    /**
     * Approximate on-demand list prices (Linux, us-east-1 / us-central1 /
     * eastus), USD. These are fallback estimates for when Infracost isn't
     * available, not a billing source of truth.
     */
    initializeDefaultPricing() {
        const hourly = (h) => ({ hourly: h, monthly: h * HOURS_PER_MONTH });
        return {
            aws: {
                // EC2
                't2.micro': hourly(0.0116),
                't2.small': hourly(0.023),
                't2.medium': hourly(0.0464),
                't2.large': hourly(0.0928),
                't3.nano': hourly(0.0052),
                't3.micro': hourly(0.0104),
                't3.small': hourly(0.0208),
                't3.medium': hourly(0.0416),
                't3.large': hourly(0.0832),
                't3.xlarge': hourly(0.1664),
                't3.2xlarge': hourly(0.3328),
                't3a.micro': hourly(0.0094),
                't3a.small': hourly(0.0188),
                't3a.medium': hourly(0.0376),
                't3a.large': hourly(0.0752),
                't4g.micro': hourly(0.0084),
                't4g.small': hourly(0.0168),
                't4g.medium': hourly(0.0336),
                't4g.large': hourly(0.0672),
                'm5.large': hourly(0.096),
                'm5.xlarge': hourly(0.192),
                'm5.2xlarge': hourly(0.384),
                'm5.4xlarge': hourly(0.768),
                'm6i.large': hourly(0.096),
                'm6i.xlarge': hourly(0.192),
                'm6g.large': hourly(0.077),
                'm6g.xlarge': hourly(0.154),
                'm7g.large': hourly(0.0816),
                'c5.large': hourly(0.085),
                'c5.xlarge': hourly(0.17),
                'c5.2xlarge': hourly(0.34),
                'c6i.large': hourly(0.085),
                'c6g.large': hourly(0.068),
                'r5.large': hourly(0.126),
                'r5.xlarge': hourly(0.252),
                'r6g.large': hourly(0.1008),
                'r6i.large': hourly(0.126),
                // RDS / Aurora / DocumentDB (single-AZ, MySQL/PostgreSQL)
                'db.t3.micro': hourly(0.017),
                'db.t3.small': hourly(0.034),
                'db.t3.medium': hourly(0.068),
                'db.t3.large': hourly(0.136),
                'db.t4g.micro': hourly(0.016),
                'db.t4g.small': hourly(0.032),
                'db.t4g.medium': hourly(0.065),
                'db.m5.large': hourly(0.171),
                'db.m5.xlarge': hourly(0.342),
                'db.m6g.large': hourly(0.152),
                'db.r5.large': hourly(0.25),
                'db.r6g.large': hourly(0.215),
                // ElastiCache
                'cache.t3.micro': hourly(0.017),
                'cache.t3.small': hourly(0.034),
                'cache.t3.medium': hourly(0.068),
                'cache.t4g.micro': hourly(0.016),
                'cache.t4g.small': hourly(0.032),
                'cache.m5.large': hourly(0.156),
                'cache.m6g.large': hourly(0.149),
                'cache.r5.large': hourly(0.216),
                'cache.r6g.large': hourly(0.206),
                // OpenSearch
                't3.small.search': hourly(0.036),
                't3.medium.search': hourly(0.073),
                'm5.large.search': hourly(0.142),
                'r5.large.search': hourly(0.186),
                // Redshift
                'dc2.large': hourly(0.25),
                'ra3.xlplus': hourly(1.086),
                // MSK
                'kafka.t3.small': hourly(0.0456),
                'kafka.m5.large': hourly(0.21),
                // Storage / networking / managed services
                's3_standard': { per_gb_month: 0.023 },
                'ebs_gp2': { per_gb_month: 0.10 },
                'ebs_gp3': { per_gb_month: 0.08 },
                'ebs_io1': { per_gb_month: 0.125 },
                'ebs_io2': { per_gb_month: 0.125 },
                'ebs_st1': { per_gb_month: 0.045 },
                'ebs_sc1': { per_gb_month: 0.015 },
                'ebs_standard': { per_gb_month: 0.05 },
                'rds_storage_gp2': { per_gb_month: 0.115 },
                'efs_standard': { per_gb_month: 0.30 },
                'opensearch_ebs': { per_gb_month: 0.135 },
                'msk_storage': { per_gb_month: 0.10 },
                'ecr_storage': { per_gb_month: 0.10 },
                'cloudwatch_logs_ingest': { per_gb: 0.50 },
                'nat_gateway': hourly(0.045),
                'application_load_balancer': hourly(0.0225),
                'eks_cluster': hourly(0.10),
                'public_ipv4': hourly(0.005),
                'vpc_endpoint_interface': hourly(0.01),
                'vpn_connection': hourly(0.05),
                'lambda': { per_million_requests: 0.20, per_gb_second: 0.0000166667 },
                'dynamodb': { rcu_hourly: 0.00013, wcu_hourly: 0.00065, storage_per_gb_month: 0.25 }
            },
            gcp: {
                'e2-micro': hourly(0.0084),
                'e2-small': hourly(0.0168),
                'e2-medium': hourly(0.0335),
                'e2-standard-2': hourly(0.067),
                'e2-standard-4': hourly(0.134),
                'e2-standard-8': hourly(0.268),
                'e2-highmem-2': hourly(0.0904),
                'n1-standard-1': hourly(0.0475),
                'n1-standard-2': hourly(0.095),
                'n1-standard-4': hourly(0.19),
                'n1-standard-8': hourly(0.38),
                'n2-standard-2': hourly(0.0971),
                'n2-standard-4': hourly(0.1942),
                'n2d-standard-2': hourly(0.0845),
                'c2-standard-4': hourly(0.2088),
                't2d-standard-1': hourly(0.0422),
                // Cloud SQL
                'db-f1-micro': hourly(0.0105),
                'db-g1-small': hourly(0.035),
                'db-n1-standard-1': hourly(0.0965),
                'db-n1-standard-2': hourly(0.193),
                'db-n1-standard-4': hourly(0.386),
                'cloudsql_custom': { vcpu_hourly: 0.0413, gb_ram_hourly: 0.007 },
                'cloudsql_ssd': { per_gb_month: 0.17 },
                // Storage / networking / managed services
                'standard_storage': { per_gb_month: 0.020 },
                'standard_persistent_disk': { per_gb_month: 0.04 },
                'balanced_persistent_disk': { per_gb_month: 0.10 },
                'ssd_persistent_disk': { per_gb_month: 0.17 },
                'gke_cluster': hourly(0.10),
                'memorystore': { basic_gb_hourly: 0.049, standard_gb_hourly: 0.064 },
                'external_ip': hourly(0.005),
                'forwarding_rule': hourly(0.025),
                'cloud_nat': hourly(0.044),
                'vpn_tunnel': hourly(0.05)
            },
            azure: {
                'Standard_B1s': hourly(0.0104),
                'Standard_B1ms': hourly(0.0207),
                'Standard_B2s': hourly(0.0416),
                'Standard_B2ms': hourly(0.0832),
                'Standard_B4ms': hourly(0.166),
                'Standard_D2s_v3': hourly(0.096),
                'Standard_D4s_v3': hourly(0.192),
                'Standard_D8s_v3': hourly(0.384),
                'Standard_D2s_v5': hourly(0.096),
                'Standard_D4s_v5': hourly(0.192),
                'Standard_D2as_v5': hourly(0.086),
                'Standard_E2s_v3': hourly(0.126),
                'Standard_E4s_v3': hourly(0.252),
                'Standard_F2s_v2': hourly(0.0846),
                'Standard_DS2_v2': hourly(0.146),
                'sql_database': {
                    'Basic': { monthly: 4.90 },
                    'S0': { monthly: 14.72 },
                    'S1': { monthly: 29.43 },
                    'S2': { monthly: 73.61 },
                    'S3': { monthly: 147.19 },
                    'Standard': { monthly: 14.72 },
                    'P1': { monthly: 456.25 },
                    'Premium': { monthly: 456.25 },
                    'GP_Gen5_2': { monthly: 0.5044 * HOURS_PER_MONTH },
                    'GP_S_Gen5_1': { monthly: 0.2522 * HOURS_PER_MONTH },
                    'BC_Gen5_2': { monthly: 1.3606 * HOURS_PER_MONTH }
                },
                'flexible_server': {
                    'B_Standard_B1ms': hourly(0.017),
                    'B_Standard_B2s': hourly(0.068),
                    'GP_Standard_D2s_v3': hourly(0.171),
                    'GP_Standard_D2ds_v4': hourly(0.171),
                    'GP_Standard_D4s_v3': hourly(0.342),
                    'MO_Standard_E2ds_v4': hourly(0.228)
                },
                'flexible_server_storage': { per_gb_month: 0.115 },
                'redis': {
                    'Basic_C0': { monthly: 16.06 },
                    'Basic_C1': { monthly: 40.15 },
                    'Standard_C0': { monthly: 40.15 },
                    'Standard_C1': { monthly: 100.74 },
                    'Standard_C2': { monthly: 164.98 },
                    'Premium_P1': { monthly: 404.42 }
                },
                'app_service': {
                    'F1': hourly(0),
                    'Y1': hourly(0),
                    'B1': hourly(0.018),
                    'B2': hourly(0.036),
                    'B3': hourly(0.072),
                    'S1': hourly(0.095),
                    'S2': hourly(0.19),
                    'S3': hourly(0.38),
                    'P1v2': hourly(0.111),
                    'P1v3': hourly(0.155),
                    'P2v3': hourly(0.31),
                    'P3v3': hourly(0.62)
                },
                'container_registry': {
                    'Basic': { monthly: 5.00 },
                    'Standard': { monthly: 20.00 },
                    'Premium': { monthly: 50.00 }
                },
                'vnet_gateway': {
                    'Basic': hourly(0.036),
                    'VpnGw1': hourly(0.19),
                    'VpnGw2': hourly(0.49),
                    'VpnGw3': hourly(1.25)
                },
                'blob_storage_hot': { per_gb_month: 0.0184 },
                'managed_disk_standard': { per_gb_month: 0.045 },
                'managed_disk_premium': { per_gb_month: 0.1536 },
                'aks_standard_tier': hourly(0.10),
                'public_ip_standard': hourly(0.005),
                'public_ip_basic': hourly(0.0036),
                'lb_standard': hourly(0.025),
                'nat_gateway': hourly(0.045)
            }
        };
    }

    getFreeCost(resourceType) {
        return {
            hourly: 0,
            monthly: 0,
            yearly: 0,
            currency: 'USD',
            breakdown: [`${resourceType}: no direct cost`],
            source: 'free'
        };
    }

    getDefaultCost(resourceDescription) {
        return {
            hourly: 0.01,
            monthly: 7.30,
            yearly: 87.60,
            currency: 'USD',
            breakdown: [`${resourceDescription}: Estimated cost (unknown resource type)`],
            source: 'estimated'
        };
    }

    getUnknownProviderCost() {
        return {
            hourly: 0,
            monthly: 0,
            yearly: 0,
            currency: 'USD',
            breakdown: ['Unknown provider - no cost data available'],
            source: 'unknown'
        };
    }

    getErrorCost(errorMessage) {
        return {
            hourly: 0,
            monthly: 0,
            yearly: 0,
            currency: 'USD',
            breakdown: [`Error: ${errorMessage}`],
            source: 'error'
        };
    }

    async calculateTotalCost(resources, filePath = null) {
        let totalMonthly = 0;
        let totalHourly = 0;
        let totalYearly = 0;
        const allBreakdowns = [];
        
        for (const resource of resources) {
            try {
                const cost = await this.calculateResourceCost(resource, filePath);
                if (cost && cost.monthly) {
                    totalMonthly += cost.monthly;
                    totalHourly += cost.hourly || 0;
                    totalYearly += cost.yearly || 0;
                    if (cost.breakdown) {
                        allBreakdowns.push(...cost.breakdown);
                    }
                }
            } catch (error) {
                console.warn(`Failed to calculate cost for resource ${resource.name}:`, error);
            }
        }
        
        return {
            hourly: totalHourly,
            monthly: totalMonthly,
            yearly: totalYearly,
            currency: 'USD',
            breakdown: allBreakdowns,
            resourceCount: resources.length
        };
    }

    clearCache() {
        this.pricingCache.clear();
        this.resourceCostMap.clear();
    }

    dispose() {
        this.clearCache();
        if (this.infracost) {
            this.infracost.dispose();
        }
    }
}

module.exports = TerraformCostCalculator;
module.exports.isFreeResourceType = isFreeResourceType;