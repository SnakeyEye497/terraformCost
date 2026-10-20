const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BudgetManager = require('../../src/budget-manager');
const CapacityManager = require('../../src/capacity-manager');
const CostHistoryManager = require('../../src/cost-history-manager');
const NotificationManager = require('../../src/notification-manager');
const { extractResourcesFromPlan, getPlanMetadata } = require('../../src/plan-parser');
const TerraformCostCalculator = require('../../src/cost-calculator');

function tempProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfcost-test-'));
    const nested = path.join(root, 'envs', 'prod');
    fs.mkdirSync(nested, { recursive: true });
    return { root, nestedFile: path.join(nested, 'main.tf') };
}

suite('Budget / capacity / history managers', () => {
    test('budget file is found by walking up from a nested .tf file, with alias keys normalized', async () => {
        const { root, nestedFile } = tempProject();
        fs.writeFileSync(path.join(root, 'terraform.budget.json'), JSON.stringify({ finalLimit: 500, limit1: 100 }));
        const budget = await new BudgetManager().loadBudgetForFile(nestedFile);
        assert.strictEqual(budget.final_limit, 500);
        assert.strictEqual(budget.limit_1, 100);
        assert.strictEqual(budget.limit_2, 0);
    });

    test('malformed budget JSON yields null instead of throwing', async () => {
        const { root, nestedFile } = tempProject();
        fs.writeFileSync(path.join(root, 'terraform.budget.json'), '{ not json');
        assert.strictEqual(await new BudgetManager().loadBudgetForFile(nestedFile), null);
    });

    test('notification levels are tracked per key and reset by clearCache', () => {
        const bm = new BudgetManager();
        bm.setNotificationLevelForFile('workspace:/x', 3);
        assert.strictEqual(bm.getNotificationLevelForFile('workspace:/x'), 3);
        bm.clearCache();
        assert.strictEqual(bm.getNotificationLevelForFile('workspace:/x'), 0);
    });

    test('capacity config round-trips and is found from a nested file', async () => {
        const { root, nestedFile } = tempProject();
        const cfg = { expected_users: 5000, requests_per_day: 1e6, growth_rate_percent: 10 };
        await new CapacityManager().saveCapacityForFolder({ fsPath: root }, cfg);
        assert.deepStrictEqual(await new CapacityManager().loadCapacityForFile(nestedFile), cfg);
    });

    test('cost history appends snapshots and caps at 200 entries', async () => {
        const { root, nestedFile } = tempProject();
        const seeded = Array.from({ length: 199 }, (_, i) => ({ timestamp: i, scope: 'file', totalMonthly: i }));
        fs.writeFileSync(path.join(root, 'terraform-cost-history.json'), JSON.stringify(seeded));
        const hm = new CostHistoryManager();
        for (let i = 199; i < 205; i++) {
            await hm.appendSnapshot({ fsPath: root }, { timestamp: i, scope: 'file', totalMonthly: i });
        }
        const history = await new CostHistoryManager().loadHistoryForFile(nestedFile);
        assert.strictEqual(history.length, 200);
        assert.strictEqual(history[0].timestamp, 5, 'oldest entries drop first');
        assert.strictEqual(history[199].totalMonthly, 204);
    });
});

suite('Budget alert webhooks', () => {
    const alert = { level: 4, current: 812.5, limit: 800, currency: 'USD', projectName: 'demo', fileName: 'main.tf' };
    let originalFetch;

    setup(() => {
        originalFetch = globalThis.fetch;
    });

    teardown(() => {
        globalThis.fetch = originalFetch;
    });

    test('Slack payload is plain text with the key facts', () => {
        const p = NotificationManager.buildSlackPayload(alert);
        assert.ok(p.text.includes('USD 812.50/mo'));
        assert.ok(p.text.includes('Final limit exceeded (USD 800.00/mo)'));
    });

    test('Teams payload is an Adaptive Card message (works with Workflows and classic webhooks)', () => {
        const p = NotificationManager.buildTeamsPayload(alert);
        assert.strictEqual(p.type, 'message');
        const card = p.attachments[0];
        assert.strictEqual(card.contentType, 'application/vnd.microsoft.card.adaptive');
        assert.strictEqual(card.content.type, 'AdaptiveCard');
        const facts = card.content.body.find((b) => b.type === 'FactSet').facts;
        assert.deepStrictEqual(facts.map((f) => f.title), ['Project', 'File', 'Current spend', 'Threshold']);
        assert.strictEqual(card.content.body[0].color, 'Attention');
    });

    test('sendBudgetAlert posts JSON and surfaces HTTP errors', async () => {
        const nm = new NotificationManager({});
        const posted = [];
        globalThis.fetch = async (url, init) => {
            posted.push({ url, body: JSON.parse(init.body) });
            return url.includes('fail')
                ? { ok: false, status: 400, text: async () => 'Bad payload' }
                : { ok: true, status: 200, text: async () => 'ok' };
        };

        await nm.sendBudgetAlert({ ...alert, provider: 'teams', webhookUrl: 'https://example.test/ok' });
        assert.strictEqual(posted[0].body.type, 'message');

        await assert.rejects(nm.sendBudgetAlert({ ...alert, provider: 'slack', webhookUrl: 'https://example.test/fail' }),
            /Webhook returned 400: Bad payload/);
        await assert.rejects(nm.sendBudgetAlert({ ...alert, provider: 'slack', webhookUrl: '' }), /No webhook URL configured/);
    });
});

suite('Terraform plan-based costing', () => {
    const plan = require('../../test-fixtures/sample-plan/plan.json');

    test('extracts managed resources that exist after apply', () => {
        const resources = extractResourcesFromPlan(plan);
        assert.deepStrictEqual(resources.map((r) => `${r.type}.${r.name}`).sort(),
            ['aws_db_instance.primary', 'aws_ebs_volume.data', 'aws_instance.web', 'aws_s3_bucket.logs']);
        assert.strictEqual(getPlanMetadata(plan).terraformVersion, plan.terraform_version);
    });

    test('skips deletes and data sources', () => {
        const resources = extractResourcesFromPlan({
            resource_changes: [
                { mode: 'managed', type: 'aws_instance', name: 'gone', change: { actions: ['delete'], after: null } },
                { mode: 'data', type: 'aws_ami', name: 'ubuntu', change: { actions: ['read'], after: {} } },
                { mode: 'managed', type: 'aws_instance', name: 'kept', change: { actions: ['no-op'], after: { instance_type: 't3.micro' } } }
            ]
        });
        assert.deepStrictEqual(resources.map((r) => r.name), ['kept']);
    });

    test('rejects input that is not terraform show -json output', () => {
        assert.throws(() => extractResourcesFromPlan({ hello: 'world' }), /resource_changes/);
    });

    test('plan resources cost through the same calculator', async () => {
        const calculator = new TerraformCostCalculator();
        const web = extractResourcesFromPlan(plan).find((r) => r.name === 'web');
        const cost = await calculator.calculateResourceCost(web);
        assert.ok(Math.abs(cost.monthly - 0.0832 * 730) < 0.5, `t3.large ~ $60.74, got ${cost.monthly}`);
    });
});
