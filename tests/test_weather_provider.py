import copy
import json
from datetime import date, timedelta
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request
from unittest.mock import patch

import pytest

from services.open_meteo_provider import (
    CONDITION_BY_CODE,
    OPEN_METEO_URL,
    OpenMeteoInvalidResponseError,
    OpenMeteoUnavailableError,
    REQUEST_TIMEOUT_SECONDS,
    fetch_forecast,
)


def provider_payload():
    return {
        "timezone": "America/Denver",
        "daily": {
            "time": ["2026-01-01", "2026-01-02"],
            "weather_code": [0, 95],
            "temperature_2m_max": [30.0, 28.0],
            "temperature_2m_min": [10.0, 14.0],
            "precipitation_probability_max": [5, 90],
            "precipitation_sum": [0.0, 0.2],
            "snowfall_sum": [0.0, 0.0],
            "wind_speed_10m_max": [5.0, 12.0],
            "wind_direction_10m_dominant": [180, 270],
            "wind_gusts_10m_max": [8.0, 20.0],
            "sunrise": ["2026-01-01T07:10", "2026-01-02T07:09"],
            "sunset": ["2026-01-01T16:40", "2026-01-02T16:41"],
        },
        "hourly": {
            "time": [
                "2026-01-01T00:00",
                "2026-01-01T01:00",
                "2026-01-02T00:00",
                "2026-01-02T01:00",
            ],
            "weather_code": [0, 1, 71, 95],
            "temperature_2m": [10.0, 11.0, 15.0, 16.0],
            "apparent_temperature": [8.0, 9.0, 10.0, 12.0],
            "precipitation_probability": [0, 20, 60, 90],
            "precipitation": [0.0, 0.1, 0.2, 0.4],
            "snowfall": [0.0, 0.0, 0.2, 0.0],
            "wind_speed_10m": [2.0, 3.0, 5.0, 7.0],
            "wind_direction_10m": [180, 190, 200, 210],
            "wind_gusts_10m": [3.0, 4.0, 8.0, 9.0],
            "is_day": [0, 0, 1, 1],
        },
    }


def november_horizon_payload():
    payload = provider_payload()
    dates = [date(2026, 11, 2) + timedelta(days=offset) for offset in range(16)]
    date_values = [value.isoformat() for value in dates]
    hourly_times = [
        f"{day.isoformat()}T{hour:02d}:00"
        for day in dates
        for hour in range(24)
    ]

    payload["daily"] = {
        "time": date_values,
        "weather_code": [0] * 16,
        "temperature_2m_max": [30] * 15 + [None],
        "temperature_2m_min": [10] * 15 + [None],
        "precipitation_probability_max": [5] * 16,
        "precipitation_sum": [0.0] * 16,
        "snowfall_sum": [0.0] * 16,
        "wind_speed_10m_max": [5.0] * 16,
        "wind_direction_10m_dominant": [180] * 16,
        "wind_gusts_10m_max": [8.0] * 15 + [None],
        "sunrise": [f"{value}T07:00" for value in date_values],
        "sunset": [f"{value}T17:00" for value in date_values],
    }
    payload["hourly"] = {
        "time": hourly_times,
        "weather_code": [0] * 384,
        "temperature_2m": [10.0] * 384,
        "apparent_temperature": [8.0] * 384,
        "precipitation_probability": [0] * 384,
        "precipitation": [0.0] * 384,
        "snowfall": [0.0] * 384,
        "wind_speed_10m": [2.0] * 384,
        "wind_direction_10m": [180] * 384,
        "wind_gusts_10m": [3.0] * 378 + [None] * 6,
        "is_day": [0] * 384,
    }
    return payload


def honolulu_daily_null_code_payload():
    payload = november_horizon_payload()
    dates = [date(2026, 11, 7) + timedelta(days=offset) for offset in range(16)]
    date_values = [value.isoformat() for value in dates]
    payload["daily"]["time"] = date_values
    payload["daily"]["weather_code"][-1] = None
    payload["daily"]["temperature_2m_max"][-1] = 82.0
    payload["daily"]["temperature_2m_min"][-1] = 70.0
    payload["daily"]["wind_gusts_10m_max"][-1] = 22.0
    payload["daily"]["sunrise"] = [f"{value}T06:30" for value in date_values]
    payload["daily"]["sunset"] = [f"{value}T17:45" for value in date_values]
    payload["hourly"]["time"] = [
        f"{day.isoformat()}T{hour:02d}:00"
        for day in dates
        for hour in range(24)
    ]
    payload["hourly"]["wind_gusts_10m"] = [3.0] * 384
    return payload


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return self.body


