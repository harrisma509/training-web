import copy
import json
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
    assert forecast.daily[0].sunrise_local == "2026-01-01T07:10"
    assert forecast.hourly_by_date["2026-01-01"][0].timestamp_local == "2026-01-01T00:00"
    assert forecast.hourly_by_date["2026-01-02"][0].condition == "snow"
    normalized_text = json.dumps(forecast.daily[0].to_dict())
    assert "temperature_2m_max" not in normalized_text
    assert "weather_code" not in normalized_text
    assert "latitude" not in normalized_text
    assert "longitude" not in normalized_text


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
        lambda value: value["hourly"]["temperature_2m"].__setitem__(0, "10"),
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
