/*
 * constants.js
 * Shared constants and defaults used by the UI and state layer.
 * This file provides the app-wide settings and thresholds that other modules read; it is a stable data source
 * and not a place for rendering or feature logic.
 */
window.APP_CONSTANTS = Object.freeze({
  WEEKLY_HOURS_GREEN_MIN: 6,
  WEEKLY_HOURS_YELLOW_MIN: 4,
  AC_RATIO_TARGET_MIN: 0.8,
  AC_RATIO_TARGET_MAX: 1.3,
  AC_RATIO_CAUTION_MAX: 1.5,
  ZONE_THRESHOLDS: Object.freeze({
    z1_z2_pct: Object.freeze({
      targetMin: 60,
      targetMax: 80,
    }),
    z3_pct: Object.freeze({
      targetMin: 10,
      targetMax: 30,
    }),
    z4_z5_pct: Object.freeze({
      targetMax: 10,
      cautionMax: 20,
    }),
  }),
});

function zoneHeaderRange(metric) {
  const thresholds = window.APP_CONSTANTS.ZONE_THRESHOLDS[metric];
  if (!thresholds) {
    return "";
  }

  if (metric === "z4_z5_pct") {
    return `0-${thresholds.targetMax}`;
  }

  return `${thresholds.targetMin}-${thresholds.targetMax}`;
}
