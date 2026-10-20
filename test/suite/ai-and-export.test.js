const assert = require('assert');
const ExcelJS = require('exceljs');
const AIAdvisor = require('../../src/ai-advisor');
const { buildWorkbook } = require('../../src/excel-exporter');

const RESOURCES = [
    { resource: { type: 'aws_instance', name: 'web', provider: 'aws', attributes: { instance_type: 'm5.xlarge' } }, cost: { monthly: 140.16 } },
    { resource: { type: 'aws_nat_gateway', name: 'nat', provider: 'aws', attributes: {} }, cost: { monthly: 32.85 }, sourceFile: 'net.tf' }
];

function chatResponse(content, ok = true, status = 200) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Error',
        json: async () => (ok ? { choices: [{ message: { content } }] } : { error: { message: content } })
    };
}

suite('AI advisor (stubbed provider API)', () => {
    let originalFetch;
    let lastRequest;

    setup(() => {
        originalFetch = globalThis.fetch;
        lastRequest = null;
    });

    teardown(() => {
        globalThis.fetch = originalFetch;
    });

    test('parses fenced JSON suggestions and sends the resources in the prompt', async () => {
        globalThis.fetch = async (url, init) => {
            lastRequest = { url, init, body: JSON.parse(init.body) };
            return chatResponse('```json\n[{"resource":"aws_instance.web","category":"rightsizing","suggestion":"Use m5.large","estimatedMonthlySavings":70,"confidence":"high"}]\n```');
        };

        const result = await new AIAdvisor({}).getSuggestions({
            provider: 'groq', apiKey: 'gsk_test', resources: RESOURCES,
            totals: { monthly: 173.01, yearly: 2076.12 }, currency: 'USD'
        });

        assert.strictEqual(lastRequest.url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.strictEqual(lastRequest.init.headers.authorization, 'Bearer gsk_test');
        const prompt = lastRequest.body.messages[0].content;
        assert.ok(prompt.includes('aws_instance.web (aws): 140.16 USD/mo — instance_type=m5.xlarge'));
        assert.ok(prompt.includes('aws_nat_gateway.nat (aws) [net.tf]'));
        assert.strictEqual(result.suggestions.length, 1);
        assert.strictEqual(result.suggestions[0].estimatedMonthlySavings, 70);
    });

    test('non-JSON answers are surfaced as a single low-confidence suggestion', async () => {
        globalThis.fetch = async () => chatResponse('Consider a savings plan for EC2.');
        const result = await new AIAdvisor({}).getSuggestions({ provider: 'openai', apiKey: 'sk', resources: RESOURCES });
        assert.strictEqual(result.suggestions.length, 1);
        assert.strictEqual(result.suggestions[0].confidence, 'low');
        assert.ok(result.suggestions[0].suggestion.includes('savings plan'));
    });

    test('provider errors are reported with the provider name and status', async () => {
        globalThis.fetch = async () => chatResponse('Invalid API key', false, 401);
        await assert.rejects(
            new AIAdvisor({}).getSuggestions({ provider: 'deepseek', apiKey: 'bad', resources: RESOURCES }),
            /DeepSeek API error \(401\): Invalid API key/);
    });

    test('scaling suggestions require capacity inputs and normalize unknown actions', async () => {
        const advisor = new AIAdvisor({});
        await assert.rejects(
            advisor.getScalingSuggestions({ provider: 'groq', apiKey: 'k', resources: RESOURCES, capacity: {} }),
            /No capacity\/usage inputs/);

        globalThis.fetch = async (url, init) => {
            lastRequest = JSON.parse(init.body);
            return chatResponse('[{"resource":"aws_instance.web","action":"explode","reasoning":"x","confidence":"medium"}]');
        };
        const result = await advisor.getScalingSuggestions({
            provider: 'groq', apiKey: 'k', resources: RESOURCES, capacity: { expected_users: 200, requests_per_day: 5000 }
        });
        assert.ok(lastRequest.messages[0].content.includes('Expected/current users: 200'));
        assert.strictEqual(result.suggestions[0].action, 'keep');
    });

    test('missing API key fails fast without calling the network', async () => {
        globalThis.fetch = async () => { throw new Error('should not be called'); };
        await assert.rejects(new AIAdvisor({}).getSuggestions({ provider: 'claude', apiKey: '', resources: RESOURCES }),
            /No API key configured for/);
    });
});

suite('Excel cost report', () => {
    const base = {
        projectName: 'demo',
        generatedAt: new Date('2026-10-20T10:00:00Z'),
        currency: 'USD',
        totals: { hourly: 0.24, monthly: 173.01, yearly: 2076.12 },
        resources: [
            { type: 'aws_instance', name: 'web', provider: 'aws', sourceFile: 'main.tf', monthly: 140.16, yearly: 1681.92, breakdown: ['EC2'] },
            { type: 'aws_nat_gateway', name: 'nat', provider: 'aws', sourceFile: 'net.tf', monthly: 32.85, yearly: 394.2, breakdown: ['NAT'] }
        ],
        forecast: { months: [1, 2, 3], flat: [173.01, 346.02, 519.03], growth: [173.01, 354.66, 545.4], growthRatePct: 5 }
    };

    async function roundTrip(data) {
        const buffer = await buildWorkbook(data).xlsx.writeBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        return workbook;
    }

    test('file scope produces the core sheets with correct totals', async () => {
        const wb = await roundTrip({ ...base, scope: 'file', scopeLabel: 'main.tf' });
        assert.deepStrictEqual(wb.worksheets.map((w) => w.name),
            ['Summary', 'Resources', 'By Provider', 'By Resource Type', '12-Month Forecast']);
        assert.strictEqual(wb.getWorksheet('Resources').rowCount, 3, 'header + 2 resources');
    });

    test('workspace scope with budget, capacity and history adds the optional sheets', async () => {
        const wb = await roundTrip({
            ...base,
            scope: 'workspace',
            scopeLabel: '2 files',
            fileCount: 2,
            byFile: [{ file: 'main.tf', monthly: 140.16, count: 1 }, { file: 'net.tf', monthly: 32.85, count: 1 }],
            budget: { limit_1: 100, final_limit: 500, level: 1, current: 173.01 },
            capacityConfig: { expected_users: 1000 },
            costHistory: [{ timestamp: '2026-10-01T00:00:00Z', scope: 'workspace', label: 'Oct', totalMonthly: 150, currency: 'USD', resourceCount: 2 }]
        });
        const names = wb.worksheets.map((w) => w.name);
        for (const sheet of ['By File-Module', 'Budget', 'Capacity Inputs', 'Cost History']) {
            assert.ok(names.includes(sheet), `missing ${sheet}: ${names.join(', ')}`);
        }
    });
});
