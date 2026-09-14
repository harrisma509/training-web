(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.AICoachSettingsValidation = factory();
    }
})(typeof window !== "undefined" ? window : globalThis, function () {
    const AI_COACH_REASONING_VALUES = ["none", "low", "medium", "high"];

    function validateAiCoachSettingsDraft(draft) {
        const errors = {};
        const validateCurrency = (field, label, min, max) => {
            const raw = String(draft?.[field] ?? "").trim();
            if (!raw) {
                errors[field] = `${label} is required.`;
                return;
            }
            if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
                errors[field] = `${label} must use cents-compatible numeric format.`;
                return;
            }
            const value = Number(raw);
            if (!Number.isFinite(value) || value < min || value > max) {
                errors[field] = `${label} must be between ${min.toFixed(2)} and ${max.toFixed(2)}.`;
            }
        };

        validateCurrency("monthly_cost_limit_usd", "Monthly cost limit", 0, 25);
        validateCurrency("max_turn_cost_usd", "Per-turn cost limit", 0.01, 1);

        const rawTokens = String(draft?.max_output_tokens ?? "").trim();
        if (!rawTokens) {
            errors.max_output_tokens = "Maximum output tokens is required.";
        } else if (!/^\d+$/.test(rawTokens) || !Number.isSafeInteger(Number(rawTokens))) {
            errors.max_output_tokens = "Maximum output tokens must be a whole number.";
        } else if (Number(rawTokens) < 250 || Number(rawTokens) > 32000) {
            errors.max_output_tokens = "Maximum output tokens must be between 250 and 32000.";
        }

        const rawDailyDays = String(draft?.detailed_daily_history_days ?? "").trim();
        if (!rawDailyDays) {
            errors.detailed_daily_history_days = "Detailed daily history is required.";
        } else if (!/^\d+$/.test(rawDailyDays) || !Number.isSafeInteger(Number(rawDailyDays))) {
            errors.detailed_daily_history_days = "Detailed daily history must be a whole number.";
        } else if (Number(rawDailyDays) < 7 || Number(rawDailyDays) > 365) {
            errors.detailed_daily_history_days = "Detailed daily history must be between 7 and 365.";
        }

        const rawWeeklyRows = String(draft?.weekly_history_rows ?? "").trim();
        if (!rawWeeklyRows) {
            errors.weekly_history_rows = "Weekly history is required.";
        } else if (!/^\d+$/.test(rawWeeklyRows) || !Number.isSafeInteger(Number(rawWeeklyRows))) {
            errors.weekly_history_rows = "Weekly history must be a whole number.";
        } else if (Number(rawWeeklyRows) < 4 || Number(rawWeeklyRows) > 104) {
            errors.weekly_history_rows = "Weekly history must be between 4 and 104.";
        }

        if (!AI_COACH_REASONING_VALUES.includes(draft?.reasoning_effort)) {
            errors.reasoning_effort = "Choose a supported reasoning effort.";
        }

        return { valid: Object.keys(errors).length === 0, errors };
    }

    function hydrateAiCoachSettingsFields(draft, fields) {
        Object.entries(fields).forEach(([field, element]) => {
            if (element && element.value !== draft[field]) {
                element.value = draft[field];
            }
        });
    }

    function detailedDailyHistoryWarning(draft) {
        return Number(draft?.detailed_daily_history_days) > 90
            ? "Extended history may substantially increase context size and cost."
            : "";
    }

    function weeklyHistoryWarning(draft) {
        return Number(draft?.weekly_history_rows) > 52
            ? "Extended weekly history may increase context size and cost."
            : "";
    }

    return {
        AI_COACH_REASONING_VALUES,
        detailedDailyHistoryWarning,
        hydrateAiCoachSettingsFields,
        validateAiCoachSettingsDraft,
        weeklyHistoryWarning,
    };
});
