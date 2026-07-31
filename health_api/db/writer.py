import os

import psycopg
from psycopg.rows import dict_row

from health_api.handlers.weight import WeightRecord


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def upsert_weight(rows: list[WeightRecord]) -> int:
    if not rows:
        return 0

    sql = """
        INSERT INTO health_weight (
            date,
            measured_at,
            weight_lb,
            body_fat_pct,
            lean_body_mass_lb,
            bmi,
            source
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (date) DO UPDATE SET
            measured_at = COALESCE(EXCLUDED.measured_at, health_weight.measured_at),
            weight_lb = COALESCE(EXCLUDED.weight_lb, health_weight.weight_lb),
            body_fat_pct = COALESCE(EXCLUDED.body_fat_pct, health_weight.body_fat_pct),
            lean_body_mass_lb = COALESCE(EXCLUDED.lean_body_mass_lb, health_weight.lean_body_mass_lb),
            bmi = COALESCE(EXCLUDED.bmi, health_weight.bmi),
            source = COALESCE(EXCLUDED.source, health_weight.source),
            updated_at = now()
    """

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                sql,
                [
                    (
                        row.date,
                        row.measured_at,
                        row.values.get("weight_lb"),
                        row.values.get("body_fat_pct"),
                        row.values.get("lean_body_mass_lb"),
                        row.values.get("bmi"),
                        row.source,
                    )
                    for row in rows
                ],
            )
    return len(rows)
