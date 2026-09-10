"""Pure Durable Memories validation, routing, selection, and compilation."""

import re
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

MEMORY_TYPES = (
    "medical", "safety", "training_goal", "schedule", "event", "equipment",
    "preference", "lesson_learned",
)
SCOPES = (
    "all_training", "planning", "recovery", "strength", "weight", "mtb",
    "emtb", "bike_park", "gravel", "skiing",
)
PRIORITIES = ("critical", "high", "normal")
EDITABLE_FIELDS = (
    "memory_type", "title", "memory_text", "applies_to", "priority",
    "effective_date", "expires_at", "is_active",
)
READ_ONLY_FIELDS = {"memory_id", "created_at", "updated_at"}
MAX_TITLE_CHARACTERS = 120
MAX_MEMORY_CHARACTERS = 1000
MAX_SELECTED_MEMORIES = 12
MAX_COMPILED_CHARACTERS = 6000
RECENT_ENTITY_DAYS = 14
DENVER = ZoneInfo("America/Denver")
SELECTION_REASON_ORDER = (
    "critical_memory",
    "high_all_training_medical",
    "high_all_training_safety",
    "current_question_match",
    "authoritative_context_match",
    "recent_conversation_match",
    "older_bounded_history_match",
    "all_training_match",
)

SCOPE_PHRASES = {
    "planning": ("tomorrow", "this week", "next week", "plan", "schedule", "what should i do", "how am i doing", "progress", "workout", "train"),
    "recovery": ("recover", "recovery", "fatigue", "tired", "sleep", "hrv", "resting heart rate", "sore", "soreness", "illness", "injury", "pain", "stitches", "wound", "surgery"),
    "strength": ("strength", "lifting", "weights", "arms", "legs", "core", "squat", "hinge", "press", "row", "prehab"),
    "bike_park": ("bike park", "trestle", "keystone", "whistler", "lift served", "downhill", "jump", "drop", "pro line", "rallon"),
    "emtb": ("e-mtb", "emtb", "wild", "battery", "range extender", "motor", "bosch"),
    "gravel": ("gravel", "denna", "road ride", "pavement"),
    "mtb": ("mountain bike", "mtb", "technical trail", "singletrack", "descent", "trail climbing"),
    "weight": ("weight", "weigh-in", "calories", "food", "fat", "protein", "diet", "eating"),
    "skiing": ("ski", "skiing", "powder", "bumps", "moguls"),
}
AUTHORITATIVE_SCOPE_SIGNALS = {
    "is_injury_week": ("recovery",),
    "is_bike_park_week": ("bike_park", "mtb"),
}
MEMORY_WRAPPER = (
    "These Durable Memories are selected background facts about the athlete. "
    "Use them only when relevant. Current authoritative Training Intelligence, "
    "current clinician guidance, direct statements in the current conversation, "
    "and newer dated facts take precedence. Do not treat expired or inactive "
    "memories as current and do not use memories to recalculate persisted metrics."
)


class MemoryValidationError(ValueError):
    pass


class MalformedMemoryError(ValueError):
    pass


class CriticalMemoryOverflowError(ValueError):
    pass


@dataclass(frozen=True)
class RouteEvidence:
    current: frozenset
    recent: frozenset
    older: frozenset
    authoritative: frozenset
    active: frozenset
    recent_scores: dict
    older_scores: dict
    supporting_entity_scopes: frozenset = frozenset()
    question_text: str = ""
    recent_texts: tuple = ()
    older_texts: tuple = ()


def _normalize_text(value, field_name, maximum):
    if not isinstance(value, str):
        raise MemoryValidationError(f"{field_name} must be a string.")
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not value:
        raise MemoryValidationError(f"{field_name} cannot be blank.")
    if len(value) > maximum:
        raise MemoryValidationError(f"{field_name} exceeds the {maximum:,} character limit.")
    return value


def _canonical(value, field_name, allowed):
    if not isinstance(value, str):
        raise MemoryValidationError(f"{field_name} must be a string.")
    value = value.strip()
    if value not in allowed:
        raise MemoryValidationError(f"Unsupported {field_name}.")
    return value


