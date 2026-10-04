const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function extractFunction(source, functionName) {
    const marker = `function ${functionName}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${functionName} must exist in the shell`);

    const openBrace = source.indexOf(") {", start) + 2;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let index = openBrace; index < source.length; index += 1) {
        const character = source[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === "\"" || character === "'" || character === "`") {
            quote = character;
            continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

function loadDispatcherFactory() {
    const appSource = fs.readFileSync("static/app.js", "utf8");
    const functionSource = extractFunction(appSource, "createFeatureActivationDispatcher");
    return vm.runInNewContext(`(${functionSource})`);
}

function createHarness() {
    const events = [];
    const features = {
        daily: {},
        plan: {
            initCalls: 0,
            activateCalls: 0,
            async init() {
                this.initCalls += 1;
                await new Promise(resolve => setTimeout(resolve, 0));
            },
            activate(context) {
                this.activateCalls += 1;
                events.push(["activate", context.featureName, context.source]);
            },
        },
        search: {
            activate(context) {
                events.push(["search-activate", context.source, context.route.tab]);
            },
        },
        legacy: {},
    };
    let currentFeatureName = "daily";
    let committed = 0;
    const restored = [];
    const legacyCalls = [];

    const dispatcher = loadDispatcherFactory()({
        resolveFeature: name => features[name],
        getCurrentFeatureName: () => currentFeatureName,
        buildContext: (featureName, previousFeatureName, options) => ({
            featureName,
            previousFeatureName,
            source: options.source,
            reason: options.reason || options.source,
            route: options.route || { tab: featureName },
        }),
        commitTransition: context => {
            currentFeatureName = context.featureName;
            committed += 1;
            events.push(["commit", context.featureName]);
        },
        restoreBlockedRoute: context => restored.push(context.source),
        reportError: error => events.push(["error", error.message]),
        activateLegacy: (featureName, context) => legacyCalls.push([featureName, context.source]),
    });

    return {
        dispatcher,
        events,
        features,
        getCurrent: () => currentFeatureName,
        getCommitted: () => committed,
        restored,
        legacyCalls,
    };
}

async function main() {
    const harness = createHarness();
    const first = harness.dispatcher.activateFeature("plan", { source: "tab-click" });
    const second = harness.dispatcher.activateFeature("plan", { source: "mobile-nav" });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.accepted, true);
    assert.equal(secondResult.accepted, true);
    assert.equal(harness.features.plan.initCalls, 1, "overlapping activation must initialize once");
    assert.equal(harness.features.plan.activateCalls, 1, "same-tab overlap must not duplicate activation");
    assert.equal(harness.getCommitted(), 1);

    harness.features.plan.canDeactivate = () => false;
    const blocked = await harness.dispatcher.activateFeature("search", { source: "tab-click" });
    assert.equal(blocked.accepted, false);
    assert.equal(harness.getCurrent(), "plan");
    assert.deepEqual(harness.restored, ["tab-click"]);
    assert.equal(harness.getCommitted(), 1, "blocked deactivation must not commit visibility or URL");

    harness.features.plan.canDeactivate = async () => {
        throw new Error("guard failed");
    };
    const rejected = await harness.dispatcher.activateFeature("search", { source: "popstate" });
    assert.equal(rejected.accepted, false);
    assert.deepEqual(harness.restored, ["tab-click", "popstate"]);
    assert.equal(harness.getCommitted(), 1);
    assert.ok(harness.events.some(event => event[0] === "error" && event[1] === "guard failed"));

    const lifecycleOrder = [];
    harness.features.plan.canDeactivate = () => true;
    harness.features.plan.deactivate = () => lifecycleOrder.push("deactivate");
    harness.features.search.activate = context => lifecycleOrder.push(`activate:${context.source}`);
    const accepted = await harness.dispatcher.activateFeature("search", { source: "direct-url" });
    assert.equal(accepted.accepted, true);
    assert.deepEqual(lifecycleOrder, ["deactivate", "activate:direct-url"]);
    assert.equal(harness.legacyCalls.length, 0, "lifecycle activation must suppress legacy fallback");

    const legacy = await harness.dispatcher.activateFeature("legacy", { source: "programmatic" });
    assert.equal(legacy.accepted, true);
    assert.deepEqual(harness.legacyCalls, [["legacy", "programmatic"]]);

    console.log("Frontend activation dispatcher contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
