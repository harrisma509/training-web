const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
    formatTurnMetadata,
    humanModel,
    coachModelUpdateNotice,
    reasoningEffortLabel,
} = require("../static/coach.js");

assert.equal(humanModel("gpt-6-luna"), "GPT-6 Luna");
assert.equal(humanModel("gpt-5.6-luna"), "GPT-5.6 Luna");
assert.equal(humanModel("gpt-5.6-luna-standard"), "GPT-5.6 Luna Standard");
assert.equal(humanModel("  future-model-luna  "), "Future Model Luna");
assert.equal(humanModel("  "), "Model unavailable");

assert.equal(
    coachModelUpdateNotice({
        availability_status: "checked",
        newer_approved_model_available: true,
        newer_approved_model: "gpt-6-luna",
        newer_approved_model_name: "GPT-6 Luna",
    }),
    "GPT-6 Luna available",
);
assert.equal(coachModelUpdateNotice({ availability_status: "unavailable" }), "");
assert.equal(
    coachModelUpdateNotice({
        availability_status: "checked",
        newer_approved_model_available: false,
    }),
    "",
);

assert.equal(reasoningEffortLabel("high"), "High Reasoning");
assert.equal(reasoningEffortLabel("medium"), "Medium Reasoning");
assert.equal(reasoningEffortLabel("low"), "Low Reasoning");
assert.equal(reasoningEffortLabel("xhigh"), "XHigh Reasoning");
assert.equal(reasoningEffortLabel("max"), "Max Reasoning");
assert.equal(reasoningEffortLabel("none"), "None");
assert.equal(reasoningEffortLabel(null), "");

assert.equal(
    formatTurnMetadata("gpt-6-luna", "high", 16900, 87600, 0.0091),
    "GPT-6 Luna • High Reasoning • 16.9 sec • 87.6K tokens • $0.0091",
);
assert.equal(
    formatTurnMetadata("gpt-5.6-luna", "none", 9900, 32700, 0.0073),
    "GPT-5.6 Luna • None • 9.9 sec • 32.7K tokens • $0.0073",
);

const coachDocumentation = fs.readFileSync("docs/AI_COACH.md", "utf8");
assert.match(coachDocumentation, /TRAINING_AI_MODEL` selects the active\s+Coach model for new requests/);
assert.match(coachDocumentation, /TRAINING_AI_MODEL=<supported-model-id>/);
assert.match(coachDocumentation, /immutable application catalog currently approves/);
assert.match(coachDocumentation, /cached in process for 24 hours/);
assert.match(coachDocumentation, /four-second timeout/);
assert.match(coachDocumentation, /unknown pricing fails closed before a paid request/);
assert.match(coachDocumentation, /Completed turns retain the actual model used/);
assert.match(coachDocumentation, /does not change `TRAINING_AI_MODEL` or switch/);
assert.match(coachDocumentation, /docker restart training-web` does not reload Compose environment/);
assert.match(coachDocumentation, /docker compose up -d --force-recreate training-web/);
assert.doesNotMatch(coachDocumentation, /- Model: `gpt-(?:5\.6|6)-luna`/);
assert.doesNotMatch(coachDocumentation, /current production model is/);

console.log("Coach model metadata formatting tests passed.");
