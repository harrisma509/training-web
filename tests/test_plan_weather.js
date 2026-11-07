const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const weatherSource = fs.readFileSync("static/plan_weather.js", "utf8");
const planCssSource = fs.readFileSync("static/plan.css", "utf8");

class FakeElement {
  constructor(document, name = "") {
    this.ownerDocument = document;
    this.name = name;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.children = new Map();
    this.isConnected = true;
    this.disabled = false;
    this.hidden = false;
    this.offsetParent = {};
    this.tabIndex = 0;
    this.innerHTML = "";
    this.textContent = "";
    this.classNames = new Set();
    this.classList = {
      add: value => this.classNames.add(value),
      remove: value => this.classNames.delete(value),
      contains: value => this.classNames.has(value),
    };
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  appendChild(child) {
    this.children.set(child.id || child.name, child);
    child.parent = this;
    child.isConnected = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelector(selector) {
    if (!this.children.has(selector)) {
      this.children.set(selector, new FakeElement(this.ownerDocument, selector));
    }
    return this.children.get(selector);
  }

  querySelectorAll() {
    return [this.querySelector("[data-plan-weather-action='close']")];
  }

  contains() {
    return true;
  }

  closest(selector) {
    if (selector === "[data-plan-weather-trigger]" && this.dataset.planWeatherTrigger) {
      return this;
    }
    if (selector === "[data-plan-weather-action]" && this.dataset.planWeatherAction) {
      return this;
    }
    return null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getClientRects() {
    return [1];
  }

  matches(selector) {
    return selector.includes("button");
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.activeElement = null;
    this.trigger = null;
    this.strip = new FakeElement(this, "planStrip");
    this.body = new FakeElement(this, "body");
  }

  getElementById(id) {
    return id === "planStrip" ? this.strip : null;
  }

  createElement(name) {
    return new FakeElement(this, name);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  querySelector(selector) {
    if (selector.includes("data-plan-weather-trigger")) return this.trigger;
    return null;
  }
}

function createWeatherController(api = {}) {
  const document = new FakeDocument();
  const window = {
    api,
    escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character])),
    TrainingApp: {
      TransientSurface: {
        create: options => {
          let opener = null;
          let open = false;
          return {
            open({ opener: nextOpener } = {}) {
              opener = nextOpener;
              open = true;
            },
            close(reason) {
              if (!open) return false;
              open = false;
              options.onBeforeClose?.(reason, options.getSurface?.());
              options.onAfterClose?.(reason, options.getSurface?.());
              return true;
            },
            requestClose(reason) {
              return Promise.resolve(this.close(reason));
            },
            isOpen: () => open,
            getOpener: () => opener,
          };
        },
      },
    },
  };
  vm.runInNewContext(weatherSource, { window, document, Date, Intl, Map, Number, Promise, Set, String });
  return { controller: window.PlanWeatherController, document, window };
}

function item({
  id,
  environment = "outdoor",
  locationId,
  locationName = `Location ${locationId}`,
  duration = null,
  itemState = "committed",
}) {
  return {
    plan_item_id: id,
    environment,
    item_state: itemState,
    saved_location_id: locationId,
    saved_location: locationId == null
      ? null
      : { location_id: locationId, display_name: locationName, is_home: false },
    prescription: { target_duration_min: duration },
  };
}

function forecast(date, options = {}) {
  return {
    freshness: options.freshness || "fresh",
    stale_age_minutes: options.staleAgeMinutes ?? null,
    available_start_date: options.startDate || date,
    available_end_date: options.endDate || "2026-11-04",
    daily: [{
      date,
      condition: options.condition || "clear",
      temperature_high_f: Object.hasOwn(options, "high") ? options.high : 64,
      temperature_low_f: Object.hasOwn(options, "low") ? options.low : 39,
      precipitation_probability_max_pct: Object.hasOwn(options, "precipitationProbability")
        ? options.precipitationProbability
        : 10,
      precipitation_in: Object.hasOwn(options, "precipitation") ? options.precipitation : 0.01,
      snowfall_in: Object.hasOwn(options, "snowfall") ? options.snowfall : 0,
      wind_speed_max_mph: Object.hasOwn(options, "windSpeed") ? options.windSpeed : 12,
      wind_direction_dominant_deg: Object.hasOwn(options, "windDirection")
        ? options.windDirection
        : 225,
      wind_gust_max_mph: Object.hasOwn(options, "gust") ? options.gust : 24,
      sunrise_local: Object.hasOwn(options, "sunrise") ? options.sunrise : `${date}T06:30`,
      sunset_local: Object.hasOwn(options, "sunset") ? options.sunset : `${date}T17:45`,
    }],
  };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

function testResponse(payload) {
  return { ok: true, json: async () => payload };
}

async function runApiScript(fetch) {
  const window = {};
  vm.runInNewContext(apiSource, { window, fetch, URLSearchParams });
  return window.api;
}

async function testApiWeatherWrappersUseOnlyTiRoutes() {
  const requests = [];
  const api = await runApiScript(async (url, options) => {
    requests.push({ url: String(url), options });
    return testResponse({});
  });

  await api.fetchWeatherForecast(42);
  await api.fetchWeatherHourly(42, "2026-10-20");

  assert.equal(requests[0].url, "/api/weather/locations/42/forecast");
  assert.equal(requests[1].url, "/api/weather/locations/42/hourly?date=2026-10-20");
  assert.equal(requests.every(request => request.options.method === undefined), true);
}

function testSelectionUsesOutdoorDurationAndDisplayOrder() {
  const items = [
    item({ id: 1, environment: "indoor", locationId: 90, duration: 300 }),
    item({ id: 2, environment: "either", locationId: 91, duration: 240 }),
    item({ id: 3, locationId: 10, locationName: "First outdoor", duration: 45 }),
    item({ id: 4, locationId: 20, locationName: "Longest outdoor", duration: 90 }),
    item({ id: 5, locationId: 30, locationName: "Equal duration", duration: 90 }),
    item({ id: 6, locationId: 20, locationName: "Duplicate location", duration: null }),
    item({ id: 7, locationId: 40, duration: 500, itemState: "cancelled" }),
    item({ id: 8, locationId: 50, duration: 500, itemState: "deleted" }),
    item({ id: 9, locationId: 60, duration: null }),
  ];

  const selection = createWeatherController().controller.selectLocationsForDate(items);

  assert.equal(selection.primary.display_name, "Longest outdoor");
  assert.deepEqual(
    Array.from(selection.locations, location => location.display_name),
    ["Longest outdoor", "First outdoor", "Equal duration", "Location 60"],
  );
  assert.equal(selection.additionalCount, 3);
  assert.equal(selection.locations.some(location => [90, 91, 40, 50].includes(location.location_id)), false);
}

function testMissingDurationsPreserveFirstAndHomeIsOnlyFallback() {
  const controller = createWeatherController().controller;
  const first = item({ id: 1, locationId: 11, duration: null });
  const later = item({ id: 2, locationId: 12, duration: null });
  const selection = controller.selectLocationsForDate([first, later]);
  assert.equal(selection.primary.location_id, 11);

  const home = {
    location_id: 3,
    display_name: "Home",
    is_home: true,
    lifecycle_state: "active",
  };
  const fallback = controller.selectLocationsForDate(
    [item({ id: 4, environment: "indoor", locationId: 20, duration: 100 })],
    home,
  );
  assert.equal(fallback.primary.display_name, "Home");
  assert.deepEqual(Array.from(fallback.locations, location => location.location_id), [3]);
  assert.equal(controller.selectLocationsForDate([]).locations.length, 0);
}

async function testPastAndBeyondRangeDoNotFetchWeather() {
  let forecastCalls = 0;
  const { controller } = createWeatherController({
    fetchWeatherForecast: async () => {
      forecastCalls += 1;
      return forecast("2026-10-20");
    },
    fetchSavedLocations: async () => ({ locations: [] }),
  });
  const items = [item({ id: 1, locationId: 7, duration: 30 })];

  assert.equal(controller.renderDay({
    dateKey: "2026-10-19",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  }), "");
  assert.equal(controller.renderDay({
    dateKey: "2026-11-05",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  }), "");
  await settle();
  assert.equal(forecastCalls, 0);
}

async function testHeaderDeduplicatesForecastsAndFormatsNullableValues() {
  const forecastCalls = [];
  const { controller } = createWeatherController({
    fetchWeatherForecast: async locationId => {
      forecastCalls.push(locationId);
      return forecast("2026-10-20", { high: null, low: 39, gust: 41 });
    },
  });
  const items = [
    item({ id: 1, locationId: 7, locationName: "Home trail", duration: 90 }),
    item({ id: 2, locationId: 8, locationName: "Other trail", duration: 45 }),
    item({ id: 3, locationId: 8, locationName: "Duplicate trail", duration: 30 }),
  ];

  controller.renderDay({ dateKey: "2026-10-20", todayKey: "2026-10-20", items, itemsReady: true });
  controller.renderDay({ dateKey: "2026-10-21", todayKey: "2026-10-20", items, itemsReady: true });
  await settle();
  const html = controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });

