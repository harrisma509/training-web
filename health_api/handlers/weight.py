from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("America/Denver")
SUPPORTED_WEIGHT_METRICS = {
    "weight_body_mass": "weight_lb",
    "body_fat_percentage": "body_fat_pct",
    "lean_body_mass": "lean_body_mass_lb",
    "body_mass_index": "bmi",
}
NUMERIC_KEYS = ("qty", "value", "avg", "average", "mean", "last", "latest", "median", "min", "max")


@dataclass
class WeightRecord:
    date: datetime.date
    measured_at: datetime
    values: dict[str, Decimal]
    source: str | None


def pick_numeric(record: dict) -> Decimal | None:
    for key in NUMERIC_KEYS:
        value = record.get(key)
        if value is None or value == "":
            continue
        try:
            return Decimal(str(value))
        except (ArithmeticError, ValueError):
            continue
    return None


def parse_timestamp(record: dict) -> datetime | None:
    for key in ("date", "start", "end"):
        value = record.get(key)
        if not value:
            continue
        try:
            timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            continue
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=LOCAL_TZ)
        return timestamp
    return None


def build_weight_rows(metrics: list[dict]) -> list[WeightRecord]:
    by_date: dict[datetime.date, WeightRecord] = {}

    for metric in metrics:
        field = SUPPORTED_WEIGHT_METRICS[metric.get("name", "").lower()]
        for record in metric.get("data", []):
            if not isinstance(record, dict):
                continue
            timestamp = parse_timestamp(record)
            value = pick_numeric(record)
            if timestamp is None or value is None:
                continue

            local_timestamp = timestamp.astimezone(LOCAL_TZ)
            day = local_timestamp.date()
            current = by_date.get(day)
            if current is None:
                current = WeightRecord(day, local_timestamp, {}, record.get("source"))
                by_date[day] = current

            if local_timestamp >= current.measured_at:
                current.measured_at = local_timestamp
                if record.get("source") is not None:
                    current.source = str(record["source"])

            existing_field = current.values.get(field)
            field_timestamp_key = f"_{field}_timestamp"
            previous_timestamp = getattr(current, field_timestamp_key, None)
            if existing_field is None or previous_timestamp is None or local_timestamp >= previous_timestamp:
                current.values[field] = value
                setattr(current, field_timestamp_key, local_timestamp)

    return [by_date[day] for day in sorted(by_date)]
