from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from health_api.handlers.weight import LOCAL_TZ, parse_timestamp, pick_numeric

SUPPORTED_HRV_METRICS = {
    "hrv_sdnn",
    "heart_rate_variability_sdnn",
    "heart_rate_variability",
    "sdnn",
    "hrv",
}
LOOKBACK_MINUTES = (60, 90, 120, 180, 240)
BIAS_LAST_MINUTES = 30
PHYS_MIN_MS = Decimal("5")
PHYS_MAX_MS = Decimal("120")
MAD_MULT = Decimal("4")


@dataclass
class HRVRecord:
    date: date
    measured_at: datetime
    hrv_sdnn_ms: Decimal
    source: str | None
    sample_timestamp: datetime
    mins_before_wake: int | None
    rule: str
    proximity_level: str


def _parse_hrv_timestamp(record: dict) -> datetime | None:
    for key in ("timestamp", "date", "start", "end"):
        value = record.get(key)
        if value:
            timestamp = parse_timestamp({"date": value})
            if timestamp is not None:
                return timestamp
    return None


def _median(values: list[Decimal]) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _filter_points(points: list[tuple[datetime, Decimal, dict]]) -> list[tuple[datetime, Decimal, dict]]:
    plausible = [point for point in points if PHYS_MIN_MS <= point[1] <= PHYS_MAX_MS]
    if not plausible:
        return []
    values = [point[1] for point in plausible]
    median = _median(values)
    deviations = [abs(value - median) for value in values]
    mad = _median(deviations) or Decimal("1")
    multiplier = MAD_MULT if len(values) >= 5 else max(MAD_MULT, Decimal("8"))
    low = median - multiplier * mad
    high = median + multiplier * mad
    return [point for point in plausible if low <= point[1] <= high]


def _local_midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=LOCAL_TZ)


def _windows(day: date, sleep_end: datetime | None) -> list[tuple[datetime, datetime, str]]:
    midnight = _local_midnight(day)
    if sleep_end is not None:
        windows = [
            (sleep_end - timedelta(minutes=minutes), sleep_end, f"anchored_{minutes}m")
            for minutes in LOOKBACK_MINUTES
        ]
        windows.append((midnight, sleep_end, "00:00-to-sleepEnd"))
        clock_start = datetime.combine(day, time(3, 30), tzinfo=LOCAL_TZ)
        clock_end = min(datetime.combine(day, time(6, 30), tzinfo=LOCAL_TZ), sleep_end)
        windows.append((clock_start, clock_end, "clock_03:30-06:30"))
        return windows

    clock_start = datetime.combine(day, time(3, 30), tzinfo=LOCAL_TZ)
    clock_end = datetime.combine(day, time(6, 30), tzinfo=LOCAL_TZ)
    return [(clock_start, clock_end, "clock_03:30-06:30"), (midnight, clock_end, "midnight_fallback")]


def _proximity_level(rule: str) -> str:
    for minutes in LOOKBACK_MINUTES:
        if rule.startswith(f"anchored_{minutes}m"):
            return f"P{minutes}"
    return "OTHER"


def build_hrv_rows(metrics: list[dict], sleep_ends: dict[date, datetime]) -> list[HRVRecord]:
    grouped: dict[date, list[tuple[datetime, Decimal, dict]]] = {}
    for metric in metrics:
        for raw_record in metric.get("data", []):
            if not isinstance(raw_record, dict):
                continue
            timestamp = _parse_hrv_timestamp(raw_record)
            value = pick_numeric(raw_record)
            if timestamp is None or value is None:
                continue
            local_timestamp = timestamp.astimezone(LOCAL_TZ)
            grouped.setdefault(local_timestamp.date(), []).append(
                (local_timestamp, value, raw_record)
            )

    rows = []
    for day in sorted(grouped):
        cleaned = _filter_points(grouped[day])
        if not cleaned:
            continue
        sleep_end = sleep_ends.get(day)
        picked = None
        rule = ""
        for start, end, label in _windows(day, sleep_end):
            candidates = [point for point in cleaned if start <= point[0] <= end and (sleep_end is None or point[0] <= sleep_end)]
            if not candidates:
                continue
            bias_start = end - timedelta(minutes=BIAS_LAST_MINUTES)
            near_wake = [point for point in candidates if bias_start <= point[0] <= end]
            if near_wake:
                candidates = near_wake
                rule = f"{label}:bias{BIAS_LAST_MINUTES}:median"
            else:
                rule = f"{label}:median"
            median = _median([point[1] for point in candidates])
            picked = min(candidates, key=lambda point: (abs(point[1] - median), -point[0].timestamp()))
            break
        if picked is None:
            median = _median([point[1] for point in cleaned])
            picked = min(cleaned, key=lambda point: (abs(point[1] - median), -point[0].timestamp()))
            rule = "overall_daily_median"

        sample_timestamp, value, raw_record = picked
        mins_before_wake = None
        if sleep_end is not None:
            mins_before_wake = max(0, round((sleep_end - sample_timestamp).total_seconds() / 60))
        rows.append(
            HRVRecord(
                date=day,
                measured_at=max(point[0] for point in grouped[day]),
                hrv_sdnn_ms=value,
                source=str(raw_record["source"]) if raw_record.get("source") is not None else None,
                sample_timestamp=sample_timestamp,
                mins_before_wake=mins_before_wake,
                rule=rule,
                proximity_level=_proximity_level(rule),
            )
        )
    return rows
