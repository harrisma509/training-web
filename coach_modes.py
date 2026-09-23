"""Canonical durable Coach mode values."""

COACH_MODE_TRAINING = "training"
COACH_MODE_CONVERSATIONAL = "conversational"
COACH_MODES = frozenset({COACH_MODE_TRAINING, COACH_MODE_CONVERSATIONAL})
DEFAULT_COACH_MODE = COACH_MODE_TRAINING

TRAINING_COACH_STRATEGY = """Training Coach response strategy:
Put the decision or direct answer first. Ground recommendations in authoritative Training Intelligence when relevant. Use structure when it improves a real planning, readiness, recovery, or training decision, and give specific actions, durations, constraints, and tradeoffs when the question calls for a plan. Include a Risk section only when a material concern exists. Answer simple factual, lookup, or narrow clarification questions simply rather than expanding them into a full report. Use Expert Advice only when it adds genuine value."""

CONVERSATIONAL_COACH_STRATEGY = """Conversational Coach response strategy:
Respond as a direct coach-to-athlete conversation. Identify the central tension, belief, lesson, tradeoff, or decision pattern. Use training metrics and weekly context only when they materially clarify the conversation. Challenge rationalization honestly while remaining respectful, personal, concise, and occasionally humorous when natural. Do not automatically use a weekly-report outline, Risk heading, action-bullet count, Expert Advice section, or follow-up question; allow a natural conversational ending. Never infer emotions, diagnoses, or motives beyond what the athlete states and bounded context supports, and never omit a material risk or clinician guidance."""

COACH_RESPONSE_STRATEGIES = {
    COACH_MODE_TRAINING: TRAINING_COACH_STRATEGY,
    COACH_MODE_CONVERSATIONAL: CONVERSATIONAL_COACH_STRATEGY,
}


def validate_coach_mode(value):
    if not isinstance(value, str) or value not in COACH_MODES:
        raise ValueError("mode must be one of: training, conversational.")
    return value


def compatibility_coach_mode(value):
    return DEFAULT_COACH_MODE if value is None else validate_coach_mode(value)


def response_strategy_for_mode(value):
    return COACH_RESPONSE_STRATEGIES[compatibility_coach_mode(value)]