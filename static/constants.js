window.AppState = window.AppState || {
  dailyRows: [],
  weeklyRows: [],
  zonesRows: [],
  activeTab: "daily",
};

window.APP_CONSTANTS = Object.freeze({
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
