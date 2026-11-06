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
        locations: homeAvailable
          ? [
            {
              location_id: 1,
              display_name: "Home",
              location_type: "home",
              lifecycle_state: "active",
              is_home: true,
              is_referenced: true,
            },
            selectedLocation,
          ]
          : [{
            ...selectedLocation,
            location_type: "home",
            is_home: true,
          }],
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
    listeners: new Map(),
    getElementById(id) {
      return elements.get(id) || null;
    },
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
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
  assert.match(managementHtml, /(?:Used by a template or Plan item|Not currently used)/);
  assert.match(managementHtml, /saved-location-management-row/);
  assert.match(managementHtml, /saved-location-management-name[^>]*>Central Park<\/strong>/);
  assert.match(managementHtml, /data-saved-location-action="rename"[^>]*>Rename<\/button>/);
  assert.doesNotMatch(managementHtml, /Save name/);
  assert.doesNotMatch(managementHtml, /latitude|longitude/);
}

function createManagementRow(location) {
  const nameInput = new FakeElement();
  nameInput.value = location.display_name;
  const displayName = new FakeElement();
  displayName.textContent = location.display_name;
  const renameField = new FakeElement();
  renameField.hidden = true;
  const buttons = {};
  const addButton = action => {
    const button = new FakeElement();
    button.dataset.savedLocationAction = action;
    buttons[action] = button;
    return button;
  };
  for (const action of ["rename", "save-name", "cancel-rename", "toggle-menu"]) {
    addButton(action);
  }
  const actions = [];
  if (!location.is_home && location.lifecycle_state === "active") {
    actions.push("home", "hide", "archive");
  } else if (location.lifecycle_state !== "active") {
    actions.push("restore");
  }
  if (!location.is_referenced) actions.push("delete");

  const row = {
    dataset: {
      savedLocationId: String(location.location_id),
      savedLocationState: location.lifecycle_state,
      savedLocationHome: String(Boolean(location.is_home)),
      savedLocationEditing: "false",
      savedLocationSaving: "false",
    },
    buttons,
    nameInput,
    displayName,
    renameField,
    classList: { add() {}, remove() {} },
    querySelector(selector) {
      if (selector === "[data-saved-location-display-name]") return displayName;
      if (selector === "[data-saved-location-rename]") return renameField;
      if (selector === "[data-saved-location-name]") return nameInput;
      const match = selector.match(/^\[data-saved-location-action="([^"]+)"\]$/);
      return match ? buttons[match[1]] || null : null;
    },
  };
  const querySelectorBase = row.querySelector.bind(row);

  if (actions.length) {
    const menu = new FakeElement();
    menu.hidden = true;
    menu.buttons = actions.map(addButton);
    menu.querySelector = selector => selector === "button" ? menu.buttons[0] || null : null;
    menu.closest = selector => selector === "[data-saved-location-id]" ? row : null;
    row.menu = menu;
    row.querySelector = selector => selector === "[data-saved-location-menu]"
      ? menu
      : querySelectorBase(selector);
  }
  for (const button of Object.values(buttons)) {
    button.closest = selector => {
      if (selector === "[data-saved-location-id]") return row;
      if (selector === "[data-saved-location-action]") return button;
      if (selector === "[data-saved-location-menu]" && row.menu?.buttons.includes(button)) {
        return row.menu;
      }
      const match = selector.match(/^\[data-saved-location-action="([^"]+)"\]$/);
      return match && button.dataset.savedLocationAction === match[1] ? button : null;
    };
  }
  return row;
}

