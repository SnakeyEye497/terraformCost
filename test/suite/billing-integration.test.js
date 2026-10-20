const assert = require('assert');
const fs = require('fs');
const billing = require('../../src/billing-integration');

const NOW = new Date(Date.UTC(2026, 9, 20, 12)); // 2026-10-20

suite('Billing integration (actual cloud spend)', () => {
    test('billing periods: last full month + month to date, exclusive end dates', () => {
        const p = billing.getBillingPeriods(NOW);
        assert.deepStrictEqual(
            [p.lastMonth.start, p.lastMonth.end, p.lastMonth.invoiceMonth],
            ['2026-09-01', '2026-10-01', '202609']);
        assert.deepStrictEqual(
            [p.monthToDate.start, p.monthToDate.end, p.monthToDate.invoiceMonth],
            ['2026-10-01', '2026-10-21', '202610']);
        assert.strictEqual(p.daysElapsed, 20);
        assert.strictEqual(p.daysInMonth, 31);
    });

    test('billing periods across a year boundary', () => {
        const p = billing.getBillingPeriods(new Date(Date.UTC(2027, 0, 1)));
        assert.strictEqual(p.lastMonth.start, '2026-12-01');
        assert.strictEqual(p.lastMonth.end, '2027-01-01');
    });

    test('parses AWS Cost Explorer output, summing and sorting by service', () => {
        const r = billing.parseAwsCostExplorer({
            ResultsByTime: [{
                Groups: [
                    { Keys: ['Amazon Simple Storage Service'], Metrics: { UnblendedCost: { Amount: '3.5', Unit: 'USD' } } },
                    { Keys: ['Amazon Elastic Compute Cloud - Compute'], Metrics: { UnblendedCost: { Amount: '120.25', Unit: 'USD' } } },
                    { Keys: ['Tax'], Metrics: { UnblendedCost: { Amount: '0', Unit: 'USD' } } }
                ]
            }]
        });
        assert.strictEqual(r.total, 123.75);
        assert.deepStrictEqual(r.services.map((s) => s.name), ['Amazon Elastic Compute Cloud - Compute', 'Amazon Simple Storage Service']);
    });

    test('parses Azure Cost Management query output by column name', () => {
        const r = billing.parseAzureCostQuery({
            properties: {
                columns: [{ name: 'Cost' }, { name: 'ServiceName' }, { name: 'Currency' }],
                rows: [[40.5, 'Virtual Machines', 'EUR'], [9.5, 'Storage', 'EUR']]
            }
        });
        assert.strictEqual(r.total, 50);
        assert.strictEqual(r.currency, 'EUR');
        assert.strictEqual(r.services[0].name, 'Virtual Machines');
    });

    test('Azure query body uses an inclusive end one second before the next period', () => {
        const body = billing.buildAzureQueryBody({ start: '2026-09-01', end: '2026-10-01' });
        assert.strictEqual(body.timePeriod.from, '2026-09-01T00:00:00Z');
        assert.strictEqual(body.timePeriod.to, '2026-09-30T23:59:59Z');
        assert.strictEqual(body.dataset.grouping[0].name, 'ServiceName');
    });

    test('GCP BigQuery query rejects table names that could inject SQL', () => {
        assert.ok(billing.buildGcpBillingQuery('proj-1.billing.gcp_billing_export_v1_ABC', '202609').includes("invoice.month = '202609'"));
        assert.throws(() => billing.buildGcpBillingQuery('proj.ds.t` WHERE 1=1; --', '202609'), /Invalid BigQuery table/);
        assert.throws(() => billing.buildGcpBillingQuery('proj.ds.t', "2026' OR '1"), /Invalid invoice month/);
    });

    test('fetchActualSpend runs the right CLIs and isolates per-provider failures', async () => {
        const calls = [];
        const run = async (command, args, opts) => {
            calls.push({ command, args, input: opts?.input });
            if (command === 'aws') {
                return JSON.stringify({ ResultsByTime: [{ Groups: [{ Keys: ['EC2'], Metrics: { UnblendedCost: { Amount: '10', Unit: 'USD' } } }] }] });
            }
            if (command === 'bq') {
                return JSON.stringify([{ service: 'Compute Engine', cost: '7.25', currency: 'USD' }]);
            }
            if (command === 'az' && args[0] === 'account') {
                throw new Error('Please run az login');
            }
            throw new Error(`unexpected ${command}`);
        };

        const { results } = await billing.fetchActualSpend(['aws', 'azure', 'gcp'], {
            now: NOW, run, awsProfile: 'prod', gcpBillingExportTable: 'p.d.t'
        });

        const aws = results.find((r) => r.provider === 'aws');
        assert.strictEqual(aws.lastMonth.total, 10);
        assert.strictEqual(aws.monthToDate.total, 10);
        const awsCall = calls.find((c) => c.command === 'aws');
        assert.ok(awsCall.args.includes('Start=2026-09-01,End=2026-10-01'));
        assert.deepStrictEqual(awsCall.args.slice(-2), ['--profile', 'prod']);

        assert.match(results.find((r) => r.provider === 'azure').error, /az login/);

        const gcp = results.find((r) => r.provider === 'gcp');
        assert.strictEqual(gcp.lastMonth.total, 7.25);
        assert.ok(calls.find((c) => c.command === 'bq').input.includes('FROM `p.d.t`'), 'SQL goes via stdin, not argv');
    });

    test('Azure fetch writes the query body to a temp file and cleans it up', async () => {
        let bodyPath = null;
        const run = async (command, args) => {
            const bodyArg = args[args.indexOf('--body') + 1];
            bodyPath = bodyArg.slice(1);
            const body = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
            assert.strictEqual(body.type, 'ActualCost');
            assert.ok(args.some((a) => a.includes('/subscriptions/00000000-0000-0000-0000-000000000001/')));
            return JSON.stringify({ properties: { columns: [{ name: 'Cost' }, { name: 'ServiceName' }], rows: [[5, 'Storage']] } });
        };
        const { results } = await billing.fetchActualSpend(['azure'], {
            now: NOW, run, azureSubscriptionId: '00000000-0000-0000-0000-000000000001'
        });
        assert.strictEqual(results[0].lastMonth.total, 5);
        await new Promise((r) => setTimeout(r, 50));
        assert.strictEqual(fs.existsSync(bodyPath), false);
    });

    test('comparison markdown includes estimate, actuals, projection, and errors', () => {
        const periods = billing.getBillingPeriods(NOW);
        const svc = (total) => ({ total, currency: 'USD', services: [{ name: 'EC2', cost: total }], period: 'x' });
        const md = billing.buildComparisonMarkdown(
            { periods, results: [{ provider: 'aws', lastMonth: svc(300), monthToDate: svc(200) }, { provider: 'gcp', error: 'bq | not found' }] },
            { byProvider: [{ provider: 'aws', monthly: 250 }], totals: { monthly: 250 } },
            { currency: 'USD', projectName: 'demo' });

        assert.ok(md.includes('# Estimated vs. actual cloud spend — demo'));
        assert.ok(md.includes('| AWS | USD 250.00 | USD 300.00 | USD 200.00 | USD 310.00 | +24% |'), md);
        assert.ok(md.includes('bq \\| not found'), 'pipes in errors are escaped');
        assert.ok(md.includes('## AWS — top services'));
    });

    test('the real runner reports a missing CLI clearly', async () => {
        await assert.rejects(
            billing.runCommand('definitely-not-a-real-cli-xyz', ['--version'], { timeoutMs: 10000 }),
            /not found on PATH|exited with code/);
    });
});
