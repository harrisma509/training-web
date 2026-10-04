/*
 * app.js
 * Shell/bootstrap layer for the dashboard.
 * Owns tab switching, shared header behavior, and app-level wiring; it delegates feature data loading to
 * module functions and relies on AppState plus the shared API layer for runtime state and fetch logic.
 */
function createFeatureActivationDispatcher({
  resolveFeature,
  getCurrentFeatureName,
  buildContext,
  commitTransition,
  restoreBlockedRoute,
  reportError,
  activateLegacy,
  recordAcceptedRoute,
}) {
  const initializationPromises = new Map();
  let transitionQueue = Promise.resolve();
  let hasCommittedActivation = false;

  function report(error) {
    if (typeof reportError === "function") {
      reportError(error);
    } else {
      console.error(error);
    }
  }

  function initializeFeature(featureName, feature, context) {
    if (typeof feature?.init !== "function") {
      return Promise.resolve(true);
    }
    if (!initializationPromises.has(featureName)) {
      const initialization = Promise.resolve()
        .then(() => feature.init.call(feature, context))
        .then(() => true)
        .catch(error => {
          report(error);
          return false;
        });
      initializationPromises.set(featureName, initialization);
    }
    return initializationPromises.get(featureName);
  }

  async function runTransition(featureName, options = {}) {
    const destination = resolveFeature(featureName) || {};
    const previousFeatureName = getCurrentFeatureName();
    const context = buildContext(featureName, previousFeatureName, options, destination);
    const sameFeature = previousFeatureName === featureName;
    const routeChanged = Boolean(options.routeChanged);

    if (hasCommittedActivation && sameFeature && !routeChanged && options.force !== true) {
      return { accepted: true, changed: false, reason: "same-feature" };
    }

    if (!await initializeFeature(featureName, destination, context)) {
      restoreBlockedRoute?.(context);
      return { accepted: false, changed: false, reason: "init-failed" };
    }

    if (!sameFeature) {
      const currentFeature = resolveFeature(previousFeatureName);
      if (typeof currentFeature?.canDeactivate === "function") {
        let canDeactivate = false;
        try {
          canDeactivate = await currentFeature.canDeactivate.call(currentFeature, context) === true;
        } catch (error) {
          report(error);
          canDeactivate = false;
        }
        if (!canDeactivate) {
          restoreBlockedRoute?.(context);
          return { accepted: false, changed: false, reason: "deactivation-blocked" };
        }
      }

      if (typeof currentFeature?.deactivate === "function") {
        try {
          await currentFeature.deactivate.call(currentFeature, context);
        } catch (error) {
          report(error);
        }
      }
    }

    try {
      await commitTransition(context, { destination, previousFeatureName });
    } catch (error) {
      report(error);
      restoreBlockedRoute?.(context);
      return { accepted: false, changed: false, reason: "commit-failed" };
    }
    hasCommittedActivation = true;

    if (typeof destination.activate === "function") {
      try {
        await destination.activate.call(destination, context);
      } catch (error) {
        report(error);
      }
    } else if (typeof activateLegacy === "function") {
      try {
        await activateLegacy(featureName, context, destination);
      } catch (error) {
        report(error);
      }
    }

    recordAcceptedRoute?.(context);
    return { accepted: true, changed: !sameFeature };
  }

  function activateFeature(featureName, options = {}) {
    const transition = transitionQueue.then(
      () => runTransition(featureName, options),
      () => runTransition(featureName, options),
    );
    transitionQueue = transition.catch(() => undefined);
    return transition;
  }

  return { activateFeature };
}

const state = window.AppState;

window.TrainingApp = window.TrainingApp || {
  state: window.AppState,
  api: window.api,
  utils: window.AppUtils,
  features: {},
};
window.TrainingApp.state = window.AppState;
window.TrainingApp.api = window.api;
window.TrainingApp.utils = window.AppUtils;
window.TrainingApp.features = window.TrainingApp.features || {};
window.TrainingApp.registerFeature = window.TrainingApp.registerFeature || function (name, feature) {
  if (!feature || typeof feature !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(window.TrainingApp.features, name)) {
    window.TrainingApp.features[name] = feature;
  }
};

