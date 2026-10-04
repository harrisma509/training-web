const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function extractFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    const openBrace = source.indexOf(") {", start) + 2;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = openBrace; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (["\"", "'", "`"].includes(character)) {
            quote = character;
            continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

const componentsSource = fs.readFileSync("static/components.js", "utf8");
const createAdapter = vm.runInNewContext(`(${extractFunction(componentsSource, "createComponentsLifecycleAdapter")})`);

async function main() {
    let dirty = { editor: false, service: false, history: false };
    let confirmResult = false;
    let confirmCalls = 0;
    const closes = [];
    const adapter = createAdapter({
        surfaces: {
            editor: { close: reason => closes.push(["editor", reason]) },
            service: { close: reason => closes.push(["service", reason]) },
            history: { close: reason => closes.push(["history", reason]) },
        },
        getDirtyState: () => dirty,
        confirmDiscard: () => {
            confirmCalls += 1;
            return confirmResult;
        },
    });

    assert.equal(adapter.init(), true);
    assert.equal(adapter.activate({ source: "desktop" }), true);
    assert.equal(adapter.canDeactivate(), true, "clean Components state should deactivate immediately");
    assert.equal(confirmCalls, 0);

    dirty.editor = true;
    confirmResult = false;
    assert.equal(await adapter.canDeactivate({ source: "popstate" }), false, "declined discard blocks navigation");
    assert.equal(confirmCalls, 1);
    assert.deepEqual(closes, []);

    confirmResult = true;
    const first = adapter.canDeactivate({ source: "mobile-nav" });
    const second = adapter.canDeactivate({ source: "mobile-nav" });
    assert.equal(first, second, "overlapping guards share one confirmation promise");
    assert.equal(await first, true);
    assert.equal(confirmCalls, 2);
    assert.equal(await adapter.canDeactivate(), true, "accepted confirmation does not mutate dirty state");

    adapter.deactivate("service-subtab");
    assert.deepEqual(closes, [
        ["editor", "service-subtab"],
        ["service", "service-subtab"],
        ["history", "service-subtab"],
    ]);

    assert.match(componentsSource, /componentEditorDirty = false;\s+closeComponentEditor\(\)/);
    assert.match(componentsSource, /catch \(error\) \{[\s\S]*setComponentEditorStatus\(error\.message/);
    assert.match(componentsSource, /historyEditorDirty && !window\.confirm\("Discard unsaved changes\?"\)/);
    console.log("Components lifecycle adapter contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});