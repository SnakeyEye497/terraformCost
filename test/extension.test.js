const assert = require('assert');
const vscode = require('vscode');

// Import test modules
const TerraformParser = require('../src/terraform-parser');
const TerraformCostCalculator = require('../src/cost-calculator');

suite('Terraform Cost Calculator Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting Terraform Cost Calculator tests.');

    suite('Terraform Parser Tests', () => {
        let parser;

        setup(() => {
            parser = new TerraformParser();
        });

        test('Should parse AWS EC2 instance', async () => {
            const terraformCode = `
resource "aws_instance" "web_server" {
  ami           = "ami-0c55b159cbfafe1d0"
  instance_type = "t3.medium"
  
  tags = {
    Name = "Web Server"
  }
}`;
            
            const result = await parser.parse(terraformCode);
            assert.strictEqual(result.resources.length, 1);
            
            const resource = result.resources[0];
            assert.strictEqual(resource.type, 'aws_instance');
            assert.strictEqual(resource.name, 'web_server');
            assert.strictEqual(resource.provider, 'aws');
            assert.strictEqual(resource.attributes.instance_type, 't3.medium');
        });

        test('Should parse GCP compute instance', async () => {
            const terraformCode = `
resource "google_compute_instance" "app_server" {
  name         = "app-server"
  machine_type = "e2-medium"
  zone         = "us-central1-a"
}`;
            
            const result = await parser.parse(terraformCode);
            assert.strictEqual(result.resources.length, 1);
            
            const resource = result.resources[0];
            assert.strictEqual(resource.type, 'google_compute_instance');
            assert.strictEqual(resource.name, 'app_server');
            assert.strictEqual(resource.provider, 'gcp');
            assert.strictEqual(resource.attributes.machine_type, 'e2-medium');
        });

        test('Should parse Azure virtual machine', async () => {
            const terraformCode = `
resource "azurerm_virtual_machine" "main" {
  name     = "main-vm"
  location = "East US"
  vm_size  = "Standard_B2s"
}`;
            
            const result = await parser.parse(terraformCode);
            assert.strictEqual(result.resources.length, 1);
            
            const resource = result.resources[0];
            assert.strictEqual(resource.type, 'azurerm_virtual_machine');
            assert.strictEqual(resource.name, 'main');
            assert.strictEqual(resource.provider, 'azure');
            assert.strictEqual(resource.attributes.vm_size, 'Standard_B2s');
        });

        test('Should parse multiple resources', async () => {
            const terraformCode = `
resource "aws_instance" "web" {
  ami           = "ami-12345"
  instance_type = "t2.micro"
}

resource "aws_s3_bucket" "storage" {
  bucket = "my-bucket"
}`;
            
            const result = await parser.parse(terraformCode);
            assert.strictEqual(result.resources.length, 2);
            assert.strictEqual(result.resources[0].type, 'aws_instance');
            assert.strictEqual(result.resources[1].type, 'aws_s3_bucket');
        });

        test('Should identify cost-relevant resources', () => {
            assert.strictEqual(parser.isResourceCostRelevant('aws_instance'), true);
            assert.strictEqual(parser.isResourceCostRelevant('aws_s3_bucket'), true);
            assert.strictEqual(parser.isResourceCostRelevant('aws_vpc'), false);
            assert.strictEqual(parser.isResourceCostRelevant('google_compute_instance'), true);
            assert.strictEqual(parser.isResourceCostRelevant('azurerm_virtual_machine'), true);
        });
    });

    suite('Cost Calculator Tests', () => {
        let calculator;

        setup(() => {
            calculator = new TerraformCostCalculator();
        });

        test('Should calculate AWS EC2 instance cost', async () => {
            const resource = {
                type: 'aws_instance',
                provider: 'aws',
                attributes: {
                    instance_type: 't3.medium'
                }
            };
            
            const cost = await calculator.calculateResourceCost(resource);
            assert.ok(cost.monthly > 0);
            assert.strictEqual(cost.currency, 'USD');
            assert.ok(cost.breakdown.length > 0);
        });

        test('Should calculate GCP compute instance cost', async () => {
            const resource = {
                type: 'google_compute_instance',
                provider: 'gcp',
                attributes: {
                    machine_type: 'e2-medium'
                }
            };
            
            const cost = await calculator.calculateResourceCost(resource);
            assert.ok(cost.monthly > 0);
            assert.strictEqual(cost.currency, 'USD');
            assert.ok(cost.breakdown.length > 0);
        });

        test('Should calculate Azure VM cost', async () => {
            const resource = {
                type: 'azurerm_virtual_machine',
                provider: 'azure',
                attributes: {
                    vm_size: 'Standard_B2s'
                }
            };
            
            const cost = await calculator.calculateResourceCost(resource);
            assert.ok(cost.monthly > 0);
            assert.strictEqual(cost.currency, 'USD');
            assert.ok(cost.breakdown.length > 0);
        });

        test('Should handle unknown resource types', async () => {
            const resource = {
                type: 'unknown_resource',
                provider: 'unknown',
                attributes: {}
            };
            
            const cost = await calculator.calculateResourceCost(resource);
            assert.strictEqual(cost.monthly, 0);
            assert.strictEqual(cost.currency, 'USD');
        });

        test('Should calculate EBS volume cost based on size', async () => {
            const resource = {
                type: 'aws_ebs_volume',
                provider: 'aws',
                attributes: {
                    size: 100,
                    type: 'gp3'
                }
            };
            
            const cost = await calculator.calculateResourceCost(resource);
            assert.ok(cost.monthly > 0);
            assert.ok(cost.breakdown[0].includes('100GB'));
        });
    });

    suite('Integration Tests', () => {
        test('Should parse and calculate costs for complex Terraform file', async () => {
            const terraformCode = `
resource "aws_instance" "web" {
  ami           = "ami-12345"
  instance_type = "t3.medium"
}

resource "aws_db_instance" "database" {
  instance_class = "db.t3.small"
  allocated_storage = 20
}

resource "google_compute_instance" "app" {
  machine_type = "e2-medium"
}`;

            const parser = new TerraformParser();
            const calculator = new TerraformCostCalculator();
            
            const parsed = await parser.parse(terraformCode);
            assert.strictEqual(parsed.resources.length, 3);
            
            let totalCost = 0;
            for (const resource of parsed.resources) {
                const cost = await calculator.calculateResourceCost(resource);
                totalCost += cost.monthly;
            }
            
            assert.ok(totalCost > 0, 'Total cost should be greater than 0');
        });
    });
});

suite('Configuration Tests', () => {
    test('Should have valid package.json configuration', () => {
        const fs = require('fs');
        const path = require('path');
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);
        
        assert.strictEqual(packageJson.name, 'terraform-cost-calculator');
        assert.ok(packageJson.contributes);
        assert.ok(packageJson.contributes.commands);
        assert.ok(packageJson.contributes.configuration);
        
        // Check that required commands are present
        const commands = packageJson.contributes.commands;
        const commandIds = commands.map(cmd => cmd.command);
        
        assert.ok(commandIds.includes('terraformCost.calculateCosts'));
        assert.ok(commandIds.includes('terraformCost.toggleCostDisplay'));
        assert.ok(commandIds.includes('terraformCost.refreshCosts'));
    });
});

// Mock VS Code API for testing
if (typeof vscode === 'undefined') {
    global.vscode = {
        window: {
            showInformationMessage: (msg) => console.log('Info:', msg),
            showWarningMessage: (msg) => console.log('Warning:', msg),
            showErrorMessage: (msg) => console.log('Error:', msg)
        },
        workspace: {
            getConfiguration: (section) => ({
                get: (key, defaultValue) => defaultValue
            })
        }
    };
}