if (window.PlanController) {
  window.TrainingApp.registerFeature("plan", window.PlanController);
}
if (window.GoalsController) {
  window.TrainingApp.registerFeature("goals", window.GoalsController);
}
if (window.KPIsController) {
  window.TrainingApp.registerFeature("kpis", window.KPIsController);
}
if (window.ComponentsController) {
  window.TrainingApp.registerFeature("components", window.ComponentsController);
  window.TrainingApp.registerFeature("service", window.ComponentsController);
}
const planTab = document.getElementById("planTab");
const goalsTab = document.getElementById("goalsTab");
const kpisTab = document.getElementById("kpisTab");
const chartsTab = document.getElementById("chartsTab");
const dailyTab = document.getElementById("dailyTab");
const searchTab = document.getElementById("searchTab");
const weeklyTab = document.getElementById("weeklyTab");
const zonesTab = document.getElementById("zonesTab");
const serviceTab = document.getElementById("serviceTab");
const componentsSubtab = document.getElementById("componentsSubtab");
const gearSubtab = document.getElementById("gearSubtab");
const yearlyTab = document.getElementById("yearlyTab");
const coachTab = document.getElementById("coachTab");
const planPane = document.getElementById("planPane");
const goalsPane = document.getElementById("goalsPane");
const kpisPane = document.getElementById("kpisPane");
const chartsPane = document.getElementById("chartsPane");
const dailyPane = document.getElementById("dailyPane");
const searchPane = document.getElementById("searchPane");
const weeklyPane = document.getElementById("weeklyPane");
const zonesPane = document.getElementById("zonesPane");
const servicePane = document.getElementById("servicePane");
const gearPane = document.getElementById("gearPane");
const componentsPane = document.getElementById("componentsPane");
const yearlyPane = document.getElementById("yearlyPane");
const coachPane = document.getElementById("coachPane");

const dailyControls = document.getElementById("dailyControls");
const weeklyControls = document.getElementById("weeklyControls");
const zonesControls = document.getElementById("zonesControls");
const gearControls = document.getElementById("gearControls");
const componentsControls = document.getElementById("componentsControls");
const yearlyControls = document.getElementById("yearlyControls");

const weeklyLimit = document.getElementById("weeklyLimit");
const zonesLimit = document.getElementById("zonesLimit");
const hideShoesCheckbox = document.getElementById("hideShoesCheckbox");
const hideRetiredCheckbox = document.getElementById("hideRetiredCheckbox");
const gearRefresh = document.getElementById("gearRefresh");
const componentsBikeSelect = document.getElementById("componentsBikeSelect");

const mobileMenuButton = document.getElementById("mobileMenuButton");
const mobileCurrentDestination = document.getElementById("mobileCurrentDestination");
const mobileNavigation = document.getElementById("mobileNavigation");

function closeMobileNavigation(restoreFocus = false) {
  if (!mobileMenuButton || !mobileNavigation) return;
  mobileNavigation.classList.add("hidden");
  mobileMenuButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) mobileMenuButton.focus();
}

function openMobileNavigation() {
  if (!mobileMenuButton || !mobileNavigation) return;
  mobileNavigation.classList.remove("hidden");
  mobileMenuButton.setAttribute("aria-expanded", "true");
  mobileNavigation.querySelector("button")?.focus();
}

