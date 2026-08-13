(function () {
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsDrawer = document.getElementById("settingsDrawer");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const rememberLastTab = document.getElementById("rememberLastTab");
  const startupTab = document.getElementById("startupTab");
  const startupTabRow = document.getElementById("startupTabRow");
  const settingsDefaultBike = document.getElementById("settingsDefaultBike");
  const settingsDailyLimit = document.getElementById("settingsDailyLimit");
  const settingsWeeklyLimit = document.getElementById("settingsWeeklyLimit");
  const settingsZonesLimit = document.getElementById("settingsZonesLimit");
  const appearanceInputs = Array.from(document.querySelectorAll('input[name="appearance"]'));
  const settingsHideShoes = document.getElementById("settingsHideShoes");
  const settingsHideRetired = document.getElementById("settingsHideRetired");
  const settingsTabButtons = Array.from(document.querySelectorAll(".settings-tab"));
  const settingsTabPanels = {
    general: document.getElementById("settingsGeneralTab"),
    yearly: document.getElementById("settingsYearlyTab"),
  };
  const settingsStatusSummary = document.getElementById("settingsStatusSummary");
  const refreshStatusBtn = document.getElementById("refreshStatusBtn");
  const copyDiagnosticsBtn = document.getElementById("copyDiagnosticsBtn");
  const hideShoesCheckbox = document.getElementById("hideShoesCheckbox");
  const hideRetiredCheckbox = document.getElementById("hideRetiredCheckbox");
  const systemThemeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function syncFormCheckboxes() {
    if (hideShoesCheckbox) {
      hideShoesCheckbox.checked = Boolean(window.AppState.hideShoes);
    }
    if (hideRetiredCheckbox) {
      hideRetiredCheckbox.checked = Boolean(window.AppState.hideRetired);
    }
    if (settingsHideShoes) {
      settingsHideShoes.checked = Boolean(window.AppState.hideShoes);
    }
    if (settingsHideRetired) {
      settingsHideRetired.checked = Boolean(window.AppState.hideRetired);
    }
    if (rememberLastTab) {
      rememberLastTab.checked = window.AppState.rememberLastTab !== false;
    }
  }

  function syncDefaultBikeSelect() {
    if (!settingsDefaultBike) {
      return;
    }

    const bikes = Array.isArray(window.AppState.componentsData?.available_bikes) ? window.AppState.componentsData.available_bikes : [];
    const value = String(window.AppState.defaultBikeGearId || "").trim();

    if (bikes.length === 0) {
      settingsDefaultBike.innerHTML = '<option value="">No bikes</option>';
      settingsDefaultBike.value = "";
      settingsDefaultBike.disabled = true;
      return;
    }

    const options = bikes.map((bike) => {
      const bikeId = String(bike?.gear_id ?? "").trim();
      const label = String(bike?.display_name || bike?.gear_name || bikeId || "Bike").trim();
      return `<option value="${bikeId}">${label}</option>`;
    }).join("");

    settingsDefaultBike.innerHTML = `<option value="">Use last selected bike</option>${options}`;
    settingsDefaultBike.disabled = false;

    if (value && bikes.some((bike) => String(bike?.gear_id ?? "").trim() === value)) {
      settingsDefaultBike.value = value;
    } else {
      settingsDefaultBike.value = "";
    }
  }

  function syncLimitSelects() {
    const selects = {
      dailyLimit: window.AppState.dailyLimit,
      weeklyLimit: window.AppState.weeklyLimit,
      zonesLimit: window.AppState.zonesLimit,
    };

    Object.entries(selects).forEach(([elementId, value]) => {
      const select = document.getElementById(elementId);
      if (!select) {
        return;
      }
      select.value = String(value);
    });

    if (settingsDefaultBike) {
      syncDefaultBikeSelect();
    }
    if (settingsDailyLimit) {
      settingsDailyLimit.value = String(window.AppState.dailyLimit);
    }
    if (settingsWeeklyLimit) {
      settingsWeeklyLimit.value = String(window.AppState.weeklyLimit);
    }
    if (settingsZonesLimit) {
      settingsZonesLimit.value = String(window.AppState.zonesLimit);
    }
    if (startupTab) {
      startupTab.value = window.AppState.startupTab || "daily";
    }
    if (rememberLastTab) {
      rememberLastTab.checked = window.AppState.rememberLastTab !== false;
    }
    if (startupTabRow) {
      startupTabRow.classList.toggle("hidden", window.AppState.rememberLastTab !== false);
    }
  }

  function updateStartupTabVisibility() {
    if (!rememberLastTab || !startupTabRow) {
      return;
    }

    const shouldHide = window.AppState.rememberLastTab !== false;
    startupTabRow.classList.toggle("hidden", shouldHide);
    rememberLastTab.checked = window.AppState.rememberLastTab !== false;
  }

  function handleSystemAppearanceChange() {
    if (window.AppState.appearance === "system") {
      applyAppearancePreference();
    }
  }

  function renderSystemStatusSummary(data) {
    const requestDurationSeconds = data.duration_seconds ?? data.latest_request_duration_seconds ?? null;
    const rows = [
      { label: "Status", value: data.health || "unknown" },
      { label: "Sync status", value: data.status || "unknown" },
      { label: "Latest request duration", value: requestDurationSeconds == null ? "n/a" : formatRequestDuration(requestDurationSeconds) },
      { label: "Last sync", value: formatDisplayTimestamp(data.latest_sync_run_at_utc) },
      { label: "Last good sync", value: formatDisplayTimestamp(data.last_good_sync_run_at_utc) },
      { label: "Hours since good sync", value: data.hours_since_good_sync == null ? "n/a" : `${data.hours_since_good_sync} h` },
      { label: "Warnings", value: data.warning_count ?? 0 },
      { label: "Daily rows", value: data.daily_rows ?? "n/a" },
      { label: "Weekly rows", value: data.weekly_rows ?? "n/a" },
      { label: "Request status", value: data.latest_request_status || "n/a" },
      { label: "Request time", value: formatDisplayTimestamp(data.latest_request_requested_at_utc) },
    ];

    const html = rows.map((row) => `
      <div class="settings-status-row">
        <span class="settings-status-label">${escapeHtml(String(row.label))}</span>
        <span class="settings-status-value">${escapeHtml(String(row.value))}</span>
      </div>
    `).join("");

    if (settingsStatusSummary) {
      settingsStatusSummary.innerHTML = `<div class="settings-status-list">${html}</div>`;
    }
  }

  async function loadSystemStatus() {
    if (!settingsStatusSummary) {
      return;
    }

    settingsStatusSummary.textContent = "Loading...";

    try {
      const response = await fetch("/api/system-status");
      if (!response.ok) {
        throw new Error(`System status failed: ${response.status}`);
      }

      const data = await response.json();
      renderSystemStatusSummary(data);
    } catch (error) {
      console.error(error);
      settingsStatusSummary.textContent = "Unable to load system status.";
    }
  }

  async function copySystemDiagnostics() {
    if (!settingsStatusSummary || !copyDiagnosticsBtn) {
      return;
    }

    const originalLabel = copyDiagnosticsBtn.textContent.trim();
    const normalizeText = (value) => String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    const text = normalizeText(settingsStatusSummary.innerText || settingsStatusSummary.textContent || "");
    if (!text) {
      copyDiagnosticsBtn.textContent = "Unable to copy diagnostics";
      window.clearTimeout(copyDiagnosticsBtn.feedbackTimer);
      copyDiagnosticsBtn.feedbackTimer = window.setTimeout(() => {
        copyDiagnosticsBtn.textContent = originalLabel;
      }, 1800);
      return;
    }

    const showFeedback = (label) => {
      copyDiagnosticsBtn.textContent = label;
      window.clearTimeout(copyDiagnosticsBtn.feedbackTimer);
      copyDiagnosticsBtn.feedbackTimer = window.setTimeout(() => {
        copyDiagnosticsBtn.textContent = originalLabel;
      }, 1800);
    };

    try {
      const canUseClipboard = typeof navigator !== "undefined"
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === "function"
        && window.isSecureContext;

      if (canUseClipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const tempElement = document.createElement("textarea");
        tempElement.value = text;
        tempElement.setAttribute("readonly", "");
        tempElement.style.position = "fixed";
        tempElement.style.top = "-9999px";
        tempElement.style.left = "-9999px";
        tempElement.style.opacity = "0";
        document.body.appendChild(tempElement);
        tempElement.focus();
        tempElement.select();

        let copied = false;
        try {
          copied = document.execCommand("copy");
        } catch (error) {
          copied = false;
        }

        document.body.removeChild(tempElement);

        if (!copied) {
          throw new Error("Clipboard fallback copy failed.");
        }
      }

      showFeedback("Diagnostics copied");
    } catch (error) {
      console.warn("Clipboard unavailable.", error);
      showFeedback("Unable to copy diagnostics");
    }
  }

  function updatePreferenceState(newState) {
    Object.assign(window.AppState, newState);
    persistPreferences();
    applyAppearancePreference();
    syncLimitSelects();
    syncFormCheckboxes();
    if (typeof window.renderGearTable === "function") {
      window.renderGearTable();
    }
  }

  function updateLimitPreference(key, value, reloadFn) {
    const allowedValues = window.APP_ROW_LIMITS?.[key.replace(/Limit$/, "")];
    if (!allowedValues || !Number.isInteger(value) || !allowedValues.includes(value)) {
      return;
    }

    window.AppState[key] = value;
    syncLimitSelects();
    persistPreferences();

    if (typeof reloadFn === "function") {
      reloadFn();
    }
  }

  function restorePreferences() {
    const saved = loadSavedPreferences();
    Object.assign(window.AppState, saved);

    if (window.AppState.rememberLastTab === false) {
      window.AppState.activeTab = window.AppState.startupTab || "daily";
    }

    applyAppearancePreference();
    syncLimitSelects();
    syncFormCheckboxes();
    if (appearanceInputs.length > 0) {
      appearanceInputs.forEach((input) => {
        input.checked = input.value === window.AppState.appearance;
      });
    }
  }

  function openSettingsDrawer() {
    settingsDrawer?.classList.remove("hidden");
    settingsDrawer?.setAttribute("aria-hidden", "false");
    loadSystemStatus();
  }

  function closeSettingsDrawer() {
    settingsDrawer?.classList.add("hidden");
    settingsDrawer?.setAttribute("aria-hidden", "true");
  }

  function setSettingsTab(selectedTab) {
    const validTabs = Object.keys(settingsTabPanels);
    if (!selectedTab || !validTabs.includes(selectedTab)) {
      return;
    }

    settingsTabButtons.forEach((tabButton) => {
      const isActive = tabButton.dataset.settingsTab === selectedTab;
      tabButton.classList.toggle("active", isActive);
      tabButton.setAttribute("aria-selected", String(isActive));
      tabButton.tabIndex = isActive ? 0 : -1;
    });

    Object.entries(settingsTabPanels).forEach(([tabName, panel]) => {
      if (!panel) {
        return;
      }
      const isVisible = tabName === selectedTab;
      panel.classList.toggle("hidden", !isVisible);
      panel.setAttribute("aria-hidden", String(!isVisible));
    });
  }

  function attachSettingsEventListeners() {
    settingsBtn?.addEventListener("click", openSettingsDrawer);
    settingsCloseBtn?.addEventListener("click", closeSettingsDrawer);
    settingsTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setSettingsTab(button.dataset.settingsTab);
      });
    });

    settingsDrawer?.addEventListener("click", (event) => {
      if (event.target === settingsDrawer) {
        closeSettingsDrawer();
      }
    });

    appearanceInputs.forEach((input) => {
      input.addEventListener("change", (event) => {
        const selectedAppearance = event.target.value;
        window.AppState.appearance = selectedAppearance;
        persistPreferences();
        applyAppearancePreference();
      });
    });

    rememberLastTab?.addEventListener("change", (event) => {
      const checked = Boolean(event.target.checked);
      window.AppState.rememberLastTab = checked;
      if (!checked) {
        window.AppState.startupTab = window.AppState.startupTab || "daily";
        window.AppState.activeTab = window.AppState.startupTab;
        if (typeof window.showTab === "function") {
          window.showTab(window.AppState.activeTab);
        }
      }
      persistPreferences();
      updateStartupTabVisibility();
    });

    startupTab?.addEventListener("change", (event) => {
      const selectedTab = event.target.value;
      if (!["daily", "weekly", "zones", "gear", "components", "yearly"].includes(selectedTab)) {
        return;
      }

      window.AppState.startupTab = selectedTab;
      if (window.AppState.rememberLastTab === false) {
        window.AppState.activeTab = selectedTab;
        if (typeof window.showTab === "function") {
          window.showTab(selectedTab);
        }
      }
      persistPreferences();
    });

    settingsHideShoes?.addEventListener("change", (event) => {
      const checked = event.target.checked;
      window.AppState.hideShoes = checked;
      if (hideShoesCheckbox) {
        hideShoesCheckbox.checked = checked;
      }
      persistPreferences();
      if (typeof window.renderGearTable === "function") {
        window.renderGearTable();
      }
    });

    settingsHideRetired?.addEventListener("change", (event) => {
      const checked = event.target.checked;
      window.AppState.hideRetired = checked;
      if (hideRetiredCheckbox) {
        hideRetiredCheckbox.checked = checked;
      }
      persistPreferences();
      if (typeof window.renderGearTable === "function") {
        window.renderGearTable();
      }
    });

    if (settingsDailyLimit) {
      settingsDailyLimit.addEventListener("change", (event) => {
        const value = Number(event.target.value);
        updateLimitPreference("dailyLimit", value, () => {
          if (window.AppState.activeTab === "daily" && typeof window.loadDaily === "function") {
            window.loadDaily();
          }
        });
      });
    }

    if (settingsWeeklyLimit) {
      settingsWeeklyLimit.addEventListener("change", (event) => {
        const value = Number(event.target.value);
        updateLimitPreference("weeklyLimit", value, () => {
          if (window.AppState.activeTab === "weekly" && typeof window.loadWeekly === "function") {
            window.loadWeekly();
          }
        });
      });
    }

    if (settingsZonesLimit) {
      settingsZonesLimit.addEventListener("change", (event) => {
        const value = Number(event.target.value);
        updateLimitPreference("zonesLimit", value, () => {
          if (window.AppState.activeTab === "zones" && typeof window.loadZones === "function") {
            window.loadZones();
          }
        });
      });
    }

    refreshStatusBtn?.addEventListener("click", loadSystemStatus);
    copyDiagnosticsBtn?.addEventListener("click", copySystemDiagnostics);

    if (systemThemeMedia && typeof systemThemeMedia.addEventListener === "function") {
      systemThemeMedia.addEventListener("change", handleSystemAppearanceChange);
    } else if (systemThemeMedia && typeof systemThemeMedia.addListener === "function") {
      systemThemeMedia.addListener(handleSystemAppearanceChange);
    }
  }

  const SettingsController = {
    initialize() {
      restorePreferences();
      syncFormCheckboxes();
      if (hideShoesCheckbox) {
        hideShoesCheckbox.checked = window.AppState.hideShoes;
      }
      if (hideRetiredCheckbox) {
        hideRetiredCheckbox.checked = window.AppState.hideRetired;
      }
      if (settingsHideShoes) {
        settingsHideShoes.checked = window.AppState.hideShoes;
      }
      if (settingsHideRetired) {
        settingsHideRetired.checked = window.AppState.hideRetired;
      }
        attachSettingsEventListeners();
      setSettingsTab("general");
    },
  };

  window.SettingsController = SettingsController;
  window.loadSystemStatus = loadSystemStatus;
  window.copySystemDiagnostics = copySystemDiagnostics;
  window.restorePreferences = restorePreferences;
  window.syncLimitSelects = syncLimitSelects;
  window.updateLimitPreference = updateLimitPreference;
  window.applyAppearancePreference = applyAppearancePreference;
  window.syncFormCheckboxes = syncFormCheckboxes;
  window.syncDefaultBikeSelect = syncDefaultBikeSelect;
  window.updateStartupTabVisibility = updateStartupTabVisibility;

  SettingsController.initialize();
})();
