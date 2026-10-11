const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const itemSource = fs.readFileSync("static/plan_items.js", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");

assert.match(apiSource, /async fetchPlanItems\(startDate, endDate, options = \{\}\)/);
assert.match(apiSource, /\/api\/plan\/items\?\$\{params\.toString\(\)\}/);
assert.match(apiSource, /signal: options\.signal/);
assert.match(itemSource, /const state = \{/);
assert.match(itemSource, /generation: 0/);
assert.match(itemSource, /new AbortController\(\)/);
assert.match(itemSource, /new Map\(\)/);
assert.match(itemSource, /data-plan-item-id/);
assert.match(itemSource, /role="status"/);
assert.match(itemSource, /Planned items unavailable/);
assert.match(itemSource, /target_load/);
assert.match(itemSource, /item_state === "draft"/);
assert.match(itemSource, /structured workout with/);
assert.doesNotMatch(itemSource, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(itemSource, /user_note/);
assert.match(planSource, /PlanItemsController\?\.init\?\.\(\{ onChange: renderPlanStrip \}\)/);
assert.match(planSource, /PlanItemsController\?\.load\?\.\(range, \{ force \}\)/);
assert.match(planSource, /renderDaySection\?\.\(dayKey\)/);
assert.match(planSource, /No activity recorded yet/);
assert.match(planSource, /plannedState\.status === "success"/);
assert.match(planSource, /MONTH_NAMES\[dateValue\.getUTCMonth\(\)\]/);
assert.match(templateSource, /plan_items\.js\?v=\{\{ asset_version \}\}/);
assert.match(templateSource, /plan_items\.js[\s\S]*plan\.js/);
assert.match(cssSource, /\.plan-planned-section/);
assert.match(cssSource, /\.plan-planned-card\.is-historical/);
assert.match(cssSource, /var\(--panel2\)/);
assert.match(cssSource, /var\(--blue\)/);
assert.match(cssSource, /overflow-wrap: anywhere/);

async function testApiWrapper() {
  let request;
  const response = {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ start_date: "2026-10-12", end_date: "2026-11-09", items: [] }),
  };
  const context = {
    fetch: async (url, options) => {
      request = { url, options };
      return response;
    },
    window: {},
    URLSearchParams,
  };
  vm.runInNewContext(apiSource, context);
  const signal = { aborted: false };
  await context.window.api.fetchPlanItems("2026-10-12", "2026-11-09", { signal });

  assert.equal(
    request.url,
    "/api/plan/items?start_date=2026-10-12&end_date=2026-11-09",
  );
  assert.equal(request.options.signal, signal);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function testController() {
  const requests = [];
  let changeCount = 0;
  const context = {
    window: {
      escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character])),
      api: {
        fetchPlanItems: (start, end, options) => {
          const pending = deferred();
          requests.push({ start, end, options, pending });
          return pending.promise;
        },
      },
    },
    AbortController,
    Intl,
    Map,
    Object,
    Promise,
  };
  vm.runInNewContext(itemSource, context);
  const controller = context.window.PlanItemsController;
  assert.equal(controller.init({ onChange: () => { changeCount += 1; } }), true);
  assert.equal(controller.init({ onChange: () => { changeCount += 1; } }), true);

  const firstLoad = controller.load({
    start: "2026-10-05",
    end: "2026-11-02",
  });
  assert.equal(controller.getState().status, "loading");
  assert.match(controller.renderDaySection("2026-10-18"), /Loading planned items/);

  const secondLoad = controller.load({
    start: "2026-10-12",
    end: "2026-11-09",
  });
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].pending.resolve({
    items: [
      {
        plan_item_id: 2,
        planned_date: "2026-10-18",
        item_state: "committed",
        category: { category_name: "Endurance" },
        prescription: {
          title: "Second item",
          sport_type: "Ride",
          target_duration_min: null,
          target_load: 0,
          segments: [],
        },
      },
      {
        plan_item_id: 1,
        planned_date: "2026-10-18",
        item_state: "draft",
        category: { category_name: "Endurance" },
        prescription: {
          title: "<Unsafe item>",
          activity_category: "Ride",
          target_duration_min: 90,
          target_load: null,
          segments: [{ segment_order: 1 }],
        },
      },
      { plan_item_id: 99, planned_date: "not-a-date" },
    ],
  });
  await secondLoad;
  requests[0].pending.resolve({
    items: [{
      plan_item_id: 100,
      planned_date: "2026-10-20",
      prescription: { title: "Stale item" },
    }],
  });
  await firstLoad;

  const state = controller.getState();
  assert.equal(state.status, "success");
  assert.equal(state.range.start, "2026-10-12");
  assert.equal(state.range.end, "2026-11-09");
  assert.equal(state.items.map(item => item.plan_item_id).join(","), "2,1");
  assert.equal(
    controller.getItemsForDate("2026-10-18").map(item => item.plan_item_id).join(","),
    "2,1",
  );
  const rendered = controller.renderDaySection("2026-10-18");
  assert.match(rendered, /Planned activities/);
  assert.match(rendered, /data-plan-item-id="2"/);
  assert.match(rendered, /data-plan-item-id="1"/);
  assert.match(rendered, /Target load 0/);
  assert.match(rendered, /90 min/);
  assert.match(rendered, /Structured · 1 segments/);
  assert.match(rendered, /Draft/);
  assert.equal((rendered.match(/>Planned</g) || []).length, 1);
  assert.doesNotMatch(rendered, /plan-planned-badge/);
  assert.match(rendered, /&lt;Unsafe item&gt;/);
  assert.doesNotMatch(rendered, /user_note|plan_prescription_id|owner_kind/);
  assert.ok(changeCount >= 3);

  const failureLoad = controller.load(
    { start: "2026-11-09", end: "2026-12-07" },
    { force: true },
  );
  requests[2].pending.reject(new Error("planned request failed"));
  await failureLoad;
  assert.equal(controller.getState().status, "error");
  assert.match(
    controller.renderDaySection("2026-11-18"),
    /Planned items unavailable\. Actual activities are still shown\./,
  );
}

Promise.all([testApiWrapper(), testController()]).then(() => {
  console.log("Plan planned-items overlay contract tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
