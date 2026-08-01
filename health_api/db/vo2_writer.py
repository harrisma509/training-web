import os

import psycopg
from psycopg.rows import dict_row

from health_api.handlers.vo2 import VO2Record


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def upsert_vo2(rows: list[VO2Record]) -> int:
    if not rows:
        return 0

    sql = """
        INSERT INTO health_vo2_max (week_start, measured_at, vo2max, source)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (week_start) DO UPDATE SET
            measured_at = EXCLUDED.measured_at,
            vo2max = EXCLUDED.vo2max,
            source = EXCLUDED.source,
            updated_at = now()
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                sql,
                [(row.week_start, row.measured_at, row.vo2max, row.source) for row in rows],
            )
    return len(rows)