def call_with_payload(payload):
    response = FakeResponse(json.dumps(payload).encode("utf-8"))
    with patch("services.open_meteo_provider.urlopen", return_value=response) as urlopen:
        forecast = fetch_forecast(
            Decimal("39.7392"),
            Decimal("-104.9903"),
            "America/Denver",
        )
    return forecast, urlopen


def test_request_contract_and_normalized_local_forecast():
    forecast, urlopen = call_with_payload(provider_payload())

    request = urlopen.call_args.args[0]
    assert isinstance(request, Request)
    assert urlsplit(request.full_url).scheme == "https"
    assert urlsplit(request.full_url).netloc == "api.open-meteo.com"
    assert urlsplit(request.full_url).path == "/v1/forecast"
    assert request.headers["Accept"] == "application/json"
    query = parse_qs(urlsplit(request.full_url).query)
    assert set(query) == {
        "latitude",
        "longitude",
        "timezone",
        "forecast_days",
        "temperature_unit",
        "wind_speed_unit",
        "precipitation_unit",
        "timeformat",
        "daily",
        "hourly",
    }
    assert query["latitude"] == ["39.7392"]
    assert query["longitude"] == ["-104.9903"]
    assert query["timezone"] == ["America/Denver"]
    assert query["forecast_days"] == ["16"]
    assert query["temperature_unit"] == ["fahrenheit"]
    assert query["wind_speed_unit"] == ["mph"]
    assert query["precipitation_unit"] == ["inch"]
    assert query["timeformat"] == ["iso8601"]
    assert query["daily"][0].split(",") == [
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
    ]
    assert query["hourly"][0].split(",") == [
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
    ]
    assert "past_days" not in query
    assert urlopen.call_args.kwargs["timeout"] == REQUEST_TIMEOUT_SECONDS == 8

    assert forecast.available_start_date == "2026-01-01"
    assert forecast.available_end_date == "2026-01-02"
    assert forecast.daily[0].condition == "clear"
    assert forecast.daily[1].condition == "storm"
    assert forecast.daily[0].temperature_high_f == 30.0
    assert forecast.daily[0].temperature_low_f == 10.0
    assert forecast.daily[0].sunrise_local == "2026-01-01T07:10"
    assert forecast.hourly_by_date["2026-01-01"][0].timestamp_local == "2026-01-01T00:00"
    assert forecast.hourly_by_date["2026-01-02"][0].condition == "snow"
    normalized_text = json.dumps(forecast.daily[0].to_dict())
    assert "temperature_2m_max" not in normalized_text
    assert "weather_code" not in normalized_text
    assert "latitude" not in normalized_text
    assert "longitude" not in normalized_text


def test_missing_daily_temperature_extremes_are_preserved_as_null():
    payload = provider_payload()
    payload["daily"]["temperature_2m_max"][1] = None
    payload["daily"]["temperature_2m_min"][1] = None
    forecast, _ = call_with_payload(payload)

    daily = forecast.daily[1].to_dict()
    assert daily["temperature_high_f"] is None
    assert daily["temperature_low_f"] is None
    assert daily["condition"] == "storm"
    assert daily["precipitation_in"] == 0.2


def test_november_horizon_preserves_unavailable_gusts_as_null():
    forecast, _ = call_with_payload(november_horizon_payload())

    assert forecast.available_start_date == "2026-11-02"
    assert forecast.available_end_date == "2026-11-17"
    assert len(forecast.daily) == 16
    assert forecast.daily[0].temperature_high_f == 30.0
    assert type(forecast.daily[0].temperature_high_f) is float
    assert forecast.daily[-1].temperature_high_f is None
    assert forecast.daily[-1].temperature_low_f is None
    assert forecast.daily[-1].wind_gust_max_mph is None
    final_day_hours = forecast.hourly_by_date["2026-11-17"]
    assert len(final_day_hours) == 24
    assert all(hour.wind_gust_mph is None for hour in final_day_hours[18:])
    assert final_day_hours[17].wind_gust_mph == 3.0
    assert type(final_day_hours[0].precipitation_probability_pct) is float


