import csv
import io
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from csv_export import CsvColumn, csv_response, serialize_csv, validate_csv_filename


class CsvExportTests(unittest.TestCase):
    def test_serializes_explicit_column_order_with_bom_and_crlf(self):
        body = serialize_csv(
            [CsvColumn("name", "Activity"), CsvColumn("activity_id", "ID")],
            [{"activity_id": 42, "name": "Morning ride"}],
        )

        self.assertTrue(body.startswith(b"\xef\xbb\xbf"))
        self.assertEqual(body.decode("utf-8-sig"), "Activity,ID\r\nMorning ride,42\r\n")

    def test_serializes_null_blank_zero_booleans_dates_and_timestamps(self):
        columns = [
            CsvColumn("missing", "Missing"),
            CsvColumn("none", "None"),
            CsvColumn("empty", "Empty"),
            CsvColumn("int_zero", "Integer zero"),
            CsvColumn("decimal_zero", "Decimal zero"),
            CsvColumn("float_zero", "Float zero"),
            CsvColumn("yes", "Yes"),
            CsvColumn("no", "No"),
            CsvColumn("date", "Date"),
            CsvColumn("aware", "Aware"),
            CsvColumn("naive", "Naive"),
        ]
        row = {
            "none": None,
            "empty": "",
            "int_zero": 0,
            "decimal_zero": Decimal("0.000"),
            "float_zero": 0.0,
            "yes": True,
            "no": False,
            "date": date(2026, 10, 5),
            "aware": datetime(2026, 10, 5, 12, 30, tzinfo=timezone(timedelta(hours=-6))),
            "naive": datetime(2026, 10, 5, 12, 30),
        }

        parsed = list(csv.reader(io.StringIO(
            serialize_csv(columns, [row]).decode("utf-8-sig"),
            newline="",
        )))
        self.assertEqual(parsed[0], [
            "Missing", "None", "Empty", "Integer zero", "Decimal zero",
            "Float zero", "Yes", "No", "Date", "Aware", "Naive",
        ])
        self.assertEqual(parsed[1], [
            "", "", "", "0", "0", "0", "true", "false", "2026-10-05",
            "2026-10-05T12:30:00-06:00", "2026-10-05T12:30:00",
        ])

    def test_serializes_locale_independent_numbers_and_negative_values(self):
        columns = [CsvColumn("decimal", "Decimal"), CsvColumn("float", "Float"), CsvColumn("negative", "Negative")]
        body = serialize_csv(
            columns,
            [{"decimal": Decimal("1234.50"), "float": 1234.5, "negative": -12.75}],
        ).decode("utf-8-sig")

        self.assertEqual(body, "Decimal,Float,Negative\r\n1234.50,1234.5,-12.75\r\n")

    def test_quotes_unicode_commas_quotes_and_embedded_line_endings(self):
        text = 'café, "trail"\nsecond\rthird\r\nfourth'
        body = serialize_csv([CsvColumn("text", "Text")], [{"text": text}])
        parsed = list(csv.reader(io.StringIO(body.decode("utf-8-sig"), newline="")))

        self.assertEqual(parsed, [["Text"], [text]])
        self.assertTrue(body.endswith(b"\r\n"))

    def test_neutralizes_formula_prefixes_after_whitespace_and_controls(self):
        values = ["=1+1", "+1", "-1", "@SUM(A1)", "  =1+1", "\t+1", "\r-1", "\n@1", "\x00=1"]
        columns = [CsvColumn(str(index), f"Column {index}") for index in range(len(values))]
        body = serialize_csv(columns, [dict(zip((column.key for column in columns), values))])
        rows = list(csv.reader(io.StringIO(body.decode("utf-8-sig"), newline="")))

        self.assertEqual(rows[1], ["'" + value for value in values])

    def test_does_not_neutralize_typed_negative_numbers(self):
        columns = [
            CsvColumn("integer", "Integer"),
            CsvColumn("decimal", "Decimal"),
            CsvColumn("float", "Float"),
        ]
        body = serialize_csv(
            columns,
            [{"integer": -1, "decimal": Decimal("-2.50"), "float": -0.5}],
        ).decode("utf-8-sig")

        self.assertEqual(body, "Integer,Decimal,Float\r\n-1,-2.50,-0.5\r\n")

    def test_rejects_non_finite_and_unsupported_values(self):
        with self.assertRaisesRegex(ValueError, "Non-finite"):
            serialize_csv([CsvColumn("value", "Value")], [{"value": float("nan")}])
        with self.assertRaisesRegex(ValueError, "Non-finite"):
            serialize_csv([CsvColumn("value", "Value")], [{"value": Decimal("Infinity")}])
        with self.assertRaisesRegex(TypeError, "Unsupported CSV cell type"):
            serialize_csv([CsvColumn("value", "Value")], [{"value": b"not text"}])
        with self.assertRaisesRegex(TypeError, "rows must be mappings"):
            serialize_csv([CsvColumn("value", "Value")], ["not a mapping"])

    def test_filename_validation_accepts_safe_csv_basenames(self):
        self.assertEqual(validate_csv_filename("training-search.csv"), "training-search.csv")
        self.assertEqual(validate_csv_filename("Weekly_52.CSV"), "Weekly_52.CSV")

    def test_filename_validation_rejects_paths_headers_and_unsupported_names(self):
        invalid_filenames = [
            "../training.csv",
            r"..\training.csv",
            "folder/training.csv",
            r"folder\training.csv",
            '"training.csv"',
            "training\r\nX-Evil: true.csv",
            "training\n.csv",
            "training\x00.csv",
            "K.csv",
            ".csv",
            "training.txt",
            "",
        ]
        for filename in invalid_filenames:
            with self.subTest(filename=repr(filename)):
                with self.assertRaisesRegex(ValueError, "safe CSV basename"):
                    validate_csv_filename(filename)

    def test_response_has_safe_attachment_headers_and_no_filesystem_output(self):
        columns = [CsvColumn("value", "Value")]
        with tempfile.TemporaryDirectory() as temp_dir:
            before = set(Path(temp_dir).iterdir())
            response = csv_response(columns, [{"value": "ok"}], "training-export.csv")
            after = set(Path(temp_dir).iterdir())

        self.assertEqual(response.media_type, "text/csv; charset=utf-8")
        self.assertEqual(response.headers["content-type"], "text/csv; charset=utf-8")
        self.assertEqual(response.headers["content-disposition"], 'attachment; filename="training-export.csv"')
        self.assertEqual(response.body, b"\xef\xbb\xbfValue\r\nok\r\n")
        self.assertEqual(after, before)

    def test_response_rejects_unsafe_filename_before_serializing_rows(self):
        def rows():
            raise AssertionError("Rows must not be consumed for an invalid filename.")
            yield {}

        with self.assertRaisesRegex(ValueError, "safe CSV basename"):
            csv_response([CsvColumn("value", "Value")], rows(), "bad\r\n.csv")

    def test_serializes_one_shot_iterables(self):
        rows = ({"value": value} for value in ("first", "second"))
        body = serialize_csv([CsvColumn("value", "Value")], rows)
        self.assertEqual(body.decode("utf-8-sig"), "Value\r\nfirst\r\nsecond\r\n")


if __name__ == "__main__":
    unittest.main()
