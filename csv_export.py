"""Shared, feature-agnostic CSV serialization and attachment responses."""

import csv
import io
import math
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from fastapi.responses import Response


_SAFE_FILENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\.[cC][sS][vV]")
_FORMULA_PREFIXES = frozenset("=+-@")


@dataclass(frozen=True)
class CsvColumn:
    """A stable output header and the corresponding row-mapping key."""

    key: str
    header: str


def _safe_text(value: str) -> str:
    index = 0
    while index < len(value):
        character = value[index]
        if not character.isspace() and not unicodedata.category(character).startswith("C"):
            break
        index += 1
    if index < len(value) and value[index] in _FORMULA_PREFIXES:
        return "'" + value
    return value


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        return _safe_text(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Non-finite numeric values cannot be exported.")
        return "0" if value == 0 else str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Non-finite numeric values cannot be exported.")
        return "0" if value == 0 else repr(value)
    raise TypeError(f"Unsupported CSV cell type: {type(value).__name__}.")


def validate_csv_filename(filename: str) -> str:
    """Accept only a safe ASCII basename with a CSV extension."""
    if not isinstance(filename, str) or not filename.isascii() or not _SAFE_FILENAME.fullmatch(filename):
        raise ValueError("filename must be a safe CSV basename.")
    return filename


def serialize_csv(
    columns: Sequence[CsvColumn],
    rows: Iterable[Mapping[str, object]],
) -> bytes:
    """Serialize ordered columns and rows as BOM-prefixed UTF-8 CSV.

    Text fields that could be interpreted as spreadsheet formulas receive a
    leading apostrophe. The original text, including leading whitespace and
    control characters, remains unchanged after that prefix.
    """
    if (
        not isinstance(columns, Sequence)
        or isinstance(columns, (str, bytes))
        or not columns
        or any(
            not isinstance(column, CsvColumn)
            or not isinstance(column.key, str)
            or not isinstance(column.header, str)
            for column in columns
        )
    ):
        raise ValueError("CSV columns must be a non-empty sequence of CsvColumn values.")

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(_safe_text(column.header) for column in columns)

    for row in rows:
        if not isinstance(row, Mapping):
            raise TypeError("CSV rows must be mappings.")
        writer.writerow(_cell_text(row.get(column.key)) for column in columns)

    return output.getvalue().encode("utf-8-sig")


def csv_response(
    columns: Sequence[CsvColumn],
    rows: Iterable[Mapping[str, object]],
    filename: str,
) -> Response:
    """Create an in-memory downloadable CSV response with safe headers."""
    safe_filename = validate_csv_filename(filename)
    return Response(
        content=serialize_csv(columns, rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )
