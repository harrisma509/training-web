const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = name => fs.readFileSync(path.join(root, "static", name), "utf8");

const candidates = [
    ["plan.js", "PlanController", "loadPlan"],
    ["search.js", "searchController", "loadResults"],
    ["zones.js", "zonesController", "loadZones"],
    ["gear.js", "GearController", "loadGear"],
    ["weekly.js", "WeeklyController", "loadWeekly"],
];

for (const [file, controller, loader] of candidates) {
    const text = source(file);
    assert.match(text, new RegExp(`${controller}\\s*=|window\\.${controller}\\s*=`), `${file} registers its controller`);
    assert.match(text, /(?:init\s*:|\binit\s*,)/, `${file} exposes init`);
    assert.match(text, /(?:activate\s*:|\bactivate\s*,)/, `${file} exposes activate`);
    assert.match(text, /(?:refresh\s*:|\brefresh\s*,)/, `${file} exposes refresh`);
    assert.match(text, new RegExp(`${loader}LoadPromise|listenersAttached|Initialized`), `${file} has idempotence state`);
    assert.match(text, /requestId|REQUESTS|LoadRequestId/i, `${file} documents or implements request freshness`);
}

const search = source("search.js");
assert.match(search, /if \(state\.listenersAttached\) return;/);
assert.match(search, /function refresh\(\)/);

const gear = source("gear.js");
assert.match(gear, /if \(requestId !== gearLoadRequestId\)/);
assert.match(gear, /window\.AppState\.gearRows = Array\.isArray\(rows\) \? rows : \[\];/);

console.log("Low-risk lifecycle contract tests passed.");
