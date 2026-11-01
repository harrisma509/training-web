const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const moduleSource = fs.readFileSync("static/saved_locations.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const settingsSource = fs.readFileSync("templates/partials/settings/settings_drawer.html", "utf8");
const settingsModuleSource = fs.readFileSync("static/settings.js", "utf8");
const templateModuleSource = fs.readFileSync("static/plan_templates.js", "utf8");
const itemModuleSource = fs.readFileSync("static/plan_item_editor.js", "utf8");

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.classList = {
      add: () => {},
      remove: () => {},
    };
    this.value = "";
    this.innerHTML = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  focus() {
    this.focused = true;
  }

  reset() {
    this.value = "";
  }

  querySelector(selector) {
    if (selector === 'button[type="submit"]') return this.submitButton;
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

async function flushTasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function testSearchAndSaveFlow(homeAvailable) {
  const elements = new Map();
  for (const id of [
    "savedLocationSearchOverlay",
    "savedLocationSearchDialog",
    "savedLocationSearchForm",
    "savedLocationSearchQuery",
    "savedLocationSearchStatus",
    "savedLocationSearchResults",
    "savedLocationSaveForm",
    "savedLocationDisplayName",
    "savedLocationType",
    "savedLocationTypeHelp",
    "savedLocationManagement",
    "savedLocationManagementList",
    "savedLocationManagementStatus",
  ]) {
    elements.set(id, new FakeElement());
  }
  const saveButton = new FakeElement();
  elements.get("savedLocationSaveForm").submitButton = saveButton;
  const calls = [];
  const selectedLocation = {
    location_id: 41,
    display_name: "Central Park",
    timezone_name: "America/New_York",
    location_type: "training",
    lifecycle_state: "active",
    is_home: false,
  };
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    let response;
    if (url === "/api/saved-locations" && options.method === "POST") {
      response = { location: selectedLocation };
    } else if (url === "/api/saved-locations") {
      response = {
        locations: homeAvailable ? [{ location_id: 1, is_home: true }] : [],
      };
    } else if (url.startsWith("/api/saved-locations/search?")) {
      response = {
        results: [
          {
            place_id: "synthetic-geoapify-place-id",
            display_name: "Sample Venue <img>",
            subtitle: "Example City",
          },
        ],
      };
    } else if (url === "/api/saved-locations/manage") {
      response = {
        locations: [
          {
            location_id: 41,
            display_name: "Home",
            location_type: "home",
            lifecycle_state: "active",
            is_home: true,
            is_referenced: true,
          },
        ],
      };
    } else {
      throw new Error("Unexpected saved-location API request.");
    }
    return { ok: true, json: async () => response };
  };
  const app = {
    TransientSurface: {
      create({ onBeforeClose, onAfterClose }) {
        return {
          open() {},
          requestClose() {
            onBeforeClose();
            onAfterClose();
          },
        };
      },
    },
  };
  const document = {
    readyState: "complete",
    activeElement: null,
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  const window = { TrainingApp: app, confirm: () => true };
  const browserContext = { window, document, URLSearchParams, fetch };
  vm.runInNewContext(apiSource, browserContext);
  vm.runInNewContext(moduleSource, browserContext);

  let assignedLocation = null;
  await app.savedLocations.openSearch({
    onSaved(location) {
      assignedLocation = location;
    },
  });
  const searchForm = elements.get("savedLocationSearchForm");
  const searchQuery = elements.get("savedLocationSearchQuery");
  searchQuery.value = "Sample Venue";
  await searchForm.dispatch("submit", { preventDefault() {} });
  await flushTasks();

  const results = elements.get("savedLocationSearchResults");
  assert.match(results.innerHTML, /Sample Venue &lt;img&gt;/);
  assert.doesNotMatch(results.innerHTML, /<img>/);
  await results.dispatch("click", {
    target: {
      closest(selector) {
        return selector === "[data-saved-location-place-id]"
          ? { dataset: { savedLocationPlaceId: "synthetic-geoapify-place-id" } }
          : null;
      },
    },
  });
  assert.equal(elements.get("savedLocationDisplayName").value, "Sample Venue <img>");
  assert.equal(
    elements.get("savedLocationType").value,
    homeAvailable ? "training" : "home",
  );
  assert.equal(elements.get("savedLocationType").disabled, false);
  elements.get("savedLocationDisplayName").value = "Sample Venue";
  await elements.get("savedLocationDisplayName").dispatch("input");

  await elements.get("savedLocationSaveForm").dispatch("submit", {
    preventDefault() {},
  });
  const saveRequest = requests.find(
    ({ url, options }) => url === "/api/saved-locations" && options.method === "POST",
  );
  assert.ok(saveRequest);
  const requestBody = JSON.parse(saveRequest.options.body);
  assert.equal(requestBody.provider_place_id, "synthetic-geoapify-place-id");
  assert.equal(requestBody.display_name, "Sample Venue");
  assert.equal(requestBody.location_type, homeAvailable ? "training" : "home");
  assert.equal("latitude" in requestBody, false);
  assert.equal("longitude" in requestBody, false);
  assert.equal(assignedLocation, selectedLocation);
  assert.equal(elements.get("savedLocationSearchOverlay").attributes["aria-hidden"], "true");

  await app.savedLocations.activateManagement();
  const managementHtml = elements.get("savedLocationManagementList").innerHTML;
  assert.match(managementHtml, /Home\/default/);
  assert.match(managementHtml, /Used by a template or Plan item/);
  assert.doesNotMatch(managementHtml, /latitude|longitude/);
}

assert.match(indexSource, /id="savedLocationSearchOverlay"/);
assert.match(indexSource, /static\/saved_locations\.js/);
assert.match(settingsSource, /id="savedLocationManagement"/);
assert.match(settingsModuleSource, /savedLocations\?\.activateManagement\(\)/);
assert.match(templateModuleSource, /data-plan-template-action="add-location"/);
assert.match(templateModuleSource, /state\.draft\.saved_location_id = location\.location_id/);
assert.match(itemModuleSource, /data-plan-item-editor-action="add-location"/);
assert.match(itemModuleSource, /locationSelect\.value = String\(location\.location_id\)/);
assert.match(moduleSource, /data-saved-location-action="archive"/);
assert.match(moduleSource, /data-saved-location-action="hide"/);
assert.match(moduleSource, /data-saved-location-action="home"/);
assert.match(moduleSource, /data-saved-location-action="restore"/);
assert.match(moduleSource, /data-saved-location-action="delete"/);
assert.match(moduleSource, /window\.confirm/);
for (const method of [
  "searchSavedLocations",
  "fetchSavedLocationsForManagement",
  "createSavedLocation",
  "updateSavedLocation",
  "setSavedLocationHome",
  "deleteSavedLocation",
]) {
  assert.match(apiSource, new RegExp(`async ${method}\\(`));
}

Promise.all([testSearchAndSaveFlow(true), testSearchAndSaveFlow(false)]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
