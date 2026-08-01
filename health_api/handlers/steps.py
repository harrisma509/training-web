from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from health_api.handlers.weight import LOCAL_TZ, parse_timestamp, pick_numeric

SUPPORTED_STEPS_METRICS = {"step_count"}


@dataclass
class StepsRecord:
    date: date
    measured_at: datetime
    steps: int
    source: str | None


def build_steps_rows(metrics: list[dict]) -> list[StepsRecord]:
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
        total_steps = sum(value for _, value, _ in measurements)
        measured_at, _, source = max(measurements, key=lambda item: item[0])
        rows.append(StepsRecord(day, measured_at, int(total_steps), source))

    return rows