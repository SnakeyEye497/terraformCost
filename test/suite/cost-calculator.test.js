const assert = require('assert');
const TerraformCostCalculator = require('../../src/cost-calculator');
const TerraformParser = require('../../src/terraform-parser');

const approx = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.01, `${msg || ''} expected ${expected}, got ${actual}`);

suite('Cost Calculator — resource coverage', () => {
    let calculator;

    setup(() => {
        calculator = new TerraformCostCalculator();
    });

    const cost = (type, attributes = {}, provider) =>
        calculator.calculateResourceCost({ type, name: 'x', provider: provider || TerraformParser.getProviderFromResourceType(type), attributes });

    test('free networking/IAM types cost nothing instead of the unknown-type estimate', async () => {
        for (const type of ['aws_vpc', 'aws_subnet', 'aws_security_group', 'aws_iam_role', 'aws_iam_role_policy_attachment',
            'aws_s3_bucket_versioning', 'aws_route_table_association', 'google_compute_network', 'google_project_iam_member',
            'azurerm_resource_group', 'azurerm_subnet_network_security_group_association', 'random_password', 'null_resource',
            'aws_redshift_subnet_group', 'aws_vpn_gateway_attachment', 'aws_vpc_ipv4_cidr_block_association', 'aws_flow_log']) {
            const c = await cost(type);
            assert.strictEqual(c.monthly, 0, `${type} should be free`);
            assert.strictEqual(c.source, 'free', type);
        }
    });

    test('unknown paid-looking types still get the flagged estimate', async () => {
        const c = await cost('aws_some_future_service');
        assert.ok(c.monthly > 0);
        assert.strictEqual(c.source, 'estimated');
    });

    test('literal count multiplies the cost', async () => {
        const single = await cost('aws_instance', { instance_type: 't3.medium' });
        const triple = await cost('aws_instance', { instance_type: 't3.medium', count: 3 });
        approx(triple.monthly, single.monthly * 3);
        assert.ok(triple.breakdown.some((b) => b.includes('x3 instances (count)')));
    });

    test('count = 0 makes a resource free', async () => {
        const c = await cost('aws_instance', { instance_type: 't3.medium', count: 0 });
        assert.strictEqual(c.monthly, 0);
    });

    test('literal for_each list/map multiplies the cost; unresolvable for_each counts once', async () => {
        const single = await cost('aws_instance', { instance_type: 't3.small' });
        const list = await cost('aws_instance', { instance_type: 't3.small', for_each: ['a', 'b'] });
        const map = await cost('aws_instance', { instance_type: 't3.small', for_each: { a: 1, b: 2, c: 3 } });
        const fn = await cost('aws_instance', { instance_type: 't3.small', for_each: { _function: 'toset(var.names)' } });
        approx(list.monthly, single.monthly * 2);
        approx(map.monthly, single.monthly * 3);
        approx(fn.monthly, single.monthly);
    });

    test('RDS adds storage and doubles for Multi-AZ', async () => {
        const c = await cost('aws_db_instance', { instance_class: 'db.t3.small', allocated_storage: 20, multi_az: true });
        approx(c.monthly, 0.034 * 730 * 2 + 20 * 0.115 * 2);
    });

    test('EKS node group reads both flattened HCL and nested plan JSON shapes', async () => {
        const hcl = await cost('aws_eks_node_group', { instance_types: ['m5.large'], desired_size: 3 });
        const plan = await cost('aws_eks_node_group', { instance_types: ['m5.large'], scaling_config: [{ desired_size: 3, min_size: 1 }] });
        approx(hcl.monthly, 0.096 * 730 * 3);
        approx(plan.monthly, hcl.monthly);
    });

    test('Interface VPC endpoints are priced per AZ; Gateway endpoints are free', async () => {
        const iface = await cost('aws_vpc_endpoint', { vpc_endpoint_type: 'Interface', subnet_ids: ['a', 'b', 'c'] });
        const gateway = await cost('aws_vpc_endpoint', { vpc_endpoint_type: 'Gateway' });
        approx(iface.monthly, 0.01 * 730 * 3);
        assert.strictEqual(gateway.monthly, 0);
    });

    test('DynamoDB provisioned vs on-demand', async () => {
        const provisioned = await cost('aws_dynamodb_table', { billing_mode: 'PROVISIONED', read_capacity: 10, write_capacity: 10 });
        const onDemand = await cost('aws_dynamodb_table', { billing_mode: 'PAY_PER_REQUEST' });
        assert.ok(provisioned.monthly > onDemand.monthly);
        approx(onDemand.monthly, 0.25);
    });

    test('Cloud SQL custom tiers are priced from vCPU/RAM and doubled for HA', async () => {
        const c = await cost('google_sql_database_instance', { tier: 'db-custom-2-7680', availability_type: 'REGIONAL' });
        approx(c.monthly, (2 * 0.0413 + 7.5 * 0.007) * 730 * 2);
    });

    test('GKE cluster includes the default node pool unless it is removed', async () => {
        const withPool = await cost('google_container_cluster', { initial_node_count: 3, machine_type: 'e2-standard-2' });
        const removed = await cost('google_container_cluster', { initial_node_count: 1, remove_default_node_pool: true });
        approx(withPool.monthly, 0.10 * 730 + 0.067 * 730 * 3);
        approx(removed.monthly, 0.10 * 730);
    });

    test('preemptible GKE nodes get the spot discount', async () => {
        const normal = await cost('google_container_node_pool', { node_count: 2, machine_type: 'e2-medium' });
        const spot = await cost('google_container_node_pool', { node_count: 2, machine_type: 'e2-medium', preemptible: true });
        approx(spot.monthly, normal.monthly * 0.3);
    });

    test('AKS: Free tier control plane costs nothing, nodes are priced', async () => {
        const free = await cost('azurerm_kubernetes_cluster', { vm_size: 'Standard_D2s_v3', node_count: 2 });
        const standard = await cost('azurerm_kubernetes_cluster', { vm_size: 'Standard_D2s_v3', node_count: 2, sku_tier: 'Standard' });
        approx(free.monthly, 0.096 * 730 * 2);
        approx(standard.monthly, free.monthly + 0.10 * 730);
    });

    test('Azure plan-JSON nested default_node_pool is read', async () => {
        const c = await cost('azurerm_kubernetes_cluster', { default_node_pool: [{ vm_size: 'Standard_D4s_v3', node_count: 3 }] });
        approx(c.monthly, 0.192 * 730 * 3);
    });

    test('Azure SQL, flexible servers, Redis, App Service, public IPs', async () => {
        approx((await cost('azurerm_mssql_database', { sku_name: 'S1' })).monthly, 29.43);
        approx((await cost('azurerm_postgresql_flexible_server', { sku_name: 'GP_Standard_D2s_v3', storage_mb: 32768 })).monthly,
            0.171 * 730 + 32 * 0.115);
        approx((await cost('azurerm_redis_cache', { sku_name: 'Standard', family: 'C', capacity: 1 })).monthly, 100.74);
        approx((await cost('azurerm_service_plan', { sku_name: 'P1v3' })).monthly, 0.155 * 730);
        approx((await cost('azurerm_public_ip', { sku: 'Standard' })).monthly, 0.005 * 730);
        assert.strictEqual((await cost('azurerm_lb', { sku: 'Basic' })).monthly, 0);
    });

    test('every newly supported type produces a positive, labelled cost', async () => {
        const cases = [
            ['aws_elasticache_replication_group', { node_type: 'cache.t3.small', num_cache_clusters: 2 }],
            ['aws_rds_cluster_instance', { instance_class: 'db.r6g.large' }],
            ['aws_lambda_function', { memory_size: 256 }],
            ['aws_efs_file_system', {}],
            ['aws_eip', {}],
            ['aws_vpn_connection', {}],
            ['aws_route53_zone', {}],
            ['aws_kms_key', {}],
            ['aws_secretsmanager_secret', {}],
            ['aws_opensearch_domain', { instance_type: 'm5.large.search', instance_count: 2, volume_size: 20 }],
            ['aws_redshift_cluster', { node_type: 'dc2.large', number_of_nodes: 2 }],
            ['aws_msk_cluster', { number_of_broker_nodes: 3, volume_size: 100 }],
            ['google_redis_instance', { tier: 'STANDARD_HA', memory_size_gb: 5 }],
            ['google_compute_address', {}],
            ['google_compute_forwarding_rule', {}],
            ['azurerm_linux_virtual_machine_scale_set', { sku: 'Standard_B2s', instances: 3 }],
            ['azurerm_kubernetes_cluster_node_pool', { vm_size: 'Standard_D2s_v3', node_count: 2 }],
            ['azurerm_container_registry', { sku: 'Standard' }],
            ['azurerm_virtual_network_gateway', { sku: 'VpnGw1' }],
            ['azurerm_nat_gateway', {}]
        ];
        for (const [type, attributes] of cases) {
            const c = await cost(type, attributes);
            assert.ok(c.monthly > 0, `${type} should have a cost`);
            assert.notStrictEqual(c.source, 'estimated', `${type} should be explicitly priced`);
            approx(c.yearly, c.monthly * 12, type);
            assert.ok(c.breakdown.length > 0, type);
        }
    });

    test('internal GCP addresses are free', async () => {
        assert.strictEqual((await cost('google_compute_address', { address_type: 'INTERNAL' })).monthly, 0);
    });
});

suite('Cost Calculator — Infracost result matching', () => {
    const calculator = new TerraformCostCalculator();
    const infra = (name, monthly) => ({ name, type: 'aws_instance', cost: { hourly: monthly / 730, monthly, yearly: monthly * 12, breakdown: [`${name}`] } });

    test('matches by full address, module-prefixed address, and indexed instances', () => {
        const resources = [
            infra('aws_instance.web[0]', 10),
            infra('aws_instance.web[1]', 10),
            infra('module.app.aws_instance.api', 20),
            infra('aws_instance.webserver', 99)
        ];
        const web = calculator.findMatchingResources(resources, { type: 'aws_instance', name: 'web' });
        assert.strictEqual(web.length, 2, 'both count instances, but not "webserver"');
        const api = calculator.findMatchingResources(resources, { type: 'aws_instance', name: 'api' });
        assert.strictEqual(api.length, 1);
    });

    test('never falls back to another resource of the same type', () => {
        const matches = calculator.findMatchingResources([infra('aws_instance.other', 50)], { type: 'aws_instance', name: 'web' });
        assert.strictEqual(matches.length, 0);
    });
});
