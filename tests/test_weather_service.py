from datetime import datetime, timezone
from decimal import Decimal
import logging
from unittest.mock import patch

import pytest

from services.open_meteo_provider import (
    OpenMeteoInvalidResponseError,
    OpenMeteoUnavailableError,
)
from services.weather_models import (
    DailyWeather,
    HourlyWeather,
    NormalizedWeather,
)
from services.weather_service import (
    FRESH_TTL_SECONDS,
    MAX_CACHE_ENTRIES,
    STALE_TTL_SECONDS,
    WeatherLocationNotFoundError,
    WeatherService,
    WeatherUnavailableError,
)


def normalized_weather(condition="clear"):
    day = DailyWeather(
        date="2026-01-01",
        condition=condition,
        temperature_high_f=30.0,
        temperature_low_f=10.0,
        precipitation_probability_max_pct=5.0,
        precipitation_in=0.0,
        snowfall_in=0.0,
        wind_speed_max_mph=5.0,
        wind_direction_dominant_deg=180.0,
        wind_gust_max_mph=8.0,
        sunrise_local="2026-01-01T07:10",
        sunset_local="2026-01-01T16:40",
    )
    hour = HourlyWeather(
        timestamp_local="2026-01-01T00:00",
        condition=condition,
        temperature_f=10.0,
        apparent_temperature_f=8.0,
        precipitation_probability_pct=0.0,
        precipitation_in=0.0,
        snowfall_in=0.0,
        wind_speed_mph=2.0,
        wind_direction_deg=180.0,
        wind_gust_mph=3.0,
        is_day=False,
    )
    return NormalizedWeather(
        daily=(day,),
        hourly_by_date={"2026-01-01": (hour,)},
        available_start_date="2026-01-01",
        available_end_date="2026-01-01",
    )


class FakeClock:
    def __init__(self):
        self.value = 100.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class FakeProvider:
    def __init__(self, *responses, default=None):
        self.responses = list(responses)
        self.default = default or normalized_weather()
        self.calls = []

    def __call__(self, latitude, longitude, timezone_name):
        self.calls.append((latitude, longitude, timezone_name))
        response = self.responses.pop(0) if self.responses else self.default
        if isinstance(response, BaseException):
            raise response
        return response


class FakeWeatherService(WeatherService):
    def _load_location(self, location_id):
        return {
            "location_id": location_id,
            "display_name": f"Synthetic location {location_id}",
            "latitude": Decimal("39.7392"),
            "longitude": Decimal("-104.9903"),
            "timezone_name": "America/Denver",
            "lifecycle_state": "archived",
        }


def make_service(provider, clock):
    return FakeWeatherService(
        provider=provider,
        monotonic=clock,
        utcnow=lambda: datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class FakeCursor:
    def __init__(self, row):
        self.row = row
        self.query = None
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params):
        self.query = query
        self.params = params

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, cursor):
        self.fake_cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.fake_cursor


def location_row(**overrides):
    row = {
        "location_id": 7,
        "display_name": "Synthetic location",
        "latitude": Decimal("39.7392"),
        "longitude": Decimal("-104.9903"),
        "timezone_name": "America/Denver",
        "lifecycle_state": "archived",
    }
    row.update(overrides)
    return row


@pytest.mark.parametrize("lifecycle_state", ["active", "hidden", "archived"])
def test_location_lookup_accepts_each_lifecycle_state_and_keeps_coordinates_internal(
    lifecycle_state,
):
    cursor = FakeCursor(location_row(lifecycle_state=lifecycle_state))
    service = WeatherService(provider=FakeProvider())
    with patch(
        "services.weather_service.db_conn",
        return_value=FakeConnection(cursor),
    ):
        location = service._load_location(7)

    assert cursor.params == (7,)
    assert "WHERE location_id = %s" in cursor.query
    assert "lifecycle_state =" not in cursor.query
    assert location["lifecycle_state"] == lifecycle_state
    assert location["latitude"] == Decimal("39.7392")
    assert location["longitude"] == Decimal("-104.9903")


def test_location_lookup_maps_missing_and_invalid_location_data():
    service = WeatherService(provider=FakeProvider())
    with patch(
        "services.weather_service.db_conn",
        return_value=FakeConnection(FakeCursor(None)),
    ):
        with pytest.raises(WeatherLocationNotFoundError):
            service._load_location(7)

    invalid_rows = (
        location_row(latitude=Decimal("100")),
        location_row(timezone_name="Not/A_Zone"),
    )
    for row in invalid_rows:
        with patch(
            "services.weather_service.db_conn",
            return_value=FakeConnection(FakeCursor(row)),
        ):
            with pytest.raises(WeatherUnavailableError):
                service._load_location(7)


