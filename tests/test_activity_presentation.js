const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ActivityPresentation = require("../static/activity-presentation.js");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const presentationWindow = {};
vm.runInNewContext(
  fs.readFileSync("static/activity-presentation.js", "utf8"),
  { window: presentationWindow },
);
assert.equal(
  presentationWindow.ActivityPresentation.getCategoryPresentation("physical_therapy").label,
  "Physical Therapy",
);
assert.equal(
  presentationWindow.ActivityPresentation.getCategoryPresentation("physical_therapy").icon,
  "🩺",
);
assert.equal(presentationWindow.ActivityPresentation.getActivityTypeLabel("PhysicalTherapy"), "Physical Therapy");
assert.equal(ActivityPresentation.getCategoryPresentation("strength"), null);
assert.equal(ActivityPresentation.getCategoryPresentation("future_category"), null);

const dailySource = fs.readFileSync("static/daily.js", "utf8");
const dailyStart = dailySource.indexOf("function renderStructuredOtherActivities(");
const dailyEnd = dailySource.indexOf("\n  function renderOtherActivitiesCell", dailyStart);
assert.ok(dailyStart >= 0 && dailyEnd > dailyStart);
const renderDailyActivities = vm.runInNewContext(
  `(() => { ${dailySource.slice(dailyStart, dailyEnd)}; return renderStructuredOtherActivities; })()`,
  { window: { ActivityPresentation }, escapeHtml },
);
assert.equal(
  renderDailyActivities({
    other_activities: [{
      activity_id: "20562082318",
      name: "Test",
      activity_category: "physical_therapy",
    }],
  }),
  '<a class="activity-link" href="https://www.strava.com/activities/20562082318" target="_blank" rel="noopener noreferrer">Test</a> (Physical Therapy)',
);
assert.equal(
  renderDailyActivities({
    other_activities: [{ name: "Strength session", activity_category: "strength" }],
  }),
  "Strength session (strength)",
);
assert.equal(
  renderDailyActivities({
    other_activities: [{ name: "Future session", activity_category: "future_category" }],
  }),
  "Future session (future_category)",
);

const planSource = fs.readFileSync("static/plan.js", "utf8");
const planStart = planSource.indexOf("const ACTIVITY_ICON_MAP =");
const planEnd = planSource.indexOf("\n  function getWeekStart", planStart);
assert.ok(planStart >= 0 && planEnd > planStart);
const planRenderers = vm.runInNewContext(
  `(() => { ${planSource.slice(planStart, planEnd)}; return { resolveActivityIcon, renderActivityWithIcon }; })()`,
  { window: { ActivityPresentation }, escapeHtml },
);
assert.equal(planRenderers.resolveActivityIcon("Test", "Workout", "physical_therapy"), "🩺");
assert.equal(
  planRenderers.renderActivityWithIcon("Test", "Workout", "physical_therapy"),
  '<span role="img" aria-label="Physical Therapy">🩺</span> Test',
);
assert.equal(planRenderers.resolveActivityIcon("Strength session", "Workout", "strength"), "💪");
assert.equal(planRenderers.renderActivityWithIcon("Prehab", "Workout", "prehab"), "🧘 Prehab");
assert.equal(
  planRenderers.renderActivityWithIcon("Rehabilitation · Workout", "Workout", "rehabilitation"),
  "💪 Rehabilitation · Workout",
);
assert.equal(planRenderers.resolveActivityIcon("Future session", "Workout", "future_category"), "💪");

console.log("Activity presentation tests passed.");