def _strict_date(value, field_name):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise MemoryValidationError(f"{field_name} must be an ISO date.")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise MemoryValidationError(f"{field_name} must be an ISO date.") from None


def _strict_datetime(value, field_name):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise MemoryValidationError(f"{field_name} must include a timezone offset.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise MemoryValidationError(f"{field_name} must include a timezone offset.") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise MemoryValidationError(f"{field_name} must include a timezone offset.")
    return parsed


def validate_memory_payload(payload):
    if not isinstance(payload, dict):
        raise MemoryValidationError("Request body must be an object.")
    expected = set(EDITABLE_FIELDS)
    missing = expected - payload.keys()
    unknown = payload.keys() - expected
    if missing:
        raise MemoryValidationError("All Durable Memory fields are required.")
    if unknown:
        raise MemoryValidationError("Unsupported Durable Memory field.")
    applies_to = payload["applies_to"]
    if not isinstance(applies_to, list) or not applies_to:
        raise MemoryValidationError("applies_to must contain at least one scope.")
    normalized_scopes = []
    for scope in applies_to:
        normalized = _canonical(scope, "applicability scope", SCOPES)
        if normalized in normalized_scopes:
            raise MemoryValidationError("Applicability scopes must not contain duplicates.")
        normalized_scopes.append(normalized)
    effective_date = _strict_date(payload["effective_date"], "effective_date")
    expires_at = _strict_datetime(payload["expires_at"], "expires_at")
    if effective_date and expires_at and effective_date > expires_at.astimezone(DENVER).date():
        raise MemoryValidationError("effective_date cannot be after expires_at.")
    if not isinstance(payload["is_active"], bool):
        raise MemoryValidationError("is_active must be a boolean.")
    return {
        "memory_type": _canonical(payload["memory_type"], "memory_type", MEMORY_TYPES),
        "title": _normalize_text(payload["title"], "title", MAX_TITLE_CHARACTERS),
        "memory_text": _normalize_text(payload["memory_text"], "memory_text", MAX_MEMORY_CHARACTERS),
        "applies_to": normalized_scopes,
        "priority": _canonical(payload["priority"], "priority", PRIORITIES),
        "effective_date": effective_date,
        "expires_at": expires_at,
        "is_active": payload["is_active"],
    }


def _stored_datetime(value, field_name):
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise MalformedMemoryError(f"Malformed stored {field_name}.")
    return value


def validate_stored_memory(row):
    if not isinstance(row, dict):
        raise MalformedMemoryError("Malformed stored memory.")
    try:
        memory_id = row["memory_id"]
        if isinstance(memory_id, bool) or not isinstance(memory_id, int) or memory_id <= 0:
            raise MalformedMemoryError("Malformed stored memory identifier.")
        stored_payload = {field: row[field] for field in EDITABLE_FIELDS}
        if isinstance(stored_payload["effective_date"], date) and not isinstance(stored_payload["effective_date"], datetime):
            stored_payload["effective_date"] = stored_payload["effective_date"].isoformat()
        if isinstance(stored_payload["expires_at"], datetime):
            stored_payload["expires_at"] = stored_payload["expires_at"].isoformat()
        values = validate_memory_payload(stored_payload)
        created_at = _stored_datetime(row["created_at"], "created_at")
        updated_at = _stored_datetime(row["updated_at"], "updated_at")
    except (KeyError, TypeError, ValueError):
        raise MalformedMemoryError("Malformed stored memory.") from None
    return {
        "memory_id": memory_id,
        **values,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def derived_status(memory, generated_at, local_date):
    if not memory["is_active"]:
        return "inactive"
    if memory["effective_date"] and memory["effective_date"] > local_date:
        return "future"
    if memory["expires_at"] and memory["expires_at"] <= generated_at:
        return "expired"
    return "active"


def is_active_eligible(memory, generated_at, local_date):
    return derived_status(memory, generated_at, local_date) == "active"


def response_memory(memory, generated_at=None, local_date=None):
    generated_at = generated_at or datetime.now(DENVER)
    local_date = local_date or generated_at.astimezone(DENVER).date()
    return {
        **memory,
        "effective_date": memory["effective_date"].isoformat() if memory["effective_date"] else None,
        "expires_at": memory["expires_at"].isoformat() if memory["expires_at"] else None,
        "created_at": memory["created_at"].isoformat(),
        "updated_at": memory["updated_at"].isoformat(),
        "status": derived_status(memory, generated_at, local_date),
    }


def _normalized_match_text(value):
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _matching_scopes(text):
    normalized = _normalized_match_text(text)
    return {
        scope for scope, phrases in SCOPE_PHRASES.items()
        if any(re.search(rf"\b{re.escape(_normalized_match_text(phrase))}\b", normalized) for phrase in phrases)
    }


TITLE_STOPWORDS = frozenset({
    "a", "and", "for", "has", "history", "in", "is", "left", "memory", "of",
    "preferred", "role", "the", "this", "training", "weekly", "with", "year",
    "2026", "bike", "configuration", "current", "maintenance", "ride", "target",
})
DIRECT_ALIAS_GROUPS = {
    "knee_replacement": ("knee replacement", "total knee replacement", "tka", "knee surgery", "replacement surgery"),
    "raynauds": ("raynaud", "raynaud's", "cold hands", "cold fingers", "cold feet", "cold toes"),
    "rallon": ("rallon", "park bike"),
    "denna": ("denna", "gravel bike"),
    "wild": ("wild", "e-mtb battery", "emtb battery", "range extender", "bosch motor"),
    "bomb": ("bomb", "thursday group ride"),
    "weight_maintenance": ("weight target", "target weight", "weight range"),
    "elevation_baseline": ("elevation target", "elevation baseline"),
    "bike_park_safety": ("bike park", "trestle", "pro line", "park safety", "full face"),
}
DIRECT_ALIAS_SCOPES = {
    "rallon": "bike_park",
    "denna": "gravel",
    "wild": "emtb",
    "bike_park_safety": "bike_park",
}
BROAD_PLANNING_PHRASES = (
    "how am i doing",
    "what should i do this week",
    "what should i do next week",
    "build my plan",
    "plan my week",
)
BROAD_PLANNING_MEMORY_TYPES = frozenset({
    "training_goal", "schedule", "medical", "safety", "lesson_learned", "event",
})


def _phrase_present(text, phrase):
    normalized = _normalized_match_text(text)
    normalized_phrase = _normalized_match_text(phrase)
    return bool(normalized_phrase) and bool(re.search(rf"\b{re.escape(normalized_phrase)}\b", normalized))


def _distinctive_tokens(text):
    return {
        token for token in _normalized_match_text(text).split()
        if token not in TITLE_STOPWORDS and len(token) >= 4
    }


def _direct_title_match(memory, text, active_scope_names=()):
    if not text:
        return False
    title = memory["title"]
    title_tokens = _distinctive_tokens(title)
    text_tokens = _distinctive_tokens(text)
    if title_tokens & text_tokens:
        return True
    for group_name, phrases in DIRECT_ALIAS_GROUPS.items():
        if any(_phrase_present(title, phrase) for phrase in phrases):
            if any(_phrase_present(text, phrase) for phrase in phrases):
                return True
            if DIRECT_ALIAS_SCOPES.get(group_name) in active_scope_names:
                return True
    return False


def _memory_direct_matches(memory, evidence):
    strong_scopes = active_scopes(evidence) - {"all_training"}
    return {
        "current": _direct_title_match(memory, evidence.question_text, strong_scopes),
        "recent": any(_direct_title_match(memory, text, strong_scopes) for text in evidence.recent_texts),
        "older": any(_direct_title_match(memory, text, strong_scopes) for text in evidence.older_texts),
    }


def _is_broad_planning_question(text):
    return any(_phrase_present(text, phrase) for phrase in BROAD_PLANNING_PHRASES)


def _context_signal_values(context):
    if not isinstance(context, dict):
        return {}, []
    signals = {}
    verified_flag_paths = (
        ("athlete_narrative", "current_week"),
        ("upcoming_context", "current_week_flags"),
    )
    for parent_key, flags_key in verified_flag_paths:
        parent = context.get(parent_key)
        flags = parent.get(flags_key) if isinstance(parent, dict) else None
        if not isinstance(flags, dict):
            continue
        for flag_name in AUTHORITATIVE_SCOPE_SIGNALS:
            if flags.get(flag_name) is True:
                signals[flag_name] = True
    recent_days = context.get("recent_days")
    if not isinstance(recent_days, list):
        recent_days = []
    return signals, recent_days[:RECENT_ENTITY_DAYS]


def route_evidence(question, history, context):
    question_text = question if isinstance(question, str) else ""
    current = _matching_scopes(question_text)
    bounded_history = history if isinstance(history, list) else []
    recent_messages = bounded_history[-2:]
    older_messages = bounded_history[:-2]
    recent = set()
    recent_texts = []
    for item in recent_messages:
        if isinstance(item, dict):
            text = str(item.get("message_text", ""))
            recent_texts.append(text)
            recent.update(_matching_scopes(text))
    older = set()
    recent_scores = {}
    older_scores = {}
    older_matches = []
    for item in older_messages:
        if isinstance(item, dict):
            text = str(item.get("message_text", ""))
            matches = _matching_scopes(text)
            older_matches.append((text, matches))
            older.update(matches)
            for scope in matches:
                older_scores[scope] = older_scores.get(scope, 0) + 1
    for item in recent_messages:
        if isinstance(item, dict):
            for scope in _matching_scopes(str(item.get("message_text", ""))):
                recent_scores[scope] = recent_scores.get(scope, 0) + 2
    signals, recent_days = _context_signal_values(context)
    authoritative = set()
    supporting_entity_scopes = set()
    active = set()
    for name, value in signals.items():
        if value is True:
            active.add(name)
            authoritative.update(AUTHORITATIVE_SCOPE_SIGNALS[name])
    for item in recent_days:
        if isinstance(item, dict):
            activity_values = []
            for field_name in (
                "main_ride_name",
                "main_ride_bike_name",
                "main_ride_sport_type",
                "other_activity_names",
            ):
                value = item.get(field_name)
                if isinstance(value, list):
                    activity_values.extend(value)
                elif isinstance(value, str):
                    activity_values.append(value)
            text = " ".join(activity_values)
            normalized = _normalized_match_text(text)
            supporting_entity_scopes.update(_matching_scopes(text))
            if re.search(r"\brallon\b", normalized):
                supporting_entity_scopes.update({"bike_park", "mtb"})
            if re.search(r"\bwild\b", normalized):
                supporting_entity_scopes.update({"emtb", "mtb"})
            if re.search(r"\bdenna\b", normalized):
                supporting_entity_scopes.add("gravel")
    older_texts = tuple(
        text for text, matches in older_matches
        if any(older_scores.get(scope, 0) >= 2 for scope in matches)
    )
    return RouteEvidence(
        frozenset(current), frozenset(recent), frozenset(older),
        frozenset(authoritative), frozenset(active), recent_scores, older_scores,
        frozenset(supporting_entity_scopes),
        question_text, tuple(recent_texts), older_texts,
    )


def active_scopes(evidence):
    return {
        "all_training",
        *evidence.current,
        *evidence.authoritative,
        *(scope for scope, score in evidence.recent_scores.items() if score >= 2),
        *(scope for scope, score in evidence.older_scores.items() if score >= 2),
    }


def _normal_memory_has_strong_scope(memory, evidence):
    scopes = set(memory["applies_to"])
    strong_scopes = active_scopes(evidence) - {"all_training"}
    if not scopes & strong_scopes:
        return False
    direct = _memory_direct_matches(memory, evidence)
    if direct["current"] or direct["recent"] or direct["older"]:
        return True
    return (
        "planning" in scopes
        and "planning" in evidence.current
        and _is_broad_planning_question(evidence.question_text)
        and memory["memory_type"] in BROAD_PLANNING_MEMORY_TYPES
    )


def _ranking_key(memory, evidence):
    scopes = set(memory["applies_to"])
    direct = _memory_direct_matches(memory, evidence)
    return (
        0 if memory["priority"] == "critical" else 1,
        0 if direct["current"] else 1,
        0 if scopes & evidence.current else 1,
        0 if scopes & evidence.authoritative else 1,
        0 if scopes & evidence.supporting_entity_scopes else 1,
        0 if scopes & evidence.recent else 1,
        0 if memory["priority"] == "high" else 1,
        0 if scopes & evidence.older else 1,
        0 if memory["effective_date"] else 1,
        -memory["updated_at"].timestamp(),
        memory["memory_id"],
    )


def _select_memories_with_evidence(memories, question, history, context, generated_at, local_date):
    evidence = route_evidence(question, history, context)
    eligible = [
        memory for memory in memories
        if is_active_eligible(memory, generated_at, local_date)
        and _normal_memory_has_strong_scope(memory, evidence)
    ]
    safety = [
        memory for memory in memories
        if is_active_eligible(memory, generated_at, local_date)
        and (memory["priority"] == "critical" or (
            memory["priority"] == "high"
            and memory["memory_type"] in {"medical", "safety"}
            and "all_training" in memory["applies_to"]
        ))
    ]
    combined = {memory["memory_id"]: memory for memory in (*eligible, *safety)}
    ranked = sorted(combined.values(), key=lambda memory: _ranking_key(memory, evidence))
    critical = [memory for memory in ranked if memory["priority"] == "critical"]
    if len(critical) > MAX_SELECTED_MEMORIES:
        raise CriticalMemoryOverflowError("Too many eligible critical Durable Memories.")
    selected = []
    for memory in ranked:
        if len(selected) >= MAX_SELECTED_MEMORIES:
            break
        candidate = compile_memories((*selected, memory))
        if len(candidate) <= MAX_COMPILED_CHARACTERS:
            selected.append(memory)
    if any(memory["memory_id"] not in {item["memory_id"] for item in selected} for memory in critical):
        raise CriticalMemoryOverflowError("Eligible critical Durable Memories exceed the compiled limit.")
    return selected, evidence


def select_memories(memories, question, history, context, generated_at, local_date):
    selected, _ = _select_memories_with_evidence(
        memories, question, history, context, generated_at, local_date
    )
    return selected


def select_memories_with_evidence(memories, question, history, context, generated_at, local_date):
    """Return the existing selection plus immutable routing evidence."""
    selected, evidence = _select_memories_with_evidence(
        memories, question, history, context, generated_at, local_date
    )
    return selected, evidence


def canonical_active_scopes(evidence):
    active = active_scopes(evidence)
    return [scope for scope in SCOPES if scope in active]


def selection_reasons(memory, evidence):
    scopes = set(memory["applies_to"])
    direct = _memory_direct_matches(memory, evidence)
    broad_planning_match = (
        "planning" in scopes
        and "planning" in evidence.current
        and _is_broad_planning_question(evidence.question_text)
        and memory["memory_type"] in BROAD_PLANNING_MEMORY_TYPES
    )
    reasons = []
    if memory["priority"] == "critical":
        reasons.append("critical_memory")
    if memory["priority"] == "high" and memory["memory_type"] == "medical" and "all_training" in scopes:
        reasons.append("high_all_training_medical")
    if memory["priority"] == "high" and memory["memory_type"] == "safety" and "all_training" in scopes:
        reasons.append("high_all_training_safety")
    if direct["current"] or broad_planning_match:
        reasons.append("current_question_match")
    if scopes & evidence.authoritative and (
        direct["current"] or direct["recent"] or direct["older"]
    ):
        reasons.append("authoritative_context_match")
    if direct["recent"]:
        reasons.append("recent_conversation_match")
    if direct["older"]:
        reasons.append("older_bounded_history_match")
    if "all_training" in scopes:
        reasons.append("all_training_match")
    return [reason for reason in SELECTION_REASON_ORDER if reason in reasons]


def compile_memories(memories):
    if not memories:
        return ""
    lines = [MEMORY_WRAPPER]
    for memory in memories:
        date_context = []
        if memory["effective_date"]:
            date_context.append(f"effective {memory['effective_date'].isoformat()}")
        if memory["expires_at"]:
            date_context.append(f"expires {memory['expires_at'].isoformat()}")
        context = f"; {', '.join(date_context)}" if date_context else ""
        lines.append(
            f"- Type: {memory['memory_type']}; Priority: {memory['priority']}{context}\n"
            f"  Title: {memory['title']}\n"
            f"  Fact: {memory['memory_text']}"
        )
    return "\n\n".join(lines)