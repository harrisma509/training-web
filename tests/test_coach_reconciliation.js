const assert = require("node:assert/strict");

const { hasNewPersistedUserMessage } = require("../static/coach.js");

const message = "How am I doing this week?";
const baseline = new Set(["10"]);

assert.equal(
    hasNewPersistedUserMessage([{ role: "user", message_text: message, coach_message_id: 10 }], message, baseline),
    false,
);
assert.equal(
    hasNewPersistedUserMessage([
        { role: "user", message_text: message, coach_message_id: 10 },
        { role: "user", message_text: message, coach_message_id: 13 },
    ], message, baseline),
    true,
);
assert.equal(
    hasNewPersistedUserMessage([{ role: "user", message_text: "A different question", coach_message_id: 13 }], message, baseline),
    false,
);
assert.equal(
    hasNewPersistedUserMessage([{ role: "user", message_text: message, coach_message_id: null }], message, baseline),
    false,
);

console.log("Coach reconciliation predicate tests passed.");