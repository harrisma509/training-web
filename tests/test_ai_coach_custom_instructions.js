const assert = require("node:assert/strict");

const fields = [
    "coaching_priorities",
    "safety_progression_rules",
    "training_approach",
    "recovery_adjustment_rules",
    "communication_style",
    "planning_preferences",
    "other_instructions",
];
const blankProfile = Object.fromEntries(fields.map((field) => [field, ""]));
const requests = [];

global.window = {};
global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
            return { ...blankProfile, updated_at: "2026-09-08T12:00:00Z" };
        },
    };
};

const validation = require("../static/ai-coach-custom-instructions-validation.js");
require("../static/api.js");

(async () => {
    const blank = validation.validateCustomInstructionsDraft(blankProfile);
    assert.equal(blank.valid, true);
    assert.equal(blank.combinedCharacters, 0);

    const normalized = validation.validateCustomInstructionsDraft({
        ...blankProfile,
        communication_style: "  First\r\n\r\nSecond\r  ",
    });
    assert.equal(normalized.valid, true);
    assert.equal(normalized.normalized.communication_style, "First\n\nSecond");

    const oneSectionAtLimit = validation.validateCustomInstructionsDraft({
        ...blankProfile,
        coaching_priorities: "a".repeat(1500),
    });
    assert.equal(oneSectionAtLimit.valid, true);

    const oneSectionOverLimit = validation.validateCustomInstructionsDraft({
        ...blankProfile,
        coaching_priorities: "a".repeat(1501),
    });
    assert.equal(oneSectionOverLimit.valid, false);
    assert.match(oneSectionOverLimit.errors.coaching_priorities, /1,500/);

    const combinedAtLimit = validation.validateCustomInstructionsDraft({
        coaching_priorities: "a".repeat(1500),
        safety_progression_rules: "b".repeat(1500),
        training_approach: "c".repeat(1500),
        recovery_adjustment_rules: "d".repeat(1500),
        communication_style: "e".repeat(1500),
        planning_preferences: "f".repeat(500),
        other_instructions: "",
    });
    assert.equal(combinedAtLimit.valid, true);
    assert.equal(combinedAtLimit.combinedCharacters, 8000);

    const combinedOverLimit = validation.validateCustomInstructionsDraft({
        ...combinedAtLimit.normalized,
        other_instructions: "g",
    });
    assert.equal(combinedOverLimit.valid, false);
    assert.match(combinedOverLimit.combinedError, /8,000/);

    const loaded = await window.api.fetchAiCoachCustomInstructions();
    assert.equal(requests[0].url, "/api/settings/ai-coach/custom-instructions");
    assert.equal(requests[0].options.method, undefined);
    assert.equal(loaded.updated_at, "2026-09-08T12:00:00Z");

    const payload = { ...blankProfile, communication_style: "Direct\nanswers" };
    await window.api.saveAiCoachCustomInstructions(payload);
    assert.equal(requests[1].url, "/api/settings/ai-coach/custom-instructions");
    assert.equal(requests[1].options.method, "PUT");
    assert.deepEqual(Object.keys(JSON.parse(requests[1].options.body)).sort(), [...fields].sort());
    assert.deepEqual(JSON.parse(requests[1].options.body), payload);
    assert.equal("updated_at" in JSON.parse(requests[1].options.body), false);

    console.log("AI Coach Custom Instructions API and validation tests passed.");
})();
