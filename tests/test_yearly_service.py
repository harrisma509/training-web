import unittest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

import services.yearly_service as yearly_service


class YearlyDataRecordTests(unittest.TestCase):
    def _get_yearly_data(self, annual_rows, monthly_rows=None):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [annual_rows, monthly_rows or []]

        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        connection = MagicMock()
        connection.cursor.return_value = cursor_context
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection

        with (
            patch.object(yearly_service, "db_conn", return_value=connection_context),
            patch.object(yearly_service, "rows_to_json", side_effect=lambda rows: rows),
            patch.object(yearly_service, "datetime") as datetime_mock,
        ):
            datetime_mock.now.return_value = datetime(2026, 10, 28, tzinfo=timezone.utc)
            return yearly_service.get_yearly_data()

    @staticmethod
    def _annual_row(year, is_ytd, **values):
        row = {
            "calendar_year": year,
            **{metric: None for metric in yearly_service.ANNUAL_RECORD_METRICS},
            "is_ytd": is_ytd,
            "through_date": "2026-10-28" if is_ytd else None,
        }
        row.update(values)
        return row

    def test_ytd_values_compete_for_all_annual_records_including_decimal_totals(self):
        ytd_values = {
            metric: Decimal("100")
            for metric in yearly_service.ANNUAL_RECORD_METRICS
        }
        completed_values = {
            metric: Decimal("50")
            for metric in yearly_service.ANNUAL_RECORD_METRICS
        }
        older_values = {
            metric: Decimal("25")
            for metric in yearly_service.ANNUAL_RECORD_METRICS
        }
        ytd_values["bike_elevation_ft"] = Decimal("555044")
        completed_values["bike_elevation_ft"] = Decimal("553685")
        older_values["bike_elevation_ft"] = Decimal("389650")
        rows = [
            self._annual_row(2026, True, **ytd_values),
            self._annual_row(2025, False, **completed_values),
            self._annual_row(2024, False, **older_values),
        ]

        payload = self._get_yearly_data(rows)
        ytd, completed, older = payload["annual_metrics"]

        self.assertEqual(
            [row["calendar_year"] for row in payload["annual_metrics"]],
            [2026, 2025, 2024],
        )
        for metric in yearly_service.ANNUAL_RECORD_METRICS:
            with self.subTest(metric=metric):
                self.assertTrue(ytd[f"{metric}_record"])
                self.assertFalse(completed[f"{metric}_record"])
                self.assertFalse(older[f"{metric}_record"])
        self.assertTrue(ytd["bike_elevation_ft_record"])
        self.assertFalse(completed["bike_elevation_ft_record"])

        expected_fields = set(rows[0]) | {
            f"{metric}_record" for metric in yearly_service.ANNUAL_RECORD_METRICS
        }
        self.assertEqual(set(ytd), expected_fields)
        self.assertEqual(set(payload), {"annual_metrics", "monthly_hours"})

    def test_ytd_below_maximum_and_null_values_are_not_records(self):
        payload = self._get_yearly_data(
            [
                self._annual_row(2026, True, training_hours=Decimal("9")),
                self._annual_row(2025, False, training_hours=Decimal("10")),
                self._annual_row(2024, False, training_hours=None),
            ]
        )

        ytd, completed, null_row = payload["annual_metrics"]
        self.assertFalse(ytd["training_hours_record"])
        self.assertTrue(completed["training_hours_record"])
        self.assertFalse(null_row["training_hours_record"])

    def test_ytd_tie_retains_trophies_on_all_tied_rows(self):
        payload = self._get_yearly_data(
            [
                self._annual_row(2026, True, ski_days=Decimal("20")),
                self._annual_row(2025, False, ski_days=Decimal("20")),
                self._annual_row(2024, False, ski_days=Decimal("19")),
            ]
        )

        ytd, completed, older = payload["annual_metrics"]
        self.assertTrue(ytd["ski_days_record"])
        self.assertTrue(completed["ski_days_record"])
        self.assertFalse(older["ski_days_record"])

    def test_only_valid_ytd_row_is_its_metric_record(self):
        payload = self._get_yearly_data(
            [self._annual_row(2026, True, ride_count=Decimal("12"))]
        )

        row = payload["annual_metrics"][0]
        self.assertTrue(row["ride_count_record"])
        self.assertFalse(row["training_hours_record"])

    def test_incomplete_month_stays_ineligible_and_future_months_are_suppressed(self):
        payload = self._get_yearly_data(
            [
                self._annual_row(2026, True),
                self._annual_row(2025, False),
            ],
            [
                {"calendar_year": 2026, "calendar_month": 9, "training_hours": 5},
                {"calendar_year": 2025, "calendar_month": 9, "training_hours": 5},
                {"calendar_year": 2026, "calendar_month": 10, "training_hours": 100},
                {"calendar_year": 2025, "calendar_month": 10, "training_hours": 10},
                {"calendar_year": 2026, "calendar_month": 11, "training_hours": 200},
            ],
        )

        monthly_by_year = {
            row["calendar_year"]: row for row in payload["monthly_hours"]
        }
        self.assertTrue(monthly_by_year[2026]["sep_record"])
        self.assertTrue(monthly_by_year[2025]["sep_record"])
        self.assertFalse(monthly_by_year[2026]["oct_record"])
        self.assertTrue(monthly_by_year[2025]["oct_record"])
        self.assertIsNone(monthly_by_year[2026]["nov"])
        self.assertFalse(monthly_by_year[2026]["nov_record"])


if __name__ == "__main__":
    unittest.main()
