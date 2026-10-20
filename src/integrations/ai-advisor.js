/**
 * Multi-provider AI cost-optimization and capacity-planning advisor.
 *
 * Given the resources+costs already computed by TerraformCostCalculator, asks
 * a user-chosen LLM (Gemini, Claude, GPT, DeepSeek, or Groq) for either:
 *  - getSuggestions(): concrete cost suggestions ("this m5.xlarge is
 *    oversized, switch to m5.large: ~$73/mo savings"), or
 *  - getScalingSuggestions(): scale up/down suggestions reasoned against an
 *    expected real-world load (users/requests/growth) the caller supplies.
 * Both are one-shot request/response — no chat state, no auto-firing on
 * every keystroke; callers decide when to invoke it (a button/command).
 *
 * DeepSeek and Groq are both included as low-/no-cost options: DeepSeek is
 * pay-as-you-go at a fraction of a cent per request with no minimum spend,
 * and Groq has a genuinely free tier (no card required). Both speak the same
 * OpenAI-compatible chat-completions API, so they share one adapter.
 *
 * API keys are stored via VS Code's SecretStorage (context.secrets), never
 * in settings.json — settings only hold the provider choice and an optional
 * model override.
 */

const SECRET_KEY_PREFIX = 'terraformCost.ai.apiKey.';

const PROVIDER_LABELS = {
    gemini: 'Gemini',
    claude: 'Claude',
    openai: 'GPT',
    deepseek: 'DeepSeek',
    groq: 'Groq'
};

// Provider model ids drift fast — verified live: 'gemini-2.0-flash' was
// already retired, and by the time a fix landed 'gemini-2.5-flash' had been
// deprecated for new accounts too (in favor of 'gemini-3.6-flash' at time of
// writing). Using Google's rolling '-latest' alias instead of a pinned
// version avoids re-fixing this every few months. Groq's 'llama-3.3-70b-versatile'
// turned out to already be gone too (checked against an actual Groq console's
// org rate-limit table — only llama-prompt-guard-2-* remain, which are safety
// classifiers, not chat models); 'openai/gpt-oss-120b' is the current
// flagship general-purpose model there instead. These are all overridable
// per-user via the terraformCost.ai.model setting regardless.
const DEFAULT_MODELS = {
    gemini: 'gemini-flash-latest',
    claude: 'claude-sonnet-5',
    openai: 'gpt-4o-mini',
    deepseek: 'deepseek-chat',
    groq: 'openai/gpt-oss-120b'
};

// OpenAI-compatible providers (same request/response shape, different host).
const OPENAI_COMPATIBLE_BASE_URLS = {
    openai: 'https://api.openai.com/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions'
};

