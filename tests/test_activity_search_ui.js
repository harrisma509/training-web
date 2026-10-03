const assert = require("node:assert/strict");
const fs = require("node:fs");
const { formatActivityLocalDate, formatActivityLocalTime } = require("../static/search.js");

async function main() {
    process.env.TZ = "Pacific/Auckland";

    assert.equal(formatActivityLocalDate("2024-03-10"), "2024-03-10");
    assert.equal(formatActivityLocalTime("2024-03-10T03:15:00"), "03:15");
    assert.equal(formatActivityLocalDate("2024-11-03"), "2024-11-03");
    assert.equal(formatActivityLocalTime("2024-11-03T09:45:00"), "09:45");
    assert.equal(formatActivityLocalTime(null), "");
    assert.equal(formatActivityLocalTime(""), "");

    const searchSource = fs.readFileSync("static/search.js", "utf8");
    const dailySource = fs.readFileSync("static/daily.js", "utf8");
    const htmlSource = fs.readFileSync("index.html", "utf8");
    assert.doesNotMatch(searchSource, /new Date|Date\.parse/);
    assert.match(searchSource, /window\.api\.searchActivities\(filters\)/);
    assert.match(searchSource, /state\.sort = column\.sort/);
    assert.match(searchSource, /state\.offset = state\.nextOffset/);
    assert.match(searchSource, /url\.searchParams\.set\("tab", "search"\)/);
    assert.match(searchSource, /url\.searchParams\.set\("offset", String\(state\.offset\)\)/);
    assert.match(searchSource, /payload\?\.applied_start_date/);
    assert.match(searchSource, /"highest_elevation"/);
    assert.match(searchSource, /"longest_distance"/);
    assert.match(searchSource, /"longest_duration"/);
    assert.match(dailySource, /dailySearchAdvanced/);
    assert.match(dailySource, /openAdvancedSearch\(\{ text:/);
    assert.match(htmlSource, /id="searchTab"/);
    assert.match(htmlSource, /id="searchResults"/);
    assert.match(htmlSource, /id="dailySearchAdvanced"/);

    global.window = {};
    let requestedUrl = "";
    global.fetch = async url => {
        requestedUrl = String(url);
        return { ok: true, json: async () => ({ items: [] }) };
    };
    require("../static/api.js");
    await global.window.api.searchActivities({
        text: "Floyd Hill",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        sort: "highest_elevation",
        limit: 50,
        offset: 0,
        gear_id: "",
    });
    const params = new URL(`http://localhost${requestedUrl}`).searchParams;
    assert.equal(params.get("text"), "Floyd Hill");
    assert.equal(params.get("start_date"), "2024-01-01");
    assert.equal(params.get("end_date"), "2024-12-31");
    assert.equal(params.get("sort"), "highest_elevation");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "0");
    assert.equal(params.has("gear_id"), false);

    await global.window.api.fetchDaily(60, "", "2012-07-15");
    assert.match(requestedUrl, /^\/api\/daily\?/);
    assert.equal(new URL(`http://localhost${requestedUrl}`).searchParams.get("date"), "2012-07-15");

    console.log("Activity Search UI contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});