const vscode = require('vscode');
const InfracostIntegration = require('./infracost-integration');

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
                    const infracostResource = this.findMatchingResource(infracostData.resources, resource);
                    
                    if (infracostResource && infracostResource.cost) {
                        // Cache the mapping
                        this.resourceCostMap.set(this.getResourceKey(resource), infracostResource.cost);
                        return infracostResource.cost;
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

    findMatchingResource(infracostResources, tfResource) {
        // Try exact match first
        const exactMatch = infracostResources.find(r => 
            r.type === tfResource.type && 
            r.name === tfResource.name
        );
        
        if (exactMatch) return exactMatch;

        // Try partial match on name
        const nameMatch = infracostResources.find(r => 
            r.type === tfResource.type && 
            (r.name.includes(tfResource.name) || tfResource.name.includes(r.name))
        );
        
        if (nameMatch) return nameMatch;

        // Try type-only match (take first of same type)
        const typeMatch = infracostResources.find(r => r.type === tfResource.type);
        
        return typeMatch || null;
    }

    getResourceKey(resource) {
        return `${resource.provider}:${resource.type}:${resource.name}`;
    }

    async calculateResourceCostFallback(resource) {
        const provider = resource.provider;
        const resourceType = resource.type;
        const attributes = resource.attributes;
        const region = this.getRegionForResource(resource);
        
        let cost = {
            hourly: 0,
            monthly: 0,
            yearly: 0,
            currency: this.getCurrency(),
            breakdown: [],
            source: 'fallback'
        };

        switch (provider) {
            case 'aws':
                cost = await this.calculateAWSCost(resourceType, attributes, region);
                break;
            case 'gcp':
                cost = await this.calculateGCPCost(resourceType, attributes, region);
                break;
            case 'azure':
                cost = await this.calculateAzureCost(resourceType, attributes, region);
                break;
            default:
                cost = this.getUnknownProviderCost();
        }

        cost = this.applyPricingModifiers(cost, attributes);
        return cost;
    }

    async calculateAWSCost(resourceType, attributes, region) {
        let cost = { hourly: 0, monthly: 0, yearly: 0, currency: 'USD', breakdown: [] };

        switch (resourceType) {
            case 'aws_instance':
                cost = this.calculateEC2Cost(attributes);
                break;
            case 'aws_db_instance':
                cost = this.calculateRDSCost(attributes);
                break;
            case 'aws_s3_bucket':
                cost = this.calculateS3Cost(attributes);
                break;
            case 'aws_ebs_volume':
                cost = this.calculateEBSCost(attributes);
                break;
            case 'aws_nat_gateway':
                cost = this.calculateNATGatewayCost();
                break;
            case 'aws_lb':
            case 'aws_alb':
            case 'aws_nlb':
                cost = this.calculateLoadBalancerCost(resourceType);
                break;
            case 'aws_eks_cluster':
                cost = this.calculateEKSCost(attributes);
                break;
            case 'aws_rds_cluster':
                cost = this.calculateRDSClusterCost(attributes);
                break;
            case 'aws_elasticache_cluster':
                cost = this.calculateElastiCacheCost(attributes);
                break;
            default:
                cost = this.getDefaultCost(`AWS ${resourceType}`);
        }

        return cost;
    }

    async calculateGCPCost(resourceType, attributes, region) {
        let cost = { hourly: 0, monthly: 0, yearly: 0, currency: 'USD', breakdown: [] };

        switch (resourceType) {
            case 'google_compute_instance':
                cost = this.calculateGCECost(attributes);
                break;
            case 'google_sql_database_instance':
                cost = this.calculateCloudSQLCost(attributes);
                break;
            case 'google_storage_bucket':
                cost = this.calculateCloudStorageCost(attributes);
                break;
            case 'google_compute_disk':
                cost = this.calculateComputeDiskCost(attributes);
                break;
            case 'google_container_cluster':
                cost = this.calculateGKECost(attributes);
                break;
            default:
                cost = this.getDefaultCost(`GCP ${resourceType}`);
        }

        return cost;
    }

    async calculateAzureCost(resourceType, attributes, region) {
        let cost = { hourly: 0, monthly: 0, yearly: 0, currency: 'USD', breakdown: [] };

        switch (resourceType) {
            case 'azurerm_virtual_machine':
            case 'azurerm_linux_virtual_machine':
            case 'azurerm_windows_virtual_machine':
                cost = this.calculateVMCost(attributes);
                break;
            case 'azurerm_sql_database':
                cost = this.calculateSQLDatabaseCost(attributes);
                break;
            case 'azurerm_storage_account':
                cost = this.calculateStorageAccountCost(attributes);
                break;
            case 'azurerm_managed_disk':
                cost = this.calculateManagedDiskCost(attributes);
                break;
            case 'azurerm_kubernetes_cluster':
                cost = this.calculateAKSCost(attributes);
                break;
            default:
                cost = this.getDefaultCost(`Azure ${resourceType}`);
        }

        return cost;
    }

    // AWS Resource Calculations
    calculateEC2Cost(attributes) {
        const instanceType = this.resolveAttributeValue(attributes.instance_type) || 't2.micro';
        const pricing = this.defaultPricing.aws[instanceType] || this.defaultPricing.aws['t2.micro'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`EC2 ${instanceType}: ${pricing.monthly}/month`]
        };
    }

    calculateRDSCost(attributes) {
        const instanceClass = this.resolveAttributeValue(attributes.instance_class) || 'db.t3.micro';
        const multiAz = this.resolveAttributeValue(attributes.multi_az) === true;
        
        let pricing = this.defaultPricing.aws[instanceClass] || this.defaultPricing.aws['db.t3.micro'];
        let monthlyCost = pricing.monthly;
        
        if (multiAz) {
            monthlyCost *= 2;
        }
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [
                `RDS ${instanceClass}: ${pricing.monthly}/month`,
                multiAz ? `Multi-AZ enabled: +${pricing.monthly}/month` : null
            ].filter(Boolean)
        };
    }

    calculateS3Cost(attributes) {
        const estimatedGB = 100;
        const pricing = this.defaultPricing.aws.s3_standard;
        const monthlyCost = estimatedGB * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`S3 Storage (est. ${estimatedGB}GB): ${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateEBSCost(attributes) {
        const size = this.resolveAttributeValue(attributes.size) || 8;
        const volumeType = this.resolveAttributeValue(attributes.type) || 'gp2';
        const pricingKey = volumeType === 'gp3' ? 'ebs_gp3' : 'ebs_gp2';
        const pricing = this.defaultPricing.aws[pricingKey];
        const monthlyCost = size * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`EBS ${volumeType} ${size}GB: ${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateNATGatewayCost() {
        const pricing = this.defaultPricing.aws.nat_gateway;
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`NAT Gateway: ${pricing.monthly}/month`]
        };
    }

    calculateLoadBalancerCost(resourceType) {
        const pricing = this.defaultPricing.aws.application_load_balancer;
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`Load Balancer: ${pricing.monthly}/month`]
        };
    }

    calculateEKSCost(attributes) {
        const clusterCost = 73; // $0.10/hour
        return {
            hourly: 0.10,
            monthly: clusterCost,
            yearly: clusterCost * 12,
            currency: 'USD',
            breakdown: [`EKS Cluster: ${clusterCost}/month`]
        };
    }

    calculateRDSClusterCost(attributes) {
        const instanceCount = this.resolveAttributeValue(attributes.cluster_instances) || 2;
        const instanceClass = this.resolveAttributeValue(attributes.instance_class) || 'db.t3.medium';
        const pricing = this.defaultPricing.aws[instanceClass] || this.defaultPricing.aws['db.t3.micro'];
        const totalCost = pricing.monthly * instanceCount;
        
        return {
            hourly: pricing.hourly * instanceCount,
            monthly: totalCost,
            yearly: totalCost * 12,
            currency: 'USD',
            breakdown: [`RDS Cluster (${instanceCount}x ${instanceClass}): ${totalCost}/month`]
        };
    }

    calculateElastiCacheCost(attributes) {
        const nodeType = this.resolveAttributeValue(attributes.node_type) || 'cache.t3.micro';
        const numNodes = this.resolveAttributeValue(attributes.num_cache_nodes) || 1;
        const baseCost = 12.41; // Approximate for cache.t3.micro
        const totalCost = baseCost * numNodes;
        
        return {
            hourly: totalCost / 730,
            monthly: totalCost,
            yearly: totalCost * 12,
            currency: 'USD',
            breakdown: [`ElastiCache (${numNodes}x ${nodeType}): ${totalCost.toFixed(2)}/month`]
        };
    }

    // GCP Resource Calculations
    calculateGCECost(attributes) {
        const machineType = this.resolveAttributeValue(attributes.machine_type) || 'e2-micro';
        const pricing = this.defaultPricing.gcp[machineType] || this.defaultPricing.gcp['e2-micro'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`GCE ${machineType}: ${pricing.monthly}/month`]
        };
    }

    calculateCloudSQLCost(attributes) {
        const tier = this.resolveAttributeValue(attributes.tier) || 'db-n1-standard-1';
        const pricing = this.defaultPricing.gcp[tier] || this.defaultPricing.gcp['db-n1-standard-1'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`Cloud SQL ${tier}: ${pricing.monthly}/month`]
        };
    }

    calculateCloudStorageCost(attributes) {
        const estimatedGB = 100;
        const pricing = this.defaultPricing.gcp.standard_storage;
        const monthlyCost = estimatedGB * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Cloud Storage (est. ${estimatedGB}GB): ${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateComputeDiskCost(attributes) {
        const size = this.resolveAttributeValue(attributes.size) || 10;
        const diskType = this.resolveAttributeValue(attributes.type) || 'pd-standard';
        const pricingKey = diskType.includes('ssd') ? 'ssd_persistent_disk' : 'standard_storage';
        const pricing = this.defaultPricing.gcp[pricingKey];
        const monthlyCost = size * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Compute Disk ${diskType} ${size}GB: ${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateGKECost(attributes) {
        const clusterCost = 73; // Similar to EKS
        return {
            hourly: 0.10,
            monthly: clusterCost,
            yearly: clusterCost * 12,
            currency: 'USD',
            breakdown: [`GKE Cluster: ${clusterCost}/month`]
        };
    }

    // Azure Resource Calculations
    calculateVMCost(attributes) {
        const vmSize = this.resolveAttributeValue(attributes.vm_size) || 
                      this.resolveAttributeValue(attributes.size) || 
                      'Standard_B1s';
        const pricing = this.defaultPricing.azure[vmSize] || this.defaultPricing.azure['Standard_B1s'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`VM ${vmSize}: ${pricing.monthly}/month`]
        };
    }

    calculateSQLDatabaseCost(attributes) {
        const sku = this.resolveAttributeValue(attributes.sku_name) || 'Basic';
        const pricing = this.defaultPricing.azure[sku] || this.defaultPricing.azure['Basic'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`SQL Database ${sku}: ${pricing.monthly}/month`]
        };
    }

    calculateStorageAccountCost(attributes) {
        const estimatedGB = 100;
        const pricing = this.defaultPricing.azure.blob_storage_hot;
        const monthlyCost = estimatedGB * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Storage Account (est. ${estimatedGB}GB): ${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateManagedDiskCost(attributes) {
        const size = this.resolveAttributeValue(attributes.disk_size_gb) || 30;
        const storageType = this.resolveAttributeValue(attributes.storage_account_type) || 'Standard_LRS';
        const pricingKey = storageType.includes('Premium') ? 'managed_disk_premium' : 'managed_disk_standard';
        const pricing = this.defaultPricing.azure[pricingKey];
        const monthlyCost = size * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / 730,
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Managed Disk ${storageType} ${size}GB: ${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateAKSCost(attributes) {
        const clusterCost = 73;
        return {
            hourly: 0.10,
            monthly: clusterCost,
            yearly: clusterCost * 12,
            currency: 'USD',
            breakdown: [`AKS Cluster: ${clusterCost}/month`]
        };
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
                      this.resolveAttributeValue(attributes.instance_market_options?.market_type) === 'spot';
        
        if (isSpot) {
            cost.monthly *= 0.3; // ~70% discount for spot
            cost.hourly *= 0.3;
            cost.yearly *= 0.3;
            cost.breakdown.push('Spot pricing applied (~70% discount)');
        }
        
        return cost;
    }

    initializeDefaultPricing() {
        return {
            aws: {
                't2.micro': { hourly: 0.0116, monthly: 8.468 },
                't2.small': { hourly: 0.023, monthly: 16.79 },
                't2.medium': { hourly: 0.0464, monthly: 33.87 },
                't3.micro': { hourly: 0.0104, monthly: 7.592 },
                't3.small': { hourly: 0.0208, monthly: 15.184 },
                't3.medium': { hourly: 0.0416, monthly: 30.368 },
                't3.large': { hourly: 0.0832, monthly: 60.736 },
                'm5.large': { hourly: 0.096, monthly: 70.08 },
                'm5.xlarge': { hourly: 0.192, monthly: 140.16 },
                'db.t3.micro': { hourly: 0.017, monthly: 12.41 },
                'db.t3.small': { hourly: 0.034, monthly: 24.82 },
                'db.t3.medium': { hourly: 0.068, monthly: 49.64 },
                's3_standard': { per_gb_month: 0.023 },
                'ebs_gp2': { per_gb_month: 0.10 },
                'ebs_gp3': { per_gb_month: 0.08 },
                'nat_gateway': { hourly: 0.045, monthly: 32.85 },
                'application_load_balancer': { hourly: 0.0225, monthly: 16.425 }
            },
            gcp: {
                'e2-micro': { hourly: 0.0063, monthly: 4.599 },
                'e2-small': { hourly: 0.0126, monthly: 9.198 },
                'e2-medium': { hourly: 0.0252, monthly: 18.396 },
                'n1-standard-1': { hourly: 0.0475, monthly: 34.675 },
                'n1-standard-2': { hourly: 0.095, monthly: 69.35 },
                'n1-standard-4': { hourly: 0.19, monthly: 138.70 },
                'db-n1-standard-1': { hourly: 0.0825, monthly: 60.225 },
                'standard_storage': { per_gb_month: 0.020 },
                'ssd_persistent_disk': { per_gb_month: 0.17 }
            },
            azure: {
                'Standard_B1s': { hourly: 0.0104, monthly: 7.592 },
                'Standard_B1ms': { hourly: 0.0208, monthly: 15.184 },
                'Standard_B2s': { hourly: 0.0416, monthly: 30.368 },
                'Standard_D2s_v3': { hourly: 0.096, monthly: 70.08 },
                'Standard_D4s_v3': { hourly: 0.192, monthly: 140.16 },
                'Basic': { hourly: 0.0165, monthly: 12.045 },
                'Standard': { hourly: 0.0275, monthly: 20.075 },
                'blob_storage_hot': { per_gb_month: 0.0184 },
                'managed_disk_standard': { per_gb_month: 0.045 },
                'managed_disk_premium': { per_gb_month: 0.1536 }
            }
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