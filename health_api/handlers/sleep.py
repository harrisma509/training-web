from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from health_api.handlers.sleep_scoring import score_sleep
from health_api.handlers.weight import LOCAL_TZ, parse_timestamp

SUPPORTED_SLEEP_METRICS = {"sleep_analysis"}
SLEEP_FIELDS = {
    "deep": "deep_sleep_hr",
    "core": "core_sleep_hr",
    "rem": "rem_sleep_hr",
    "awake": "awake_hr",
    "totalSleep": "total_sleep_hr",
    "asleep": "asleep_hr",
    "inBed": "in_bed_hr",
}


@dataclass
class SleepRecord:
    date: date
    sleep_start: datetime | None
    sleep_end: datetime | None
    in_bed_start: datetime | None
    in_bed_end: datetime | None
    values: dict[str, Decimal]
    source: str | None
    score: dict[str, int | str] | None = None


def _parse_value(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError):
        return None


def _parse_field_timestamp(record: dict, key: str) -> datetime | None:
    value = record.get(key)
    if not value:
        return None
    return parse_timestamp({"date": value})


def _record_date(record: dict) -> date | None:
    timestamp = parse_timestamp(record)
    return timestamp.astimezone(LOCAL_TZ).date() if timestamp else None


def _build_record(record: dict) -> SleepRecord | None:
    day = _record_date(record)
    if day is None:
        return None
    values = {
        field: parsed
        for source, field in SLEEP_FIELDS.items()
        if (parsed := _parse_value(record.get(source))) is not None
    }
    return SleepRecord(
        date=day,
        sleep_start=_parse_field_timestamp(record, "sleepStart"),
        sleep_end=_parse_field_timestamp(record, "sleepEnd"),
        in_bed_start=_parse_field_timestamp(record, "inBedStart"),
        in_bed_end=_parse_field_timestamp(record, "inBedEnd"),
        values=values,
        source=str(record["source"]) if record.get("source") is not None else None,
    )


def build_sleep_rows(metrics: list[dict]) -> list[SleepRecord]:
    by_date: dict[date, SleepRecord] = {}
    for metric in metrics:
        for raw_record in metric.get("data", []):
            if not isinstance(raw_record, dict):
                continue
            record = _build_record(raw_record)
            if record is None:
                continue
            current = by_date.get(record.date)
            current_end = current.sleep_end if current else None
            if current is None or (record.sleep_end or datetime.min) >= (current_end or datetime.min):
                by_date[record.date] = record
    return [by_date[day] for day in sorted(by_date)]


__all__ = ["SleepRecord", "SUPPORTED_SLEEP_METRICS", "build_sleep_rows", "score_sleep"]
