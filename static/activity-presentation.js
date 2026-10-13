(function (root) {
  const PRESENTATION_BY_TOKEN = new Map([
    ["physicaltherapy", Object.freeze({ label: "Physical Therapy", icon: "🏥" })],
  ]);

  function normalizeActivityToken(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function getCategoryPresentation(category) {
    return PRESENTATION_BY_TOKEN.get(normalizeActivityToken(category)) || null;
  }

  function getActivityTypeLabel(activityType) {
    return getCategoryPresentation(activityType)?.label || null;
  }

  const activityPresentation = Object.freeze({
    getCategoryPresentation,
    getActivityTypeLabel,
  });

  if (root) {
    root.ActivityPresentation = activityPresentation;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = activityPresentation;
  }
})(typeof window === "undefined" ? null : window);
