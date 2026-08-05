"""
Weekly commentary route module.

Owns editing weekly_commentary fields from the Weekly tab.
This module handles the weekly commentary PATCH endpoint and related Pydantic model.

Keep write behavior idempotent and targeted to weekly_commentary only.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from db import db_conn

router = APIRouter()


class WeeklyCommentaryUpdate(BaseModel):
    week_type: Optional[str] = None
    event: Optional[str] = None
    planned_focus: Optional[str] = None
    actual_focus: Optional[str] = None
    weekly_comment: Optional[str] = None
    risk_note: Optional[str] = None
    coach_note: Optional[str] = None
    task_note: Optional[str] = None
    lesson_learned: Optional[str] = None
    status_override: Optional[str] = None
    is_travel_week: Optional[bool] = None
    is_sick_week: Optional[bool] = None
    is_injury_week: Optional[bool] = None
    is_bike_park_week: Optional[bool] = None
    is_recovery_week: Optional[bool] = None
    is_goal_week: Optional[bool] = None
    hide_from_dashboard: Optional[bool] = None
    display_priority: Optional[int] = None


@router.patch("/api/weekly-commentary/{week_start}")
def update_weekly_comment(week_start: str, payload: WeeklyCommentaryUpdate):
    try:
        week_start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=422, detail="week_start must be YYYY-MM-DD")

    update_values = payload.dict(exclude_unset=True)
    if "weekly_comment" in update_values and update_values["weekly_comment"] == "":
        update_values["weekly_comment"] = None

    if not update_values:
        raise HTTPException(status_code=400, detail="No updatable fields provided")

    insert_columns = ["week_start"] + list(update_values.keys()) + ["created_at", "updated_at"]
    insert_placeholders = ["%s"] * len(insert_columns)
    insert_values = [week_start_date] + list(update_values.values()) + ["now()", "now()"]
    on_conflict_set = ",\n            ".join(
        f"{col} = excluded.{col}" for col in update_values.keys()
    ) + ",\n            updated_at = now()"

    sql = f"""
        insert into weekly_commentary ({', '.join(insert_columns)})
        values ({', '.join(insert_placeholders)})
        on conflict (week_start) do update
        set {on_conflict_set}
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, insert_values)

    response_data = {"week_start": week_start_date.isoformat()}
    response_data.update(update_values)
    return JSONResponse(response_data)
