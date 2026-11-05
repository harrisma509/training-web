const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chooseSessionMenuPlacement, reasoningEffortLabel } = require("../static/coach.js");

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

    await window.api.updateCoachSession("42", { mode: "conversational" });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, "/api/coach/sessions/42");
    assert.equal(requests[1].options.method, "PATCH");
    assert.deepEqual(JSON.parse(requests[1].options.body), { mode: "conversational" });

    await window.api.fetchCoachModelStatus();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].url, "/api/coach/model-status");

    await window.api.refreshCoachModelStatus();
    assert.equal(requests.length, 4);
    assert.equal(requests[3].url, "/api/coach/model-status/refresh");
    assert.equal(requests[3].options.method, "POST");

    const coachSource = fs.readFileSync("static/coach.js", "utf8");
    const coachPaneSource = fs.readFileSync("templates/partials/panes/coach_pane.html", "utf8");
    const coachLayoutSource = fs.readFileSync("static/coach-layout.css", "utf8");
    const coachResponsiveSource = fs.readFileSync("static/coach-responsive.css", "utf8");
    const deleteDialogSource = fs.readFileSync("templates/partials/dialogs/coach_delete_dialog.html", "utf8");
    assert.match(coachSource, /Chat actions for \$\{title\}/);
    assert.match(coachSource, /Delete chat/);
    assert.match(coachSource, /input\.addEventListener\("blur", \(\) => saveRename/);
    assert.match(coachSource, /event\.key === "Escape"/);
    assert.match(coachSource, /state\.deletePending/);
    assert.match(coachSource, /coachModeSelect/);
    assert.match(coachSource, /What's on your mind\?/);
    assert.match(coachSource, /coach_mode/);
    assert.match(coachSource, /reasoning_effort_requested/);
    assert.equal(reasoningEffortLabel("high"), "High Reasoning");
    assert.equal(reasoningEffortLabel(null), "");
    assert.match(coachSource, /state\.modePending/);
    assert.match(coachSource, /fetchCoachModelStatus/);
    assert.match(coachPaneSource, /aria-label="Session info"/);
    assert.match(coachPaneSource, /<button id="coachModelStatusRefresh" class="coach-model-status-refresh" type="button"\s+aria-label="Refresh model availability">Refresh<\/button>/);
    assert.match(coachPaneSource, /coachModelUpdateNotice/);
    assert.doesNotMatch(coachPaneSource, /coachOverflowToggle|coachOverflowMenu/);
    assert.match(coachSource, /if \(state\.modelStatusRequest\) return state\.modelStatusRequest/);
    assert.match(coachSource, /refs\.modelStatusRefresh\.disabled = state\.modelStatusLoading/);
    assert.match(coachSource, /state\.modelStatusLoading\s*\?\s*"Checking…"\s*:\s*"Refresh"/);
    assert.match(coachSource, /loadCoachModelStatus\(true\)/);
    assert.match(coachSource, /refs\.usageToggle\.setAttribute\("aria-label", label\)/);
    assert.match(coachSource, /refs\.modelStatusRefresh\.addEventListener\("click", \(\) => loadCoachModelStatus\(true\)\)/);
    const refreshFlow = coachSource.match(/function loadCoachModelStatus\(forceRefresh = false\) \{[\s\S]*?\n    \}/)[0];
    assert.match(refreshFlow, /if \(state\.modelStatusRequest\) return state\.modelStatusRequest/);
    assert.match(refreshFlow, /await window\.api\.refreshCoachModelStatus\(\)/);
    assert.match(refreshFlow, /renderModelUpdateNotice\(\)/);
    assert.doesNotMatch(refreshFlow, /setUsagePanelOpen/);
    assert.match(coachPaneSource, /class="coach-configured-model-status"[\s\S]*?class="coach-configured-model-copy"[\s\S]*?class="coach-model-status-line"/);
    assert.match(coachPaneSource, /<div class="coach-model-status-line">[\s\S]*?id="coachConfiguredModelMessage"[\s\S]*?<button id="coachModelStatusRefresh"/);
    assert.match(coachPaneSource, /class="coach-usage-content"[\s\S]*?class="coach-configured-model-status"[\s\S]*?id="coachUsageItems"/);
    assert.match(coachPaneSource, /<button id="coachModelStatusRefresh"[^>]*aria-label="Refresh model availability">Refresh<\/button>/);
    assert.doesNotMatch(coachPaneSource, /↻/);
    assert.doesNotMatch(coachPaneSource, /Refresh model status|Provider Availability|Local Pricing/);
    assert.match(coachPaneSource, /id="coachUsageClose"[^>]*type="button"[^>]*aria-label="Close session info"/);
    assert.match(coachPaneSource, /class="coach-ai-sparkle"/);
    assert.match(coachSource, /refs\.usageClose\.addEventListener\("click", \(\) => setUsagePanelOpen\(false, true\)\)/);
    assert.match(coachLayoutSource, /\.coach-ai-sparkle\s*\{[^}]*color:\s*var\(--green\)/);
    const refreshStyle = coachLayoutSource.match(/\.coach-model-status-refresh \{[^}]*\}/)[0];
    assert.match(refreshStyle, /font-size:\s*12px/);
    assert.match(refreshStyle, /border:\s*0/);
    assert.match(refreshStyle, /background:\s*transparent/);
    assert.match(refreshStyle, /text-decoration:\s*none/);
    assert.doesNotMatch(refreshStyle, /border:\s*1px|background:\s*var\(/);
    assert.match(coachLayoutSource, /\.coach-model-status-refresh:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--green\)/);
    assert.match(coachLayoutSource, /\.coach-usage-content\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*980px;[^}]*margin-right:\s*auto;[^}]*margin-left:\s*0/);
    assert.match(coachLayoutSource, /\.coach-usage-content\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(coachLayoutSource, /\.coach-configured-model-status\s*\{[^}]*grid-column:\s*1 \/ span 4;[^}]*grid-row:\s*1/);
    assert.match(coachLayoutSource, /\.coach-usage-items\s*\{\s*display:\s*contents;/);
    assert.match(coachLayoutSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(1\)\s*\{[^}]*grid-column:\s*5 \/ span 4;[^}]*grid-row:\s*1/);
    assert.match(coachLayoutSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(2\)\s*\{[^}]*grid-column:\s*9 \/ span 4;[^}]*grid-row:\s*1/);
    assert.match(coachLayoutSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(3\)\s*\{[^}]*grid-column:\s*1 \/ span 3;[^}]*grid-row:\s*2/);
    assert.match(coachLayoutSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(4\)\s*\{[^}]*grid-column:\s*4 \/ span 3;[^}]*grid-row:\s*2/);
    assert.match(coachLayoutSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(5\)\s*\{[^}]*grid-column:\s*7 \/ span 3;[^}]*grid-row:\s*2/);
    assert.match(coachLayoutSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(6\)\s*\{[^}]*grid-column:\s*10 \/ span 3;[^}]*grid-row:\s*2/);
    assert.match(coachLayoutSource, /\.coach-usage-panel\s*\{[^}]*padding:\s*12px 24px/);
    assert.match(coachResponsiveSource, /@media \(max-width: 760px\)[\s\S]*?\.coach-usage-content\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(coachResponsiveSource, /\.coach-configured-model-status,[\s\S]*?\.coach-usage-items > \.coach-usage-item:nth-child\(1\),[\s\S]*?grid-column:\s*1 \/ -1/);
    assert.match(coachResponsiveSource, /\.coach-usage-items > \.coach-usage-item:nth-child\(3\),[\s\S]*?\.coach-usage-items > \.coach-usage-item:nth-child\(6\)[\s\S]*?grid-column:\s*span 1/);
    assert.match(coachResponsiveSource, /\.coach-usage-panel\s*\{[^}]*padding:\s*12px 14px/);
    const usageItems = coachSource.match(/const items = \[([\s\S]*?)\n        \];/)[1];
    const metricLabels = [...usageItems.matchAll(/\["([^"]+)",/g)].map(match => match[1]);
    assert.deepEqual(metricLabels, [
        "Session model",
        "Latest turn model",
        "Messages",
        "Turns",
        "Tokens",
        "Estimated cost",
    ]);
    assert.deepEqual(metricLabels.slice(0, 2), ["Session model", "Latest turn model"]);
    assert.deepEqual(metricLabels.slice(2), ["Messages", "Turns", "Tokens", "Estimated cost"]);
    assert.match(coachSource, /placeSessionMenu\(id\)/);
    assert.match(coachSource, /is-upward/);
    assert.match(deleteDialogSource, /Permanently delete this chat\?/);
    assert.match(deleteDialogSource, /There is no trash or restore option/);
    assert.match(deleteDialogSource, /Delete permanently/);
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
    assert.match(coachSource, /refs\.conversation\.scrollTop = refs\.conversation\.scrollHeight/);

    console.log("Coach session management API and UI contract tests passed.");
})();
