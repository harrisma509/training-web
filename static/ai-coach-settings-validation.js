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
        } else if (Number(rawTokens) < 250 || Number(rawTokens) > 8000) {
            errors.max_output_tokens = "Maximum output tokens must be between 250 and 8000.";
        }

        if (!AI_COACH_REASONING_VALUES.includes(draft?.reasoning_effort)) {
            errors.reasoning_effort = "Choose a supported reasoning effort.";
        }

        return { valid: Object.keys(errors).length === 0, errors };
    }

    return { AI_COACH_REASONING_VALUES, validateAiCoachSettingsDraft };
});