function syncMobileNavigation(activeTab) {
  const activeDesktopTab = document.querySelector(`.header-tabs button[data-tab="${activeTab}"]`)
    || document.getElementById(`${activeTab}Tab`);
  const destination = activeDesktopTab ? activeDesktopTab.textContent.trim() : "Daily";
  if (mobileCurrentDestination) mobileCurrentDestination.textContent = destination;

  document.querySelectorAll(".header-tabs button, #mobileNavigation button").forEach(button => {
    const isActive = button.dataset.tab === activeTab || button.id === `${activeTab}Tab`;
    button.classList.toggle("active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function buildMobileNavigation() {
  if (!mobileNavigation) return;
  document.querySelectorAll(".header-tabs button").forEach(desktopButton => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-navigation-item";
    button.dataset.tab = desktopButton.id.replace(/Tab$/, "");
    button.textContent = desktopButton.textContent.trim();
    button.addEventListener("click", () => {
      showTab(button.dataset.tab, { source: "mobile-nav" });
      closeMobileNavigation();
    });
    mobileNavigation.appendChild(button);
  });
}

buildMobileNavigation();
mobileMenuButton?.addEventListener("click", () => {
  const isOpen = mobileMenuButton.getAttribute("aria-expanded") === "true";
  if (isOpen) closeMobileNavigation();
  else openMobileNavigation();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && mobileMenuButton?.getAttribute("aria-expanded") === "true") {
    closeMobileNavigation(true);
  }
});
document.addEventListener("click", event => {
  if (mobileMenuButton?.getAttribute("aria-expanded") !== "true") return;
  if (!event.target.closest(".mobile-navigation-bar, #mobileNavigation")) closeMobileNavigation();
});

planTab?.addEventListener("click", () => showTab("plan"));
goalsTab?.addEventListener("click", () => showTab("goals"));
kpisTab?.addEventListener("click", () => showTab("kpis"));
chartsTab?.addEventListener("click", () => showTab("charts"));
dailyTab.addEventListener("click", () => showTab("daily"));
searchTab?.addEventListener("click", () => showTab("search"));
weeklyTab.addEventListener("click", () => showTab("weekly"));
zonesTab.addEventListener("click", () => showTab("zones"));
serviceTab?.addEventListener("click", () => showTab("service"));
componentsSubtab?.addEventListener("click", () => requestServiceSubtab("components"));
gearSubtab?.addEventListener("click", () => requestServiceSubtab("gear"));
document.querySelectorAll(".service-subtab").forEach((button, index, buttons) => {
  button.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextButton = buttons[(index + direction + buttons.length) % buttons.length];
    nextButton.focus();
    requestServiceSubtab(nextButton.id === "gearSubtab" ? "gear" : "components");
  });
});
yearlyTab.addEventListener("click", () => showTab("yearly"));
coachTab?.addEventListener("click", () => showTab("coach"));
gearRefresh.addEventListener("click", () => {
  window.TrainingApp?.features?.gear?.refresh?.();
});
componentsBikeSelect?.addEventListener("change", event => {
  const selectedGearId = String(event.target.value || "").trim();
  window.AppState.componentsSelectedGearId = selectedGearId;
  persistPreferences();
  loadComponents();
});
function statusPill(value) {
  const status = safe(value);
  if (!status) {
    return "";
  }
  return `<span class="pill status-${status}">${status}</span>`;
}
window.TrainingApp?.features?.sync?.init?.();
window.TrainingApp?.features?.sync?.refresh?.();
function showServiceSubtab(subtab) {
  const normalizedSubtab = ["components", "gear"].includes(subtab) ? subtab : "components";
  persistPreferences();

  const isComponents = normalizedSubtab === "components";
  componentsPane.classList.toggle("hidden", !isComponents);
  gearPane.classList.toggle("hidden", isComponents);
  componentsControls.classList.toggle("hidden", !isComponents || state.activeTab !== "service");
  gearControls.classList.toggle("hidden", isComponents || state.activeTab !== "service");

  [componentsSubtab, gearSubtab].forEach(button => {
    if (!button) return;
    const isSelected = button === (isComponents ? componentsSubtab : gearSubtab);
    button.classList.toggle("active", isSelected);
    button.setAttribute("aria-selected", String(isSelected));
    button.tabIndex = isSelected ? 0 : -1;
  });
}

