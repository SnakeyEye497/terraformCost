const assert = require('assert');
const path = require('path');
const TerraformParser = require('../../src/terraform-parser');
const { resolveModuleGraph, parseModuleManifest } = require('../../src/module-resolver');

// Builds the parsedByFile map resolveModuleGraph expects from { relPath: hcl }.
async function parseTree(files, root = path.resolve('/virtual-project')) {
    const parser = new TerraformParser();
    const parsedByFile = new Map();
    for (const [relPath, code] of Object.entries(files)) {
        const absPath = path.join(root, relPath);
        parsedByFile.set(absPath, { ...(await parser.parse(code)), relPath });
    }
    return { parser, parsedByFile, root };
}

const MODULE_VM = `
variable "instance_type" {
  default = "t3.micro"
}

resource "aws_instance" "vm" {
  instance_type = var.instance_type
}`;

suite('Module resolver', () => {
    test('caller overrides win over module defaults; each call site resolves separately', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
module "small" {
  source = "./modules/vm"
}

module "big" {
  source        = "./modules/vm"
  instance_type = "m5.xlarge"
}`,
            'modules/vm/main.tf': MODULE_VM
        });

        const results = resolveModuleGraph(parsedByFile, parser);
        const byPath = Object.fromEntries(results.map((r) => [r.modulePath, r.resource.attributes.instance_type]));
        assert.deepStrictEqual(byPath, { small: 't3.micro', big: 'm5.xlarge' });
    });

    test('var passthrough from the caller into a child module', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
variable "size" {
  default = "c5.large"
}

module "app" {
  source        = "./modules/vm"
  instance_type = var.size
}`,
            'modules/vm/main.tf': MODULE_VM
        });

        const [only] = resolveModuleGraph(parsedByFile, parser);
        assert.strictEqual(only.resource.attributes.instance_type, 'c5.large');
    });

    test('count on a module block instantiates it N times', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
module "workers" {
  source = "./modules/vm"
  count  = 3
}`,
            'modules/vm/main.tf': MODULE_VM
        });

        const results = resolveModuleGraph(parsedByFile, parser);
        assert.deepStrictEqual(results.map((r) => r.modulePath), ['workers[0]', 'workers[1]', 'workers[2]']);
    });

    test('count resolved from a variable, and count = 0 removes the module', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
variable "replicas" {
  default = 2
}

module "on" {
  source = "./modules/vm"
  count  = var.replicas
}

module "off" {
  source = "./modules/vm"
  count  = 0
}`,
            'modules/vm/main.tf': MODULE_VM
        });

        const results = resolveModuleGraph(parsedByFile, parser);
        assert.deepStrictEqual(results.map((r) => r.modulePath), ['on[0]', 'on[1]']);
    });

    test('for_each over a literal list on a module block', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
module "regional" {
  source   = "./modules/vm"
  for_each = ["us", "eu"]
}`,
            'modules/vm/main.tf': MODULE_VM
        });

        const results = resolveModuleGraph(parsedByFile, parser);
        assert.deepStrictEqual(results.map((r) => r.modulePath), ['regional["us"]', 'regional["eu"]']);
    });

    test('remote modules resolve through the terraform init manifest, including nested ones', async () => {
        const { parser, parsedByFile, root } = await parseTree({
            'main.tf': `
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"
  nat_type = "per-az"
}`,
            '.terraform/modules/vpc/main.tf': `
variable "nat_type" {
  default = "single"
}

resource "aws_nat_gateway" "this" {
  connectivity_type = "public"
}

module "flow_logs" {
  source = "git::https://example.com/flow-logs.git"
}`,
            '.terraform/modules/vpc.flow_logs/main.tf': `
resource "aws_eip" "log" {
  domain = "vpc"
}`
        });

        const manifest = parseModuleManifest({
            Modules: [
                { Key: '', Source: '', Dir: '.' },
                { Key: 'vpc', Source: 'registry.terraform.io/terraform-aws-modules/vpc/aws', Version: '5.0.0', Dir: '.terraform/modules/vpc' },
                { Key: 'vpc.flow_logs', Source: 'git::https://example.com/flow-logs.git', Dir: '.terraform/modules/vpc.flow_logs' }
            ]
        }, root);
        const results = resolveModuleGraph(parsedByFile, parser, { moduleManifests: new Map([[root, manifest]]) });

        const found = results.map((r) => `${r.modulePath}:${r.resource.type}`).sort();
        assert.deepStrictEqual(found, ['vpc.flow_logs:aws_eip', 'vpc:aws_nat_gateway']);
        assert.strictEqual(results.unresolvedModules.length, 0);
    });

    test('remote modules without a manifest are reported as unresolved, not silently dropped', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
}

resource "aws_instance" "bastion" {
  instance_type = "t3.nano"
}`
        });

        const results = resolveModuleGraph(parsedByFile, parser);
        assert.strictEqual(results.length, 1);
        assert.deepStrictEqual(results.unresolvedModules, [{ modulePath: 'vpc', source: 'terraform-aws-modules/vpc/aws' }]);
    });

    test('a module directory is never also scanned as a root', async () => {
        const { parser, parsedByFile } = await parseTree({
            'main.tf': `
module "a" {
  source = "./modules/vm"
}`,
            'modules/vm/main.tf': MODULE_VM
        });
        assert.strictEqual(resolveModuleGraph(parsedByFile, parser).length, 1);
    });
});
