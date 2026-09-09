(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.AICoachCustomInstructionsValidation = factory();
    }
})(typeof window !== "undefined" ? window : globalThis, function () {
    const CUSTOM_INSTRUCTION_FIELDS = [
        "coaching_priorities",
        "safety_progression_rules",
        "training_approach",
        "recovery_adjustment_rules",
        "communication_style",
        "planning_preferences",
        "other_instructions",
    ];
    const MAX_SECTION_CHARACTERS = 1500;
    const MAX_COMBINED_CHARACTERS = 8000;

    function normalizeCustomInstruction(value) {
        return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    }

    function normalizeCustomInstructionsDraft(draft) {
        const normalized = {};
        CUSTOM_INSTRUCTION_FIELDS.forEach((field) => {
            const value = draft?.[field];
            normalized[field] = typeof value === "string" ? normalizeCustomInstruction(value) : value;
        });
        return normalized;
    }

    function validateCustomInstructionsDraft(draft) {
        const normalized = normalizeCustomInstructionsDraft(draft || {});
        const errors = {};
        let combinedCharacters = 0;

        CUSTOM_INSTRUCTION_FIELDS.forEach((field) => {
            const value = normalized[field];
            if (typeof value !== "string") {
                errors[field] = "This section must be text.";
                return;
            }
            const length = value.length;
            combinedCharacters += length;
            if (length > MAX_SECTION_CHARACTERS) {
                errors[field] = "This section must be 1,500 characters or fewer.";
            }
        });

        const combinedError = combinedCharacters > MAX_COMBINED_CHARACTERS
            ? "Combined Custom Instructions must be 8,000 characters or fewer."
            : "";

        return {
            valid: Object.keys(errors).length === 0 && !combinedError,
            errors,
            combinedError,
            normalized,
            combinedCharacters,
        };
    }

    return {
        CUSTOM_INSTRUCTION_FIELDS,
        MAX_SECTION_CHARACTERS,
        MAX_COMBINED_CHARACTERS,
        normalizeCustomInstruction,
        normalizeCustomInstructionsDraft,
        validateCustomInstructionsDraft,
    };
});