async function requestServiceSubtab(subtab) {
  const normalizedSubtab = ["components", "gear"].includes(subtab) ? subtab : "components";
  const switchingAwayFromComponents = state.serviceSubtab === "components"
    && normalizedSubtab !== "components";
  const componentsFeature = window.TrainingApp?.features?.service || window.ComponentsController;

  if (switchingAwayFromComponents && typeof componentsFeature?.canDeactivate === "function") {
    const allowed = await componentsFeature.canDeactivate({
      featureName: "service",
      reason: "service-subtab",
      source: "service-subtab",
      destinationSubtab: normalizedSubtab,
    });
    if (allowed !== true) {
      return false;
    }
    await componentsFeature.deactivate({
      featureName: "service",
      reason: "service-subtab",
      source: "service-subtab",
      destinationSubtab: normalizedSubtab,
    });
  }

  showServiceSubtab(normalizedSubtab);
  return true;
}

window.showServiceSubtab = showServiceSubtab;
window.requestServiceSubtab = requestServiceSubtab;

const VALID_FEATURE_TABS = ["plan", "goals", "kpis", "charts", "daily", "search", "weekly", "zones", "service", "yearly", "coach"];
let lastAcceptedRoute = window.location.href;

function normalizeFeatureTab(tab) {
  return VALID_FEATURE_TABS.includes(tab) ? tab : "daily";
}

function buildFeatureUrl(tab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  if (tab !== "daily") url.searchParams.delete("date");
  if (tab !== "search") window.TrainingApp?.features?.search?.removeSearchParameters(url);
  return url;
}

function buildFeatureActivationContext(featureName, previousFeatureName, options = {}, destination = {}) {
  const source = options.source || (options.fromHistory ? "popstate" : "programmatic");
  const url = buildFeatureUrl(featureName);
  const crossesSearchBoundary = previousFeatureName !== featureName
    && (previousFeatureName === "search" || featureName === "search");
  const fromHistory = source === "popstate" || source === "startup" || source === "direct-url" || options.fromHistory === true;
  const managesHistory = featureName !== "search" || typeof destination.activate !== "function";
  const shouldPush = crossesSearchBoundary && !fromHistory && url.href !== window.location.href;

  return {
    featureName,
    previousFeatureName,
    source,
    reason: options.reason || source,
    fromHistory,
    activationKey: `${featureName}:${url.pathname}${url.search}`,
    route: {
      tab: featureName,
      date: url.searchParams.get("date") || "",
      url,
      params: new URLSearchParams(url.search),
    },
    historyMode: shouldPush ? "push" : "replace",
    updateHistory: managesHistory,
  };
}

function commitFeatureTransition(context) {
  const normalizedTab = context.featureName;
  const isPlan = normalizedTab === "plan";
  const isGoals = normalizedTab === "goals";
  const isKpis = normalizedTab === "kpis";
  const isCharts = normalizedTab === "charts";
  const isDaily = normalizedTab === "daily";
  const isSearch = normalizedTab === "search";
  const isWeekly = normalizedTab === "weekly";
  const isZones = normalizedTab === "zones";
  const isService = normalizedTab === "service";
  const isYearly = normalizedTab === "yearly";
  const isCoach = normalizedTab === "coach";

  state.activeTab = normalizedTab;
  if (isSearch && context.source === "popstate") {
    window.TrainingApp?.features?.search?.restoreFromUrl?.();
  }
  persistPreferences();

  if (context.updateHistory && context.route.url.href !== window.location.href) {
    if (context.historyMode === "push") window.history.pushState({}, "", context.route.url);
    else window.history.replaceState({}, "", context.route.url);
  }

  planPane.classList.toggle("hidden", !isPlan);
  goalsPane.classList.toggle("hidden", !isGoals);
  kpisPane.classList.toggle("hidden", !isKpis);
  chartsPane.classList.toggle("hidden", !isCharts);
  dailyPane.classList.toggle("hidden", !isDaily);
  searchPane?.classList.toggle("hidden", !isSearch);
  weeklyPane.classList.toggle("hidden", !isWeekly);
  zonesPane.classList.toggle("hidden", !isZones);
  servicePane.classList.toggle("hidden", !isService);
  yearlyPane.classList.toggle("hidden", !isYearly);
  coachPane?.classList.toggle("hidden", !isCoach);

  dailyControls.classList.toggle("hidden", !isDaily);
  weeklyControls.classList.toggle("hidden", !isWeekly);
  zonesControls.classList.toggle("hidden", !isZones);
  yearlyControls.classList.toggle("hidden", !isYearly);

  planTab?.classList.toggle("active", isPlan);
  goalsTab?.classList.toggle("active", isGoals);
  kpisTab?.classList.toggle("active", isKpis);
  chartsTab?.classList.toggle("active", isCharts);
  dailyTab.classList.toggle("active", isDaily);
  searchTab?.classList.toggle("active", isSearch);
  weeklyTab.classList.toggle("active", isWeekly);
  zonesTab.classList.toggle("active", isZones);
  serviceTab?.classList.toggle("active", isService);
  yearlyTab.classList.toggle("active", isYearly);
  coachTab?.classList.toggle("active", isCoach);
  syncMobileNavigation(normalizedTab);

  if (isService) {
    showServiceSubtab(state.serviceSubtab);
  } else {
    componentsControls.classList.add("hidden");
    gearControls.classList.add("hidden");
  }

  if (isCharts) window.TrainingApp?.features?.charts?.showCategory?.(state.chartsCategory, { load: false });
  if (isYearly) window.TrainingApp?.features?.yearly?.showView?.(state.yearlyView || "annual");
}

