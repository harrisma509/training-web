(function () {
  window.APP_PREFERENCES_KEY = "training.preferences.v1";
  window.DEFAULT_PREFERENCES = Object.freeze({
    appearance: "system",
    activeTab: "daily",
    rememberLastTab: true,
    startupTab: "daily",
    defaultBikeGearId: "",
    componentsSelectedGearId: "",
    hideShoes: true,
    hideRetired: true,
    dailyLimit: 60,
    weeklyLimit: 60,
    zonesLimit: 60,
    yearlyView: "annual",
    yearlyRows: [],
    yearlyMonthlyRows: [],
  });

  window.APP_ROW_LIMITS = Object.freeze({
    daily: [60, 90, 365, 1000],
    weekly: [26, 60, 260],
    zones: [26, 60, 260],
  });

  window.AppState = window.AppState || {
    dailyRows: [],
    weeklyRows: [],
    zonesRows: [],
    gearRows: [],
    yearlyRows: [],
    yearlyMonthlyRows: [],
    yearlyView: "annual",
    componentsData: {
      available_bikes: [],
      selected_gear_id: null,
      selected_bike: null,
      components: [],
    },
    ...window.DEFAULT_PREFERENCES,
  };

  function normalizeStoredPreference(value, fallback, allowedValues) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }

    const asString = String(value).trim();
    if (allowedValues && allowedValues.length > 0) {
      const parsed = Number(asString);
      if (Number.isInteger(parsed) && allowedValues.includes(parsed)) {
        return parsed;
      }
      return fallback;
    }

    return fallback;
  }

  function sanitizePreferences(rawPreferences = {}) {
    const next = { ...window.DEFAULT_PREFERENCES, ...(rawPreferences || {}) };

    next.appearance = ["system", "light", "dark"].includes(next.appearance) ? next.appearance : "system";
    next.activeTab = ["daily", "weekly", "zones", "gear", "components", "yearly"].includes(next.activeTab) ? next.activeTab : "daily";
    next.rememberLastTab = next.rememberLastTab !== false;
    next.startupTab = ["daily", "weekly", "zones", "gear", "components", "yearly"].includes(next.startupTab) ? next.startupTab : "daily";
    next.yearlyView = ["annual", "monthly"].includes(next.yearlyView) ? next.yearlyView : "annual";
    next.defaultBikeGearId = next.defaultBikeGearId == null ? "" : String(next.defaultBikeGearId).trim();
    next.componentsSelectedGearId = next.componentsSelectedGearId == null ? "" : String(next.componentsSelectedGearId).trim();
    next.hideShoes = Boolean(next.hideShoes);
    next.hideRetired = Boolean(next.hideRetired);
    next.dailyLimit = normalizeStoredPreference(next.dailyLimit, 60, window.APP_ROW_LIMITS.daily);
    next.weeklyLimit = normalizeStoredPreference(next.weeklyLimit, 60, window.APP_ROW_LIMITS.weekly);
    next.zonesLimit = normalizeStoredPreference(next.zonesLimit, 60, window.APP_ROW_LIMITS.zones);
    delete next.gearLimit;

    return next;
  }

  function loadSavedPreferences() {
    try {
      const storageValue = window.localStorage.getItem(window.APP_PREFERENCES_KEY);
      if (!storageValue) {
        return sanitizePreferences();
      }
      const parsed = JSON.parse(storageValue);
      return sanitizePreferences(parsed);
    } catch (error) {
      return sanitizePreferences();
    }
  }

  function persistPreferences() {
    const snapshot = {
      appearance: window.AppState.appearance,
      activeTab: window.AppState.activeTab,
      rememberLastTab: window.AppState.rememberLastTab,
      startupTab: window.AppState.startupTab,
      defaultBikeGearId: window.AppState.defaultBikeGearId,
      componentsSelectedGearId: window.AppState.componentsSelectedGearId,
      hideShoes: window.AppState.hideShoes,
      hideRetired: window.AppState.hideRetired,
      dailyLimit: window.AppState.dailyLimit,
      weeklyLimit: window.AppState.weeklyLimit,
      zonesLimit: window.AppState.zonesLimit,
      yearlyView: window.AppState.yearlyView,
    };

    try {
      window.localStorage.setItem(window.APP_PREFERENCES_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("Unable to persist preferences.", error);
    }
  }

  function applyAppearancePreference() {
    if (!document.documentElement) {
      return;
    }

    if (window.AppState.appearance === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      return;
    }

    if (window.AppState.appearance === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      return;
    }

    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }

  window.normalizeStoredPreference = normalizeStoredPreference;
  window.sanitizePreferences = sanitizePreferences;
  window.loadSavedPreferences = loadSavedPreferences;
  window.persistPreferences = persistPreferences;
  window.applyAppearancePreference = applyAppearancePreference;
})();
