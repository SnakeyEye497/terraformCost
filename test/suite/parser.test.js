const assert = require('assert');
const TerraformParser = require('../../src/terraform-parser');

suite('Terraform Parser Test Suite', () => {
    let parser;

    setup(() => {
        parser = new TerraformParser();
    });

    test('Parse simple AWS EC2 instance', async () => {
        const terraformCode = `
resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t2.micro"
}`;

        const result = await parser.parse(terraformCode);
        
        assert.strictEqual(result.resources.length, 1);
        assert.strictEqual(result.resources[0].type, 'aws_instance');
        assert.strictEqual(result.resources[0].name, 'web');
        assert.strictEqual(result.resources[0].provider, 'aws');
        assert.strictEqual(result.resources[0].attributes.instance_type, 't2.micro');
    });

    test('Parse multiple resources', async () => {
        const terraformCode = `
resource "aws_instance" "web" {
  ami           = "ami-12345678"
  instance_type = "t2.micro"
}

resource "aws_s3_bucket" "data" {
  bucket = "my-bucket"
}`;

        const result = await parser.parse(terraformCode);
        
        assert.strictEqual(result.resources.length, 2);
        assert.strictEqual(result.resources[0].type, 'aws_instance');
        assert.strictEqual(result.resources[1].type, 'aws_s3_bucket');
    });

    test('Detect provider from resource type', () => {
        assert.strictEqual(parser.getProviderFromResourceType('aws_instance'), 'aws');
        assert.strictEqual(parser.getProviderFromResourceType('google_compute_instance'), 'gcp');
        assert.strictEqual(parser.getProviderFromResourceType('azurerm_virtual_machine'), 'azure');
        assert.strictEqual(parser.getProviderFromResourceType('unknown_resource'), 'unknown');
    });

    test('Parse resource with numeric attributes', async () => {
        const terraformCode = `
resource "aws_ebs_volume" "data" {
  size = 100
  type = "gp3"
}`;

        const result = await parser.parse(terraformCode);
        
        assert.strictEqual(result.resources.length, 1);
        assert.strictEqual(result.resources[0].attributes.size, 100);
        assert.strictEqual(typeof result.resources[0].attributes.size, 'number');
    });

    test('Parse resource with boolean attributes', async () => {
        const terraformCode = `
resource "aws_db_instance" "postgres" {
  multi_az = true
  publicly_accessible = false
}`;

        const result = await parser.parse(terraformCode);
        
        assert.strictEqual(result.resources[0].attributes.multi_az, true);
        assert.strictEqual(result.resources[0].attributes.publicly_accessible, false);
    });

    test('Handle empty terraform file', async () => {
        const result = await parser.parse('');
        
        assert.strictEqual(result.resources.length, 0);
        assert.strictEqual(result.variables.length, 0);
    });

    test('Parse variables', async () => {
        const terraformCode = `
variable "instance_type" {
  default = "t2.micro"
  description = "EC2 instance type"
}`;

        const result = await parser.parse(terraformCode);
        
        assert.strictEqual(result.variables.length, 1);
        assert.strictEqual(result.variables[0].name, 'instance_type');
    });
});