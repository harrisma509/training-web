import csv
import io
import json
import unittest
from datetime import date
from unittest.mock import patch

from fastapi.responses import JSONResponse, Response

from routes.zones import (
    ZONES_EXPORT_COLUMNS,
    api_zones,
    export_zones,
    router,
)


EXPECTED_HEADERS = [
    "week_start",
    "ride_time_hhmm",
    "zone_flag",
    "z1_z2_pct",
    "z3_pct",
    "z4_z5_pct",
    "z1_hhmm",
    "z2_hhmm",
    "z3_hhmm",
    "z4_hhmm",
    "z5_hhmm",
    "ride_count",
]


def zone_row(week_start, **updates):
    row = {
        "week_start": week_start,
        "ride_time_hhmm": "04:30",
        "zone_flag": "On target",
        "z1_z2_pct": 75.5,
        "z3_pct": 10,
        "z4_z5_pct": 0,
        "z1_hhmm": "03:00",
        "z2_hhmm": "01:30",
        "z3_hhmm": "00:00",
        "z4_hhmm": None,
        "z5_hhmm": "00:00",
        "ride_count": 2,
    }
    row.update(updates)
    return row


def csv_records(response):
    return list(csv.reader(io.StringIO(response.body.decode("utf-8-sig"), newline="")))


class ZonesExportTests(unittest.TestCase):
    def test_route_uses_the_exact_allowlist_and_visible_newest_first_rows(self):
        route = next(
            route
            for route in router.routes
            if getattr(route, "path", None) == "/api/zones/export"
        )
        self.assertEqual(route.methods, {"POST"})
        self.assertEqual([column.header for column in ZONES_EXPORT_COLUMNS], EXPECTED_HEADERS)

        rows = [
            zone_row("2026-10-05", z1_z2_pct=0, z4_hhmm=None),
            zone_row("2026-09-28", ride_count=0, zone_flag="=HYPERLINK(\"bad\")"),
        ]
        response = export_zones({"limit": 26, "rows": rows})

        self.assertIsInstance(response, Response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(
            response.headers["content-disposition"],
            'attachment; filename="training-zones.csv"',
        )
        self.assertTrue(response.body.startswith(b"\xef\xbb\xbf"))
        records = csv_records(response)
        self.assertEqual(records[0], EXPECTED_HEADERS)
        self.assertEqual([row[0] for row in records[1:]], ["2026-10-05", "2026-09-28"])
        self.assertEqual(records[1][3], "0")
        self.assertEqual(records[1][9], "")
        self.assertEqual(records[2][11], "0")
        self.assertEqual(records[2][2], "'=HYPERLINK(\"bad\")")
        self.assertNotIn("week_end", records[0])

    def test_invalid_state_rows_and_oversized_or_arbitrary_payloads_are_rejected(self):
        valid = zone_row("2026-10-05")
        invalid_payloads = [
            {"limit": 26, "rows": [valid], "filename": "arbitrary.csv"},
            {"limit": 27, "rows": [valid]},
            {"limit": 26, "rows": []},
            {"limit": 26, "rows": [{**valid, "html": "<tr>"}]},
            {"limit": 26, "rows": [{**valid, "week_start": "<td>hidden</td>"}]},
            {"limit": 26, "rows": [{**valid, "z3_pct": "10"}]},
            {"limit": 26, "rows": [{**valid, "ride_count": True}]},
            {"limit": 26, "rows": [valid, zone_row("2026-10-05")]},
            {"limit": 26, "rows": [zone_row("2026-09-28"), valid]},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = export_zones(payload)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.headers["content-type"], "application/json")

        oversized_rows = [zone_row(f"2026-10-{(index % 28) + 1:02d}") for index in range(27)]
        response = export_zones({"limit": 26, "rows": oversized_rows})
        self.assertEqual(response.status_code, 422)

    def test_display_query_remains_canonical_and_serialization_failure_is_bounded(self):
        class Cursor:
            def __init__(self):
                self.executed = None

            def execute(self, sql, params):
                self.executed = (sql, params)

            def fetchall(self):
                return [{"week_start": date(2026, 10, 5)}]

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        class Connection:
            def __init__(self, cursor):
                self.cursor_value = cursor

            def cursor(self):
                return self.cursor_value

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        cursor = Cursor()
        with patch("routes.zones.db_conn", return_value=Connection(cursor)):
            response = api_zones(limit=60)
        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(json.loads(response.body), [{"week_start": "2026-10-05"}])
        self.assertEqual(cursor.executed[1], (60,))
        self.assertIn("order by week_start desc", cursor.executed[0].lower())

        with patch("routes.zones.csv_response", side_effect=TypeError("unsupported")):
            response = export_zones({"limit": 26, "rows": [zone_row("2026-10-05")]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.body), {"detail": "Zones export is temporarily unavailable."})


if __name__ == "__main__":
    unittest.main()
