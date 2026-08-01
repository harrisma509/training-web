"""Dispatch incoming Health Auto Export metrics to metric handlers.

This module is named ``dispatcher`` because it dispatches metrics by name,
not by URL. It keeps webhook dispatch separate from FastAPI request and
response handling in ``routes.py``.

Supported metric families are Weight, resting heart rate (RHR), Steps, Sleep,
heart-rate variability (HRV), weekly VO2 Max, and Falls. Each family is routed to its own handler and
from health_api.handlers.falls import FallsRecord, SUPPORTED_FALLS_METRICS, build_falls_rows
database writer so its date grouping and aggregation rules remain isolated.
"""

from health_api.handlers.rhr import SUPPORTED_RHR_METRICS, RHRRecord, build_rhr_rows
from health_api.handlers.hrv import SUPPORTED_HRV_METRICS
from health_api.handlers.falls import FallsRecord, SUPPORTED_FALLS_METRICS, build_falls_rows
from health_api.handlers.sleep import SUPPORTED_SLEEP_METRICS, SleepRecord, build_sleep_rows
from health_api.handlers.steps import SUPPORTED_STEPS_METRICS, StepsRecord, build_steps_rows
from health_api.handlers.vo2 import SUPPORTED_VO2_METRICS, VO2Record, build_vo2_rows
from health_api.handlers.weight import SUPPORTED_WEIGHT_METRICS, WeightRecord, build_weight_rows


def route_metrics(
    metrics: list[dict],
) -> tuple[
    list[WeightRecord],
    list[RHRRecord],
    list[StepsRecord],
    list[SleepRecord],
    list[dict],
    list[VO2Record],
    list[FallsRecord],
    list[str],
    list[str],
]:
    weight_metrics = []
    rhr_metrics = []
    steps_metrics = []
    sleep_metrics = []
    hrv_metrics = []
    vo2_metrics = []
    falls_metrics = []
    warnings = []

    for metric in metrics:
        name = str(metric.get("name", "")).lower()
        if name in SUPPORTED_WEIGHT_METRICS:
            weight_metrics.append(metric)
        elif name in SUPPORTED_RHR_METRICS:
            rhr_metrics.append(metric)
        elif name in SUPPORTED_STEPS_METRICS:
            steps_metrics.append(metric)
        elif name in SUPPORTED_SLEEP_METRICS:
            sleep_metrics.append(metric)
        elif name in SUPPORTED_HRV_METRICS:
            hrv_metrics.append(metric)
        elif name in SUPPORTED_VO2_METRICS:
            vo2_metrics.append(metric)
        elif name in SUPPORTED_FALLS_METRICS:
            falls_metrics.append(metric)
        else:
            warnings.append(f"ignored unsupported metric: {name or '<missing name>'}")

    weight_rows = build_weight_rows(weight_metrics)
    rhr_rows = build_rhr_rows(rhr_metrics)
    steps_rows = build_steps_rows(steps_metrics)
    sleep_rows = build_sleep_rows(sleep_metrics)
    handlers_run = []
    if weight_metrics:
        handlers_run.append("weight")
    if rhr_metrics:
        handlers_run.append("rhr")
    if steps_metrics:
        handlers_run.append("steps")
    if sleep_metrics:
        handlers_run.append("sleep")
    if hrv_metrics:
        handlers_run.append("hrv")
    vo2_rows = build_vo2_rows(vo2_metrics)
    if vo2_metrics:
        handlers_run.append("vo2")
    falls_rows = build_falls_rows(falls_metrics)
    if falls_metrics:
        handlers_run.append("falls")
    return weight_rows, rhr_rows, steps_rows, sleep_rows, hrv_metrics, vo2_rows, falls_rows, handlers_run, warnings