function createManagementHarness(locations) {
  const savedLocations = locations.map(location => ({ ...location }));
  const managementRoot = new FakeElement();
  const managementStatus = new FakeElement();
  const managementList = new FakeElement();
  const rows = savedLocations.map(createManagementRow);
  managementList.rows = rows;
  managementList.querySelectorAll = selector => selector === "[data-saved-location-menu]"
    ? rows.map(row => row.menu).filter(Boolean)
    : [];
  managementList.querySelector = selector => {
    const id = selector.match(/data-saved-location-id="([^"]+)"/)?.[1];
    const action = selector.match(/data-saved-location-action="([^"]+)"/)?.[1];
    const row = rows.find(candidate => candidate.dataset.savedLocationId === id);
    return action ? row?.buttons[action] || null : row || null;
  };
  const calls = { loads: 0, updates: [], home: [], deleted: [], confirms: [] };
  const api = {
    async fetchSavedLocationsForManagement() {
      calls.loads += 1;
      return { locations: savedLocations.map(location => ({ ...location })) };
    },
    async updateSavedLocation(id, payload) {
      calls.updates.push({ id, payload: { ...payload } });
      const location = savedLocations.find(item => String(item.location_id) === String(id));
      Object.assign(location, payload);
      return location;
    },
    async setSavedLocationHome(id) {
      calls.home.push(id);
    },
    async deleteSavedLocation(id) {
      calls.deleted.push(id);
    },
  };
  const document = {
    readyState: "complete",
    listeners: new Map(),
    getElementById(id) {
      return {
        savedLocationManagement: managementRoot,
        savedLocationManagementList: managementList,
        savedLocationManagementStatus: managementStatus,
      }[id] || null;
    },
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    },
  };
  const window = {
    api,
    TrainingApp: {},
    confirm(message) {
      calls.confirms.push(message);
      return true;
    },
  };
  vm.runInNewContext(moduleSource, { window, document });
  return { api, calls, document, managementList, managementRoot, managementStatus, rows, savedLocations, window };
}

