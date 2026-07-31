from fastapi import APIRouter, HTTPException, Request

from health_api.auth import validate_token
from health_api.db.writer import upsert_weight
from health_api.router import route_metrics

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
    rows, handlers_run, warnings = route_metrics(valid_metrics)
    rows_upserted = upsert_weight(rows)

    return {
        "status": "ok",
        "metrics_received": len(metrics),
        "handlers_run": handlers_run,
        "rows_upserted": rows_upserted,
        "warnings": warnings,
    }
