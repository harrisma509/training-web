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
                max_output_tokens: 32000,
                reasoning_effort: "high",
                detailed_daily_history_days: 28,
                weekly_history_rows: 26,
                updated_at: "2026-09-08T12:00:00Z",
            };
        },
    };
};

require("../static/api.js");
const {
    detailedDailyHistoryWarning,
    hydrateAiCoachSettingsFields,
    validateAiCoachSettingsDraft,
    weeklyHistoryWarning,
} = require("../static/ai-coach-settings-validation.js");

(async () => {
    const loaded = await window.api.fetchAiCoachSettings();
    assert.equal(requests[0].url, "/api/settings/ai-coach");
    assert.equal(requests[0].options.method, undefined);
    assert.equal(loaded.monthly_cost_limit_usd, "0.00");

    const input = { value: "" };
    hydrateAiCoachSettingsFields({ detailed_daily_history_days: "56" }, {
        detailed_daily_history_days: input,
    });
    assert.equal(input.value, "56");

    const extendedInput = { value: "" };
    hydrateAiCoachSettingsFields({ detailed_daily_history_days: "105" }, {
        detailed_daily_history_days: extendedInput,
    });
    assert.equal(extendedInput.value, "105");
    assert.equal(
        detailedDailyHistoryWarning({ detailed_daily_history_days: "105" }),
        "Extended history may substantially increase context size and cost.",
    );

    for (const [value, warning] of [
        ["26", ""],
        ["52", ""],
        ["104", "Extended weekly history may increase context size and cost."],
    ]) {
        const weeklyInput = { value: "" };
        hydrateAiCoachSettingsFields({ weekly_history_rows: value }, {
            weekly_history_rows: weeklyInput,
        });
        assert.equal(weeklyInput.value, value);
        assert.equal(weeklyHistoryWarning({ weekly_history_rows: value }), warning);
    }

    await window.api.saveAiCoachSettings({
        monthly_cost_limit_usd: 0,
        max_turn_cost_usd: 1,
        max_output_tokens: 32000,
        reasoning_effort: "high",
        detailed_daily_history_days: 28,
        weekly_history_rows: 26,
    });
    assert.equal(requests[1].url, "/api/settings/ai-coach");
    assert.equal(requests[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(requests[1].options.body), {
        monthly_cost_limit_usd: 0,
        max_turn_cost_usd: 1,
        max_output_tokens: 32000,
        reasoning_effort: "high",
        detailed_daily_history_days: 28,
        weekly_history_rows: 26,
    });

    const valid = validateAiCoachSettingsDraft({
        monthly_cost_limit_usd: "0.00",
        max_turn_cost_usd: "1.00",
        max_output_tokens: "32000",
        reasoning_effort: "high",
        detailed_daily_history_days: "28",
        weekly_history_rows: "26",
    });
    assert.equal(valid.valid, true);

    const independentLimits = validateAiCoachSettingsDraft({
        monthly_cost_limit_usd: "0.01",
        max_turn_cost_usd: "1.00",
        max_output_tokens: "250",
        reasoning_effort: "none",
        detailed_daily_history_days: "365",
        weekly_history_rows: "104",
    });
    assert.equal(independentLimits.valid, true);

    for (const [field, value] of [
        ["monthly_cost_limit_usd", "25.01"],
        ["max_turn_cost_usd", "0.00"],
        ["max_output_tokens", "249"],
        ["max_output_tokens", "32001"],
        ["max_output_tokens", "250.5"],
        ["detailed_daily_history_days", "6"],
        ["detailed_daily_history_days", "366"],
        ["detailed_daily_history_days", "28.5"],
        ["weekly_history_rows", "3"],
        ["weekly_history_rows", "105"],
        ["weekly_history_rows", "52.5"],
    ]) {
        const draft = {
            monthly_cost_limit_usd: "5.00",
            max_turn_cost_usd: "0.25",
            max_output_tokens: "1200",
            reasoning_effort: "low",
            detailed_daily_history_days: "28",
            weekly_history_rows: "26",
            [field]: value,
        };
        assert.equal(validateAiCoachSettingsDraft(draft).valid, false);
    }

    console.log("AI Coach settings API and validation tests passed.");
})();
