import os

import psycopg
from psycopg.rows import dict_row

from health_api.handlers.sleep import SleepRecord
from health_api.handlers.sleep_scoring import score_sleep


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def upsert_sleep(rows: list[SleepRecord]) -> int:
    if not rows:
        return 0

    sql = """
        INSERT INTO health_sleep (
            date, sleep_start, sleep_end, in_bed_start, in_bed_end,
            deep_sleep_hr, core_sleep_hr, rem_sleep_hr, awake_hr,
            total_sleep_hr, asleep_hr, in_bed_hr, sleep_score,
            duration_pts, consistency_pts, interruptions_pts, score_version, source
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (date) DO UPDATE SET
            sleep_start = EXCLUDED.sleep_start,
            sleep_end = EXCLUDED.sleep_end,
            in_bed_start = EXCLUDED.in_bed_start,
            in_bed_end = EXCLUDED.in_bed_end,
            deep_sleep_hr = EXCLUDED.deep_sleep_hr,
            core_sleep_hr = EXCLUDED.core_sleep_hr,
            rem_sleep_hr = EXCLUDED.rem_sleep_hr,
            awake_hr = EXCLUDED.awake_hr,
            total_sleep_hr = EXCLUDED.total_sleep_hr,
            asleep_hr = EXCLUDED.asleep_hr,
            in_bed_hr = EXCLUDED.in_bed_hr,
            sleep_score = EXCLUDED.sleep_score,
            duration_pts = EXCLUDED.duration_pts,
            consistency_pts = EXCLUDED.consistency_pts,
            interruptions_pts = EXCLUDED.interruptions_pts,
            score_version = EXCLUDED.score_version,
            source = EXCLUDED.source,
            updated_at = now()
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(
                    """
                    SELECT sleep_start
                    FROM health_sleep
                    WHERE date < %s
                    ORDER BY date DESC
                    LIMIT 28
                    """,
                    (row.date,),
                )
                history = cur.fetchall()
                row.score = score_sleep(row, history)
                cur.execute(
                    sql,
                    (
                        row.date,
                        row.sleep_start,
                        row.sleep_end,
                        row.in_bed_start,
                        row.in_bed_end,
                        row.values.get("deep_sleep_hr"),
                        row.values.get("core_sleep_hr"),
                        row.values.get("rem_sleep_hr"),
                        row.values.get("awake_hr"),
                        row.values.get("total_sleep_hr"),
                        row.values.get("asleep_hr"),
                        row.values.get("in_bed_hr"),
                        row.score["sleep_score"],
                        row.score["duration_pts"],
                        row.score["consistency_pts"],
                        row.score["interruptions_pts"],
                        row.score["score_version"],
                        row.source,
                    ),
                )
    return len(rows)