  assert.equal(forecastCalls.length, 2);
  assert.match(html, /<button[^>]+data-plan-weather-trigger="2026-10-20"/);
  assert.match(html, /L 39°/);
  assert.match(html, /\+1/);
  const trigger = html.match(/<button\b([^>]*)>(.*?)<\/button>/s);
  assert.ok(trigger);
  assert.match(trigger[1], /aria-label="[^"]*High wind warning: maximum gust 41 mph/);
  assert.match(trigger[1], /title="[^"]*High wind warning: maximum gust 41 mph/);
  assert.match(trigger[2], /plan-weather-alert is-warning/);
  assert.doesNotMatch(trigger[2], /SW|mph|G\d|gust/i);
  assert.doesNotMatch(html, /null|undefined|NaN|0°|latitude|longitude|weather_code|Open-Meteo|Geoapify/);
}

async function testUnknownDailyConditionKeepsWeatherTriggerAndHourlyDetails() {
  const forecastCalls = [];
  const hourlyCalls = [];
  const { controller, document } = createWeatherController({
    fetchWeatherForecast: async locationId => {
      forecastCalls.push(locationId);
      return forecast("2026-10-20", {
        condition: "unknown",
        high: 72,
        low: 55,
        gust: 32,
      });
    },
    fetchWeatherHourly: async (locationId, dateKey) => {
      hourlyCalls.push([locationId, dateKey]);
      return {
        hourly: [{
          timestamp_local: `${dateKey}T08:00`,
          condition: "clear",
          temperature_f: 60,
          apparent_temperature_f: 59,
          wind_direction_deg: 225,
          wind_speed_mph: 8,
          wind_gust_mph: 12,
          precipitation_probability_pct: 10,
          precipitation_in: 0.01,
          snowfall_in: 0,
        }],
      };
    },
  });
  const items = [item({ id: 1, locationId: 9, duration: 60 })];

  controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });
  await settle();
  const html = controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });

  assert.match(html, /data-plan-weather-trigger="2026-10-20"/);
  assert.match(html, /plan-weather-icon[^>]*>·<\/span>/);
  assert.match(html, /72°\/55°/);
  assert.match(html, /plan-weather-alert is-caution/);
  assert.doesNotMatch(html, /Forecast unavailable/);

  controller.init();
  const trigger = new FakeElement(document, "weather-trigger");
  trigger.dataset.planWeatherTrigger = "2026-10-20";
  document.trigger = trigger;
  document.strip.listeners.get("click")[0]({ target: trigger });
  await settle();

  const detail = document.body.children.get("planWeatherDialog")
    ?.querySelector("#planWeatherDialogBody")?.innerHTML;
  assert.match(detail, /Conditions unknown/);
  assert.match(detail, /8:00 AM/);
  assert.doesNotMatch(detail, /Hourly forecast unavailable|Forecast unavailable/);
  assert.deepEqual(forecastCalls, [9]);
  assert.deepEqual(hourlyCalls, [[9, "2026-10-20"]]);
}

