"""Persistence for the single-user Plan view preference namespace."""

import json

from db import db_conn


PLAN_VIEW_NAMESPACE = "plan_view"
DEFAULT_HIDE_PAST_PLANNED = True


def _preference_payload(value):
    if not isinstance(value, dict):
        raise ValueError("Stored Plan preferences must be a JSON object.")
    hide_past_planned = value.get("hide_past_planned", DEFAULT_HIDE_PAST_PLANNED)
    if type(hide_past_planned) is not bool:
        raise ValueError("Stored hide_past_planned preference must be boolean.")
    return {"hide_past_planned": hide_past_planned}


def get_plan_view_preferences():
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT preference_value
                FROM public.app_preference
                WHERE preference_namespace = %s
                """,
                (PLAN_VIEW_NAMESPACE,),
            )
            row = cur.fetchone()

    if row is None:
        return {"hide_past_planned": DEFAULT_HIDE_PAST_PLANNED}
    return _preference_payload(row.get("preference_value"))


def update_plan_view_preferences(hide_past_planned):
    encoded_value = json.dumps({"hide_past_planned": hide_past_planned})
    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO public.app_preference (
                        preference_namespace,
                        preference_value
                    )
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (preference_namespace)
                    DO UPDATE SET
                        preference_value = public.app_preference.preference_value
                            || EXCLUDED.preference_value,
                        updated_at = now()
                    RETURNING preference_value
                    """,
                    (PLAN_VIEW_NAMESPACE, encoded_value),
                )
                row = cur.fetchone()
            if row is None:
                raise RuntimeError("Plan preference upsert returned no row.")
            result = _preference_payload(row.get("preference_value"))
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
