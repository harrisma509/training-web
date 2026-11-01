"""Open-Meteo adapter for the TI-owned normalized Weather contract."""

from __future__ import annotations

import json
import math
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services.weather_models import (
    DailyWeather,
    HourlyWeather,
    NormalizedWeather,
    WeatherCondition,
)


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT_SECONDS = 8
DAILY_FIELDS = (
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
    "precipitation_sum",
    "snowfall_sum",
    "wind_speed_10m_max",
    "wind_direction_10m_dominant",
    "wind_gusts_10m_max",
    "sunrise",
    "sunset",
)
HOURLY_FIELDS = (
    "weather_code",
    "temperature_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "snowfall",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "is_day",
)
CONDITION_BY_CODE: dict[int, WeatherCondition] = {
    0: "clear",
    1: "partly_cloudy",
    2: "partly_cloudy",
    3: "cloudy",
    45: "fog",
    48: "fog",
    51: "rain",
    53: "rain",
    55: "rain",
    56: "rain",
    57: "rain",
    61: "rain",
    63: "rain",
    65: "rain",
    66: "rain",
    67: "rain",
    71: "snow",
    73: "snow",
    75: "snow",
    77: "snow",
    80: "rain",
    81: "rain",
    82: "rain",
    85: "snow",
    86: "snow",
    95: "storm",
    96: "storm",
    99: "storm",
}


class OpenMeteoError(RuntimeError):
    category = "provider_unavailable"


class OpenMeteoUnavailableError(OpenMeteoError):
    category = "provider_unavailable"


class OpenMeteoInvalidResponseError(OpenMeteoError):
    category = "invalid_provider_response"

    def __init__(self, category: str = "invalid_provider_response"):
        super().__init__(category)
        self.category = category


def _invalid_response(category: str = "invalid_provider_response") -> OpenMeteoInvalidResponseError:
    return OpenMeteoInvalidResponseError(category)


def _request_params(latitude: Decimal, longitude: Decimal, timezone_name: str) -> dict[str, str]:
    return {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "timezone": timezone_name,
        "forecast_days": "16",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timeformat": "iso8601",
        "daily": ",".join(DAILY_FIELDS),
        "hourly": ",".join(HOURLY_FIELDS),
    }


