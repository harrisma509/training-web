from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from health_api.handlers.weight import LOCAL_TZ, parse_timestamp, pick_numeric

SUPPORTED_FALLS_METRICS = {
    "number_of_times_fallen",
    "numberoftimesfallen",
    "falls",
    "fall_detection",
    "fall",
    "hard_fall",
}


@dataclass
class FallsRecord:
    date: date
    measured_at: datetime
    falls: int
    source: str | None


def build_falls_rows(metrics: list[dict]) -> list[FallsRecord]:
    by_date: dict[date, list[tuple[datetime, Decimal, str | None]]] = {}

    for metric in metrics:
        for record in metric.get("data", []):
            if not isinstance(record, dict):
                continue
            timestamp = parse_timestamp(record)
            value = pick_numeric(record)
            if timestamp is None or value is None or value < 0:
                continue

            local_timestamp = timestamp.astimezone(LOCAL_TZ)
            by_date.setdefault(local_timestamp.date(), []).append(
                (local_timestamp, value, record.get("source"))
            )

    rows = []
    for day in sorted(by_date):
        measurements = by_date[day]
        measured_at, _, source = max(measurements, key=lambda item: item[0])
        total_falls = int(sum(value for _, value, _ in measurements).to_integral_value())
        rows.append(FallsRecord(day, measured_at, total_falls, source))

    return rows
