from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("America/Denver")

SCORE_VERSION = "v2.0.0"
SLEEP_GOAL_MINUTES = 8 * 60
DURATION_FULL_CREDIT_WINDOW_MINUTES = 15
AWAKE_FREE_MINUTES = 8


def _round_minutes(seconds: int) -> int:
    return (seconds + 30) // 60


def _parse_bedtime(value: datetime | None) -> int | None:
    if value is None:
        return None
    local = value.astimezone(LOCAL_TZ) if value.tzinfo else value.replace(tzinfo=LOCAL_TZ)
    minutes = local.hour * 60 + local.minute
    return minutes + 24 * 60 if local.hour <= 5 else minutes


def _median(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return int(Decimal(ordered[middle - 1] + ordered[middle]) / 2)


def _duration_points(total_sleep_hr: Decimal | None) -> int:
    if total_sleep_hr is None or total_sleep_hr <= 0:
        return 0
    asleep_seconds = int((total_sleep_hr * 3600).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    asleep_minutes = (asleep_seconds + 59) // 60
    difference = abs(asleep_minutes - SLEEP_GOAL_MINUTES)
    if difference <= DURATION_FULL_CREDIT_WINDOW_MINUTES:
        return 50
    raw = Decimal(50) * min(Decimal(1), Decimal(asleep_minutes) / SLEEP_GOAL_MINUTES)
    return min(50, max(0, int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))))


def _consistency_points(sleep_start: datetime | None, history: list[dict]) -> int:
    current_bedtime = _parse_bedtime(sleep_start)
    if current_bedtime is None:
        return 30

    prior_bedtimes = [
        bedtime
        for bedtime in (_parse_bedtime(row.get("sleep_start")) for row in history)
        if bedtime is not None
    ]
    median_bedtime = _median(prior_bedtimes)
    if median_bedtime is None:
        return 30

    difference = current_bedtime - median_bedtime
    if difference <= 15:
        return 30
    penalty = (Decimal(difference - 15) / 5).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return max(0, 30 - int(penalty))


def _interruption_points(awake_hr: Decimal | None) -> int:
    if awake_hr is None or awake_hr < 0:
        return 20
    awake_seconds = int((awake_hr * 3600).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    awake_minutes = _round_minutes(awake_seconds)
    over_minutes = max(0, awake_minutes - AWAKE_FREE_MINUTES)
    penalty = Decimal(over_minutes) * Decimal("0.25")
    penalty_points = int(penalty.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return max(0, 20 - penalty_points)


def score_sleep(record, history: list[dict]) -> dict[str, int | str]:
    duration_pts = _duration_points(record.values.get("total_sleep_hr"))
    consistency_pts = _consistency_points(record.sleep_start, history)
    interruptions_pts = _interruption_points(record.values.get("awake_hr"))
    sleep_score = duration_pts + consistency_pts + interruptions_pts
    return {
        "sleep_score": sleep_score,
        "duration_pts": duration_pts,
        "consistency_pts": consistency_pts,
        "interruptions_pts": interruptions_pts,
        "score_version": SCORE_VERSION,
    }
