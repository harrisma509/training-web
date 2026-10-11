const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const paletteSource = fs.readFileSync("static/plan_palette.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const itemSource = fs.readFileSync("static/plan_items.js", "utf8");
const templateSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");
const templateControllerSource = fs.readFileSync("static/plan_templates.js", "utf8");

assert.match(templateSource, /id="planPalette"/);
assert.match(templateSource, /<aside id="planPalette"/);
assert.match(templateSource, /id="planPaletteOpen"[^>]*>[\s\S]*?Add plans/);
assert.match(templateSource, /id="planPaletteManage"[^>]*>[\s\S]*?Manage templates/);
assert.match(templateSource, /id="planPalettePlacement"/);
assert.match(indexSource, /plan_palette\.js[\s\S]*plan_templates\.js[\s\S]*plan\.js/);
assert.match(paletteSource, /America\/Denver/);
assert.match(paletteSource, /state\.mode = "selected"/);
assert.match(paletteSource, /state\.mode = "saving"/);
assert.match(paletteSource, /state\.mode = "unknown"/);
assert.match(paletteSource, /outcomeRequiresRefresh/);
assert.match(paletteSource, /createPlanItemFromTemplate/);
assert.match(paletteSource, /planTemplateId: state\.selectedTemplate\.planTemplateId/);
assert.match(paletteSource, /plannedDate: dateKey/);
assert.match(paletteSource, /sortOrder: 0/);
assert.match(paletteSource, /userNote: null/);
assert.match(paletteSource, /PlanItemsController\?\.acceptCreatedItem/);
assert.match(paletteSource, /PlanItemsController\?\.load\?\.\(range, \{ force: true \}\)/);
assert.match(paletteSource, /String\(dateKey\) > getDenverTodayKey\(\)/);
assert.match(paletteSource, /data-plan-palette-target/);
assert.match(paletteSource, /PlanTemplateLibraryController\?\.open/);
assert.match(planSource, /data-plan-date="\$\{escapeHtml\(dayKey\)\}"/);
assert.match(planSource, /PlanPaletteController\?\.targetMarkup/);
assert.match(itemSource, /function acceptCreatedItem\(item\)/);
assert.match(itemSource, /acceptCreatedItem,/);
assert.match(cssSource, /\.plan-workspace/);
assert.match(cssSource, /\.plan-palette-placement-banner/);
assert.match(cssSource, /\.plan-palette-day-target/);
assert.match(cssSource, /\.plan-workspace\.plan-palette-open/);
assert.doesNotMatch(templateControllerSource, /planPalette|data-plan-palette|Place here|Add plans/);

async function testApiWrapper() {
  let request;
  const context = {
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => ({ plan_item_id: 7 }),
      };
    },
    window: {},
    URLSearchParams,
  };
  vm.runInNewContext(apiSource, context);
  const signal = { aborted: false };
  await context.window.api.createPlanItemFromTemplate({
    planTemplateId: 15,
    plannedDate: "2099-01-02",
    sortOrder: 0,
    userNote: null,
  }, { signal });
  assert.equal(request.url, "/api/plan/items/from-template");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.signal, signal);
  assert.deepEqual(JSON.parse(request.options.body), {
    plan_template_id: 15,
    planned_date: "2099-01-02",
    sort_order: 0,
    user_note: null,
  });
}

function testPaletteModuleLoadsWithoutPlacementMutation() {
  const context = {
    window: {},
    Intl,
    Object,
    Promise,
    AbortController,
    setTimeout,
  };
  vm.runInNewContext(paletteSource, context);
  assert.equal(typeof context.window.PlanPaletteController.init, "function");
  assert.equal(context.window.PlanPaletteController.getState().mode, "idle");
  assert.equal(context.window.PlanPaletteController.getState().selectedTemplate, null);
}

Promise.all([
  testApiWrapper(),
  testPaletteModuleLoadsWithoutPlacementMutation(),
]).then(() => {
  console.log("Plan Palette contract tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
