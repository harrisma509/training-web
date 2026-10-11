const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const placementSource = fs.readFileSync("static/plan_placement.js", "utf8");
const templateSource = fs.readFileSync("static/plan_templates.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const itemSource = fs.readFileSync("static/plan_items.js", "utf8");
const paneSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");

assert.match(apiSource, /async createPlanItemFromTemplate\(/);
assert.match(apiSource, /\/api\/plan\/items\/from-template/);
assert.match(apiSource, /plan_template_id: planTemplateId/);
assert.match(apiSource, /planned_date: plannedDate/);
assert.match(apiSource, /sort_order: sortOrder/);
assert.match(apiSource, /user_note: userNote/);
assert.match(placementSource, /mode: "idle"/);
assert.match(placementSource, /mode = "selected"/);
assert.match(placementSource, /mode = "dragging"/);
assert.match(placementSource, /mode = "saving"/);
assert.match(placementSource, /outcomeRequiresRefresh/);
assert.match(placementSource, /application\/x-training-plan-template/);
assert.match(placementSource, /PlanItemsController\?\.acceptCreatedItem/);
assert.match(placementSource, /PlanItemsController\?\.load\?\.\(range, \{ force: true \}\)/);
assert.match(placementSource, /Plan refreshed\. Review the target date before trying again\./);
assert.match(placementSource, /String\(dateKey\) > getDenverTodayKey/);
assert.match(templateSource, /plan-template-drag-handle/);
assert.match(templateSource, /data-plan-template-action="place"/);
assert.match(templateSource, /startSelection/);
assert.match(templateSource, /startDrag/);
assert.match(templateSource, /dragend/);
assert.match(templateSource, /setPlacementMode/);
assert.match(planSource, /data-plan-date="\$\{escapeHtml\(dayKey\)\}"/);
assert.match(planSource, /PlanPlacementController\?\.targetMarkup/);
assert.match(planSource, /PlanPlacementController\?\.init/);
assert.match(itemSource, /acceptCreatedItem/);
assert.match(paneSource, /id="planPlacementStatus"/);
assert.match(indexSource, /plan_placement\.js[\s\S]*plan_templates\.js/);
assert.match(cssSource, /plan-placement-target/);
assert.match(cssSource, /plan-template-drag-handle/);

async function testApiWrapper() {
  let request;
  const context = {
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, statusText: "Created", json: async () => ({ plan_item_id: 8 }) };
    },
    window: {},
    URLSearchParams,
  };
  vm.runInNewContext(apiSource, context);
  await context.window.api.createPlanItemFromTemplate({
    planTemplateId: 4,
    plannedDate: "2099-01-02",
  });

  assert.equal(request.url, "/api/plan/items/from-template");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    plan_template_id: 4,
    planned_date: "2099-01-02",
    sort_order: 0,
    user_note: null,
  });
}

async function testPlacementStateMachine() {
  const listeners = {};
  const accepted = [];
  let libraryMode = false;
  const context = {
    window: {
      setTimeout,
      api: {
        createPlanItemFromTemplate: async payload => ({
          plan_item_id: 12,
          planned_date: payload.plannedDate,
          item_state: "committed",
          prescription: { title: "Core Strength", segments: [] },
        }),
      },
      PlanTemplateLibraryController: {
        setPlacementMode: active => { libraryMode = active; },
      },
      PlanItemsController: {
        acceptCreatedItem: item => accepted.push(item),
        load: async () => {},
      },
      PlanController: {
        getRange: () => ({ start: "2099-01-01", end: "2099-02-01" }),
      },
    },
    document: {
      addEventListener: (type, handler) => { listeners[type] = handler; },
      getElementById: () => ({ textContent: "" }),
    },
    Intl,
    Object,
    Promise,
  };
  vm.runInNewContext(placementSource, context);
  const controller = context.window.PlanPlacementController;
  assert.equal(controller.init(), true);
  assert.equal(controller.init(), true);
  assert.equal(controller.startSelection({
    planTemplateId: 4,
    templateName: "Core Strength",
  }), true);
  assert.equal(controller.getState().mode, "selected");
  assert.equal(libraryMode, true);
  assert.match(controller.targetMarkup("2099-01-02", "Fri JAN 2"), /Place here/);
  assert.equal(controller.targetMarkup("2020-12-31", "Thu DEC 31"), "");

  const firstSubmit = controller.submit("2099-01-02");
  const secondSubmit = controller.submit("2099-01-02");
  assert.equal(await firstSubmit, true);
  assert.equal(await secondSubmit, false);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].plan_item_id, 12);
  assert.equal(controller.getState().mode, "success");
  assert.ok(listeners.keydown);
}

Promise.all([testApiWrapper(), testPlacementStateMachine()]).then(() => {
  console.log("Plan placement contract tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
