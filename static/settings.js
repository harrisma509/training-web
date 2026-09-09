/*
 * settings.js
 * Settings drawer and preferences controller.
 * Owns the settings UI, tab behavior, checkbox sync, and status refresh behavior. It reads/writes AppState and
 * keeps the drawer in sync with the rest of the app without embedding app-shell logic elsewhere.
 */
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
  const defaultSyncDaysInput = document.getElementById("defaultSyncDaysInput");
  const saveDefaultSyncDaysBtn = document.getElementById("saveDefaultSyncDaysBtn");
  const defaultSyncDaysStatus = document.getElementById("defaultSyncDaysStatus");
  const appearanceInputs = Array.from(document.querySelectorAll('input[name="appearance"]'));
  const settingsHideShoes = document.getElementById("settingsHideShoes");
  const settingsHideRetired = document.getElementById("settingsHideRetired");
  const settingsTabButtons = Array.from(document.querySelectorAll(".settings-tab"));
  const settingsTabPanels = {
    general: document.getElementById("settingsGeneralTab"),
    yearly: document.getElementById("settingsYearlyTab"),
    "ai-coach": document.getElementById("settingsAiCoachTab"),
  };
  const aiCoachMonthlyLimit = document.getElementById("aiCoachMonthlyLimit");
  const aiCoachTurnLimit = document.getElementById("aiCoachTurnLimit");
  const aiCoachOutputTokens = document.getElementById("aiCoachOutputTokens");
  const aiCoachReasoning = document.getElementById("aiCoachReasoning");
  const aiCoachSettingsUpdated = document.getElementById("aiCoachSettingsUpdated");
  const aiCoachSettingsStatus = document.getElementById("aiCoachSettingsStatus");
  const aiCoachSettingsError = document.getElementById("aiCoachSettingsError");
  const aiCoachSettingsRetry = document.getElementById("aiCoachSettingsRetry");
  const aiCoachSettingsCancel = document.getElementById("aiCoachSettingsCancel");
  const aiCoachSettingsSave = document.getElementById("aiCoachSettingsSave");
  const aiCoachFields = [aiCoachMonthlyLimit, aiCoachTurnLimit, aiCoachOutputTokens, aiCoachReasoning].filter(Boolean);
  const customInstructionFields = window.AICoachCustomInstructionsValidation.CUSTOM_INSTRUCTION_FIELDS;
  const customInstructionElements = {
    coaching_priorities: document.getElementById("aiCoachCustomCoachingPriorities"),
    safety_progression_rules: document.getElementById("aiCoachCustomSafetyRules"),
    training_approach: document.getElementById("aiCoachCustomTrainingApproach"),
    recovery_adjustment_rules: document.getElementById("aiCoachCustomRecoveryRules"),
    communication_style: document.getElementById("aiCoachCustomCommunicationStyle"),
    planning_preferences: document.getElementById("aiCoachCustomPlanningPreferences"),
    other_instructions: document.getElementById("aiCoachCustomOtherInstructions"),
  };
  const customInstructionCounts = {
    coaching_priorities: document.getElementById("aiCoachCustomCoachingPrioritiesCount"),
    safety_progression_rules: document.getElementById("aiCoachCustomSafetyRulesCount"),
    training_approach: document.getElementById("aiCoachCustomTrainingApproachCount"),
    recovery_adjustment_rules: document.getElementById("aiCoachCustomRecoveryRulesCount"),
    communication_style: document.getElementById("aiCoachCustomCommunicationStyleCount"),
    planning_preferences: document.getElementById("aiCoachCustomPlanningPreferencesCount"),
    other_instructions: document.getElementById("aiCoachCustomOtherInstructionsCount"),
  };
  const customInstructionErrors = {
    coaching_priorities: document.getElementById("aiCoachCustomCoachingPrioritiesError"),
    safety_progression_rules: document.getElementById("aiCoachCustomSafetyRulesError"),
    training_approach: document.getElementById("aiCoachCustomTrainingApproachError"),
    recovery_adjustment_rules: document.getElementById("aiCoachCustomRecoveryRulesError"),
    communication_style: document.getElementById("aiCoachCustomCommunicationStyleError"),
    planning_preferences: document.getElementById("aiCoachCustomPlanningPreferencesError"),
    other_instructions: document.getElementById("aiCoachCustomOtherInstructionsError"),
  };
  const customInstructionsUpdated = document.getElementById("aiCoachCustomInstructionsUpdated");
  const customInstructionsStatus = document.getElementById("aiCoachCustomInstructionsStatus");
  const customInstructionsError = document.getElementById("aiCoachCustomInstructionsError");
  const customInstructionsCombinedCount = document.getElementById("aiCoachCustomInstructionsCombinedCount");
  const customInstructionsCombinedError = document.getElementById("aiCoachCustomInstructionsCombinedError");
  const customInstructionsRetry = document.getElementById("aiCoachCustomInstructionsRetry");
  const customInstructionsCancel = document.getElementById("aiCoachCustomInstructionsCancel");
  const customInstructionsSave = document.getElementById("aiCoachCustomInstructionsSave");
  const aiCoachFieldErrors = {
    monthly_cost_limit_usd: document.getElementById("aiCoachMonthlyLimitError"),
    max_turn_cost_usd: document.getElementById("aiCoachTurnLimitError"),
    max_output_tokens: document.getElementById("aiCoachOutputTokensError"),
    reasoning_effort: document.getElementById("aiCoachReasoningError"),
  };
  const aiCoachFieldIds = {
    monthly_cost_limit_usd: aiCoachMonthlyLimit,
    max_turn_cost_usd: aiCoachTurnLimit,
    max_output_tokens: aiCoachOutputTokens,
    reasoning_effort: aiCoachReasoning,
  };
  let selectedSettingsTab = "general";
  let aiCoachBaseline = null;
  let aiCoachDraft = null;
  let aiCoachLoadPromise = null;
  let aiCoachLoading = false;
  let aiCoachSaving = false;
  let aiCoachValidation = { valid: false, errors: {} };
  let customInstructionsBaseline = null;
  let customInstructionsDraft = null;
  let customInstructionsLoadPromise = null;
  let customInstructionsLoading = false;
  let customInstructionsSaving = false;
  let customInstructionsValidation = { valid: false, errors: {}, normalized: {}, combinedCharacters: 0 };
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

  const validateAiCoachSettingsDraft = window.AICoachSettingsValidation.validateAiCoachSettingsDraft;

  function normalizeAiCoachSettings(settings) {
    const normalized = settings || {};
    const normalizeCurrency = (value) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "";
    };
    return {
      monthly_cost_limit_usd: normalizeCurrency(normalized.monthly_cost_limit_usd),
      max_turn_cost_usd: normalizeCurrency(normalized.max_turn_cost_usd),
      max_output_tokens: Number.isInteger(Number(normalized.max_output_tokens))
        ? String(normalized.max_output_tokens)
        : "",
      reasoning_effort: String(normalized.reasoning_effort || ""),
      updated_at: normalized.updated_at || "",
    };
  }

  function cloneAiCoachSettings(settings) {
    return settings ? { ...settings } : null;
  }

  const validateCustomInstructionsDraft = window.AICoachCustomInstructionsValidation.validateCustomInstructionsDraft;

  function emptyCustomInstructions() {
    return customInstructionFields.reduce((values, field) => {
      values[field] = "";
      return values;
    }, {});
  }

  function normalizeCustomInstructionsProfile(profile) {
    const normalized = {};
    customInstructionFields.forEach((field) => {
      normalized[field] = profile?.[field];
    });
    normalized.updated_at = profile?.updated_at;
    return normalized;
  }

  function cloneCustomInstructionsDraft(draft) {
    return draft ? { ...draft } : null;
  }

  function readCustomInstructionsDraft() {
    return customInstructionFields.reduce((draft, field) => {
      draft[field] = customInstructionElements[field]?.value || "";
      return draft;
    }, {});
  }

  function setCustomInstructionsStatus(message, isError = false) {
    if (!customInstructionsStatus) {
      return;
    }
    customInstructionsStatus.textContent = message || "";
    customInstructionsStatus.classList.toggle("error", Boolean(isError));
  }

  function formatCustomInstructionsUpdatedAt(value) {
    if (!value) {
      return "Last updated: unavailable";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Last updated: unavailable";
    }
    return `Last updated: ${parsed.toLocaleString()}`;
  }

  function customInstructionsAreDirty(draft) {
    if (!customInstructionsBaseline || !draft) {
      return false;
    }
    const normalizedDraft = validateCustomInstructionsDraft(draft).normalized;
    return customInstructionFields.some((field) => normalizedDraft[field] !== customInstructionsBaseline[field]);
  }

  function renderCustomInstructions() {
    const draft = customInstructionsDraft || emptyCustomInstructions();
    const validation = validateCustomInstructionsDraft(draft);
    customInstructionsValidation = validation;

    customInstructionFields.forEach((field) => {
      const element = customInstructionElements[field];
      const value = typeof draft[field] === "string" ? draft[field] : "";
      const normalizedValue = validation.normalized[field];
      const fieldError = validation.errors[field] || "";
      if (element && element.value !== value) {
        element.value = value;
      }
      if (customInstructionCounts[field]) {
        customInstructionCounts[field].textContent = `${typeof normalizedValue === "string" ? normalizedValue.length : 0} / 1,500`;
      }
      if (customInstructionErrors[field]) {
        customInstructionErrors[field].textContent = fieldError;
      }
      if (element) {
        element.setAttribute("aria-invalid", fieldError ? "true" : "false");
        element.disabled = customInstructionsLoading || customInstructionsSaving;
      }
    });

    if (customInstructionsUpdated) {
      customInstructionsUpdated.textContent = formatCustomInstructionsUpdatedAt(customInstructionsBaseline?.updated_at);
    }
    if (customInstructionsCombinedCount) {
      customInstructionsCombinedCount.textContent = `Combined: ${validation.combinedCharacters} / 8,000`;
    }
    if (customInstructionsCombinedError) {
      customInstructionsCombinedError.textContent = validation.combinedError || "";
    }

    const dirty = customInstructionsAreDirty(draft);
    if (customInstructionsSave) {
      customInstructionsSave.disabled = customInstructionsLoading
        || customInstructionsSaving
        || !customInstructionsBaseline
        || !dirty
        || !validation.valid;
    }
    if (customInstructionsCancel) {
      customInstructionsCancel.disabled = customInstructionsLoading
        || customInstructionsSaving
        || !customInstructionsBaseline
        || !dirty;
    }
    if (customInstructionsRetry) {
      customInstructionsRetry.disabled = customInstructionsLoading || customInstructionsSaving;
    }
  }

  async function loadCustomInstructions(force = false) {
    if (customInstructionsLoadPromise) {
      return customInstructionsLoadPromise;
    }
    if (!force && customInstructionsBaseline) {
      return customInstructionsBaseline;
    }
    customInstructionsLoading = true;
    if (customInstructionsError) {
      customInstructionsError.textContent = "";
    }
    setCustomInstructionsStatus("Loading...");
    renderCustomInstructions();
    customInstructionsLoadPromise = (async () => {
      try {
        if (!window.api || typeof window.api.fetchAiCoachCustomInstructions !== "function") {
          throw new Error("AI Coach Custom Instructions are unavailable.");
        }
        const loaded = normalizeCustomInstructionsProfile(await window.api.fetchAiCoachCustomInstructions());
        const validation = validateCustomInstructionsDraft(loaded);
        if (!validation.valid || !(loaded.updated_at instanceof String || typeof loaded.updated_at === "string")) {
          throw new Error("AI Coach Custom Instructions response is invalid.");
        }
        customInstructionsBaseline = { ...validation.normalized, updated_at: loaded.updated_at };
        customInstructionsDraft = cloneCustomInstructionsDraft(validation.normalized);
        setCustomInstructionsStatus("Loaded");
        renderCustomInstructions();
        return customInstructionsBaseline;
      } catch (error) {
        console.warn("Unable to load AI Coach Custom Instructions.", error);
        if (customInstructionsError) {
          customInstructionsError.textContent = "Unable to load AI Coach Custom Instructions.";
        }
        setCustomInstructionsStatus("Custom Instructions are unavailable.", true);
        renderCustomInstructions();
        throw error;
      } finally {
        customInstructionsLoading = false;
        customInstructionsLoadPromise = null;
        renderCustomInstructions();
      }
    })();
    return customInstructionsLoadPromise;
  }

  async function saveCustomInstructions() {
    if (customInstructionsLoading || customInstructionsSaving || !customInstructionsBaseline) {
      return;
    }
    customInstructionsDraft = readCustomInstructionsDraft();
    const validation = validateCustomInstructionsDraft(customInstructionsDraft);
    customInstructionsValidation = validation;
    renderCustomInstructions();
    if (!validation.valid) {
      const firstInvalid = customInstructionFields.find((field) => validation.errors[field]);
      customInstructionElements[firstInvalid]?.focus();
      return;
    }

    customInstructionsDraft = validation.normalized;
    customInstructionsSaving = true;
    if (customInstructionsError) {
      customInstructionsError.textContent = "";
    }
    setCustomInstructionsStatus("Saving...");
    renderCustomInstructions();
    try {
      if (!window.api || typeof window.api.saveAiCoachCustomInstructions !== "function") {
        throw new Error("AI Coach Custom Instructions are unavailable.");
      }
      const saved = normalizeCustomInstructionsProfile(
        await window.api.saveAiCoachCustomInstructions({ ...validation.normalized }),
      );
      const savedValidation = validateCustomInstructionsDraft(saved);
      if (!savedValidation.valid || !(saved.updated_at instanceof String || typeof saved.updated_at === "string")) {
        throw new Error("AI Coach Custom Instructions response is invalid.");
      }
      customInstructionsBaseline = { ...savedValidation.normalized, updated_at: saved.updated_at };
      customInstructionsDraft = cloneCustomInstructionsDraft(savedValidation.normalized);
      setCustomInstructionsStatus("Saved");
    } catch (error) {
      console.warn("Unable to save AI Coach Custom Instructions.", error);
      if (customInstructionsError) {
        customInstructionsError.textContent = "Unable to save Custom Instructions. Your draft was kept.";
      }
      setCustomInstructionsStatus("Save failed.", true);
    } finally {
      customInstructionsSaving = false;
      renderCustomInstructions();
    }
  }

  function cancelCustomInstructions() {
    if (!customInstructionsBaseline || customInstructionsLoading || customInstructionsSaving) {
      return;
    }
    customInstructionsDraft = cloneCustomInstructionsDraft(customInstructionsBaseline);
    if (customInstructionsError) {
      customInstructionsError.textContent = "";
    }
    setCustomInstructionsStatus("Changes canceled");
    renderCustomInstructions();
  }

  function readAiCoachDraft() {
    return {
      monthly_cost_limit_usd: aiCoachMonthlyLimit?.value || "",
      max_turn_cost_usd: aiCoachTurnLimit?.value || "",
      max_output_tokens: aiCoachOutputTokens?.value || "",
      reasoning_effort: aiCoachReasoning?.value || "",
    };
  }

  function aiCoachDraftPayload(draft) {
    return {
      monthly_cost_limit_usd: Number(draft.monthly_cost_limit_usd),
      max_turn_cost_usd: Number(draft.max_turn_cost_usd),
      max_output_tokens: Number(draft.max_output_tokens),
      reasoning_effort: draft.reasoning_effort,
    };
  }

  function setAiCoachStatus(message, isError = false) {
    if (!aiCoachSettingsStatus) {
      return;
    }
    aiCoachSettingsStatus.textContent = message || "";
    aiCoachSettingsStatus.classList.toggle("error", Boolean(isError));
  }

  function formatAiCoachUpdatedAt(value) {
    if (!value) {
      return "Last updated: unavailable";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Last updated: unavailable";
    }
    return `Last updated: ${parsed.toLocaleString()}`;
  }

  function renderAiCoachSettings() {
    const draft = aiCoachDraft || { monthly_cost_limit_usd: "", max_turn_cost_usd: "", max_output_tokens: "", reasoning_effort: "" };
    const validation = validateAiCoachSettingsDraft(draft);
    aiCoachValidation = validation;
    const values = {
      monthly_cost_limit_usd: aiCoachMonthlyLimit,
      max_turn_cost_usd: aiCoachTurnLimit,
      max_output_tokens: aiCoachOutputTokens,
      reasoning_effort: aiCoachReasoning,
    };

    Object.entries(values).forEach(([field, element]) => {
      if (element && element.value !== draft[field]) {
        element.value = draft[field];
      }
      const errorElement = aiCoachFieldErrors[field];
      const message = validation.errors[field] || "";
      if (errorElement) {
        errorElement.textContent = message;
      }
      if (element) {
        element.setAttribute("aria-invalid", message ? "true" : "false");
      }
    });

    if (aiCoachSettingsUpdated) {
      aiCoachSettingsUpdated.textContent = formatAiCoachUpdatedAt(aiCoachBaseline?.updated_at);
    }
    const dirty = Boolean(aiCoachBaseline && JSON.stringify(draft) !== JSON.stringify({
      monthly_cost_limit_usd: aiCoachBaseline.monthly_cost_limit_usd,
      max_turn_cost_usd: aiCoachBaseline.max_turn_cost_usd,
      max_output_tokens: aiCoachBaseline.max_output_tokens,
      reasoning_effort: aiCoachBaseline.reasoning_effort,
    }));
    if (aiCoachSettingsSave) {
      aiCoachSettingsSave.disabled = aiCoachLoading || aiCoachSaving || !aiCoachBaseline || !dirty || !validation.valid;
    }
    if (aiCoachSettingsCancel) {
      aiCoachSettingsCancel.disabled = aiCoachLoading || aiCoachSaving || !aiCoachBaseline || !dirty;
    }
    if (aiCoachSettingsRetry) {
      aiCoachSettingsRetry.disabled = aiCoachLoading || aiCoachSaving;
    }
    aiCoachFields.forEach((field) => {
      field.disabled = aiCoachLoading || aiCoachSaving;
    });
  }

  async function loadAiCoachSettings(force = false) {
    if (aiCoachLoadPromise) {
      return aiCoachLoadPromise;
    }
    if (!force && aiCoachBaseline) {
      return aiCoachBaseline;
    }
    aiCoachLoading = true;
    if (aiCoachSettingsError) {
      aiCoachSettingsError.textContent = "";
    }
    setAiCoachStatus("Loading...");
    renderAiCoachSettings();
    aiCoachLoadPromise = (async () => {
      try {
        if (!window.api || typeof window.api.fetchAiCoachSettings !== "function") {
          throw new Error("AI Coach settings are unavailable.");
        }
        const loaded = normalizeAiCoachSettings(await window.api.fetchAiCoachSettings());
        if (!validateAiCoachSettingsDraft(loaded).valid) {
          throw new Error("AI Coach settings response is invalid.");
        }
        aiCoachBaseline = loaded;
        aiCoachDraft = cloneAiCoachSettings(loaded);
        setAiCoachStatus("Loaded");
        renderAiCoachSettings();
        return loaded;
      } catch (error) {
        console.warn("Unable to load AI Coach settings.", error);
        if (aiCoachSettingsError) {
          aiCoachSettingsError.textContent = "Unable to load AI Coach settings.";
        }
        setAiCoachStatus("Settings are unavailable.", true);
        renderAiCoachSettings();
        throw error;
      } finally {
        aiCoachLoading = false;
        aiCoachLoadPromise = null;
        renderAiCoachSettings();
      }
    })();
    return aiCoachLoadPromise;
  }

  async function saveAiCoachSettings() {
    if (aiCoachLoading || aiCoachSaving || !aiCoachBaseline) {
      return;
    }
    aiCoachDraft = readAiCoachDraft();
    const validation = validateAiCoachSettingsDraft(aiCoachDraft);
    aiCoachValidation = validation;
    renderAiCoachSettings();
    if (!validation.valid) {
      const firstInvalid = Object.keys(validation.errors)[0];
      aiCoachFieldIds[firstInvalid]?.focus();
      return;
    }

    aiCoachSaving = true;
    if (aiCoachSettingsError) {
      aiCoachSettingsError.textContent = "";
    }
    setAiCoachStatus("Saving...");
    renderAiCoachSettings();
    try {
      if (!window.api || typeof window.api.saveAiCoachSettings !== "function") {
        throw new Error("AI Coach settings are unavailable.");
      }
      const saved = normalizeAiCoachSettings(await window.api.saveAiCoachSettings(aiCoachDraftPayload(aiCoachDraft)));
      aiCoachBaseline = saved;
      aiCoachDraft = cloneAiCoachSettings(saved);
      setAiCoachStatus("Saved");
    } catch (error) {
      console.warn("Unable to save AI Coach settings.", error);
      if (aiCoachSettingsError) {
        aiCoachSettingsError.textContent = "Unable to save AI Coach settings. Review the values and try again.";
      }
      setAiCoachStatus("Save failed.", true);
    } finally {
      aiCoachSaving = false;
      renderAiCoachSettings();
    }
  }

  function cancelAiCoachSettings() {
    if (!aiCoachBaseline || aiCoachLoading || aiCoachSaving) {
      return;
    }
    aiCoachDraft = cloneAiCoachSettings(aiCoachBaseline);
    if (aiCoachSettingsError) {
      aiCoachSettingsError.textContent = "";
    }
    setAiCoachStatus("Changes canceled");
    renderAiCoachSettings();
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

  function setDefaultSyncDaysStatus(message, isError = false) {
    if (!defaultSyncDaysStatus) {
      return;
    }

    defaultSyncDaysStatus.textContent = message;
    defaultSyncDaysStatus.classList.toggle("error", Boolean(isError));
  }

  async function loadDefaultSyncDaysPreference() {
    if (!defaultSyncDaysInput) {
      return;
    }

    try {
      const data = await window.api.fetchAppPreferences();
      const nextValue = Number(data?.default_sync_days_back ?? 7);
      if (Number.isInteger(nextValue) && nextValue >= 1 && nextValue <= 6000) {
        defaultSyncDaysInput.value = String(nextValue);
        return;
      }
      defaultSyncDaysInput.value = "7";
    } catch (error) {
      defaultSyncDaysInput.value = "7";
    }
  }

  async function saveDefaultSyncDaysPreference() {
    if (!defaultSyncDaysInput || !saveDefaultSyncDaysBtn) {
      return;
    }

    const rawValue = String(defaultSyncDaysInput.value).trim();
    const numericValue = Number(rawValue);

    if (!rawValue || !Number.isInteger(numericValue) || numericValue < 1 || numericValue > 6000) {
      setDefaultSyncDaysStatus("Please enter a whole number from 1 to 6000.", true);
      return;
    }

    saveDefaultSyncDaysBtn.disabled = true;
    setDefaultSyncDaysStatus("Saving...");

    try {
      const saved = await window.api.saveAppPreferences({ default_sync_days_back: numericValue });
      const savedValue = Number(saved?.default_sync_days_back ?? numericValue);
      if (Number.isInteger(savedValue) && savedValue >= 1 && savedValue <= 6000) {
        defaultSyncDaysInput.value = String(savedValue);
        setDefaultSyncDaysStatus("Saved");
      } else {
        setDefaultSyncDaysStatus("Unable to save default sync days.", true);
      }
    } catch (error) {
      console.error(error);
      setDefaultSyncDaysStatus("Unable to save default sync days.", true);
    } finally {
      saveDefaultSyncDaysBtn.disabled = false;
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
      const data = window.api && typeof window.api.fetchSystemStatus === "function"
        ? await window.api.fetchSystemStatus()
        : await fetch("/api/system-status").then(async response => {
          if (!response.ok) {
            throw new Error(`System status failed: ${response.status}`);
          }
          return response.json();
        });

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
    if (selectedSettingsTab === "ai-coach") {
      loadAiCoachSettings(true).catch(() => { });
      loadCustomInstructions(true).catch(() => { });
    }
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

    selectedSettingsTab = selectedTab;

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

    if (selectedTab === "ai-coach") {
      loadAiCoachSettings(true).catch(() => { });
      loadCustomInstructions(true).catch(() => { });
    }
  }

  function attachSettingsEventListeners() {
    settingsBtn?.addEventListener("click", openSettingsDrawer);
    settingsCloseBtn?.addEventListener("click", closeSettingsDrawer);
    settingsTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setSettingsTab(button.dataset.settingsTab);
      });
    });

    aiCoachFields.forEach((field) => {
      field.addEventListener("input", () => {
        aiCoachDraft = readAiCoachDraft();
        if (aiCoachSettingsError) {
          aiCoachSettingsError.textContent = "";
        }
        renderAiCoachSettings();
      });
      field.addEventListener("change", () => {
        aiCoachDraft = readAiCoachDraft();
        renderAiCoachSettings();
      });
    });
    aiCoachSettingsRetry?.addEventListener("click", () => {
      loadAiCoachSettings(true).catch(() => { });
    });
    aiCoachSettingsCancel?.addEventListener("click", cancelAiCoachSettings);
    aiCoachSettingsSave?.addEventListener("click", saveAiCoachSettings);

    customInstructionFields.forEach((field) => {
      customInstructionElements[field]?.addEventListener("input", () => {
        customInstructionsDraft = readCustomInstructionsDraft();
        if (customInstructionsError) {
          customInstructionsError.textContent = "";
        }
        renderCustomInstructions();
      });
    });
    customInstructionsRetry?.addEventListener("click", () => {
      loadCustomInstructions(true).catch(() => { });
    });
    customInstructionsCancel?.addEventListener("click", cancelCustomInstructions);
    customInstructionsSave?.addEventListener("click", saveCustomInstructions);

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
      const selectedTab = event.target.value === "overview" ? "plan" : event.target.value;
      if (!["plan", "goals", "kpis", "charts", "daily", "weekly", "zones", "gear", "components", "yearly"].includes(selectedTab)) {
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
    saveDefaultSyncDaysBtn?.addEventListener("click", saveDefaultSyncDaysPreference);
    defaultSyncDaysInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        saveDefaultSyncDaysPreference();
      }
    });

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
      loadDefaultSyncDaysPreference();
      attachSettingsEventListeners();
      setSettingsTab("general");
    },
  };

  window.SettingsController = SettingsController;
  window.loadSystemStatus = loadSystemStatus;
  window.copySystemDiagnostics = copySystemDiagnostics;
  window.loadDefaultSyncDaysPreference = loadDefaultSyncDaysPreference;
  window.saveDefaultSyncDaysPreference = saveDefaultSyncDaysPreference;
  window.restorePreferences = restorePreferences;
  window.syncLimitSelects = syncLimitSelects;
  window.updateLimitPreference = updateLimitPreference;
  window.applyAppearancePreference = applyAppearancePreference;
  window.syncFormCheckboxes = syncFormCheckboxes;
  window.syncDefaultBikeSelect = syncDefaultBikeSelect;
  window.updateStartupTabVisibility = updateStartupTabVisibility;
  window.validateAiCoachSettingsDraft = validateAiCoachSettingsDraft;
  window.loadAiCoachSettings = loadAiCoachSettings;
  window.saveAiCoachSettings = saveAiCoachSettings;
  window.cancelAiCoachSettings = cancelAiCoachSettings;

  SettingsController.initialize();
})();