def test_first_miss_caches_and_fresh_hits_skip_provider_while_updating_lru():
    clock = FakeClock()
    provider = FakeProvider()
    service = make_service(provider, clock)

    service.get_forecast(1)
    service.get_forecast(2)
    service.get_forecast(1)
    assert list(service._cache) == [2, 1]
    clock.advance(FRESH_TTL_SECONDS - 1)
    result = service.get_forecast(1)

    assert result.freshness == "fresh"
    assert result.stale_age_minutes is None
    assert len(provider.calls) == 2
    assert provider.calls[0] == (
        Decimal("39.7392"),
        Decimal("-104.9903"),
        "America/Denver",
    )


def test_refresh_at_thirty_minutes_resets_age_after_success():
    clock = FakeClock()
    provider = FakeProvider(normalized_weather(), normalized_weather("rain"))
    service = make_service(provider, clock)

    service.get_forecast(1)
    clock.advance(FRESH_TTL_SECONDS)
    refreshed = service.get_forecast(1)
    assert refreshed.freshness == "fresh"
    assert refreshed.daily[0].condition == "rain"
    assert service._cache[1].fetched_at == clock.value

    clock.advance(FRESH_TTL_SECONDS - 1)
    service.get_forecast(1)
    assert len(provider.calls) == 2


def test_failed_refresh_returns_stale_without_extending_stale_lifetime():
    clock = FakeClock()
    provider = FakeProvider(
        normalized_weather(),
        OpenMeteoUnavailableError(),
        OpenMeteoUnavailableError(),
        OpenMeteoUnavailableError(),
    )
    service = make_service(provider, clock)
    service.get_forecast(1)
    original_timestamp = service._cache[1].fetched_at

    clock.advance(FRESH_TTL_SECONDS)
    stale = service.get_forecast(1)
    assert stale.freshness == "stale"
    assert stale.stale_age_minutes == 30
    assert service._cache[1].fetched_at == original_timestamp

    clock.advance(STALE_TTL_SECONDS - FRESH_TTL_SECONDS - 1)
    stale = service.get_forecast(1)
    assert stale.freshness == "stale"
    assert stale.stale_age_minutes == 359
    assert service._cache[1].fetched_at == original_timestamp

    clock.advance(1)
    with pytest.raises(WeatherUnavailableError):
        service.get_forecast(1)
    assert len(provider.calls) == 4
    assert 1 not in service._cache


def test_provider_failure_without_usable_cache_is_unavailable():
    clock = FakeClock()
    provider = FakeProvider(OpenMeteoUnavailableError())
    service = make_service(provider, clock)
    with pytest.raises(WeatherUnavailableError):
        service.get_forecast(1)
    assert len(provider.calls) == 1


def test_weather_code_failure_log_includes_saved_location_and_field_context(caplog):
    diagnostic = {
        "section": "hourly",
        "field": "weather_code",
        "index": 284,
        "timestamp": "2026-11-17T03:00",
        "actual_type": "NoneType",
        "actual_value": "null",
    }
    service = make_service(
        FakeProvider(
            OpenMeteoInvalidResponseError(
                "weather_code_type",
                diagnostic_context=diagnostic,
            )
        ),
        FakeClock(),
    )

    with caplog.at_level(logging.WARNING, logger="services.weather_service"):
        with pytest.raises(WeatherUnavailableError) as error:
            service.get_forecast(9)

    assert error.value.category == "weather_code_type"
    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    for expected in (
        "saved_location_id=9",
        "display_name=Synthetic location 9",
        "timezone_name=America/Denver",
        "latitude=39.7392",
        "longitude=-104.9903",
        "section=hourly",
        "field=weather_code",
        "index=284",
        "timestamp=2026-11-17T03:00",
        "actual_type=NoneType",
        "actual_value=null",
        "category=weather_code_type",
    ):
        assert expected in message
    assert "api.open-meteo.com" not in message
    assert "latitude=" in message
    assert "{" not in message


def test_cache_evicts_least_recently_used_entry_at_entry_thirty_three():
    clock = FakeClock()
    provider = FakeProvider()
    service = make_service(provider, clock)

    service.get_forecast(1)
    service.get_forecast(2)
    service.get_forecast(1)
    for location_id in range(3, MAX_CACHE_ENTRIES + 2):
        service.get_forecast(location_id)

    assert len(service._cache) == MAX_CACHE_ENTRIES
    assert 1 in service._cache
    assert 2 not in service._cache
    assert MAX_CACHE_ENTRIES + 1 in service._cache
