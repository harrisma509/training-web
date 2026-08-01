import os

import psycopg
from psycopg.rows import dict_row

from health_api.handlers.rhr import RHRRecord


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def upsert_rhr(rows: list[RHRRecord]) -> int:
    if not rows:
        return 0

    sql = """
        INSERT INTO health_rhr (date, measured_at, rhr_bpm, source)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (date) DO UPDATE SET
            measured_at = EXCLUDED.measured_at,
            rhr_bpm = EXCLUDED.rhr_bpm,
            source = EXCLUDED.source,
            updated_at = now()
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                sql,
                [(row.date, row.measured_at, row.rhr_bpm, row.source) for row in rows],
            )
    return len(rows)
