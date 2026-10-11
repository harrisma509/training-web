const assert = require("node:assert/strict");
const fs = require("node:fs");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const editorSource = fs.readFileSync("static/plan_item_editor.js", "utf8");
const itemsSource = fs.readFileSync("static/plan_items.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const paneSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");

assert.match(apiSource, /async updatePlanItem\(planItemId, payload\)/);
assert.match(apiSource, /method: "PUT"/);
assert.match(apiSource, /async cancelPlanItem\(planItemId\)/);
assert.match(apiSource, /\/cancel/);
assert.match(editorSource, /application\/x-training-plan-item-id/);
assert.match(editorSource, /outcome is unknown\. Review the calendar before retrying/);
assert.match(editorSource, /Segments JSON/);
assert.match(editorSource, /Cancel planned item/);
assert.match(editorSource, /data-plan-item-target/);
assert.match(itemsSource, /replaceItem\(item\)/);
assert.match(itemsSource, /removeItem\(planItemId\)/);
assert.match(itemsSource, /data-plan-item-action="edit"/);
assert.match(itemsSource, /data-plan-item-action="drag-move"/);
assert.match(planSource, /PlanItemEditor\?\.handleDragStart/);
assert.match(planSource, /PlanItemEditor\?\.handleDrop/);
assert.match(planSource, /PlanItemEditor\?\.handleTarget/);
assert.match(paneSource, /id="planItemEditor"/);
assert.match(cssSource, /\.plan-item-editor/);
assert.match(cssSource, /\.plan-day\.is-item-drop-valid/);

console.log("Plan item editor contract tests passed.");
