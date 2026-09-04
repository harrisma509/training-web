"""Read-only chart data endpoints for the Charts tab."""

import calendar
from datetime import date

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from chart_config import WEIGHT_TARGET_HIGH_LB, WEIGHT_TARGET_LOW_LB
from db import db_conn, rows_to_json

router = APIRouter()

MIN_CHART_YEAR = 2000
MAX_CHART_YEAR = 2100

FITNESS_FATIGUE_METADATA = {
    "version": "v1",
    "fitness_days": 42,
    "fatigue_days": 7,
    "form_timing": "start_of_day",
    "timezone": "America/Denver",
}


def _is_partial_month(month_start: date, through_date: date) -> bool:
    month_end = date(month_start.year, month_start.month, calendar.monthrange(month_start.year, month_start.month)[1])
    return month_start.year == through_date.year and month_start.month == through_date.month and through_date < month_end


def _is_partial_year(year: int, first_date: date, last_date: date) -> bool:
    if year == date.today().year:
        return True

    return first_date > date(year, 1, 14) or last_date < date(year, 12, 17)


@router.get("/api/charts/load/fitness-fatigue")
def api_fitness_fatigue_summary():
    summary_sql = """
        WITH latest AS (
            SELECT
                "date",
                daily_load,
                fitness,
                fatigue,
                form,
                model_version
            FROM public.daily_fitness_fatigue
            ORDER BY "date" DESC
            LIMIT 1
        ), coverage AS (
            SELECT
                MIN("date") AS first_date,
                MAX("date") AS last_date,
                COUNT(*) AS row_count
            FROM public.daily_fitness_fatigue
        )
        SELECT
            latest."date",
            latest.daily_load,
            latest.fitness,
            latest.fatigue,
            latest.form,
            latest.model_version,
            coverage.first_date,
            coverage.last_date,
            coverage.row_count,
            seven.fitness AS fitness_7_days,
            twenty_eight.fitness AS fitness_28_days,
            ninety.fitness AS fitness_90_days
        FROM latest
        CROSS JOIN coverage
        LEFT JOIN LATERAL (
            SELECT fitness
            FROM public.daily_fitness_fatigue
            WHERE "date" <= latest."date" - INTERVAL '7 days'
            ORDER BY "date" DESC
            LIMIT 1
        ) seven ON TRUE
        LEFT JOIN LATERAL (
            SELECT fitness
            FROM public.daily_fitness_fatigue
            WHERE "date" <= latest."date" - INTERVAL '28 days'
            ORDER BY "date" DESC
            LIMIT 1
        ) twenty_eight ON TRUE
        LEFT JOIN LATERAL (
            SELECT fitness
            FROM public.daily_fitness_fatigue
            WHERE "date" <= latest."date" - INTERVAL '90 days'
            ORDER BY "date" DESC
            LIMIT 1
        ) ninety ON TRUE
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(summary_sql)
            row = cur.fetchone()

    if not row:
        return JSONResponse({
            "current": None,
            "fitness_change": {"days_7": None, "days_28": None, "days_90": None},
            "model": FITNESS_FATIGUE_METADATA,
            "coverage": None,
            "warmup": {
                "first_date": "2025-01-01",
                "last_date": "2025-02-11",
                "days": 42,
            },
        })

    current = {
        "date": row["date"],
        "daily_load": row["daily_load"],
        "fitness": row["fitness"],
        "fatigue": row["fatigue"],
        "form": row["form"],
    }
    changes = {
        "days_7": difference(row["fitness"], row["fitness_7_days"]),
        "days_28": difference(row["fitness"], row["fitness_28_days"]),
        "days_90": difference(row["fitness"], row["fitness_90_days"]),
    }

    return JSONResponse({
        "current": rows_to_json([current])[0],
        "fitness_change": changes,
        "model": FITNESS_FATIGUE_METADATA,
        "coverage": {
            "first_date": row["first_date"].isoformat(),
            "through_date": row["last_date"].isoformat(),
            "row_count": row["row_count"],
        },
        "warmup": {
            "first_date": "2025-01-01",
            "last_date": "2025-02-11",
            "days": 42,
        },
    })


def difference(latest, reference):
    if latest is None or reference is None:
        return None
    return round(float(latest - reference), 2)


@router.get("/api/charts/weight")
def api_weight_chart(year: int | None = None):
    selected_year = date.today().year if year is None else year
    if not MIN_CHART_YEAR <= selected_year <= MAX_CHART_YEAR:
        raise HTTPException(status_code=422, detail="year must be between 2000 and 2100")

    year_start = date(selected_year, 1, 1)
    next_year_start = date(selected_year + 1, 1, 1)
    previous_december_start = date(selected_year - 1, 12, 1)
    daily_sql = """
        select date, weight_lb
        from health_weight
        where date >= %s and date < %s and weight_lb is not null
        order by date
    """
    monthly_sql = """
        select
            date_trunc('month', date)::date as month_start,
            avg(weight_lb) as average_lb,
            min(weight_lb) as minimum_lb,
            max(weight_lb) as maximum_lb,
            count(*) as measurement_count
        from health_weight
        where date >= %s and date < %s and weight_lb is not null
        group by 1
        order by 1
    """
    year_sql = """
        select distinct extract(year from date) as year
        from health_weight
        where weight_lb is not null
        order by year desc
    """
    previous_december_sql = """
        select
            avg(weight_lb) as average_lb,
            min(weight_lb) as minimum_lb,
            max(weight_lb) as maximum_lb,
            count(*) as measurement_count,
            min(date) as first_date,
            max(date) as last_date
        from public.health_weight
        where date >= %s and date < %s and weight_lb is not null
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(year_sql)
            available_year_rows = cur.fetchall()
            cur.execute(daily_sql, (year_start, next_year_start))
            daily_rows = cur.fetchall()
            cur.execute(monthly_sql, (year_start, next_year_start))
            monthly_rows = cur.fetchall()
            cur.execute(previous_december_sql, (previous_december_start, year_start))
            previous_december_row = cur.fetchone()

    available_years = [int(row["year"]) for row in available_year_rows]
    previous_december = None
    if previous_december_row and previous_december_row["measurement_count"]:
        previous_december = {
            **previous_december_row,
            "month": previous_december_start.strftime("%Y-%m"),
            "year": selected_year - 1,
        }

    if not daily_rows:
        return JSONResponse({
            "year": selected_year,
            "through_date": None,
            "target": {"low_lb": WEIGHT_TARGET_LOW_LB, "high_lb": WEIGHT_TARGET_HIGH_LB},
            "latest": None,
            "monthly": [],
            "daily": [],
            "previous_december": None,
            "available_years": available_years,
        })

    through_date = daily_rows[-1]["date"]
    monthly = [
        {
            **row,
            "month": row["month_start"].strftime("%Y-%m"),
            "is_partial": _is_partial_month(row["month_start"], through_date),
        }
        for row in monthly_rows
    ]

    return JSONResponse({
        "year": selected_year,
        "through_date": through_date.isoformat(),
        "target": {"low_lb": WEIGHT_TARGET_LOW_LB, "high_lb": WEIGHT_TARGET_HIGH_LB},
        "latest": rows_to_json([daily_rows[-1]])[0],
        "monthly": rows_to_json(monthly),
        "daily": rows_to_json(daily_rows),
        "previous_december": rows_to_json([previous_december])[0] if previous_december else None,
        "available_years": available_years,
    })


@router.get("/api/charts/weight/annual")
def api_annual_weight_chart():
    annual_sql = """
        select
            extract(year from date)::integer as year,
            avg(weight_lb) as average_weight_lb,
            min(weight_lb) as minimum_weight_lb,
            max(weight_lb) as maximum_weight_lb,
            count(*) as measurement_count,
            min(date) as first_date,
            max(date) as last_date
        from public.health_weight
        where weight_lb is not null
        group by 1
        order by 1
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(annual_sql)
            annual_rows = cur.fetchall()

    annual = [
        {
            **row,
            "is_partial": _is_partial_year(row["year"], row["first_date"], row["last_date"]),
        }
        for row in annual_rows
    ]
    latest_year = annual[-1]["year"] if annual else None

    return JSONResponse({
        "target": {"low_lb": WEIGHT_TARGET_LOW_LB, "high_lb": WEIGHT_TARGET_HIGH_LB},
        "first_year": annual[0]["year"] if annual else None,
        "latest_year": latest_year,
        "annual": rows_to_json(annual),
    })