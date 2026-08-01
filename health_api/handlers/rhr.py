from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from health_api.handlers.weight import LOCAL_TZ, parse_timestamp, pick_numeric

SUPPORTED_RHR_METRICS = {"resting_heart_rate"}


@dataclass
class RHRRecord:
    date: date
    measured_at: datetime
    rhr_bpm: int
    source: str | None


def build_rhr_rows(metrics: list[dict]) -> list[RHRRecord]:
    by_date: dict[date, list[tuple[datetime, Decimal, str | None]]] = {}

    for metric in metrics:
        for record in metric.get("data", []):
            if not isinstance(record, dict):
                continue
            timestamp = parse_timestamp(record)
            value = pick_numeric(record)
            if timestamp is None or value is None or value <= 0:
                continue

            local_timestamp = timestamp.astimezone(LOCAL_TZ)
            by_date.setdefault(local_timestamp.date(), []).append(
                (local_timestamp, value, record.get("source"))
            )

    rows = []
    for day in sorted(by_date):
        measurements = by_date[day]
        average = sum(value for _, value, _ in measurements) / len(measurements)
        measured_at, _, source = max(measurements, key=lambda item: item[0])
        rhr_bpm = int(average.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if rhr_bpm <= 0:
            continue
        rows.append(RHRRecord(day, measured_at, rhr_bpm, source))

    return rows