async function testPartialDailyValuesRemainClickableAndRenderHonestly() {
  const { controller, document } = createWeatherController({
    fetchWeatherForecast: async () => forecast("2026-10-20", {
      condition: "unknown",
      high: null,
      low: null,
      precipitationProbability: null,
      precipitation: null,
      snowfall: null,
      windSpeed: null,
      windDirection: null,
      gust: null,
      sunrise: null,
      sunset: null,
    }),
    fetchWeatherHourly: async (_, dateKey) => ({
      hourly: [{
        timestamp_local: `${dateKey}T08:00`,
        condition: "clear",
        temperature_f: 60,
        apparent_temperature_f: 59,
        wind_direction_deg: 225,
        wind_speed_mph: 8,
        wind_gust_mph: null,
        precipitation_probability_pct: 10,
        precipitation_in: 0.01,
        snowfall_in: 0,
      }],
    }),
  });
  const items = [item({ id: 1, locationId: 9, duration: 60 })];
  controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });
  await settle();
  const html = controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });

  assert.match(html, /<button[^>]+data-plan-weather-trigger="2026-10-20"/);
  assert.match(html, /plan-weather-icon[^>]*>·<\/span>/);
  assert.doesNotMatch(html, /Forecast unavailable|null|undefined|NaN|0°|plan-weather-alert/);

  controller.init();
  const trigger = new FakeElement(document, "weather-trigger");
  trigger.dataset.planWeatherTrigger = "2026-10-20";
  document.trigger = trigger;
  document.strip.listeners.get("click")[0]({ target: trigger });
  await settle();

  const detail = document.body.children.get("planWeatherDialog")
    ?.querySelector("#planWeatherDialogBody")?.innerHTML;
  assert.match(detail, /Conditions unknown/);
  assert.match(detail, /Sunrise and sunset unavailable\./);
  assert.match(detail, /8:00 AM/);
  assert.doesNotMatch(detail, /null|undefined|NaN|(?:^|[^0-9])0°|latitude|longitude|weather_code/);
}