class AIAdvisor {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
    }

    static get PROVIDER_LABELS() {
        return PROVIDER_LABELS;
    }

    async getApiKey(provider) {
        if (!provider || provider === 'none') return undefined;
        return this.context.secrets.get(SECRET_KEY_PREFIX + provider);
    }

    async setApiKey(provider, key) {
        await this.context.secrets.store(SECRET_KEY_PREFIX + provider, key);
    }

    async clearApiKey(provider) {
        await this.context.secrets.delete(SECRET_KEY_PREFIX + provider);
    }

    /**
     * @param {object} opts
     * @param {'gemini'|'claude'|'openai'|'deepseek'|'groq'} opts.provider
     * @param {string} [opts.model] - overrides the provider's default model
     * @param {string} opts.apiKey
     * @param {Array<{resource: object, cost: object}>} opts.resources
     * @param {object} [opts.totals] - { monthly, yearly, hourly }
     * @param {object} [opts.budget] - budget status from buildDashboardAggregate, if any
     * @param {string} [opts.currency]
     * @returns {Promise<{ provider: string, model: string, suggestions: Array, raw?: string }>}
     */
    async getSuggestions({ provider, model, apiKey, resources, totals, budget, currency }) {
        if (typeof fetch !== 'function') {
            throw new Error('This VS Code build has no global fetch available (requires Node 18+).');
        }
        if (!apiKey) {
            throw new Error(`No API key configured for ${PROVIDER_LABELS[provider] || provider}.`);
        }
        if (!resources || resources.length === 0) {
            throw new Error('No cost-relevant resources to analyze.');
        }

        const resolvedModel = model || DEFAULT_MODELS[provider];
        const prompt = buildPrompt({ resources, totals, budget, currency });
        const text = await callProvider(provider, apiKey, resolvedModel, prompt);

        const suggestions = parseSuggestions(text);
        return { provider, model: resolvedModel, suggestions, raw: text };
    }

    /**
     * Like getSuggestions, but reasons about whether each resource is right-sized
     * for an expected real-world load (users/requests/growth) instead of purely
     * about cost — "scale up before this bottlenecks" as well as "scale down,
     * you're paying for headroom nobody uses".
     *
     * @param {object} opts
     * @param {'gemini'|'claude'|'openai'|'deepseek'|'groq'} opts.provider
     * @param {string} [opts.model]
     * @param {string} opts.apiKey
     * @param {Array<{resource: object, cost: object}>} opts.resources
     * @param {object} opts.capacity - from CapacityManager: { expected_users?, requests_per_day?, peak_requests_per_second?, growth_rate_percent? }
     * @param {string} [opts.currency]
     * @returns {Promise<{ provider: string, model: string, suggestions: Array, raw?: string }>}
     */
    async getScalingSuggestions({ provider, model, apiKey, resources, capacity, currency }) {
        if (typeof fetch !== 'function') {
            throw new Error('This VS Code build has no global fetch available (requires Node 18+).');
        }
        if (!apiKey) {
            throw new Error(`No API key configured for ${PROVIDER_LABELS[provider] || provider}.`);
        }
        if (!resources || resources.length === 0) {
            throw new Error('No cost-relevant resources to analyze.');
        }
        if (!capacity || Object.keys(capacity).length === 0) {
            throw new Error('No capacity/usage inputs set. Run "Terraform Cost: Set Capacity & Scaling Inputs" first.');
        }

        const resolvedModel = model || DEFAULT_MODELS[provider];
        const prompt = buildScalingPrompt({ resources, capacity, currency });
        const text = await callProvider(provider, apiKey, resolvedModel, prompt);

        const suggestions = parseScalingSuggestions(text);
        return { provider, model: resolvedModel, suggestions, raw: text };
    }
}

