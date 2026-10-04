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

const appSource = fs.readFileSync("static/app.js", "utf8");

async function main() {
    const calls = [];
    let allowNavigation = false;
    const context = {
        window: {
            AppState: { serviceSubtab: "components" },
            TrainingApp: {
                features: {
                    service: {
                        canDeactivate: async transition => {
                            calls.push(["guard", transition.source, transition.destinationSubtab]);
                            return allowNavigation;
                        },
                        deactivate: transition => calls.push(["deactivate", transition.reason]),
                    },
                },
            },
        },
        state: { serviceSubtab: "components" },
        showServiceSubtab: subtab => {
            context.state.serviceSubtab = subtab;
            calls.push(["show", subtab]);
        },
    };

    context.requestServiceSubtab = vm.runInNewContext(`(async ${extractFunction(appSource, "requestServiceSubtab")})`, context);
    const blocked = await context.requestServiceSubtab("gear");
    assert.equal(blocked, false);
    assert.equal(context.state.serviceSubtab, "components");
    assert.deepEqual(calls, [["guard", "service-subtab", "gear"]]);

    calls.length = 0;
    allowNavigation = true;
    const accepted = await context.requestServiceSubtab("gear");
    assert.equal(accepted, true);
    assert.equal(context.state.serviceSubtab, "gear");
    assert.deepEqual(calls, [
        ["guard", "service-subtab", "gear"],
        ["deactivate", "service-subtab"],
        ["show", "gear"],
    ]);

    assert.match(appSource, /registerFeature\("service", window\.ComponentsController\)/);
    assert.match(appSource, /componentsSubtab\?\.addEventListener\("click", \(\) => requestServiceSubtab\("components"\)\)/);
    assert.match(appSource, /gearSubtab\?\.addEventListener\("click", \(\) => requestServiceSubtab\("gear"\)\)/);
    assert.match(appSource, /source === "popstate"[\s\S]*lastAcceptedRoute/);
    assert.doesNotMatch(appSource.slice(appSource.indexOf("async function requestServiceSubtab"), appSource.indexOf("window.showServiceSubtab")), /pushState|replaceState/);
    console.log("Components activation bridge contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});