async function testDatesAfterShortenedRangeDoNotShowUnavailableTrigger() {
  const { controller } = createWeatherController({
    fetchWeatherForecast: async () => forecast("2026-11-21", {
      endDate: "2026-11-21",
      condition: "unknown",
      high: null,
      low: null,
    }),
  });
  const items = [item({ id: 1, locationId: 9, duration: 60 })];
  controller.renderDay({
    dateKey: "2026-11-21",
    todayKey: "2026-11-21",
    items,
    itemsReady: true,
  });
  await settle();
  const retained = controller.renderDay({
    dateKey: "2026-11-21",
    todayKey: "2026-11-21",
    items,
    itemsReady: true,
  });
  const outsideRange = controller.renderDay({
    dateKey: "2026-11-22",
    todayKey: "2026-11-21",
    items,
    itemsReady: true,
  });

  assert.match(retained, /data-plan-weather-trigger="2026-11-21"/);
  assert.equal(outsideRange, "");
}


async function renderHeaderForGust(gust, forecastOptions = {}) {
  const { controller } = createWeatherController({
    fetchWeatherForecast: async () => forecast("2026-10-20", {
      ...forecastOptions,
      gust,
    }),
  });
  const items = [item({ id: 1, locationId: 7, duration: 30 })];
  controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });
  await settle();
  return controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });
}