def _request_json(params: dict[str, str]) -> dict[str, object]:
    request = Request(
        f"{OPEN_METEO_URL}?{urlencode(params)}",
        headers={"Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response_body = response.read()
    except HTTPError:
        raise OpenMeteoUnavailableError() from None
    except (URLError, TimeoutError, OSError):
        raise OpenMeteoUnavailableError() from None

    try:
        payload = json.loads(response_body)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise _invalid_response("json_decode") from None
    if not isinstance(payload, dict):
        raise _invalid_response("json_root_shape")
    if payload.get("error"):
        raise _invalid_response("provider_error_body")
    return payload


def _validate_location_inputs(
    latitude: object,
    longitude: object,
    timezone_name: object,
) -> tuple[Decimal, Decimal, str]:
    try:
        if isinstance(latitude, bool) or isinstance(longitude, bool):
            raise ValueError
        lat = Decimal(str(latitude))
        lon = Decimal(str(longitude))
        if not lat.is_finite() or not Decimal("-90") <= lat <= Decimal("90"):
            raise ValueError
        if not lon.is_finite() or not Decimal("-180") <= lon <= Decimal("180"):
            raise ValueError
        if not isinstance(timezone_name, str):
            raise ValueError
        ZoneInfo(timezone_name)
    except (InvalidOperation, TypeError, ValueError, ZoneInfoNotFoundError):
        raise OpenMeteoInvalidResponseError() from None
    return lat, lon, timezone_name


def _array(container: object, key: str, expected_length: int) -> list[object]:
    if not isinstance(container, dict):
        raise _invalid_response(f"array_container_shape:{key}")
    values = container.get(key)
    if not isinstance(values, list) or len(values) != expected_length:
        raise _invalid_response(f"array_missing_or_misaligned:{key}")
    return values


def _number(
    value: object,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    if type(value) not in (int, float):
        raise _invalid_response("numeric_type")
    try:
        number = float(value)
    except (OverflowError, ValueError):
        raise _invalid_response("numeric_conversion") from None
    if not math.isfinite(number):
        raise _invalid_response("numeric_non_finite")
    if minimum is not None and number < minimum:
        raise _invalid_response("numeric_below_range")
    if maximum is not None and number > maximum:
        raise _invalid_response("numeric_above_range")
    return number


def _condition(value: object) -> WeatherCondition:
    if type(value) is not int:
        raise _invalid_response("weather_code_type")
    return CONDITION_BY_CODE.get(value, "unknown")


def _local_date(value: object) -> date:
    if not isinstance(value, str):
        raise _invalid_response("date_type")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise _invalid_response("date_format") from None
    if parsed.isoformat() != value:
        raise _invalid_response("date_normalization")
    return parsed


def _local_datetime(value: object) -> datetime:
    if not isinstance(value, str):
        raise _invalid_response("timestamp_type")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise _invalid_response("timestamp_format") from None


def _validate_time_order(times: list[datetime]) -> None:
    if not times:
        raise _invalid_response("timestamp_array_empty")
    awareness = times[0].tzinfo is not None
    if any((value.tzinfo is not None) != awareness for value in times):
        raise _invalid_response("timestamp_awareness_mismatch")
    if any(current <= previous for previous, current in zip(times, times[1:])):
        raise _invalid_response("timestamp_order")


def _normalize_payload(
    payload: dict[str, object],
    timezone_name: str,
) -> NormalizedWeather:
    if payload.get("timezone") != timezone_name:
        raise _invalid_response("timezone_response_mismatch")

    daily_raw = payload.get("daily")
    if not isinstance(daily_raw, dict):
        raise _invalid_response("daily_shape")
    raw_dates = daily_raw.get("time")
    if not isinstance(raw_dates, list) or not 1 <= len(raw_dates) <= 16:
        raise _invalid_response("daily_date_array_shape")
    parsed_dates = [_local_date(value) for value in raw_dates]
    if any(current <= previous for previous, current in zip(parsed_dates, parsed_dates[1:])):
        raise _invalid_response("daily_date_order")
    daily_arrays = {
        field: _array(daily_raw, field, len(parsed_dates))
        for field in DAILY_FIELDS
    }

    daily: list[DailyWeather] = []
    for index, local_day in enumerate(parsed_dates):
        sunrise = _local_datetime(daily_arrays["sunrise"][index])
        sunset = _local_datetime(daily_arrays["sunset"][index])
        if sunrise.date() != local_day or sunset.date() != local_day:
            raise _invalid_response("daily_sunrise_sunset_date_mismatch")
        daily.append(
            DailyWeather(
                date=local_day.isoformat(),
                condition=_condition(daily_arrays["weather_code"][index]),
                temperature_high_f=_number(daily_arrays["temperature_2m_max"][index]),
                temperature_low_f=_number(daily_arrays["temperature_2m_min"][index]),
                precipitation_probability_max_pct=_number(
                    daily_arrays["precipitation_probability_max"][index],
                    minimum=0,
                    maximum=100,
                ),
                precipitation_in=_number(daily_arrays["precipitation_sum"][index], minimum=0),
                snowfall_in=_number(daily_arrays["snowfall_sum"][index], minimum=0),
                wind_speed_max_mph=_number(daily_arrays["wind_speed_10m_max"][index], minimum=0),
                wind_direction_dominant_deg=_number(
                    daily_arrays["wind_direction_10m_dominant"][index],
                    minimum=0,
                    maximum=360,
                ),
                wind_gust_max_mph=_number(daily_arrays["wind_gusts_10m_max"][index], minimum=0),
                sunrise_local=str(daily_arrays["sunrise"][index]),
                sunset_local=str(daily_arrays["sunset"][index]),
            )
        )

    hourly_raw = payload.get("hourly")
    raw_hourly_times = hourly_raw.get("time") if isinstance(hourly_raw, dict) else None
    if not isinstance(raw_hourly_times, list) or not raw_hourly_times:
        raise _invalid_response("hourly_time_array_shape")
    parsed_hourly_times = [_local_datetime(value) for value in raw_hourly_times]
    _validate_time_order(parsed_hourly_times)
    hourly_arrays = {
        field: _array(hourly_raw, field, len(parsed_hourly_times))
        for field in HOURLY_FIELDS
    }

    hourly_by_date: dict[str, list[HourlyWeather]] = {}
    for index, local_time in enumerate(parsed_hourly_times):
        day_key = local_time.date().isoformat()
        hourly_by_date.setdefault(day_key, []).append(
            HourlyWeather(
                timestamp_local=str(raw_hourly_times[index]),
                condition=_condition(hourly_arrays["weather_code"][index]),
                temperature_f=_number(hourly_arrays["temperature_2m"][index]),
                apparent_temperature_f=_number(hourly_arrays["apparent_temperature"][index]),
                precipitation_probability_pct=_number(
                    hourly_arrays["precipitation_probability"][index],
                    minimum=0,
                    maximum=100,
                ),
                precipitation_in=_number(hourly_arrays["precipitation"][index], minimum=0),
                snowfall_in=_number(hourly_arrays["snowfall"][index], minimum=0),
                wind_speed_mph=_number(hourly_arrays["wind_speed_10m"][index], minimum=0),
                wind_direction_deg=_number(
                    hourly_arrays["wind_direction_10m"][index],
                    minimum=0,
                    maximum=360,
                ),
                wind_gust_mph=_number(hourly_arrays["wind_gusts_10m"][index], minimum=0),
                is_day=_daylight_value(hourly_arrays["is_day"][index]),
            )
        )

    expected_dates = {value.isoformat() for value in parsed_dates}
    if set(hourly_by_date) != expected_dates:
        raise _invalid_response("hourly_date_coverage")
    return NormalizedWeather(
        daily=tuple(daily),
        hourly_by_date={
            day: tuple(items)
            for day, items in hourly_by_date.items()
        },
        available_start_date=parsed_dates[0].isoformat(),
        available_end_date=parsed_dates[-1].isoformat(),
    )


def _daylight_value(value: object) -> bool:
    if type(value) is not int or value not in (0, 1):
        raise _invalid_response("is_day_value")
    return value == 1


def fetch_forecast(
    latitude: object,
    longitude: object,
    timezone_name: object,
) -> NormalizedWeather:
    lat, lon, timezone_value = _validate_location_inputs(
        latitude,
        longitude,
        timezone_name,
    )
    payload = _request_json(_request_params(lat, lon, timezone_value))
    return _normalize_payload(payload, timezone_value)