def test_honolulu_null_daily_weather_code_preserves_full_forecast():
    forecast, _ = call_with_payload(honolulu_daily_null_code_payload())

    assert forecast.available_start_date == "2026-11-07"
    assert forecast.available_end_date == "2026-11-22"
    assert len(forecast.daily) == 16
    assert [day.condition for day in forecast.daily[:15]] == ["clear"] * 15
    final_day = forecast.daily[-1]
    assert final_day.date == "2026-11-22"
    assert final_day.condition == "unknown"
    assert final_day.temperature_high_f == 82.0
    assert final_day.temperature_low_f == 70.0
    assert final_day.precipitation_probability_max_pct == 5.0
    assert final_day.precipitation_in == 0.0
    assert final_day.snowfall_in == 0.0
    assert final_day.wind_speed_max_mph == 5.0
    assert final_day.wind_direction_dominant_deg == 180.0
    assert final_day.wind_gust_max_mph == 22.0
    assert final_day.sunrise_local == "2026-11-22T06:30"
    assert final_day.sunset_local == "2026-11-22T17:45"
    assert len(forecast.hourly_by_date["2026-11-22"]) == 24
    assert forecast.hourly_by_date["2026-11-22"][0].condition == "clear"


@pytest.mark.parametrize(
    ("section", "index", "value", "expected_context"),
    [
        (
            "daily",
            1,
            3.0,
            {
                "section": "daily",
                "field": "weather_code",
                "index": 1,
                "date": "2026-01-02",
                "actual_type": "float",
                "actual_value": "3.0",
            },
        ),
        (
            "daily",
            1,
            "3",
            {
                "section": "daily",
                "field": "weather_code",
                "index": 1,
                "date": "2026-01-02",
                "actual_type": "str",
                "actual_value": '"3"',
            },
        ),
        (
            "daily",
            1,
            True,
            {
                "section": "daily",
                "field": "weather_code",
                "index": 1,
                "date": "2026-01-02",
                "actual_type": "bool",
                "actual_value": "true",
            },
        ),
        (
            "hourly",
            2,
            None,
            {
                "section": "hourly",
                "field": "weather_code",
                "index": 2,
                "timestamp": "2026-01-02T00:00",
                "actual_type": "NoneType",
                "actual_value": "null",
            },
        ),
        (
            "hourly",
            3,
            "3",
            {
                "section": "hourly",
                "field": "weather_code",
                "index": 3,
                "timestamp": "2026-01-02T01:00",
                "actual_type": "str",
                "actual_value": '"3"',
            },
        ),
    ],
)
def test_weather_code_type_errors_include_bounded_temporal_context(
    section,
    index,
    value,
    expected_context,
):
    payload = provider_payload()
    payload[section]["weather_code"][index] = value
    response = FakeResponse(json.dumps(payload).encode("utf-8"))
    with patch("services.open_meteo_provider.urlopen", return_value=response):
        with pytest.raises(OpenMeteoInvalidResponseError) as error:
            fetch_forecast(39.7392, -104.9903, "America/Denver")

    assert error.value.category == "weather_code_type"
    assert error.value.diagnostic_context == expected_context


def test_weather_code_string_diagnostic_value_is_truncated():
    payload = provider_payload()
    payload["daily"]["weather_code"][0] = "x" * 200
    response = FakeResponse(json.dumps(payload).encode("utf-8"))
    with patch("services.open_meteo_provider.urlopen", return_value=response):
        with pytest.raises(OpenMeteoInvalidResponseError) as error:
            fetch_forecast(39.7392, -104.9903, "America/Denver")

    actual_value = error.value.diagnostic_context["actual_value"]
    assert len(actual_value) <= 80
    assert actual_value.endswith('..."')
    assert error.value.diagnostic_context["actual_type"] == "str"


@pytest.mark.parametrize(
    ("section", "field", "index", "value", "expected_context"),
    [
        (
            "daily",
            "precipitation_probability_max",
            1,
            None,
            {
                "section": "daily",
                "field": "precipitation_probability_max",
                "index": 1,
                "date": "2026-01-02",
                "actual_type": "NoneType",
                "actual_value": "null",
            },
        ),
        (
            "daily",
            "precipitation_sum",
            0,
            "0",
            {
                "section": "daily",
                "field": "precipitation_sum",
                "index": 0,
                "date": "2026-01-01",
                "actual_type": "str",
                "actual_value": '"0"',
            },
        ),
        (
            "daily",
            "wind_speed_10m_max",
            1,
            True,
            {
                "section": "daily",
                "field": "wind_speed_10m_max",
                "index": 1,
                "date": "2026-01-02",
                "actual_type": "bool",
                "actual_value": "true",
            },
        ),
        (
            "daily",
            "snowfall_sum",
            0,
            [],
            {
                "section": "daily",
                "field": "snowfall_sum",
                "index": 0,
                "date": "2026-01-01",
                "actual_type": "list",
                "actual_value": "<list>",
            },
        ),
        (
            "hourly",
            "temperature_2m",
            2,
            None,
            {
                "section": "hourly",
                "field": "temperature_2m",
                "index": 2,
                "timestamp": "2026-01-02T00:00",
                "actual_type": "NoneType",
                "actual_value": "null",
            },
        ),
    ],
)
def test_numeric_type_errors_include_bounded_field_context(
    section,
    field,
    index,
    value,
    expected_context,
):
    payload = provider_payload()
    payload[section][field][index] = value
    response = FakeResponse(json.dumps(payload).encode("utf-8"))
    with patch("services.open_meteo_provider.urlopen", return_value=response):
        with pytest.raises(OpenMeteoInvalidResponseError) as error:
            fetch_forecast(39.7392, -104.9903, "America/Denver")

    assert error.value.category == "numeric_type"
    assert error.value.diagnostic_context == expected_context


