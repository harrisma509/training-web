"""Strict CRUD routes for athlete-entered daily check-ins."""

import re
from datetime import date
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator
from starlette.responses import Response
from starlette.exceptions import HTTPException

from db import db_conn, json_safe

router = APIRouter()

MAX_RANGE_DAYS = 366
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
CHECKIN_COLUMNS = (
    "checkin_date",
    "overall_status",
    "note",
    "readiness",
    "energy",
    "soreness",
    "pain",
    "physical_labor",
    "handling_quality",
    "is_travel",
    "is_sick",
    "is_injury",
    "is_bike_park",
    "is_recovery",
    "is_goal_event",
    "is_bad_weather",
    "is_high_life_stress",
    "is_lost",
    "is_gear",
    "is_crash",
    "is_group_ride",
    "is_sore",
    "is_tired",
    "is_poor_sleep",
    "created_at",
    "updated_at",
)
FLAG_FIELDS = CHECKIN_COLUMNS[9:24]

class DailyCheckinPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall_status: str = Field(pattern="^(good|mixed|poor)$")
    note: StrictStr
    readiness: Optional[StrictInt] = Field(default=None, ge=1, le=5)
    energy: Optional[StrictInt] = Field(default=None, ge=1, le=5)
    soreness: Optional[StrictInt] = Field(default=None, ge=0, le=4)
    pain: Optional[StrictInt] = Field(default=None, ge=0, le=4)
    physical_labor: Optional[str] = Field(default=None, pattern="^(none|light|moderate|heavy)$")
    handling_quality: Optional[str] = Field(default=None, pattern="^(sharp|normal|off)$")
    is_travel: StrictBool = False
    is_sick: StrictBool = False
    is_injury: StrictBool = False
    is_bike_park: StrictBool = False
    is_recovery: StrictBool = False
    is_goal_event: StrictBool = False
    is_bad_weather: StrictBool = False
    is_high_life_stress: StrictBool = False
    is_lost: StrictBool = False
    is_gear: StrictBool = False
    is_crash: StrictBool = False
    is_group_ride: StrictBool = False
    is_sore: StrictBool = False
    is_tired: StrictBool = False
    is_poor_sleep: StrictBool = False

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value):
        normalized = value.strip()
        if not normalized:
            raise ValueError("note must not be blank")
        if len(normalized) > 1000:
            raise ValueError("note must be at most 1000 characters")
        return normalized


def _parse_date(value: str, field_name: str) -> date:
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        raise HTTPException(status_code=422, detail=f"{field_name} must be YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field_name} must be YYYY-MM-DD") from None


def _json_row(row):
    if row is None:
        return None
    return {key: json_safe(value) for key, value in row.items()}


def _database_unavailable():
    raise HTTPException(status_code=503, detail="Daily check-in storage is unavailable.") from None


def _select_one(cur, checkin_date):
    cur.execute(
        f"""
        SELECT {', '.join(CHECKIN_COLUMNS)}
        FROM public.daily_checkin
        WHERE checkin_date = %s
        """,
        (checkin_date,),
    )
    return cur.fetchone()


@router.get("/api/daily-checkins/{checkin_date}")
def get_daily_checkin(checkin_date: str):
    parsed_date = _parse_date(checkin_date, "checkin_date")
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                row = _select_one(cur, parsed_date)
    except HTTPException:
        raise
    except Exception:
        _database_unavailable()
    if row is None:
        raise HTTPException(status_code=404, detail="Daily check-in not found.")
    return _json_row(row)


@router.get("/api/daily-checkins")
def list_daily_checkins(start_date: str, end_date: str):
    parsed_start = _parse_date(start_date, "start_date")
    parsed_end = _parse_date(end_date, "end_date")
    if parsed_start > parsed_end:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
    if (parsed_end - parsed_start).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="Daily check-in range must not exceed 366 days")
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT {', '.join(CHECKIN_COLUMNS)}
                    FROM public.daily_checkin
                    WHERE checkin_date BETWEEN %s AND %s
                    ORDER BY checkin_date DESC
                    """,
                    (parsed_start, parsed_end),
                )
                rows = cur.fetchall()
    except HTTPException:
        raise
    except Exception:
        _database_unavailable()
    return [_json_row(row) for row in rows]


@router.put("/api/daily-checkins/{checkin_date}")
def save_daily_checkin(checkin_date: str, payload: DailyCheckinPayload):
    parsed_date = _parse_date(checkin_date, "checkin_date")
    values = payload.model_dump()
    columns = ["checkin_date", *values.keys()]
    placeholders = ["%s"] * len(columns)
    params = [parsed_date, *values.values()]
    update_columns = ", ".join(
        f"{column} = EXCLUDED.{column}" for column in values
    )
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO public.daily_checkin ({', '.join(columns)})
                    VALUES ({', '.join(placeholders)})
                    ON CONFLICT (checkin_date) DO UPDATE
                    SET {update_columns}, updated_at = now()
                    RETURNING {', '.join(CHECKIN_COLUMNS)}
                    """,
                    params,
                )
                row = cur.fetchone()
    except HTTPException:
        raise
    except Exception:
        _database_unavailable()
    if row is None:
        _database_unavailable()
    return _json_row(row)


@router.delete("/api/daily-checkins/{checkin_date}", status_code=204)
def delete_daily_checkin(checkin_date: str):
    parsed_date = _parse_date(checkin_date, "checkin_date")
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM public.daily_checkin WHERE checkin_date = %s",
                    (parsed_date,),
                )
                deleted = cur.rowcount
    except HTTPException:
        raise
    except Exception:
        _database_unavailable()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Daily check-in not found.")
    return Response(status_code=204)
