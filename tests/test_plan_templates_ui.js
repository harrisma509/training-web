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
assert.match(moduleSource, /restoreCategoryFilterFocus\(preserveFilterFocus\)/);
assert.match(moduleSource, /Template details/);
assert.doesNotMatch(moduleSource, /<legend>Prescription<\/legend>/);
assert.doesNotMatch(moduleSource, /Prescription title|Prescription description/);
assert.match(moduleSource, /template_name: sharedName/);
assert.match(moduleSource, /title: state\.view === "create" \|\| state\.sharedFieldsChanged\.name/);
assert.match(moduleSource, /<details class="plan-template-more-options"/);
assert.match(moduleSource, /Save changes/);
assert.match(moduleSource, /Duration \(min\)/);
assert.match(planCss, /width: min\(520px, 94vw\)/);
assert.match(planCss, /plan-template-more-options/);
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
assert.match(planSource, /PlanPaletteController\?\.deactivate/);
assert.match(planSource, /return window\.PlanTemplateLibraryController\?\.deactivate/);

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
    if (arguments[0]?.includes("category-filter") && this.filterTarget) return this.filterTarget;
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
  content.filterTarget = categoryFilter;
  document.elements.planTemplateLibrary = root;
  document.elements.planTemplateLibraryContent = content;
  document.elements.planTemplateLibraryOpen = trigger;

  let confirmCalls = 0;
  let categoriesResolve;
  let templatesResolve;
  const api = {
    fetchPlanCategories: () => Promise.resolve({ categories: [] }),
    fetchPlanTemplates: () => new Promise(resolve => { templatesResolve = resolve; }),
    fetchPlanTemplate: () => Promise.resolve({
      plan_template_id: 7,
      template_name: "Existing name",
      template_description: "Existing description",
      sort_order: 4,
      category: { plan_category_id: 1 },
      prescription: {
        title: "Legacy prescription title",
        description: "Legacy prescription description",
        sport_type: "Ride",
        activity_category: "Strength",
        trainer: true,
        target_duration_min: 60,
        target_load: 100,
        target_load_source: "manual",
        target_distance_mi: 20,
        target_elevation_ft: 1000,
        instruction_text: "Stay steady.",
        segments: [{ segment_name: "Warmup" }],
      },
    }),
  };
  const mutationPayloads = [];
  api.createPlanTemplate = payload => {
    mutationPayloads.push(payload);
    return Promise.resolve({
      plan_template_id: 8,
      template_name: payload.template_name,
      template_description: payload.template_description,
      sort_order: payload.sort_order,
      category: { plan_category_id: payload.category_id },
      prescription: { ...payload.prescription, segments: payload.segments },
    });
  };
  api.updatePlanTemplate = (_templateId, payload) => {
    mutationPayloads.push(payload);
    return Promise.resolve({
      plan_template_id: 7,
      template_name: payload.template_name,
      template_description: payload.template_description,
      sort_order: payload.sort_order,
      category: { plan_category_id: payload.category_id },
      prescription: { ...payload.prescription, segments: payload.segments },
    });
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
    dispatchRootAction(action, templateId) {
      const element = new FakeElement();
      element.dataset.planTemplateAction = action;
      if (templateId) element.dataset.templateId = String(templateId);
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
    mutationPayloads,
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
  assert.match(harness.content.innerHTML, /Template details/);
  assert.equal((harness.content.innerHTML.match(/data-plan-template-field="template_name"/g) || []).length, 1);
  assert.equal((harness.content.innerHTML.match(/data-plan-template-field="template_description"/g) || []).length, 1);
  assert.doesNotMatch(harness.content.innerHTML, /Prescription|Prescription title|Prescription description/);
  assert.match(harness.content.innerHTML, /<details class="plan-template-more-options">/);

  const serializerHarness = createPlanHarness();
  serializerHarness.controller.open();
  serializerHarness.dispatchRootAction("create");
  serializerHarness.dispatchChange("template_name", "Shared name");
  serializerHarness.dispatchChange("category_id", "1");
  serializerHarness.dispatchChange("template_description", "Shared description");
  serializerHarness.dispatchChange("target_duration_min", "0");
  serializerHarness.content.dispatch("submit", { target: { id: "planTemplateForm" }, preventDefault() {} });
  await flush();
  assert.equal(serializerHarness.mutationPayloads[0].template_name, "Shared name");
  assert.equal(serializerHarness.mutationPayloads[0].template_description, "Shared description");
  assert.equal(serializerHarness.mutationPayloads[0].prescription.title, "Shared name");
  assert.equal(serializerHarness.mutationPayloads[0].prescription.description, "Shared description");
  assert.equal(serializerHarness.mutationPayloads[0].prescription.target_duration_min, 0);
  assert.equal(serializerHarness.mutationPayloads[0].segments.length, 0);
  assert.equal(serializerHarness.mutationPayloads[0].prescription.target_load_source, null);
  assert.equal(serializerHarness.mutationPayloads[0].sort_order, 0);

  const editHarness = createPlanHarness();
  editHarness.controller.open();
  editHarness.dispatchRootAction("edit", 7);
  await flush();
  assert.match(editHarness.content.innerHTML, /<details class="plan-template-more-options" open>/);
  assert.match(editHarness.content.innerHTML, /Distance \(mi\)/);
  assert.match(editHarness.content.innerHTML, /Elevation \(ft\)/);
  editHarness.content.dispatch("submit", { target: { id: "planTemplateForm" }, preventDefault() {} });
  await flush();
  const preservedPayload = editHarness.mutationPayloads[0];
  assert.equal(preservedPayload.prescription.title, "Legacy prescription title");
  assert.equal(preservedPayload.prescription.description, "Legacy prescription description");
  editHarness.dispatchChange("template_name", "Unified name");
  editHarness.dispatchChange("template_description", "Unified description");
  editHarness.content.dispatch("submit", { target: { id: "planTemplateForm" }, preventDefault() {} });
  await flush();
  const unifiedPayload = editHarness.mutationPayloads[1];
  assert.equal(unifiedPayload.prescription.title, "Unified name");
  assert.equal(unifiedPayload.prescription.description, "Unified description");

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