/** Shared provider dispatch, used by both getSuggestions and getScalingSuggestions. */
async function callProvider(provider, apiKey, model, prompt) {
    if (provider === 'gemini') return callGemini(apiKey, model, prompt);
    if (provider === 'claude') return callClaude(apiKey, model, prompt);
    if (OPENAI_COMPATIBLE_BASE_URLS[provider]) {
        return callOpenAICompatible(OPENAI_COMPATIBLE_BASE_URLS[provider], PROVIDER_LABELS[provider], apiKey, model, prompt);
    }
    throw new Error(`Unknown AI provider: ${provider}`);
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

// Workspace-scope calls can hand this dozens/hundreds of resources across
// many files; cap how many go into the prompt (highest-cost first, since
// those are the ones worth a model's attention) rather than let a huge
// project silently blow past a provider's context window or run up token
// cost for no extra insight. File-scope calls essentially never hit this.
const MAX_RESOURCES_IN_PROMPT = 150;

function buildPrompt({ resources, totals, budget, currency }) {
    const cur = currency || 'USD';
    const { lines: resourceLines, truncatedCount } = formatResourceLines(resources, cur);

    const totalLine = totals
        ? `Total estimated cost: ${totals.monthly.toFixed(2)} ${cur}/month (${totals.yearly.toFixed(2)} ${cur}/year).`
        : '';

    const budgetLine = budget && (budget.final_limit || budget.limit_1)
        ? `Budget context: current spend is ${budget.current?.toFixed(2)} ${cur}/mo against a final limit of ${budget.final_limit ?? 'n/a'} ${cur}/mo.`
        : '';

    const truncationNote = truncatedCount > 0
        ? `\n(Showing the ${MAX_RESOURCES_IN_PROMPT} highest-cost resources; ${truncatedCount} lower-cost resource(s) omitted for brevity.)\n`
        : '';

    return `You are a FinOps / cloud cost optimization expert reviewing a Terraform configuration.

${totalLine}
${budgetLine}

Resources and their estimated monthly cost:
${resourceLines}
${truncationNote}
Give concrete, resource-specific cost optimization suggestions (rightsizing, reserved instances/savings plans, storage class or tier changes, architecture swaps like NAT Gateway -> VPC endpoint, removing redundant resources, etc). Skip resources that already look reasonably sized — do not pad the list with generic advice.

Respond with ONLY a JSON array (no markdown fences, no prose before or after), where each item has this exact shape:
[
  {
    "resource": "type.name",
    "category": "rightsizing" | "reserved_capacity" | "storage" | "architecture" | "other",
    "suggestion": "one or two sentence, concrete and specific",
    "estimatedMonthlySavings": number or null,
    "confidence": "low" | "medium" | "high"
  }
]
If nothing meaningful to suggest, respond with an empty JSON array: []`;
}

function buildScalingPrompt({ resources, capacity, currency }) {
    const cur = currency || 'USD';
    const { lines: resourceLines, truncatedCount } = formatResourceLines(resources, cur);
    const truncationNote = truncatedCount > 0
        ? `\n(Showing the ${MAX_RESOURCES_IN_PROMPT} highest-cost resources; ${truncatedCount} lower-cost resource(s) omitted for brevity.)\n`
        : '';

    const loadLines = [
        capacity.expected_users != null ? `Expected/current users: ${capacity.expected_users}` : null,
        capacity.requests_per_day != null ? `Requests per day: ${capacity.requests_per_day}` : null,
        capacity.peak_requests_per_second != null ? `Peak requests/second: ${capacity.peak_requests_per_second}` : null,
        capacity.growth_rate_percent != null ? `Expected growth: ~${capacity.growth_rate_percent}%/month` : null
    ].filter(Boolean).join('\n') || '(no specific figures given)';

    return `You are a cloud capacity planning expert reviewing a Terraform configuration against its expected real-world load.

Expected load:
${loadLines}

Resources and their current sizing:
${resourceLines}
${truncationNote}
For each resource whose current size looks mismatched with the expected load — either under-provisioned (risk of bottlenecks/downtime under the stated load) or over-provisioned (paying for headroom nobody uses) — give a scale up or scale down recommendation. Be conservative: this is a rough estimate based on typical throughput for that instance/resource family, not a substitute for real load testing, and your reasoning should say so implicitly by staying appropriately hedged. Skip resources that look reasonably sized for the given load — do not pad the list.

Respond with ONLY a JSON array (no markdown fences, no prose before or after), where each item has this exact shape:
[
  {
    "resource": "type.name",
    "action": "scale_up" | "scale_down" | "keep",
    "suggestedChange": "e.g. 't3.medium -> t3.large', or null if action is keep",
    "reasoning": "one or two sentences, referencing the actual expected load numbers given above",
    "confidence": "low" | "medium" | "high"
  }
]
If nothing meaningful to suggest, respond with an empty JSON array: []`;
}

/**
 * Formats a resource list into prompt lines, highest-cost first, tagging
 * each with its source file when present (workspace-scope calls) so the
 * model can reference which file a suggestion applies to. Caps at
 * MAX_RESOURCES_IN_PROMPT to keep workspace-wide calls from silently
 * blowing past context/token limits on a very large project.
 */
function formatResourceLines(resources, cur) {
    const sorted = [...resources].sort((a, b) => (b.cost?.monthly || 0) - (a.cost?.monthly || 0));
    const shown = sorted.slice(0, MAX_RESOURCES_IN_PROMPT);
    const truncatedCount = sorted.length - shown.length;

    const lines = shown.map(({ resource, cost, sourceFile }) => {
        const attrs = summarizeAttributes(resource.attributes);
        const fileTag = sourceFile ? ` [${sourceFile}]` : '';
        return `- ${resource.type}.${resource.name} (${resource.provider})${fileTag}: ${(cost.monthly || 0).toFixed(2)} ${cur}/mo${attrs ? ` — ${attrs}` : ''}`;
    }).join('\n');

    return { lines, truncatedCount };
}

function summarizeAttributes(attributes) {
    if (!attributes) return '';
    const keys = ['instance_type', 'machine_type', 'vm_size', 'instance_class', 'size', 'type', 'engine', 'multi_az', 'storage_class'];
    const parts = [];
    for (const k of keys) {
        if (attributes[k] !== undefined) parts.push(`${k}=${attributes[k]}`);
    }
    return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Provider adapters — plain fetch, no SDKs, to keep the extension lightweight.
// ---------------------------------------------------------------------------

async function callGemini(apiKey, model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 }
        })
    });
    const data = await safeJson(res);
    if (!res.ok) {
        throw new Error(`Gemini API error (${res.status}): ${data?.error?.message || res.statusText}`);
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
}

