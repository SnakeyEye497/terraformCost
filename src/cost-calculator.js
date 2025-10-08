const vscode = require('vscode');

class TerraformCostCalculator {
    constructor() {
        this.pricingCache = new Map();
        this.cacheExpiry = 60 * 60 * 1000; // 1 hour
        
        // Default pricing data (simplified) - in a real implementation, you'd use cloud provider APIs
        this.defaultPricing = this.initializeDefaultPricing();
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
                'db.t3.micro': { hourly: 0.017, monthly: 12.41 },
                'db.t3.small': { hourly: 0.034, monthly: 24.82 },
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
                'db-n1-standard-1': { hourly: 0.0825, monthly: 60.225 },
                'standard_storage': { per_gb_month: 0.020 },
                'ssd_persistent_disk': { per_gb_month: 0.17 },
                'cloud_nat': { hourly: 0.045, monthly: 32.85 }
            },
            azure: {
                'Standard_B1s': { hourly: 0.0104, monthly: 7.592 },
                'Standard_B1ms': { hourly: 0.0208, monthly: 15.184 },
                'Standard_B2s': { hourly: 0.0416, monthly: 30.368 },
                'Standard_D2s_v3': { hourly: 0.096, monthly: 70.08 },
                'Basic': { hourly: 0.0165, monthly: 12.045 },
                'Standard': { hourly: 0.0275, monthly: 20.075 },
                'blob_storage_hot': { per_gb_month: 0.0184 },
                'managed_disk_standard': { per_gb_month: 0.045 },
                'managed_disk_premium': { per_gb_month: 0.1536 }
            }
        };
    }

    async calculateResourceCost(resource) {
        try {
            const provider = resource.provider;
            const resourceType = resource.type;
            const attributes = resource.attributes;

            // Get region-specific pricing if available
            const region = this.getRegionForResource(resource);
            
            let cost = {
                hourly: 0,
                monthly: 0,
                yearly: 0,
                currency: this.getCurrency(),
                breakdown: []
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

            // Apply any discounts or reserved instance pricing
            cost = this.applyPricingModifiers(cost, attributes);

            return cost;
        } catch (error) {
            console.error('Error calculating resource cost:', error);
            return this.getErrorCost(error.message);
        }
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
            default:
                cost = this.getDefaultCost(`GCP ${resourceType}`);
        }

        return cost;
    }

    async calculateAzureCost(resourceType, attributes, region) {
        let cost = { hourly: 0, monthly: 0, yearly: 0, currency: 'USD', breakdown: [] };

        switch (resourceType) {
            case 'azurerm_virtual_machine':
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
            default:
                cost = this.getDefaultCost(`Azure ${resourceType}`);
        }

        return cost;
    }

    calculateEC2Cost(attributes) {
        const instanceType = attributes.instance_type || 't2.micro';
        const pricing = this.defaultPricing.aws[instanceType] || this.defaultPricing.aws['t2.micro'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`EC2 ${instanceType}: $${pricing.monthly}/month`]
        };
    }

    calculateRDSCost(attributes) {
        const instanceClass = attributes.instance_class || 'db.t3.micro';
        const pricing = this.defaultPricing.aws[instanceClass] || this.defaultPricing.aws['db.t3.micro'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`RDS ${instanceClass}: $${pricing.monthly}/month`]
        };
    }

    calculateS3Cost(attributes) {
        // Estimated storage cost (assuming some default usage)
        const estimatedGB = 100; // Default assumption
        const pricing = this.defaultPricing.aws.s3_standard;
        const monthlyCost = estimatedGB * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / (30 * 24),
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`S3 Storage (est. ${estimatedGB}GB): $${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateEBSCost(attributes) {
        const size = attributes.size || 8; // Default 8GB
        const volumeType = attributes.type || 'gp2';
        const pricingKey = volumeType === 'gp3' ? 'ebs_gp3' : 'ebs_gp2';
        const pricing = this.defaultPricing.aws[pricingKey];
        const monthlyCost = size * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / (30 * 24),
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`EBS ${volumeType} ${size}GB: $${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateNATGatewayCost() {
        const pricing = this.defaultPricing.aws.nat_gateway;
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`NAT Gateway: $${pricing.monthly}/month`]
        };
    }

    calculateLoadBalancerCost(resourceType) {
        const pricing = this.defaultPricing.aws.application_load_balancer;
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`Load Balancer: $${pricing.monthly}/month`]
        };
    }

    calculateGCECost(attributes) {
        const machineType = attributes.machine_type || 'e2-micro';
        const pricing = this.defaultPricing.gcp[machineType] || this.defaultPricing.gcp['e2-micro'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`GCE ${machineType}: $${pricing.monthly}/month`]
        };
    }

    calculateCloudSQLCost(attributes) {
        const tier = attributes.tier || 'db-n1-standard-1';
        const pricing = this.defaultPricing.gcp[tier] || this.defaultPricing.gcp['db-n1-standard-1'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`Cloud SQL ${tier}: $${pricing.monthly}/month`]
        };
    }

    calculateVMCost(attributes) {
        const vmSize = attributes.vm_size || 'Standard_B1s';
        const pricing = this.defaultPricing.azure[vmSize] || this.defaultPricing.azure['Standard_B1s'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`VM ${vmSize}: $${pricing.monthly}/month`]
        };
    }

    calculateSQLDatabaseCost(attributes) {
        const sku = attributes.sku_name || 'Basic';
        const pricing = this.defaultPricing.azure[sku] || this.defaultPricing.azure['Basic'];
        
        return {
            hourly: pricing.hourly,
            monthly: pricing.monthly,
            yearly: pricing.monthly * 12,
            currency: 'USD',
            breakdown: [`SQL Database ${sku}: $${pricing.monthly}/month`]
        };
    }

    getRegionForResource(resource) {
        const config = vscode.workspace.getConfiguration('terraformCost');
        const defaultRegions = config.get('region', {
            aws: 'us-east-1',
            gcp: 'us-central1',
            azure: 'East US'
        });
        
        return defaultRegions[resource.provider] || 'us-east-1';
    }

    getCurrency() {
        return vscode.workspace.getConfiguration('terraformCost').get('currency', 'USD');
    }

    applyPricingModifiers(cost, attributes) {
        // Apply reserved instance discounts, spot pricing, etc.
        // This is a simplified implementation
        return cost;
    }

    getDefaultCost(resourceDescription) {
        return {
            hourly: 0.01,
            monthly: 7.30,
            yearly: 87.60,
            currency: 'USD',
            breakdown: [`${resourceDescription}: Estimated cost`]
        };
    }

    getUnknownProviderCost() {
        return {
            hourly: 0,
            monthly: 0,
            yearly: 0,
            currency: 'USD',
            breakdown: ['Unknown provider - no cost data available']
        };
    }

    getErrorCost(errorMessage) {
        return {
            hourly: 0,
            monthly: 0,
            yearly: 0,
            currency: 'USD',
            breakdown: [`Error calculating cost: ${errorMessage}`]
        };
    }

    // Storage and other resource calculations...
    calculateCloudStorageCost(attributes) {
        const estimatedGB = 100;
        const pricing = this.defaultPricing.gcp.standard_storage;
        const monthlyCost = estimatedGB * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / (30 * 24),
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Cloud Storage (est. ${estimatedGB}GB): $${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateComputeDiskCost(attributes) {
        const size = attributes.size || 10;
        const diskType = attributes.type || 'pd-standard';
        const pricingKey = diskType.includes('ssd') ? 'ssd_persistent_disk' : 'standard_storage';
        const pricing = this.defaultPricing.gcp[pricingKey] || this.defaultPricing.gcp.standard_storage;
        const monthlyCost = size * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / (30 * 24),
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Compute Disk ${diskType} ${size}GB: $${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateStorageAccountCost(attributes) {
        const estimatedGB = 100;
        const tier = attributes.access_tier || 'Hot';
        const pricingKey = tier.toLowerCase() === 'hot' ? 'blob_storage_hot' : 'blob_storage_hot';
        const pricing = this.defaultPricing.azure[pricingKey];
        const monthlyCost = estimatedGB * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / (30 * 24),
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Storage Account ${tier} (est. ${estimatedGB}GB): $${monthlyCost.toFixed(2)}/month`]
        };
    }

    calculateManagedDiskCost(attributes) {
        const size = attributes.disk_size_gb || 30;
        const storageType = attributes.storage_account_type || 'Standard_LRS';
        const pricingKey = storageType.includes('Premium') ? 'managed_disk_premium' : 'managed_disk_standard';
        const pricing = this.defaultPricing.azure[pricingKey];
        const monthlyCost = size * pricing.per_gb_month;
        
        return {
            hourly: monthlyCost / (30 * 24),
            monthly: monthlyCost,
            yearly: monthlyCost * 12,
            currency: 'USD',
            breakdown: [`Managed Disk ${storageType} ${size}GB: $${monthlyCost.toFixed(2)}/month`]
        };
    }

    async calculateTotalCost(resources) {
        let totalMonthly = 0;
        let totalHourly = 0;
        let totalYearly = 0;
        let allBreakdowns = [];
        
        for (const resource of resources) {
            try {
                const cost = await this.calculateResourceCost(resource);
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
}

module.exports = TerraformCostCalculator;