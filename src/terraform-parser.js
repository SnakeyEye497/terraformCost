class TerraformParser {
    constructor() {
        this.resourceRegex = /resource\s+"([^"]+)"\s+"([^"]+)"\s*{([^{}]*(?:{[^{}]*}[^{}]*)*)}/gs;
        this.dataRegex = /data\s+"([^"]+)"\s+"([^"]+)"\s*{([^{}]*(?:{[^{}]*}[^{}]*)*)}/gs;
        this.variableRegex = /variable\s+"([^"]+)"\s*{([^{}]*(?:{[^{}]*}[^{}]*)*)}/gs;
    }

    async parse(terraformCode) {
        try {
            const resources = this.extractResources(terraformCode);
            const dataBlocks = this.extractDataBlocks(terraformCode);
            const variables = this.extractVariables(terraformCode);

            return {
                resources,
                dataBlocks,
                variables
            };
        } catch (error) {
            console.error('Error parsing Terraform code:', error);
            throw new Error(`Terraform parsing failed: ${error.message}`);
        }
    }

    extractResources(code) {
        const resources = [];
        let match;

        this.resourceRegex.lastIndex = 0;
        while ((match = this.resourceRegex.exec(code)) !== null) {
            const [, resourceType, resourceName, resourceBody] = match;
            const lineNumber = this.getLineNumber(code, match.index);
            
            const resource = {
                type: resourceType,
                name: resourceName,
                body: resourceBody.trim(),
                line: lineNumber,
                attributes: this.parseAttributes(resourceBody),
                provider: this.getProviderFromResourceType(resourceType)
            };

            resources.push(resource);
        }

        return resources;
    }

    extractDataBlocks(code) {
        const dataBlocks = [];
        let match;

        this.dataRegex.lastIndex = 0;
        while ((match = this.dataRegex.exec(code)) !== null) {
            const [, dataType, dataName, dataBody] = match;
            const lineNumber = this.getLineNumber(code, match.index);

            const dataBlock = {
                type: dataType,
                name: dataName,
                body: dataBody.trim(),
                line: lineNumber,
                attributes: this.parseAttributes(dataBody),
                provider: this.getProviderFromResourceType(dataType)
            };

            dataBlocks.push(dataBlock);
        }

        return dataBlocks;
    }

    extractVariables(code) {
        const variables = [];
        let match;

        this.variableRegex.lastIndex = 0;
        while ((match = this.variableRegex.exec(code)) !== null) {
            const [, variableName, variableBody] = match;
            const lineNumber = this.getLineNumber(code, match.index);

            const variable = {
                name: variableName,
                body: variableBody.trim(),
                line: lineNumber,
                attributes: this.parseAttributes(variableBody)
            };

            variables.push(variable);
        }

        return variables;
    }

    parseAttributes(body) {
        const attributes = {};
        
        // Simple attribute parsing - this could be enhanced with a proper HCL parser
        const attributeRegex = /(\w+)\s*=\s*([^#\n]*?)(?:\s*#.*)?$/gm;
        let match;

        while ((match = attributeRegex.exec(body)) !== null) {
            const [, key, value] = match;
            attributes[key.trim()] = this.parseValue(value.trim());
        }

        return attributes;
    }

    parseValue(value) {
        // Remove quotes and trim
        value = value.trim();
        
        if (value.startsWith('"') && value.endsWith('"')) {
            return value.slice(1, -1);
        }
        
        if (value.startsWith('[') && value.endsWith(']')) {
            // Simple array parsing
            const arrayContent = value.slice(1, -1);
            return arrayContent.split(',').map(item => this.parseValue(item.trim()));
        }
        
        if (value.startsWith('{') && value.endsWith('}')) {
            // Simple object parsing
            return value;
        }
        
        // Check if it's a number
        if (!isNaN(value) && !isNaN(parseFloat(value))) {
            return parseFloat(value);
        }
        
        // Check if it's a boolean
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        return value;
    }

    getProviderFromResourceType(resourceType) {
        if (resourceType.startsWith('aws_')) return 'aws';
        if (resourceType.startsWith('google_') || resourceType.startsWith('gcp_')) return 'gcp';
        if (resourceType.startsWith('azurerm_') || resourceType.startsWith('azure_')) return 'azure';
        
        // Handle some common patterns
        if (resourceType.includes('ec2') || resourceType.includes('s3') || resourceType.includes('rds')) return 'aws';
        if (resourceType.includes('compute') || resourceType.includes('storage') && !resourceType.includes('azure')) return 'gcp';
        
        return 'unknown';
    }

    getLineNumber(text, index) {
        const beforeIndex = text.substring(0, index);
        return beforeIndex.split('\n').length;
    }

    isResourceCostRelevant(resourceType) {
        const costRelevantTypes = [
            // AWS
            'aws_instance', 'aws_db_instance', 'aws_s3_bucket', 'aws_ebs_volume',
            'aws_elb', 'aws_alb', 'aws_nlb', 'aws_nat_gateway', 'aws_vpc_endpoint',
            'aws_lambda_function', 'aws_ecs_service', 'aws_ecs_cluster',
            'aws_rds_cluster', 'aws_elasticache_cluster', 'aws_elasticsearch_domain',
            
            // GCP
            'google_compute_instance', 'google_sql_database_instance', 'google_storage_bucket',
            'google_compute_disk', 'google_compute_forwarding_rule', 'google_compute_address',
            'google_cloudfunctions_function', 'google_container_cluster', 'google_redis_instance',
            
            // Azure
            'azurerm_virtual_machine', 'azurerm_sql_database', 'azurerm_storage_account',
            'azurerm_managed_disk', 'azurerm_public_ip', 'azurerm_load_balancer',
            'azurerm_function_app', 'azurerm_kubernetes_cluster', 'azurerm_redis_cache'
        ];

        return costRelevantTypes.includes(resourceType);
    }

    extractRegionFromProvider(code) {
        const regions = {
            aws: 'us-east-1',
            gcp: 'us-central1',
            azure: 'East US'
        };

        // Try to extract region from provider blocks
        const providerRegex = /provider\s+"(\w+)"\s*{([^{}]*(?:{[^{}]*}[^{}]*)*)}/gs;
        let match;

        while ((match = providerRegex.exec(code)) !== null) {
            const [, providerName, providerBody] = match;
            const attributes = this.parseAttributes(providerBody);
            
            if (providerName === 'aws' && attributes.region) {
                regions.aws = attributes.region;
            } else if (providerName === 'google' && attributes.region) {
                regions.gcp = attributes.region;
            } else if (providerName === 'azurerm' && attributes.location) {
                regions.azure = attributes.location;
            }
        }

        return regions;
    }
}

module.exports = TerraformParser;