const featureActivationDispatcher = createFeatureActivationDispatcher({
  resolveFeature: featureName => window.TrainingApp?.features?.[featureName],
  getCurrentFeatureName: () => state.activeTab || "daily",
  buildContext: buildFeatureActivationContext,
  commitTransition: commitFeatureTransition,
  restoreBlockedRoute: context => {
    if (context.source === "popstate" && lastAcceptedRoute !== window.location.href) {
      window.history.replaceState({}, "", lastAcceptedRoute);
    }
  },
  reportError: error => console.error("Feature activation failed.", error),
  recordAcceptedRoute: () => {
    lastAcceptedRoute = window.location.href;
  },
});

function activateFeature(tab, options = {}) {
  const normalizedTab = normalizeFeatureTab(tab);
  const targetUrl = buildFeatureUrl(normalizedTab);
  const source = options.source || (options.fromHistory ? "popstate" : "programmatic");
  return featureActivationDispatcher.activateFeature(normalizedTab, {
    ...options,
    source,
    reason: options.reason || source,
    routeChanged: targetUrl.href !== lastAcceptedRoute,
  });
}

window.TrainingApp.activateFeature = activateFeature;
window.activateFeature = activateFeature;

function showTab(tab, options = {}) {
  return activateFeature(tab, {
    ...options,
    source: options.source || (options.fromHistory ? "popstate" : "programmatic"),
  });
}

function renderHeaderSummary() {
  return;
}

async function loadData() {
  await Promise.all([
    window.TrainingApp?.features?.daily?.refresh?.(),
    window.TrainingApp?.features?.weekly?.refresh?.(),
    window.TrainingApp?.features?.zones?.refresh?.(),
    window.TrainingApp?.features?.gear?.refresh?.(),
    loadComponents(),
    window.TrainingApp?.features?.yearly?.refresh?.()
  ]);

  renderHeaderSummary();
  window.TrainingApp?.features?.sync?.init?.();
  window.TrainingApp?.features?.sync?.refresh?.();
}

const initialUrlParams = new URLSearchParams(window.location.search);
const requestedTab = initialUrlParams.get("tab");
const startupTab = VALID_FEATURE_TABS.includes(requestedTab)
  ? requestedTab
  : (window.AppState.activeTab || "daily");
showTab(startupTab, {
  fromHistory: true,
  source: requestedTab ? "direct-url" : "startup",
});
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  showTab(VALID_FEATURE_TABS.includes(tab) ? tab : "daily", {
    fromHistory: true,
    source: "popstate",
  });
});
loadData();