function managementEvent(row, action) {
  const element = action === "name-input" ? row.nameInput : row.buttons[action];
  return {
    target: {
      closest(selector) {
        if (selector === "[data-saved-location-action]") {
          return element?.dataset.savedLocationAction ? element : null;
        }
        if (selector === "[data-saved-location-id]") return row;
        if (selector === "[data-saved-location-name]") {
          return element === row.nameInput ? row.nameInput : null;
        }
        if (selector === "[data-saved-location-menu]") {
          return row.menu?.buttons.includes(element) ? row.menu : null;
        }
        const match = selector.match(/^\[data-saved-location-action="([^"]+)"\]$/);
        return match && element?.dataset.savedLocationAction === match[1] ? element : null;
      },
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

async function clickManagementAction(harness, row, action) {
  await harness.managementRoot.dispatch("click", managementEvent(row, action));
}

function rowMarkup(html, id) {
  const marker = `data-saved-location-id="${id}"`;
  const start = html.indexOf(marker);
  const articleStart = html.lastIndexOf("<article", start);
  const articleEnd = html.indexOf("</article>", start);
  assert.ok(start >= 0 && articleStart >= 0 && articleEnd >= 0, `Expected location row ${id}`);
  return html.slice(articleStart, articleEnd + "</article>".length);
}

const managementFixtures = [
  {
    location_id: 1,
    display_name: "Home",
    location_type: "home",
    lifecycle_state: "active",
    is_home: true,
    is_referenced: true,
    latitude: 39.7,
    longitude: -104.9,
    provider_place_id: "private-provider-id",
  },
  {
    location_id: 2,
    display_name: "Cheyenne",
    location_type: "training",
    lifecycle_state: "active",
    is_home: false,
    is_referenced: true,
  },
  {
    location_id: 3,
    display_name: "Hidden Trail",
    location_type: "training",
    lifecycle_state: "hidden",
    is_home: false,
    is_referenced: true,
  },
  {
    location_id: 4,
    display_name: "Archived Trail",
    location_type: "training",
    lifecycle_state: "archived",
    is_home: false,
    is_referenced: false,
  },
];

async function testCompactRowsAndStateSpecificOverflow() {
  const harness = createManagementHarness(managementFixtures);
  await harness.window.TrainingApp.savedLocations.activateManagement();
  const html = harness.managementList.innerHTML;
  assert.equal((html.match(/class="saved-location-management-row"/g) || []).length, 4);
  assert.match(html, /saved-location-management-name[^>]*>Cheyenne<\/strong>/);
  assert.match(html, /Home\/default · active · Used by a template or Plan item/);
  assert.match(html, /training · active · Used by a template or Plan item/);
  assert.match(html, /data-saved-location-action="rename" aria-label="Rename Cheyenne">Rename<\/button>/);
  assert.match(html, /data-saved-location-rename hidden/);
  assert.doesNotMatch(html, /Save name/);
  assert.doesNotMatch(html, /39\.7|-104\.9|latitude|longitude|private-provider-id/);

  const homeMarkup = rowMarkup(html, 1);
  assert.doesNotMatch(
    homeMarkup,
    /data-saved-location-action="(?:home|hide|archive|restore|delete)"/,
  );
  const activeMarkup = rowMarkup(html, 2);
  assert.match(activeMarkup, /aria-label="Actions for Cheyenne"/);
  for (const action of ["home", "hide", "archive"]) {
    assert.match(activeMarkup, new RegExp(`data-saved-location-action="${action}"`));
  }
  assert.doesNotMatch(activeMarkup, /data-saved-location-action="delete"/);
  const hiddenMarkup = rowMarkup(html, 3);
  assert.match(hiddenMarkup, /data-saved-location-action="restore"/);
  assert.doesNotMatch(hiddenMarkup, /data-saved-location-action="delete"/);
  assert.doesNotMatch(hiddenMarkup, /data-saved-location-action="(?:home|hide|archive)"/);
  const archivedMarkup = rowMarkup(html, 4);
  assert.match(archivedMarkup, /data-saved-location-action="restore"/);
  assert.match(archivedMarkup, /data-saved-location-action="delete"/);
  assert.doesNotMatch(archivedMarkup, /data-saved-location-action="(?:home|hide|archive)"/);
}

async function testOverflowMenusAreExclusiveAndKeyboardAccessible() {
  const harness = createManagementHarness(managementFixtures);
  await harness.window.TrainingApp.savedLocations.activateManagement();
  const active = harness.rows.find(row => row.dataset.savedLocationId === "2");
  const hidden = harness.rows.find(row => row.dataset.savedLocationId === "3");

  await clickManagementAction(harness, active, "toggle-menu");
  assert.equal(active.menu.hidden, false);
  assert.equal(active.buttons["toggle-menu"].attributes["aria-expanded"], "true");
  assert.equal(active.menu.buttons[0].focused, true);

  await clickManagementAction(harness, hidden, "toggle-menu");
  assert.equal(active.menu.hidden, true, "opening a second menu closes the first");
  assert.equal(active.buttons["toggle-menu"].attributes["aria-expanded"], "false");
  assert.equal(hidden.menu.hidden, false);

  const escape = managementEvent(hidden, "toggle-menu");
  escape.key = "Escape";
  await harness.managementRoot.dispatch("keydown", escape);
  assert.equal(hidden.menu.hidden, true);
  assert.equal(hidden.buttons["toggle-menu"].attributes["aria-expanded"], "false");
  assert.equal(hidden.buttons["toggle-menu"].focused, true);

  await clickManagementAction(harness, active, "toggle-menu");
  const outsideTarget = { closest: () => null };
  for (const listener of harness.document.listeners.get("click") || []) {
    listener({ target: outsideTarget });
  }
  assert.equal(active.menu.hidden, true, "outside click closes the menu");
}

async function testInlineRenameCancelAndKeyboardSave() {
  const harness = createManagementHarness(managementFixtures);
  await harness.window.TrainingApp.savedLocations.activateManagement();
  const cheyenne = harness.rows.find(row => row.dataset.savedLocationId === "2");

  await clickManagementAction(harness, cheyenne, "rename");
  assert.equal(cheyenne.displayName.hidden, true);
  assert.equal(cheyenne.renameField.hidden, false);
  assert.equal(cheyenne.nameInput.value, "Cheyenne");
  assert.equal(cheyenne.nameInput.focused, true);
  assert.equal(cheyenne.buttons.rename.hidden, true);
  assert.equal(cheyenne.buttons["save-name"].hidden, false);
  assert.equal(cheyenne.buttons["cancel-rename"].hidden, false);
  assert.equal(cheyenne.buttons["toggle-menu"].hidden, true);

  cheyenne.nameInput.value = "Discard this name";
  const escape = managementEvent(cheyenne, "name-input");
  escape.key = "Escape";
  await harness.managementRoot.dispatch("keydown", escape);
  assert.equal(cheyenne.displayName.hidden, false);
  assert.equal(cheyenne.renameField.hidden, true);
  assert.equal(cheyenne.nameInput.value, "Cheyenne");
  assert.equal(cheyenne.buttons.rename.focused, true);
  assert.equal(harness.calls.updates.length, 0, "Cancel makes no API mutation");

  await clickManagementAction(harness, cheyenne, "rename");
  cheyenne.nameInput.value = "Cheyenne Temporary";
  const enter = managementEvent(cheyenne, "name-input");
  enter.key = "Enter";
  await harness.managementRoot.dispatch("keydown", enter);
  assert.deepEqual(harness.calls.updates, [{
    id: "2",
    payload: { display_name: "Cheyenne Temporary", lifecycle_state: "active" },
  }]);
  assert.equal(cheyenne.displayName.textContent, "Cheyenne Temporary");
  assert.equal(cheyenne.displayName.hidden, false);
  assert.equal(cheyenne.renameField.hidden, true);
  assert.match(harness.managementList.innerHTML, />Cheyenne Temporary<\/strong>/);
  assert.equal(harness.managementStatus.textContent, "Saved location updated.");
  assert.equal(cheyenne.buttons.rename.focused, true);
}

async function testRenamePreventsDuplicateSubmissions() {
  const harness = createManagementHarness(managementFixtures);
  await harness.window.TrainingApp.savedLocations.activateManagement();
  const cheyenne = harness.rows.find(row => row.dataset.savedLocationId === "2");
  await clickManagementAction(harness, cheyenne, "rename");
  cheyenne.nameInput.value = "Cheyenne Temporary";

  const update = harness.api.updateSavedLocation.bind(harness.api);
  let resolveUpdate;
  let updateCalls = 0;
  harness.api.updateSavedLocation = (id, payload) => {
    updateCalls += 1;
    return new Promise(resolve => {
      resolveUpdate = async () => resolve(await update(id, payload));
    });
  };
  const firstSave = harness.managementRoot.dispatch(
    "click",
    managementEvent(cheyenne, "save-name"),
  );
  await Promise.resolve();
  assert.equal(cheyenne.dataset.savedLocationSaving, "true");
  assert.equal(cheyenne.nameInput.disabled, true);
  assert.equal(cheyenne.buttons["save-name"].disabled, true);
  const escape = managementEvent(cheyenne, "name-input");
  escape.key = "Escape";
  await harness.managementRoot.dispatch("keydown", escape);
  assert.equal(cheyenne.displayName.hidden, true, "Escape cannot cancel an in-flight save");
  await clickManagementAction(harness, cheyenne, "save-name");
  assert.equal(updateCalls, 1);
  await resolveUpdate();
  await firstSave;
  assert.equal(updateCalls, 1);
  assert.equal(cheyenne.dataset.savedLocationSaving, "false");
}

async function testUnreferencedDeleteRetainsConfirmation() {
  const harness = createManagementHarness(managementFixtures);
  await harness.window.TrainingApp.savedLocations.activateManagement();
  const archived = harness.rows.find(row => row.dataset.savedLocationId === "4");
  await clickManagementAction(harness, archived, "toggle-menu");
  await clickManagementAction(harness, archived, "delete");
  assert.deepEqual(harness.calls.confirms, ['Permanently delete "Archived Trail"?']);
  assert.deepEqual(harness.calls.deleted, ["4"]);
}

async function testOverflowActionsKeepExistingMutationPaths() {
  const harness = createManagementHarness(managementFixtures);
  await harness.window.TrainingApp.savedLocations.activateManagement();
  const active = harness.rows.find(row => row.dataset.savedLocationId === "2");
  const hidden = harness.rows.find(row => row.dataset.savedLocationId === "3");

  await clickManagementAction(harness, active, "home");
  await clickManagementAction(harness, active, "hide");
  await clickManagementAction(harness, active, "archive");
  await clickManagementAction(harness, hidden, "restore");

  assert.deepEqual(harness.calls.home, ["2"]);
  assert.deepEqual(
    harness.calls.updates.map(call => call.payload.lifecycle_state),
    ["hidden", "archived", "active"],
  );
  assert.deepEqual(harness.calls.updates.map(call => call.id), ["2", "2", "3"]);
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

Promise.all([
 testSearchAndSaveFlow(true),
 testSearchAndSaveFlow(false),
 testCompactRowsAndStateSpecificOverflow(),
 testOverflowMenusAreExclusiveAndKeyboardAccessible(),
 testInlineRenameCancelAndKeyboardSave(),
 testRenamePreventsDuplicateSubmissions(),
 testUnreferencedDeleteRetainsConfirmation(),
 testOverflowActionsKeepExistingMutationPaths(),
]).catch((error) => {
 console.error(error);
 process.exitCode = 1;
});
