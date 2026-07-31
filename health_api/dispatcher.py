"""Dispatch incoming Health Auto Export metrics to metric handlers.

This module is named ``dispatcher`` because it dispatches metrics by name,
not by URL. It keeps webhook dispatch separate from FastAPI request and
response handling in ``routes.py``.
"""

from health_api.handlers.weight import SUPPORTED_WEIGHT_METRICS, WeightRecord, build_weight_rows


def route_metrics(metrics: list[dict]) -> tuple[list[dict], list[WeightRecord], list[str]]:
    weight_metrics = []
    warnings = []

    for metric in metrics:
        name = str(metric.get("name", "")).lower()
        if name in SUPPORTED_WEIGHT_METRICS:
            weight_metrics.append(metric)
        else:
            warnings.append(f"ignored unsupported metric: {name or '<missing name>'}")

    rows = build_weight_rows(weight_metrics)
    if weight_metrics:
        handlers_run = ["weight"]
    else:
        handlers_run = []
    return rows, handlers_run, warnings