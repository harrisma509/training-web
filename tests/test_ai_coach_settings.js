const assert = require("node:assert/strict");

const requests = [];
global.window = {};
global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
            return {
                monthly_cost_limit_usd: "0.00",
                max_turn_cost_usd: "1.00",
                max_output_tokens: 8000,
                reasoning_effort: "high",
                updated_at: "2026-09-08T12:00:00Z",
            };
        },
    };
};

require("../static/api.js");
const { validateAiCoachSettingsDraft } = require("../static/ai-coach-settings-validation.js");

(async () => {
    const loaded = await window.api.fetchAiCoachSettings();
    assert.equal(requests[0].url, "/api/settings/ai-coach");
    assert.equal(requests[0].options.method, undefined);
    assert.equal(loaded.monthly_cost_limit_usd, "0.00");

    await window.api.saveAiCoachSettings({
        monthly_cost_limit_usd: 0,
        max_turn_cost_usd: 1,
        max_output_tokens: 8000,
        reasoning_effort: "high",
    });
    assert.equal(requests[1].url, "/api/settings/ai-coach");
    assert.equal(requests[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(requests[1].options.body), {
        monthly_cost_limit_usd: 0,
        max_turn_cost_usd: 1,
        max_output_tokens: 8000,
        reasoning_effort: "high",
    });

    const valid = validateAiCoachSettingsDraft({
        monthly_cost_limit_usd: "0.00",
        max_turn_cost_usd: "1.00",
        max_output_tokens: "8000",
        reasoning_effort: "high",
    });
    assert.equal(valid.valid, true);

    const independentLimits = validateAiCoachSettingsDraft({
        monthly_cost_limit_usd: "0.01",
        max_turn_cost_usd: "1.00",
        max_output_tokens: "250",
        reasoning_effort: "none",
    });
    assert.equal(independentLimits.valid, true);

    for (const [field, value] of [
        ["monthly_cost_limit_usd", "25.01"],
        ["max_turn_cost_usd", "0.00"],
        ["max_output_tokens", "249"],
        ["max_output_tokens", "250.5"],
    ]) {
        const draft = {
            monthly_cost_limit_usd: "5.00",
            max_turn_cost_usd: "0.25",
            max_output_tokens: "1200",
            reasoning_effort: "low",
            [field]: value,
        };
        assert.equal(validateAiCoachSettingsDraft(draft).valid, false);
    }

    console.log("AI Coach settings API and validation tests passed.");
})();
