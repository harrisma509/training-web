const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chooseSessionMenuPlacement } = require("../static/coach.js");

const requests = [];
global.window = {};
global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
            return { deleted: true, coach_session_id: 42 };
        },
    };
};

require("../static/api.js");

(async () => {
    const result = await window.api.deleteCoachSession("42/unsafe");
    assert.deepEqual(result, { deleted: true, coach_session_id: 42 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/coach/sessions/42%2Funsafe");
    assert.equal(requests[0].options.method, "DELETE");

    const coachSource = fs.readFileSync("static/coach.js", "utf8");
    const indexSource = fs.readFileSync("index.html", "utf8");
    assert.match(coachSource, /Chat actions for \$\{title\}/);
    assert.match(coachSource, /Delete chat/);
    assert.match(coachSource, /input\.addEventListener\("blur", \(\) => saveRename/);
    assert.match(coachSource, /event\.key === "Escape"/);
    assert.match(coachSource, /state\.deletePending/);
    assert.match(coachSource, /placeSessionMenu\(id\)/);
    assert.match(coachSource, /is-upward/);
    assert.match(indexSource, /Permanently delete this chat\?/);
    assert.match(indexSource, /There is no trash or restore option/);
    assert.match(indexSource, /Delete permanently/);
    assert.doesNotMatch(coachSource, /Undo/);

    const rail = { top: 100, bottom: 500 };
    const menu = { height: 76 };
    assert.equal(chooseSessionMenuPlacement({ top: 200, bottom: 228 }, menu, rail, 800), "down");
    assert.equal(chooseSessionMenuPlacement({ top: 440, bottom: 468 }, menu, rail, 800), "up");
    let scrollTop = 184;
    const before = scrollTop;
    chooseSessionMenuPlacement({ top: 440, bottom: 468 }, menu, rail, 800);
    assert.equal(scrollTop, before);
    assert.match(coachSource, /getBoundingClientRect\(\)/);
    assert.doesNotMatch(coachSource, /scrollIntoView\(|\.scrollTop\s*=/);

    console.log("Coach session management API and UI contract tests passed.");
})();
