"""Define the FastAPI routes for the Health Auto Export API.

This module is named ``routes`` because it owns the HTTP endpoint paths,
request validation, authentication errors, and response formatting. Metric
dispatch belongs to ``dispatcher.py`` so the HTTP boundary stays independent
of the supported health metric families.
"""

from fastapi import APIRouter, HTTPException, Request

from health_api.auth import validate_token
from health_api.db.falls_writer import upsert_falls
from health_api.db.rhr_writer import upsert_rhr
from health_api.db.hrv_writer import upsert_hrv
from health_api.db.sleep_writer import upsert_sleep
from health_api.db.steps_writer import upsert_steps
from health_api.db.weight_writer import upsert_weight
from health_api.db.vo2_writer import upsert_vo2
from health_api.dispatcher import route_metrics

router = APIRouter(prefix="/api/health")


@router.post("/ingest")
async def ingest(request: Request):
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid JSON payload") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="request body must be a JSON object")

    if not validate_token(payload.get("authToken"), request.query_params.get("token")):
        raise HTTPException(status_code=401, detail="invalid token")

    data = payload.get("data")
    metrics = data.get("metrics") if isinstance(data, dict) else None
    if not isinstance(metrics, list):
        raise HTTPException(status_code=400, detail="payload must contain data.metrics")

    valid_metrics = [metric for metric in metrics if isinstance(metric, dict)]
    weight_rows, rhr_rows, steps_rows, sleep_rows, hrv_metrics, vo2_rows, falls_rows, handlers_run, warnings = route_metrics(valid_metrics)
    rows_upserted = (
        upsert_weight(weight_rows)
        + upsert_rhr(rhr_rows)
        + upsert_steps(steps_rows)
        + upsert_sleep(sleep_rows)
        + upsert_hrv(hrv_metrics)
        + upsert_vo2(vo2_rows)
        + upsert_falls(falls_rows)
    )

    return {
        "status": "ok",
        "metrics_received": len(metrics),
        "handlers_run": handlers_run,
        "rows_upserted": rows_upserted,
        "warnings": warnings,
    }