async function testGustAlertThresholdsAndCompactHeaderStyles() {
  for (const [gust, alertClass, label, iconClass, iconShape] of [
    [null, null, null, null, null],
    [24.9, null, null, null, null],
    [25.0, "is-caution", "Windy: maximum gust 25 mph", "plan-weather-wind-icon", "M1.5 5h8.25"],
    [34.9, "is-caution", "Windy: maximum gust 34.9 mph", "plan-weather-wind-icon", "M1.5 5h8.25"],
    [35.0, "is-warning", "High wind warning: maximum gust 35 mph", "plan-weather-warning-icon", "M8 1.5 14.5 14H1.5z"],
    [65.3, "is-warning", "High wind warning: maximum gust 65.3 mph", "plan-weather-warning-icon", "M8 1.5 14.5 14H1.5z"],
  ]) {
    const html = await renderHeaderForGust(gust);
    const trigger = html.match(/<button\b([^>]*)>(.*?)<\/button>/s);
    assert.ok(trigger);
    assert.match(trigger[2], /<span class="plan-weather-icon" aria-hidden="true">/);
    if (!alertClass) {
      assert.doesNotMatch(trigger[2], /plan-weather-alert/);
      assert.doesNotMatch(trigger[1], /maximum gust/);
    } else {
      assert.match(trigger[2], new RegExp(`plan-weather-alert ${alertClass}`));
      assert.ok(trigger[1].includes(label));
      assert.match(trigger[2], new RegExp(`<svg class="${iconClass}"`));
      assert.ok(trigger[2].includes(iconShape), `${iconClass} should render its distinct shape`);
    }
    assert.doesNotMatch(trigger[2], /SW|mph|G\d|gust/i);
  }

  assert.match(planCssSource, /\.plan-weather-trigger\s*\{[^}]*max-width:\s*none;[^}]*overflow:\s*visible;/s);
  assert.match(planCssSource, /\.plan-weather-alert\.is-caution/);
  assert.match(planCssSource, /\.plan-weather-alert\.is-warning/);
  assert.match(planCssSource, /\.plan-weather-wind-icon,\s*\.plan-weather-warning-icon\s*\{[^}]*width:\s*11px;[^}]*height:\s*11px;/s);

  const cssRules = [...planCssSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const fontSizesFor = className => cssRules
    .filter(([, selector]) => new RegExp(`\\.${className}(?![\\w-])`).test(selector))
    .flatMap(([, , declarations]) => [...declarations.matchAll(/font-size:\s*([^;]+);/g)])
    .map(([, fontSize]) => fontSize.trim());
  assert.deepEqual(fontSizesFor("plan-weather-icon"), ["16.5px"]);
  for (const className of [
    "plan-date",
    "plan-weather-trigger",
    "plan-weather-temperature",
  ]) {
    assert.deepEqual(fontSizesFor(className), ["11px"], `${className} should use 11px throughout the stylesheet`);
  }
  assert.match(planCssSource, /\.plan-weather-icon\s*\{[^}]*color:\s*#2563EB;[^}]*font-size:\s*16\.5px;[^}]*line-height:\s*1;/s);
  assert.match(planCssSource, /\.plan-weather-alert\s*\{[^}]*font-size:\s*11px;/s);
  assert.match(planCssSource, /\.plan-weather-alert\.is-caution\s*\{[^}]*color:\s*#D97706;/s);
  assert.match(planCssSource, /\.plan-weather-alert\.is-warning\s*\{[^}]*color:\s*#DC2626;/s);

  const nullableLow = await renderHeaderForGust(null, { high: 64, low: null });
  assert.match(nullableLow, /H 64°/);
  assert.doesNotMatch(nullableLow, /\/null°|L null/);
}

async function testHomeFallbackAndNoHomeAreDistinct() {
  const calls = { locations: 0, forecasts: 0 };
  const { controller } = createWeatherController({
    fetchSavedLocations: async () => {
      calls.locations += 1;
      return {
        locations: [{
          location_id: 5,
          display_name: "Home",
          lifecycle_state: "active",
          is_home: true,
        }],
      };
    },
    fetchWeatherForecast: async () => {
      calls.forecasts += 1;
      return forecast("2026-10-20");
    },
  });

  controller.renderDay({ dateKey: "2026-10-20", todayKey: "2026-10-20", items: [], itemsReady: true });
  await settle();
  controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items: [],
    itemsReady: true,
  });
  await settle();
  const html = controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items: [],
    itemsReady: true,
  });
  assert.match(html, /Home/);
  assert.equal(calls.locations, 1);
  assert.equal(calls.forecasts, 1);

  const noHome = createWeatherController({
    fetchSavedLocations: async () => ({ locations: [] }),
    fetchWeatherForecast: async () => {
      throw new Error("No forecast should be requested without Home.");
    },
  }).controller;
  noHome.renderDay({ dateKey: "2026-10-20", todayKey: "2026-10-20", items: [], itemsReady: true });
  await settle();
  assert.equal(noHome.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items: [],
    itemsReady: true,
  }), "");
}

