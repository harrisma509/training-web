(function () {
  const app = (window.TrainingApp = window.TrainingApp || {});
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });

  const searchRoot = document.getElementById("savedLocationSearchOverlay");
  const searchDialog = document.getElementById("savedLocationSearchDialog");
  const searchForm = document.getElementById("savedLocationSearchForm");
  const searchQuery = document.getElementById("savedLocationSearchQuery");
  const searchStatus = document.getElementById("savedLocationSearchStatus");
  const searchResults = document.getElementById("savedLocationSearchResults");
  const saveForm = document.getElementById("savedLocationSaveForm");
  const displayNameInput = document.getElementById("savedLocationDisplayName");
  const locationTypeSelect = document.getElementById("savedLocationType");
  const locationTypeHelp = document.getElementById("savedLocationTypeHelp");

  const searchState = {
    surface: null,
    isOpen: false,
    homeAvailable: null,
    searching: false,
    saving: false,
    results: [],
    selected: null,
    displayName: "",
    status: "",
    requestId: 0,
    availabilityRequestId: 0,
    onSaved: null,
  };

  function getErrorMessage(error, fallback) {
    return error && typeof error.detail === "string" && error.detail
      ? error.detail
      : fallback;
  }

  function renderSearchResults() {
    searchResults.innerHTML = searchState.results
      .map(
        (result) => `
          <button type="button" class="saved-location-search-result"
            data-saved-location-place-id="${escapeHtml(result.place_id)}">
            <span class="saved-location-result-name">${escapeHtml(result.display_name)}</span>
            <span class="saved-location-result-address">${escapeHtml(result.subtitle)}</span>
          </button>
        `,
      )
      .join("");

    searchStatus.textContent = searchState.status;
    saveForm.hidden = !searchState.selected;
    if (!searchState.selected) return;

    displayNameInput.value = searchState.displayName;
    if (searchState.homeAvailable === false) {
      locationTypeSelect.innerHTML = '<option value="home">Home/default</option>';
      locationTypeSelect.value = "home";
      locationTypeSelect.disabled = searchState.homeAvailable === null;
      locationTypeHelp.textContent =
        "This will be the Home/default location because no Home exists yet.";
    } else if (searchState.homeAvailable === true) {
      locationTypeSelect.innerHTML = [
        '<option value="training">Training</option>',
        '<option value="work">Work</option>',
        '<option value="other">Other</option>',
      ].join("");
      if (!["training", "work", "other"].includes(locationTypeSelect.value)) {
        locationTypeSelect.value = "training";
      }
      locationTypeSelect.disabled = false;
      locationTypeHelp.textContent = "";
    } else {
      locationTypeSelect.innerHTML = "";
      locationTypeSelect.disabled = true;
      locationTypeHelp.textContent = "Saved locations could not be loaded.";
    }

    saveForm.querySelector('button[type="submit"]').disabled =
      searchState.saving || searchState.homeAvailable === null;
  }

  function resetSearchState() {
    searchState.requestId += 1;
    searchState.availabilityRequestId += 1;
    searchState.isOpen = false;
    searchState.homeAvailable = null;
    searchState.searching = false;
    searchState.saving = false;
    searchState.results = [];
    searchState.selected = null;
    searchState.displayName = "";
    searchState.status = "";
    searchState.onSaved = null;
    searchQuery.value = "";
    searchResults.innerHTML = "";
    searchStatus.textContent = "";
    saveForm.reset();
    saveForm.hidden = true;
  }

  function closeSearch(reason) {
    if (!searchState.surface) return;
    searchState.surface.requestClose(reason || "close-button");
  }

  async function searchPlaces(query) {
    const normalizedQuery = String(query || "").trim();
    searchState.requestId += 1;
    const requestId = searchState.requestId;
    searchState.searching = true;
    searchState.selected = null;
    searchState.displayName = "";
    searchState.results = [];
    searchState.status = "Searching...";
    renderSearchResults();

    try {
      const response = await window.api.searchSavedLocations(normalizedQuery);
      if (requestId !== searchState.requestId) return;
      if (!response || !Array.isArray(response.results)) {
        throw new Error("The location search returned an invalid response.");
      }
      searchState.results = response.results;
      searchState.status = response.results.length
        ? "Choose a result to review and save."
        : "No results found. Try a different place, postal code, or address.";
    } catch (error) {
      if (requestId !== searchState.requestId) return;
      searchState.status = getErrorMessage(
        error,
        "Location search is temporarily unavailable.",
      );
    } finally {
      if (requestId === searchState.requestId) {
        searchState.searching = false;
        renderSearchResults();
      }
    }
  }

  async function selectPlace(placeId) {
    const selected = searchState.results.find(
      (result) => String(result.place_id) === String(placeId),
    );
    if (!selected) return;

    searchState.selected = selected;
    searchState.displayName = selected.display_name;
    searchState.status = "Review the display name and location type before saving.";
    renderSearchResults();
    displayNameInput.focus();
  }

  async function saveSelectedPlace(event) {
    event.preventDefault();
    if (!searchState.selected || searchState.homeAvailable === null) return;

    const locationType = locationTypeSelect.value;
    if (!locationType) {
      searchState.status = "Choose a location type before saving.";
      renderSearchResults();
      return;
    }

    searchState.saving = true;
    searchState.status = "Verifying and saving location...";
    renderSearchResults();
    try {
      const response = await window.api.createSavedLocation({
        provider_place_id: searchState.selected.place_id,
        display_name: searchState.displayName.trim(),
        location_type: locationType,
      });
      if (!response || !response.location) {
        throw new Error("The location save returned an invalid response.");
      }
      if (typeof searchState.onSaved === "function") {
        try {
          await searchState.onSaved(response.location);
        } catch {
          searchState.status =
            "Location saved, but it could not be assigned. Refresh and select it from the saved list.";
          return;
        }
      }
      closeSearch("save-complete");
    } catch (error) {
      searchState.status = getErrorMessage(
        error,
        "Location could not be verified and saved.",
      );
    } finally {
      searchState.saving = false;
      renderSearchResults();
    }
  }

  async function openSearch(options) {
    if (!searchState.surface || searchState.isOpen) return;
    const settings = options || {};
    searchState.onSaved = settings.onSaved || null;
    searchState.isOpen = true;
    searchState.status = "Loading saved locations...";
    searchState.availabilityRequestId += 1;
    const availabilityRequestId = searchState.availabilityRequestId;
    const opener = document.activeElement;
    searchRoot.classList.remove("hidden");
    searchRoot.setAttribute("aria-hidden", "false");
    searchState.surface.open({ opener });
    renderSearchResults();
    searchQuery.focus();

    try {
      const response = await window.api.fetchSavedLocations();
      if (
        availabilityRequestId !== searchState.availabilityRequestId
        || !searchState.isOpen
      ) return;
      const locations = response && Array.isArray(response.locations)
        ? response.locations
        : [];
      searchState.homeAvailable = locations.some((location) => location.is_home);
      searchState.status = "Search for a place to add.";
    } catch (error) {
      if (
        availabilityRequestId !== searchState.availabilityRequestId
        || !searchState.isOpen
      ) return;
      searchState.homeAvailable = null;
      searchState.status = getErrorMessage(
        error,
        "Saved locations could not be loaded.",
      );
    }
    renderSearchResults();
  }

  function focusableDialogElements() {
    return Array.from(
      searchDialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden && !element.closest("[hidden]"));
  }

  function handleSearchDialogKeydown(event) {
    if (!searchState.isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch("escape");
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableDialogElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function initSearch() {
    if (!searchRoot || !window.api || !app.TransientSurface) return;
    searchState.surface = app.TransientSurface.create({
      getSurface: () => searchRoot,
      onBeforeClose() {
        searchRoot.classList.add("hidden");
        searchRoot.setAttribute("aria-hidden", "true");
      },
      onAfterClose() {
        resetSearchState();
      },
    });

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = searchQuery.value.trim();
      if (!query) {
        searchState.status = "Enter a place, postal code, or address to search.";
        renderSearchResults();
        return;
      }
      searchPlaces(query);
    });
    saveForm.addEventListener("submit", saveSelectedPlace);
    displayNameInput.addEventListener("input", () => {
      searchState.displayName = displayNameInput.value;
    });
    searchResults.addEventListener("click", (event) => {
      const button = event.target.closest("[data-saved-location-place-id]");
      if (button) selectPlace(button.dataset.savedLocationPlaceId);
    });
    searchRoot.addEventListener("click", (event) => {
      if (event.target === searchRoot) {
        closeSearch("backdrop");
        return;
      }
      const closeButton = event.target.closest(
        '[data-saved-location-search-action="close"]',
      );
      if (closeButton) closeSearch("close-button");
    });
    searchDialog.addEventListener("keydown", handleSearchDialogKeydown);
  }

  const managementRoot = document.getElementById("savedLocationManagement");
  const managementList = document.getElementById("savedLocationManagementList");
  const managementStatus = document.getElementById("savedLocationManagementStatus");
  const managementState = { requestId: 0, loading: false };

  function locationRowMarkup(location) {
    const id = escapeHtml(location.location_id);
    const lifecycle = escapeHtml(location.lifecycle_state);
    const name = escapeHtml(location.display_name);
    const isHome = Boolean(location.is_home);
    const referenced = Boolean(location.is_referenced);
    const status = [
      isHome ? "Home/default" : escapeHtml(location.location_type),
      lifecycle,
      referenced ? "Used by a template or Plan item" : "Not currently used",
    ].join(" · ");
    const actions = [];

    if (!isHome && lifecycle === "active") {
      actions.push('<button type="button" data-saved-location-action="home">Set as Home</button>');
      actions.push('<button type="button" data-saved-location-action="hide">Hide</button>');
      actions.push('<button type="button" data-saved-location-action="archive">Archive</button>');
    } else if (lifecycle !== "active") {
      actions.push('<button type="button" data-saved-location-action="restore">Restore</button>');
    }
    if (!referenced) {
      actions.push('<button type="button" data-saved-location-action="delete">Delete</button>');
    }
    const actionsId = `savedLocationActions${id}`;
    const overflow = actions.length
      ? `
        <button type="button" class="saved-location-management-overflow-trigger"
          data-saved-location-action="toggle-menu" aria-controls="${actionsId}"
          aria-expanded="false" aria-label="Actions for ${name}">⋮</button>
      `
      : "";
    const menu = actions.length
      ? `<div id="${actionsId}" class="saved-location-management-menu"
          data-saved-location-menu role="group" aria-label="More actions for ${name}" hidden>
          ${actions.join("")}
        </div>`
      : "";

    return `
      <article class="saved-location-management-row"
        data-saved-location-id="${id}"
        data-saved-location-state="${lifecycle}"
        data-saved-location-home="${isHome ? "true" : "false"}"
        data-saved-location-editing="false"
        data-saved-location-saving="false">
        <div class="saved-location-management-primary">
          <strong class="saved-location-management-name" data-saved-location-display-name>${name}</strong>
          <label class="saved-location-management-rename" data-saved-location-rename hidden>
            <span class="settings-help-text">Rename location</span>
            <input type="text" data-saved-location-name aria-label="New name for ${name}"
              maxlength="120" value="${name}">
          </label>
          <p class="saved-location-management-meta">${status}</p>
        </div>
        <div class="saved-location-management-actions">
          <button type="button" data-saved-location-action="rename" aria-label="Rename ${name}">Rename</button>
          <button type="button" data-saved-location-action="save-name" hidden>Save</button>
          <button type="button" data-saved-location-action="cancel-rename" hidden>Cancel</button>
          ${overflow}
        </div>
        ${menu}
      </article>
    `;
  }

  function closeManagementMenus(exceptMenu = null) {
    for (const menu of managementList.querySelectorAll("[data-saved-location-menu]")) {
      if (menu === exceptMenu) continue;
      menu.hidden = true;
      const row = menu.closest("[data-saved-location-id]");
      row?.querySelector('[data-saved-location-action="toggle-menu"]')
        ?.setAttribute("aria-expanded", "false");
    }
  }

  function setRenameMode(row, editing) {
    const displayName = row.querySelector("[data-saved-location-display-name]");
    const editField = row.querySelector("[data-saved-location-rename]");
    const nameInput = row.querySelector("[data-saved-location-name]");
    const renameButton = row.querySelector('[data-saved-location-action="rename"]');
    const saveButton = row.querySelector('[data-saved-location-action="save-name"]');
    const cancelButton = row.querySelector('[data-saved-location-action="cancel-rename"]');
    const menuButton = row.querySelector('[data-saved-location-action="toggle-menu"]');

    row.dataset.savedLocationEditing = String(editing);
    displayName.hidden = editing;
    editField.hidden = !editing;
    renameButton.hidden = editing;
    saveButton.hidden = !editing;
    cancelButton.hidden = !editing;
    if (menuButton) menuButton.hidden = editing;
    if (editing) {
      closeManagementMenus();
      nameInput.focus();
      nameInput.select?.();
    } else {
      nameInput.value = displayName.textContent;
    }
  }

  function cancelManagementRename(row) {
    setRenameMode(row, false);
    row.querySelector('[data-saved-location-action="rename"]')?.focus();
  }

  function setManagementMenuOpen(row, open, { returnFocus = false } = {}) {
    const menu = row.querySelector("[data-saved-location-menu]");
    const trigger = row.querySelector('[data-saved-location-action="toggle-menu"]');
    if (!menu || !trigger) return;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      menu.querySelector("button")?.focus();
    } else if (returnFocus) {
      trigger.focus();
    }
  }

  async function saveManagementLocationName(row) {
    if (row.dataset.savedLocationSaving === "true") return;
    const nameInput = row.querySelector("[data-saved-location-name]");
    const saveButton = row.querySelector('[data-saved-location-action="save-name"]');
    const cancelButton = row.querySelector('[data-saved-location-action="cancel-rename"]');
    const displayName = row.querySelector("[data-saved-location-display-name]");
    const id = row.dataset.savedLocationId;
    row.dataset.savedLocationSaving = "true";
    nameInput.disabled = true;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    managementStatus.textContent = "";

    try {
      await updateManagementLocation(row);
      displayName.textContent = nameInput.value.trim();
      setRenameMode(row, false);
      const refreshed = await loadManagementLocations();
      managementStatus.textContent = refreshed
        ? "Saved location updated."
        : "Change saved, but the location list could not be refreshed.";
      if (refreshed) {
        managementList.querySelector(
          `[data-saved-location-id="${id}"] [data-saved-location-action="rename"]`,
        )?.focus();
      }
    } catch (error) {
      managementStatus.textContent = getErrorMessage(
        error,
        "Saved location could not be updated.",
      );
      nameInput.focus();
    } finally {
      row.dataset.savedLocationSaving = "false";
      nameInput.disabled = false;
      saveButton.disabled = false;
      cancelButton.disabled = false;
    }
  }

  async function loadManagementLocations() {
    if (!managementRoot || !window.api) return false;
    managementState.requestId += 1;
    const requestId = managementState.requestId;
    managementState.loading = true;
    managementStatus.textContent = "Loading saved locations...";
    try {
      const response = await window.api.fetchSavedLocationsForManagement();
      if (requestId !== managementState.requestId) return;
      const locations = response && Array.isArray(response.locations)
        ? response.locations
        : [];
      managementList.innerHTML = locations.map(locationRowMarkup).join("");
      managementStatus.textContent = locations.length
        ? ""
        : "No saved locations yet. Add one by searching above or from a Plan editor.";
      return true;
    } catch (error) {
      if (requestId !== managementState.requestId) return;
      managementStatus.textContent = getErrorMessage(
        error,
        "Saved locations could not be loaded.",
      );
      return false;
    } finally {
      if (requestId === managementState.requestId) {
        managementState.loading = false;
      }
    }
  }

  async function updateManagementLocation(row, lifecycleState) {
    const id = row.dataset.savedLocationId;
    const input = row.querySelector("[data-saved-location-name]");
    await window.api.updateSavedLocation(id, {
      display_name: input.value.trim(),
      lifecycle_state: lifecycleState || row.dataset.savedLocationState,
    });
  }

  async function handleManagementAction(event) {
    const button = event.target.closest("[data-saved-location-action]");
    if (!button) return;
    const row = button.closest("[data-saved-location-id]");
    if (!row) return;
    const action = button.dataset.savedLocationAction;
    const nameInput = row.querySelector("[data-saved-location-name]");
    const id = row.dataset.savedLocationId;
    managementStatus.textContent = "";

    if (action === "rename") {
      setRenameMode(row, true);
      return;
    }
    if (action === "cancel-rename") {
      if (row.dataset.savedLocationSaving === "true") return;
      cancelManagementRename(row);
      return;
    }
    if (action === "toggle-menu") {
      const menu = row.querySelector("[data-saved-location-menu]");
      const shouldOpen = Boolean(menu?.hidden);
      closeManagementMenus();
      if (shouldOpen) setManagementMenuOpen(row, true);
      return;
    }
    if (row.dataset.savedLocationSaving === "true") return;
    if (action !== "save-name") {
      setManagementMenuOpen(row, false);
    }
    try {
      if (action === "save-name") {
        await saveManagementLocationName(row);
      } else if (action === "home") {
        await window.api.setSavedLocationHome(id);
      } else if (action === "hide" || action === "archive" || action === "restore") {
        const lifecycle = action === "hide"
          ? "hidden"
          : action === "archive"
            ? "archived"
            : "active";
        await updateManagementLocation(row, lifecycle);
      } else if (action === "delete") {
        if (!window.confirm(`Permanently delete "${nameInput.value.trim()}"?`)) {
          return;
        }
        await window.api.deleteSavedLocation(id);
      } else {
        return;
      }
      if (action === "save-name") return;
      const refreshed = await loadManagementLocations();
      managementStatus.textContent = refreshed
        ? "Saved location updated."
        : "Change saved, but the location list could not be refreshed.";
    } catch (error) {
      managementStatus.textContent = getErrorMessage(
        error,
        "Saved location could not be updated.",
      );
    }
  }

  async function handleManagementKeydown(event) {
    const target = event.target;
    const row = target.closest("[data-saved-location-id]");
    if (event.key === "Enter" && target.closest("[data-saved-location-name]") && row) {
      event.preventDefault();
      await saveManagementLocationName(row);
      return;
    }
    if (event.key !== "Escape") return;
    if (row?.dataset.savedLocationEditing === "true") {
      event.preventDefault();
      if (row.dataset.savedLocationSaving === "true") return;
      cancelManagementRename(row);
      return;
    }
    const menu = row?.querySelector("[data-saved-location-menu]");
    if (menu && !menu.hidden && row) {
      event.preventDefault();
      setManagementMenuOpen(row, false, { returnFocus: true });
    }
  }

  function handleManagementOutsideClick(event) {
    const target = event.target;
    if (
      target.closest("[data-saved-location-menu]")
      || target.closest('[data-saved-location-action="toggle-menu"]')
    ) return;
    closeManagementMenus();
  }

  function initManagement() {
    if (!managementRoot || !window.api) return;
    managementRoot.addEventListener("click", handleManagementAction);
    managementRoot.addEventListener("keydown", handleManagementKeydown);
    document.addEventListener("click", handleManagementOutsideClick);
    managementRoot.addEventListener("click", (event) => {
      const button = event.target.closest('[data-saved-location-action="add"]');
      if (!button) return;
      openSearch({
        onSaved: async () => {
          const refreshed = await loadManagementLocations();
          managementStatus.textContent = refreshed
            ? "Saved location added."
            : "Location saved, but the list could not be refreshed.";
        },
      });
    });
  }

  function init() {
    initSearch();
    initManagement();
  }

  app.savedLocations = {
    activateManagement: loadManagementLocations,
    openSearch,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
