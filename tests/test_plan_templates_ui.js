const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const templateSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const moduleSource = fs.readFileSync("static/plan_templates.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const planCss = fs.readFileSync("static/plan.css", "utf8");

assert.match(templateSource, /id="planTemplateLibraryOpen"/);
assert.match(templateSource, /aria-controls="planTemplateLibrary"/);
assert.match(templateSource, /id="planTemplateLibrary"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.match(templateSource, /aria-labelledby="planTemplateLibraryTitle"/);
assert.match(indexSource, /static\/plan_templates\.js\?v=\{\{ asset_version \}\}/);
assert.match(indexSource, /plan_templates\.js[\s\S]*plan\.js/);

assert.match(moduleSource, /window\.PlanTemplateLibraryController/);
assert.match(moduleSource, /function init\(\)/);
assert.match(moduleSource, /if \(state\.initialized\) return true/);
assert.match(moduleSource, /trigger\.addEventListener\("click"/);
assert.match(moduleSource, /root\.addEventListener\("click"/);
assert.match(moduleSource, /document\.addEventListener\("keydown", handleKeydown\)/);
assert.match(moduleSource, /aria-expanded/);
assert.match(moduleSource, /focusSurface/);
assert.match(moduleSource, /<h2 tabindex="-1">Template Library<\/h2>/);
assert.match(moduleSource, /state\.templates = \{ \.\.\.state\.templates, status: "error", categoryId, error \};\s*render\(\);/);
assert.doesNotMatch(moduleSource, /state\.templates = \{ \.\.\.state\.templates, status: "error", categoryId, error \};\s*render\(\);\s*focusSurface\(\)/);
assert.match(moduleSource, /window\.confirm\("Discard unsaved template changes\?"\)/);
assert.match(templateSource, /data-plan-template-action="backdrop"/);
assert.match(moduleSource, /requestClose\("escape"\)/);
assert.doesNotMatch(moduleSource, /if \(canDeactivate\(\)\) close\("(?:backdrop|close-button|escape)"\)/);
assert.match(moduleSource, /function trapFocus/);

assert.match(moduleSource, /fetchPlanCategories/);
assert.match(moduleSource, /fetchPlanTemplates\(categoryId, 200\)/);
assert.match(moduleSource, /fetchPlanTemplate\(templateId\)/);
assert.match(moduleSource, /generation !== state\.templatesGeneration/);
assert.match(moduleSource, /generation !== state\.detailGeneration/);
assert.match(moduleSource, /No templates yet/);
assert.match(moduleSource, /Templates are temporarily unavailable/);
assert.match(moduleSource, /category-filter/);

assert.match(moduleSource, /segments: state\.view === "create"/);
assert.match(moduleSource, /segments: state\.view === "create"/);
assert.match(moduleSource, /confirmed\?\.prescription\?\.segments \|\| \[\]/);
assert.match(moduleSource, /target_load_source: confirmed\?\.prescription\?\.target_load_source \?\? null/);
assert.match(moduleSource, /sort_order: confirmed\?\.sort_order \?\? 0/);
assert.match(moduleSource, /Structured segments are preserved during scalar edits/);
assert.match(moduleSource, /trainer === null/);
assert.match(moduleSource, /target_load \?\? null/);
assert.match(moduleSource, /deactivatePlanTemplate/);
assert.match(moduleSource, /Deactivate this template/);
assert.match(moduleSource, /state\.view = "library"/);

for (const method of [
  "fetchPlanCategories",
  "fetchPlanTemplates",
  "fetchPlanTemplate",
  "createPlanTemplate",
  "updatePlanTemplate",
  "deactivatePlanTemplate",
]) {
  assert.match(apiSource, new RegExp(`async ${method}\\(`));
}
assert.match(apiSource, /\/api\/plan\/categories/);
assert.match(apiSource, /\/api\/plan\/templates/);
assert.doesNotMatch(moduleSource, /\/api\/(?:plan\/)?(?:items|batches|actual|derived)/);

assert.match(planSource, /PlanTemplateLibraryController\?\.init/);
assert.match(planSource, /canDeactivate: context => window\.PlanTemplateLibraryController/);
assert.match(planSource, /deactivate: context => window\.PlanTemplateLibraryController/);

assert.match(planCss, /\.plan-template-library/);
assert.match(planCss, /@media \(max-width: 700px\)/);
assert.match(planCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(planCss, /plan-template-segment-summary/);
assert.match(planCss, /plan-template-field-error/);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.innerHTML = "";
    this.listeners = {};
    this.attributes = {};
    this.classList = { toggle: () => {} };
    this.isConnected = true;
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = 0;
    this.offsetParent = {};
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  dispatch(type, event = {}) {
    this.listeners[type]?.(event);
  }

  closest() {
    return this;
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.focusCalls = (this.focusCalls || 0) + 1;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  querySelector() {
    return this.focusTarget || null;
  }

  querySelectorAll() {
    return [];
  }

  getClientRects() {
    return [{}];
  }
}

function createPlanHarness() {
  const document = {
    activeElement: null,
    listeners: {},
    elements: {},
    getElementById(id) {
      return this.elements[id] || null;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  };
  const root = new FakeElement("planTemplateLibrary");
  const content = new FakeElement("planTemplateLibraryContent");
  const trigger = new FakeElement("planTemplateLibraryOpen");
  const focusTarget = new FakeElement("template-heading");
  const categoryFilter = new FakeElement("category-filter");
  for (const element of [root, content, trigger, focusTarget, categoryFilter]) {
    element.ownerDocument = document;
  }
  content.focusTarget = focusTarget;
  document.elements.planTemplateLibrary = root;
  document.elements.planTemplateLibraryContent = content;
  document.elements.planTemplateLibraryOpen = trigger;

  let confirmCalls = 0;
  let categoriesResolve;
  let templatesResolve;
  const api = {
    fetchPlanCategories: () => Promise.resolve({ categories: [] }),
    fetchPlanTemplates: () => new Promise(resolve => { templatesResolve = resolve; }),
  };
  const surfaceOptions = {};
  const surface = {
    open({ opener }) {
      surfaceOptions.opener = opener;
      surfaceOptions.open = true;
    },
    requestClose(reason) {
      return Promise.resolve(surfaceOptions.canClose?.(reason)).then(allowed => {
        if (!allowed || !surfaceOptions.open) return false;
        surfaceOptions.open = false;
        surfaceOptions.onBeforeClose?.(reason);
        surfaceOptions.onAfterClose?.(reason);
        surfaceOptions.opener?.focus();
        return true;
      });
    },
    close(reason) {
      surfaceOptions.open = false;
      surfaceOptions.onBeforeClose?.(reason);
      surfaceOptions.onAfterClose?.(reason);
      surfaceOptions.opener?.focus();
      return true;
    },
  };
  const window = {
    api,
    confirm: () => {
      confirmCalls += 1;
      return true;
    },
    setTimeout,
    TrainingApp: {
      TransientSurface: {
        create(options) {
          Object.assign(surfaceOptions, options);
          return surface;
        },
      },
    },
  };
  vm.runInNewContext(moduleSource, { window, document, setTimeout, Promise, JSON, Number, String, Boolean, Array, Object, Set });
  const controller = window.PlanTemplateLibraryController;
  controller.init();
  return {
    api,
    categoryFilter,
    content,
    controller,
    document,
    dispatchKeydown(event) {
      document.listeners.keydown?.(event);
    },
    dispatchRootAction(action) {
      const element = new FakeElement();
      element.dataset.planTemplateAction = action;
      root.dispatch("click", { target: element });
    },
    dispatchChange(field, value) {
      const target = field === "category-filter" ? categoryFilter : new FakeElement();
      target.dataset.planTemplateField = field;
      target.value = value;
      root.dispatch("change", { target });
    },
    get confirmCalls() {
      return confirmCalls;
    },
    setConfirmResult(value) {
      window.confirm = () => {
        confirmCalls += 1;
        return value;
      };
    },
    resolveTemplates(payload = { templates: [] }) {
      templatesResolve?.(payload);
    },
    state: () => controller.getState(),
    trigger,
    surfaceOptions,
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function runBehavioralTests() {
  const harness = createPlanHarness();
  harness.controller.open();
  harness.dispatchRootAction("create");
  harness.dispatchChange("sport_type", "Ride");
  harness.dispatchChange("sport_type", "__custom__");
  harness.dispatchChange("activity_category", "Strength");
  harness.dispatchChange("activity_category", "__custom__");
  const state = harness.state();
  assert.equal(state.dirty, true);
  assert.match(harness.content.innerHTML, /sport_type_custom/);
  assert.match(harness.content.innerHTML, /activity_category_custom/);

  harness.setConfirmResult(false);
  harness.dispatchRootAction("close");
  await flush();
  assert.equal(harness.confirmCalls, 1);
  assert.equal(harness.state().open, true);
  assert.equal(harness.state().dirty, true);

  harness.setConfirmResult(true);
  harness.dispatchKeydown({ key: "Escape", preventDefault() {} });
  await flush();
  assert.equal(harness.confirmCalls, 2);
  assert.equal(harness.state().open, false);
  assert.equal(harness.state().dirty, false);
  assert.equal(harness.state().draft, null);
  assert.equal(harness.trigger.focusCalls, 1);

  const backdropHarness = createPlanHarness();
  backdropHarness.controller.open();
  backdropHarness.dispatchRootAction("create");
  backdropHarness.dispatchChange("sport_type", "Ride");
  backdropHarness.setConfirmResult(false);
  backdropHarness.dispatchRootAction("backdrop");
  await flush();
  assert.equal(backdropHarness.confirmCalls, 1);
  assert.equal(backdropHarness.state().open, true);
  backdropHarness.setConfirmResult(true);
  backdropHarness.dispatchRootAction("backdrop");
  await flush();
  assert.equal(backdropHarness.confirmCalls, 2);
  assert.equal(backdropHarness.state().open, false);

  const cleanHarness = createPlanHarness();
  cleanHarness.controller.open();
  cleanHarness.dispatchRootAction("close");
  await flush();
  assert.equal(cleanHarness.confirmCalls, 0);
  assert.equal(cleanHarness.state().open, false);

  const filterHarness = createPlanHarness();
  filterHarness.controller.open();
  await flush();
  filterHarness.categoryFilter.focus();
  filterHarness.dispatchChange("category-filter", "3");
  filterHarness.resolveTemplates();
  await flush();
  assert.equal(filterHarness.document.activeElement, filterHarness.categoryFilter);
  console.log("Plan Template Library behavioral tests passed.");
}

runBehavioralTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

console.log("Plan Template Library UI contract tests passed.");