async function testUnavailableAndStaleLocationsRemainIndependentInDetails() {
  let mutationCalls = 0;
  const api = {
    fetchWeatherForecast: async locationId => {
      if (locationId === 2) {
        const error = new Error("Unavailable");
        error.status = 503;
        throw error;
      }
      return forecast("2026-10-20", {
        freshness: locationId === 1 ? "stale" : "fresh",
        staleAgeMinutes: 45,
      });
    },
    fetchWeatherHourly: async locationId => {
      if (locationId === 2) {
        const error = new Error("Unavailable");
        error.status = 503;
        throw error;
      }
      return {
        freshness: locationId === 1 ? "stale" : "fresh",
        stale_age_minutes: locationId === 1 ? 45 : null,
        hourly: [{
          timestamp_local: "2026-10-20T08:00",
          condition: "clear",
          temperature_f: 52,
          apparent_temperature_f: 50,
          wind_direction_deg: 225,
          wind_speed_mph: 8,
          wind_gust_mph: 14,
          precipitation_probability_pct: 10,
          precipitation_in: 0.01,
          snowfall_in: 0,
        }, {
          timestamp_local: "2026-10-20T10:00",
          condition: "cloudy",
          temperature_f: 48,
          apparent_temperature_f: 46,
          wind_direction_deg: 270,
          wind_speed_mph: 6,
          wind_gust_mph: null,
          precipitation_probability_pct: 0,
          precipitation_in: 0,
          snowfall_in: 0,
        }],
      };
    },
    updatePlanItem: async () => { mutationCalls += 1; },
    cancelPlanItem: async () => { mutationCalls += 1; },
  };
  const { controller, document } = createWeatherController(api);
  const items = [
    item({ id: 1, locationId: 1, locationName: "Primary trail", duration: 120 }),
    item({ id: 2, locationId: 2, locationName: "Unavailable trail", duration: 90 }),
    item({ id: 3, locationId: 3, locationName: "Other trail", duration: 60 }),
  ];
  controller.renderDay({ dateKey: "2026-10-20", todayKey: "2026-10-20", items, itemsReady: true });
  await settle();
  const header = controller.renderDay({
    dateKey: "2026-10-20",
    todayKey: "2026-10-20",
    items,
    itemsReady: true,
  });
  assert.match(header, /\+2/);

  controller.init();
  const trigger = new FakeElement(document, "weather-trigger");
  trigger.dataset.planWeatherTrigger = "2026-10-20";
  document.trigger = trigger;
  document.strip.listeners.get("click")[0]({
    target: trigger,
  });
  await settle();

  const dialogBody = document.body.children.get("planWeatherDialog")
    ?.querySelector("#planWeatherDialogBody");
  assert.ok(dialogBody);
  const detail = dialogBody.innerHTML;
  assert.ok(detail.indexOf("Primary trail") < detail.indexOf("Unavailable trail"));
  assert.ok(detail.indexOf("Unavailable trail") < detail.indexOf("Other trail"));
  assert.match(detail, /Stale forecast/);
  assert.match(detail, /Hourly forecast unavailable/);
  assert.match(detail, /8:00 AM/);
  assert.match(detail, /SW 8 mph · gust 14 mph/);
  assert.match(detail, /10:00 AM/);
  assert.match(detail, /W 6 mph/);
  assert.doesNotMatch(detail, /gust 6 mph/);
  assert.doesNotMatch(detail, /latitude|longitude|weather_code|Open-Meteo|Geoapify|NaN|undefined/);
  assert.equal(mutationCalls, 0);

  const keydown = document.listeners.get("keydown")[0];
  let prevented = false;
  keydown({ key: "Escape", preventDefault() { prevented = true; } });
  await settle();
  assert.equal(prevented, true);
  assert.equal(document.activeElement, trigger);
}

async function run() {
  await testApiWeatherWrappersUseOnlyTiRoutes();
  testSelectionUsesOutdoorDurationAndDisplayOrder();
  testMissingDurationsPreserveFirstAndHomeIsOnlyFallback();
  await testPastAndBeyondRangeDoNotFetchWeather();
  await testHeaderDeduplicatesForecastsAndFormatsNullableValues();
  await testUnknownDailyConditionKeepsWeatherTriggerAndHourlyDetails();
  await testPartialDailyValuesRemainClickableAndRenderHonestly();
  await testDatesAfterShortenedRangeDoNotShowUnavailableTrigger();
  await testGustAlertThresholdsAndCompactHeaderStyles();
  await testHomeFallbackAndNoHomeAreDistinct();
  await testUnavailableAndStaleLocationsRemainIndependentInDetails();
  console.log("Plan Weather UI contract tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
