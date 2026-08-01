import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from health_api.handlers.hrv import HRVRecord, build_hrv_rows

LOCAL_TZ = ZoneInfo("America/Denver")


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def upsert_hrv(metrics: list[dict]) -> int:
    if not metrics:
        return 0

    sql = """
        INSERT INTO health_hrv (
            date, measured_at, hrv_sdnn_ms, source, sample_timestamp,
            mins_before_wake, rule, proximity_level
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (date) DO UPDATE SET
            measured_at = EXCLUDED.measured_at,
            hrv_sdnn_ms = EXCLUDED.hrv_sdnn_ms,
            source = EXCLUDED.source,
            sample_timestamp = EXCLUDED.sample_timestamp,
            mins_before_wake = EXCLUDED.mins_before_wake,
            rule = EXCLUDED.rule,
            proximity_level = EXCLUDED.proximity_level,
            updated_at = now()
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            days = set()
            for metric in metrics:
                for record in metric.get("data", []):
                    if not isinstance(record, dict):
                        continue
                    for key in ("timestamp", "date", "start", "end"):
                        value = record.get(key)
                        if value:
                            try:
                                timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                            except ValueError:
                                continue
                            if timestamp.tzinfo is None:
                                timestamp = timestamp.replace(tzinfo=LOCAL_TZ)
                            days.add(timestamp.astimezone(LOCAL_TZ).date())
                            break

            sleep_ends: dict[date, datetime] = {}
            if days:
                cur.execute(
                    "SELECT date, sleep_end FROM health_sleep WHERE date = ANY(%s)",
                    (list(days),),
                )
                sleep_ends = {row["date"]: row["sleep_end"] for row in cur.fetchall() if row["sleep_end"]}

            rows = build_hrv_rows(metrics, sleep_ends)
            cur.executemany(
                sql,
                [
                    (
                        row.date,
                        row.measured_at,
                        row.hrv_sdnn_ms,
                        row.source,
                        row.sample_timestamp,
                        row.mins_before_wake,
                        row.rule,
                        row.proximity_level,
                    )
                    for row in rows
                ],
            )
    return len(rows)
