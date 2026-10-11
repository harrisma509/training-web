const assert = require("node:assert/strict");
const fs = require("node:fs");

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
assert.match(moduleSource, /state\.templates = \{ \.\.\.state\.templates, status: "error", categoryId, error \};\s*render\(\);\s*focusSurface\(\)/);
assert.match(moduleSource, /window\.confirm\("Discard unsaved template changes\?"\)/);
assert.match(templateSource, /data-plan-template-action="backdrop"/);
assert.match(moduleSource, /if \(canDeactivate\(\)\) close\("escape"\)/);
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

console.log("Plan Template Library UI contract tests passed.");
