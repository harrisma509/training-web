from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from health_api.handlers.weight import LOCAL_TZ, parse_timestamp, pick_numeric

SUPPORTED_VO2_METRICS = {"vo2_max"}


@dataclass
class VO2Record:
    week_start: date
    measured_at: datetime
    vo2max: Decimal
    source: str | None


def build_vo2_rows(metrics: list[dict]) -> list[VO2Record]:
    by_week: dict[date, list[tuple[datetime, Decimal, str | None]]] = {}

    for metric in metrics:
        for record in metric.get("data", []):
            if not isinstance(record, dict):
                continue
            timestamp = parse_timestamp(record)
            value = pick_numeric(record)
            if timestamp is None or value is None or value <= 0:
                continue

            local_timestamp = timestamp.astimezone(LOCAL_TZ)
            period_date = local_timestamp.date()
            canonical_week_start = period_date - timedelta(days=period_date.weekday())
            by_week.setdefault(canonical_week_start, []).append(
                (local_timestamp, value, record.get("source"))
            )

    rows = []
    for week_start in sorted(by_week):
        measurements = by_week[week_start]
        average = sum(value for _, value, _ in measurements) / len(measurements)
        vo2max = average.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        measured_at, _, source = max(measurements, key=lambda item: item[0])
        rows.append(VO2Record(week_start, measured_at, vo2max, source))

    return rows
