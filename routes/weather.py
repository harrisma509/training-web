"""Read-only TI Weather API."""

from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse

from services.weather_service import (
    WeatherDateError,
    WeatherLocationNotFoundError,
    WeatherUnavailableError,
    weather_service,
)


router = APIRouter()


@router.get("/api/weather/locations/{saved_location_id}/forecast")
def api_weather_forecast(saved_location_id: int = Path(..., ge=1)):
    try:
        forecast = weather_service.get_forecast(saved_location_id)
        return forecast.daily_response()
    except WeatherLocationNotFoundError:
        return JSONResponse(
            {"detail": "Saved location not found."},
            status_code=404,
        )
    except WeatherUnavailableError:
        return JSONResponse(
            {"detail": "Weather forecast is temporarily unavailable."},
            status_code=503,
        )


@router.get("/api/weather/locations/{saved_location_id}/hourly")
def api_weather_hourly(
    saved_location_id: int = Path(..., ge=1),
    requested_date: str = Query(..., alias="date"),
):
    try:
        forecast = weather_service.get_hourly_forecast(
            saved_location_id,
            requested_date,
        )
        return forecast.hourly_response(requested_date)
    except WeatherLocationNotFoundError:
        return JSONResponse(
            {"detail": "Saved location not found."},
            status_code=404,
        )
    except WeatherDateError:
        return JSONResponse(
            {"detail": WeatherDateError.detail},
            status_code=422,
        )
    except WeatherUnavailableError:
        return JSONResponse(
            {"detail": "Weather forecast is temporarily unavailable."},
            status_code=503,
        )
