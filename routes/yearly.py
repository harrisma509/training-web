"""Yearly route module.

Thin HTTP layer for Yearly dashboard endpoints.
"""

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from services.yearly_service import (
    _calculate_year_preview,
    _json_safe_payload,
    calculate_year,
    get_yearly_commentary,
    get_yearly_data,
    validate_year_calculation_input,
)

router = APIRouter()


@router.get("/api/yearly")
def api_yearly():
    payload = get_yearly_data()
    return JSONResponse(payload)


@router.get("/api/yearly/commentary/{calendar_year}")
def api_yearly_commentary(calendar_year: int):
    payload = get_yearly_commentary(calendar_year)
    if payload is None:
        return JSONResponse({"detail": f"No commentary exists for year {calendar_year}."}, status_code=404)
    return JSONResponse(payload)


@router.post("/api/yearly/calculate/preview")
def api_yearly_calculate_preview(payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object with a calendar_year value."}, status_code=400)

    raw_year = payload.get("calendar_year")
    try:
        calendar_year = int(raw_year)
    except (TypeError, ValueError):
        return JSONResponse({"detail": "calendar_year must be a valid integer."}, status_code=400)

    try:
        validate_year_calculation_input(calendar_year)
    except ValueError as exc:
        detail = str(exc)
        if calendar_year == 2012:
            return JSONResponse({"detail": "2012 is reserved for historical workbook import and cannot be previewed."}, status_code=400)
        return JSONResponse({"detail": detail}, status_code=400)

    preview = _calculate_year_preview(calendar_year)
    preview.pop("_month_date_ranges", None)
    return JSONResponse(_json_safe_payload(preview))


@router.post("/api/yearly/calculate")
def api_yearly_calculate(payload: dict | None = Body(default=None)):
    if payload is None or not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object with a calendar_year value."}, status_code=400)

    raw_year = payload.get("calendar_year")
    try:
        calendar_year = int(raw_year)
    except (TypeError, ValueError):
        return JSONResponse({"detail": "calendar_year must be a valid integer."}, status_code=400)

    try:
        validate_year_calculation_input(calendar_year)
    except ValueError as exc:
        detail = str(exc)
        if calendar_year == 2012:
            return JSONResponse({"detail": "2012 is reserved for historical workbook import and cannot be calculated."}, status_code=400)
        return JSONResponse({"detail": detail}, status_code=400)

    try:
        result = calculate_year(calendar_year)
    except ValueError as exc:
        return JSONResponse({"detail": str(exc)}, status_code=400)
    return JSONResponse(result)
