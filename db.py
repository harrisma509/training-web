"""
Shared database and JSON helpers for the Training Dashboard web app.

This module owns:
- Postgres connection creation
- Decimal/date/datetime JSON serialization helpers
- row-to-JSON conversion

Do not put route logic here.
Do not put SQL query strings here unless a future shared helper requires it.
"""

import os
from datetime import date, datetime
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row


def db_conn():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        row_factory=dict_row,
    )


def json_safe(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    return value


def rows_to_json(rows):
    return [
        {key: json_safe(value) for key, value in row.items()}
        for row in rows
    ]
