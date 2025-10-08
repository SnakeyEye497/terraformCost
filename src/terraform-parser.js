class TerraformParser {
    constructor() {
        // Improved regex patterns to handle nested blocks
        this.resourceRegex = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
        this.blockEndRegex = /\}/g;
    }

    async parse(terraformCode) {
        try {
            const resources = this.extractResources(terraformCode);
            const dataBlocks = this.extractDataBlocks(terraformCode);
            const variables = this.extractVariables(terraformCode);
            const modules = this.extractModules(terraformCode);

            return {
                resources,
                dataBlocks,
                variables,
                modules
            };
        } catch (error) {
            console.error('Error parsing Terraform code:', error);
            throw new Error(`Terraform parsing failed: ${error.message}`);
        }
    }

    extractResources(code) {
        const resources = [];
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const resourceMatch = line.match(/resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/);
            
            if (resourceMatch) {
                const [, resourceType, resourceName] = resourceMatch;
                const startLine = i + 1; // Line number (1-indexed)
                
                // Find the matching closing brace
                const blockContent = this.extractBlock(lines, i);
                const endLine = i + blockContent.lineCount;
                
                const resource = {
                    type: resourceType,
                    name: resourceName,
                    body: blockContent.content,
                    line: startLine,
                    endLine: endLine,
                    attributes: this.parseAttributes(blockContent.content),
                    provider: this.getProviderFromResourceType(resourceType),
                    nestedBlocks: this.extractNestedBlocks(blockContent.content)
                };

                resources.push(resource);
                i = endLine - 1; // Skip to end of block
            }
        }

        return resources;
    }

    extractBlock(lines, startIndex) {
        let braceCount = 0;
        let content = '';
        let lineCount = 0;
        let started = false;

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i];
            
            // Count braces
            for (const char of line) {
                if (char === '{') {
                    braceCount++;
                    started = true;
                } else if (char === '}') {
                    braceCount--;
                }
            }

            if (started) {
                content += line + '\n';
                lineCount++;
            }

            // Found matching closing brace
            if (started && braceCount === 0) {
                break;
            }
        }

        return { content: content.trim(), lineCount };
    }

    extractNestedBlocks(content) {
        const nestedBlocks = {};
        const blockPatterns = [
            'lifecycle',
            'timeouts',
            'ebs_block_device',
            'root_block_device',
            'network_interface',
            'tags',
            'metadata',
            'boot_disk',
            'network',
            'settings'
        ];

        for (const blockType of blockPatterns) {
            const regex = new RegExp(`${blockType}\\s*\\{([^}]+)\\}`, 'gs');
            const matches = [...content.matchAll(regex)];
            
            if (matches.length > 0) {
                nestedBlocks[blockType] = matches.map(m => 
                    this.parseAttributes(m[1])
                );
            }
        }

        return nestedBlocks;
    }

    extractDataBlocks(code) {
        const dataBlocks = [];
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const dataMatch = line.match(/data\s+"([^"]+)"\s+"([^"]+)"\s*\{/);
            
            if (dataMatch) {
                const [, dataType, dataName] = dataMatch;
                const startLine = i + 1;
                const blockContent = this.extractBlock(lines, i);

                const dataBlock = {
                    type: dataType,
                    name: dataName,
                    body: blockContent.content,
                    line: startLine,
                    attributes: this.parseAttributes(blockContent.content),
                    provider: this.getProviderFromResourceType(dataType)
                };

                dataBlocks.push(dataBlock);
                i += blockContent.lineCount - 1;
            }
        }

        return dataBlocks;
    }

    extractVariables(code) {
        const variables = [];
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const varMatch = line.match(/variable\s+"([^"]+)"\s*\{/);
            
            if (varMatch) {
                const [, variableName] = varMatch;
                const startLine = i + 1;
                const blockContent = this.extractBlock(lines, i);

                const variable = {
                    name: variableName,
                    body: blockContent.content,
                    line: startLine,
                    attributes: this.parseAttributes(blockContent.content)
                };

                variables.push(variable);
                i += blockContent.lineCount - 1;
            }
        }

        return variables;
    }

    extractModules(code) {
        const modules = [];
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const moduleMatch = line.match(/module\s+"([^"]+)"\s*\{/);
            
            if (moduleMatch) {
                const [, moduleName] = moduleMatch;
                const startLine = i + 1;
                const blockContent = this.extractBlock(lines, i);

                const module = {
                    name: moduleName,
                    body: blockContent.content,
                    line: startLine,
                    attributes: this.parseAttributes(blockContent.content)
                };

                modules.push(module);
                i += blockContent.lineCount - 1;
            }
        }

        return modules;
    }

    parseAttributes(body) {
        const attributes = {};
        const lines = body.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
                continue;
            }

            // Match key = value pattern (handles various formats)
            const match = trimmed.match(/^(\w+)\s*=\s*(.+?)(?:\s*#.*)?$/);
            
            if (match) {
                const [, key, value] = match;
                attributes[key] = this.parseValue(value.trim());
            }
        }

        return attributes;
    }

    parseValue(value) {
        // Remove trailing commas
        value = value.replace(/,\s*$/, '').trim();
        
        // String with quotes
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
            return value.slice(1, -1);
        }
        
        // Array
        if (value.startsWith('[') && value.endsWith(']')) {
            const arrayContent = value.slice(1, -1).trim();
            if (!arrayContent) return [];
            
            // Split by comma, but respect nested structures
            const items = this.splitByComma(arrayContent);
            return items.map(item => this.parseValue(item.trim()));
        }
        
        // Object/Map
        if (value.startsWith('{') && value.endsWith('}')) {
            const objContent = value.slice(1, -1).trim();
            if (!objContent) return {};
            
            const obj = {};
            const pairs = this.splitByComma(objContent);
            
            for (const pair of pairs) {
                const eqIndex = pair.indexOf('=');
                if (eqIndex > -1) {
                    const k = pair.substring(0, eqIndex).trim().replace(/['"]/g, '');
                    const v = pair.substring(eqIndex + 1).trim();
                    obj[k] = this.parseValue(v);
                }
            }
            return obj;
        }
        
        // Number
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            return parseFloat(value);
        }
        
        // Boolean
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        
        // Variable reference
        if (value.startsWith('var.')) {
            return { _ref: 'variable', name: value.substring(4) };
        }
        
        // Data source reference
        if (value.startsWith('data.')) {
            return { _ref: 'data', path: value.substring(5) };
        }
        
        // Resource reference
        if (/^[a-z_]+\.[a-z_]+/.test(value)) {
            return { _ref: 'resource', path: value };
        }
        
        // Function call (simplified)
        if (value.includes('(') && value.includes(')')) {
            return { _function: value };
        }
        
        // Default: return as string
        return value;
    }

    splitByComma(str) {
        const items = [];
        let current = '';
        let depth = 0;
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            
            if ((char === '"' || char === "'") && str[i-1] !== '\\') {
                if (!inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === quoteChar) {
                    inQuotes = false;
                }
            }

            if (!inQuotes) {
                if (char === '[' || char === '{') depth++;
                if (char === ']' || char === '}') depth--;
                
                if (char === ',' && depth === 0) {
                    items.push(current.trim());
                    current = '';
                    continue;
                }
            }

            current += char;
        }

        if (current.trim()) {
            items.push(current.trim());
        }

        return items;
    }

    getProviderFromResourceType(resourceType) {
        // AWS
        if (resourceType.startsWith('aws_')) return 'aws';
        
        // GCP
        if (resourceType.startsWith('google_') || 
            resourceType.startsWith('gcp_')) return 'gcp';
        
        // Azure
        if (resourceType.startsWith('azurerm_') || 
            resourceType.startsWith('azure_')) return 'azure';
        
        // Alibaba Cloud
        if (resourceType.startsWith('alicloud_')) return 'alicloud';
        
        // DigitalOcean
        if (resourceType.startsWith('digitalocean_')) return 'digitalocean';
        
        // Common pattern matching
        const patterns = {
            aws: ['ec2', 's3', 'rds', 'lambda', 'dynamodb', 'cloudfront'],
            gcp: ['compute', 'storage', 'sql', 'functions', 'pubsub'],
            azure: ['vm', 'sql', 'storage', 'app_service']
        };

        for (const [provider, keywords] of Object.entries(patterns)) {
            if (keywords.some(keyword => resourceType.includes(keyword))) {
                return provider;
            }
        }
        
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
            'aws_eks_cluster', 'aws_msk_cluster', 'aws_redshift_cluster',
            
            // GCP
            'google_compute_instance', 'google_sql_database_instance', 'google_storage_bucket',
            'google_compute_disk', 'google_compute_forwarding_rule', 'google_compute_address',
            'google_cloudfunctions_function', 'google_container_cluster', 'google_redis_instance',
            'google_compute_instance_group', 'google_bigquery_dataset',
            
            // Azure
            'azurerm_virtual_machine', 'azurerm_sql_database', 'azurerm_storage_account',
            'azurerm_managed_disk', 'azurerm_public_ip', 'azurerm_load_balancer',
            'azurerm_function_app', 'azurerm_kubernetes_cluster', 'azurerm_redis_cache',
            'azurerm_app_service', 'azurerm_cosmosdb_account'
        ];

        return costRelevantTypes.includes(resourceType);
    }

    resolveVariableReferences(resources, variables) {
        // Simple variable resolution
        const variableValues = {};
        
        for (const variable of variables) {
            const defaultValue = variable.attributes.default;
            if (defaultValue !== undefined) {
                variableValues[variable.name] = defaultValue;
            }
        }

        // Replace variable references in resources
        for (const resource of resources) {
            for (const [key, value] of Object.entries(resource.attributes)) {
                if (typeof value === 'object' && value._ref === 'variable') {
                    const varName = value.name;
                    if (variableValues[varName] !== undefined) {
                        resource.attributes[key] = variableValues[varName];
                    }
                }
            }
        }

        return resources;
    }

    extractProviderConfig(code) {
        const providers = {};
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const providerMatch = line.match(/provider\s+"([^"]+)"\s*\{/);
            
            if (providerMatch) {
                const [, providerName] = providerMatch;
                const blockContent = this.extractBlock(lines, i);
                const attributes = this.parseAttributes(blockContent.content);
                
                providers[providerName] = {
                    region: attributes.region || attributes.location || null,
                    attributes
                };
                
                i += blockContent.lineCount - 1;
            }
        }

        return providers;
    }
}

module.exports = TerraformParser;