async function callClaude(apiKey, model, prompt) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        })
    });
    const data = await safeJson(res);
    if (!res.ok) {
        throw new Error(`Claude API error (${res.status}): ${data?.error?.message || res.statusText}`);
    }
    const text = data?.content?.map((b) => b.text).join('') || '';
    if (!text) throw new Error('Claude returned an empty response.');
    return text;
}

/** Shared adapter for OpenAI, DeepSeek, and Groq — all use the same chat-completions shape. */
async function callOpenAICompatible(baseUrl, label, apiKey, model, prompt) {
    const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3
        })
    });
    const data = await safeJson(res);
    if (!res.ok) {
        throw new Error(`${label} API error (${res.status}): ${data?.error?.message || res.statusText}`);
    }
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error(`${label} returned an empty response.`);
    return text;
}

async function safeJson(res) {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Response parsing — models occasionally wrap JSON in markdown fences or add
// stray prose despite instructions; parse defensively and never throw past
// this point, so a malformed response still surfaces something useful.
// ---------------------------------------------------------------------------

function parseSuggestions(text) {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    try {
        const parsed = JSON.parse(stripped);
        if (Array.isArray(parsed)) {
            return parsed
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    resource: typeof item.resource === 'string' ? item.resource : null,
                    category: typeof item.category === 'string' ? item.category : 'other',
                    suggestion: typeof item.suggestion === 'string' ? item.suggestion : JSON.stringify(item),
                    estimatedMonthlySavings: typeof item.estimatedMonthlySavings === 'number' ? item.estimatedMonthlySavings : null,
                    confidence: typeof item.confidence === 'string' ? item.confidence : 'low'
                }));
        }
    } catch {
        // fall through to raw-text fallback below
    }

    // Model didn't return valid JSON — surface the raw text as a single
    // suggestion rather than silently discarding a real answer.
    return [{
        resource: null,
        category: 'other',
        suggestion: stripped.slice(0, 2000),
        estimatedMonthlySavings: null,
        confidence: 'low'
    }];
}

function parseScalingSuggestions(text) {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const VALID_ACTIONS = ['scale_up', 'scale_down', 'keep'];

    try {
        const parsed = JSON.parse(stripped);
        if (Array.isArray(parsed)) {
            return parsed
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    resource: typeof item.resource === 'string' ? item.resource : null,
                    action: VALID_ACTIONS.includes(item.action) ? item.action : 'keep',
                    suggestedChange: typeof item.suggestedChange === 'string' ? item.suggestedChange : null,
                    reasoning: typeof item.reasoning === 'string' ? item.reasoning : JSON.stringify(item),
                    confidence: typeof item.confidence === 'string' ? item.confidence : 'low'
                }));
        }
    } catch {
        // fall through to raw-text fallback below
    }

    return [{
        resource: null,
        action: 'keep',
        suggestedChange: null,
        reasoning: stripped.slice(0, 2000),
        confidence: 'low'
    }];
}

module.exports = AIAdvisor;
