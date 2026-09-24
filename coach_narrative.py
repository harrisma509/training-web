"""Bounded hydration of selected Strava activity narratives for Coach."""

from context_client import ContextUnavailableError
from db import db_conn


MAX_NARRATIVE_CHARACTERS_PER_ACTIVITY = 2_000
MAX_NARRATIVE_CHARACTERS_TOTAL = 15_000
TRUNCATION_MARKER = "[truncated]"


def _text(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def _activity_ids(context):
    ids = []
    seen = set()
    for day in context.get("recent_days", []) if isinstance(context, dict) else []:
        if not isinstance(day, dict):
            continue
        candidates = [day.get("main_ride_id")]
        other_activities = day.get("other_activities")
        if isinstance(other_activities, list):
            candidates.extend(
                activity.get("activity_id")
                for activity in other_activities
                if isinstance(activity, dict)
            )
        for activity_id in candidates:
            activity_id = str(activity_id).strip() if activity_id is not None else ""
            if activity_id and activity_id not in seen:
                seen.add(activity_id)
                ids.append(activity_id)
    return ids


def _bounded_text(value, limit):
    if len(value) <= limit:
        return value, False
    marker = TRUNCATION_MARKER[:limit]
    return value[: max(0, limit - len(marker))] + marker, True


def _bounded_narrative(description, private_note, remaining):
    description, description_truncated = _bounded_text(description, min(len(description), remaining))
    remaining -= len(description)
    private_note, private_note_truncated = _bounded_text(private_note, max(0, remaining))
    return description, private_note, description_truncated or private_note_truncated


def hydrate_context_with_narratives(context):
    """Add bounded narrative observations for the context's selected activities."""
    activity_ids = _activity_ids(context)
    if not activity_ids:
        enriched = dict(context)
        enriched["activity_narratives"] = []
        enriched["narrative_coverage"] = {
            "activity_count": 0,
            "character_count": 0,
            "truncated_activity_count": 0,
        }
        return enriched

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT activity_id, description, private_note
                    FROM public.strava_activities
                    WHERE activity_id = ANY(%s)
                    """,
                    (activity_ids,),
                )
                rows = cur.fetchall()
    except Exception as exc:
        raise ContextUnavailableError("Coach narrative context is unavailable.") from exc

    rows_by_id = {str(row.get("activity_id")): row for row in rows}
    narratives = []
    total_characters = 0
    truncated_count = 0
    for activity_id in activity_ids:
        row = rows_by_id.get(activity_id)
        if not row:
            continue
        description = _text(row.get("description"))
        private_note = _text(row.get("private_note"))
        if not description and not private_note:
            continue
        remaining = min(
            MAX_NARRATIVE_CHARACTERS_PER_ACTIVITY,
            MAX_NARRATIVE_CHARACTERS_TOTAL - total_characters,
        )
        if remaining <= 0:
            break
        description, private_note, truncated = _bounded_narrative(description, private_note, remaining)
        if not description and not private_note:
            continue
        narratives.append({
            "activity_id": activity_id,
            "description": description,
            "private_note": private_note,
        })
        total_characters += len(description) + len(private_note)
        truncated_count += int(truncated)

    enriched = dict(context)
    enriched["activity_narratives"] = narratives
    enriched["narrative_coverage"] = {
        "activity_count": len(narratives),
        "character_count": total_characters,
        "truncated_activity_count": truncated_count,
    }
    return enriched