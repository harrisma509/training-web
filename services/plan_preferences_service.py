"""Persistence for Plan view settings stored in the application settings row."""

from db import db_conn


DEFAULT_HIDE_PAST_PLANNED = True


def _preference_payload(plan_settings):
    if not isinstance(plan_settings, dict):
        raise ValueError("Stored Plan settings must be a JSON object.")
    hide_past_planned = plan_settings.get(
        "hide_past_planned",
        DEFAULT_HIDE_PAST_PLANNED,
    )
    if type(hide_past_planned) is not bool:
        raise ValueError("Stored hide_past_planned preference must be boolean.")
    return {"hide_past_planned": hide_past_planned}


def get_plan_view_preferences():
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT plan_settings
                FROM public.app_settings
                WHERE settings_id = 1
                """
            )
            row = cur.fetchone()

    if row is None:
        raise RuntimeError("Application settings singleton row is missing.")
    return _preference_payload(row.get("plan_settings"))


def update_plan_view_preferences(hide_past_planned):
    if type(hide_past_planned) is not bool:
        raise ValueError("hide_past_planned must be a boolean.")
    with db_conn() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.app_settings
                    SET plan_settings = jsonb_set(
                            plan_settings,
                            '{hide_past_planned}',
                            to_jsonb(%s::boolean),
                            true
                        ),
                        updated_at = now()
                    WHERE settings_id = 1
                    RETURNING plan_settings
                    """,
                    (hide_past_planned,),
                )
                row = cur.fetchone()
            if row is None:
                raise RuntimeError("Application settings update returned no row.")
            result = _preference_payload(row.get("plan_settings"))
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