def test_weather_code_families_map_to_ti_conditions_only():
    representatives = {
        0: "clear",
        2: "partly_cloudy",
        3: "cloudy",
        48: "fog",
        56: "rain",
        71: "snow",
        96: "storm",
        1000: "unknown",
    }
    assert {code: CONDITION_BY_CODE.get(code, "unknown") for code in representatives} == representatives


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value["daily"]["temperature_2m_max"].pop(),
        lambda value: value["daily"].__setitem__("time", ["not-a-date", "2026-01-02"]),
        lambda value: value["daily"]["snowfall_sum"].__setitem__(0, float("nan")),
        lambda value: value["daily"]["temperature_2m_max"].__setitem__(0, float("inf")),
        lambda value: value["daily"]["precipitation_sum"].__setitem__(0, None),
        lambda value: value["hourly"]["temperature_2m"].__setitem__(0, "10"),
        lambda value: value["hourly"]["wind_gusts_10m"].__setitem__(0, True),
        lambda value: value["hourly"]["temperature_2m"].pop(),
        lambda value: value["hourly"]["time"].__setitem__(0, "not-a-timestamp"),
        lambda value: value["hourly"].__setitem__("is_day", [0, 2, 1, 1]),
        lambda value: value.__setitem__("timezone", "UTC"),
        lambda value: value["daily"].pop("wind_gusts_10m_max"),
    ],
)
def test_malformed_provider_shapes_and_values_are_rejected(mutation):
    payload = copy.deepcopy(provider_payload())
    mutation(payload)
    response = FakeResponse(json.dumps(payload, allow_nan=True).encode("utf-8"))
    with patch("services.open_meteo_provider.urlopen", return_value=response):
        with pytest.raises(OpenMeteoInvalidResponseError):
            fetch_forecast(39.7392, -104.9903, "America/Denver")


def test_provider_error_and_malformed_json_are_rejected_without_raw_details():
    provider_error = FakeResponse(
        json.dumps({"error": True, "reason": "synthetic provider detail"}).encode("utf-8")
    )
    with patch("services.open_meteo_provider.urlopen", return_value=provider_error):
        with pytest.raises(OpenMeteoInvalidResponseError):
            fetch_forecast(39.7392, -104.9903, "America/Denver")

    malformed = FakeResponse(b"{not-json")
    with patch("services.open_meteo_provider.urlopen", return_value=malformed):
        with pytest.raises(OpenMeteoInvalidResponseError):
            fetch_forecast(39.7392, -104.9903, "America/Denver")


def test_missing_required_array_has_a_sanitized_diagnostic_category():
    payload = provider_payload()
    payload["hourly"].pop("temperature_2m")
    response = FakeResponse(json.dumps(payload).encode("utf-8"))
    with patch("services.open_meteo_provider.urlopen", return_value=response):
        with pytest.raises(OpenMeteoInvalidResponseError) as error:
            fetch_forecast(39.7392, -104.9903, "America/Denver")

    assert error.value.category == "array_missing_or_misaligned:temperature_2m"


def test_http_and_url_failures_are_sanitized_and_not_retried():
    failures = (
        HTTPError(OPEN_METEO_URL, 503, "synthetic provider failure", {}, None),
        URLError("synthetic transport failure"),
    )
    for failure in failures:
        with patch(
            "services.open_meteo_provider.urlopen",
            side_effect=failure,
        ) as urlopen:
            with pytest.raises(OpenMeteoUnavailableError):
                fetch_forecast(39.7392, -104.9903, "America/Denver")
        assert urlopen.call_count == 1
