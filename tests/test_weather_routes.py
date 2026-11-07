from dataclasses import replace
from datetime import date, timedelta
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import app as training_app
from services.weather_models import (
    DailyWeather,
    HourlyWeather,
    WeatherForecast,
)
from services.weather_service import (
    WeatherDateError,
    WeatherLocationNotFoundError,
    WeatherUnavailableError,
)


def sample_forecast(freshness="fresh", stale_age_minutes=None, optional_gusts=False):
    daily = DailyWeather(
        date="2026-01-01",
        condition="clear",
        temperature_high_f=30.0,
        temperature_low_f=10.0,
        precipitation_probability_max_pct=5.0,
        precipitation_in=0.0,
        snowfall_in=0.0,
        wind_speed_max_mph=5.0,
        wind_direction_dominant_deg=180.0,
        wind_gust_max_mph=None if optional_gusts else 8.0,
        sunrise_local="2026-01-01T07:10",
        sunset_local="2026-01-01T16:40",
    )
    hour = HourlyWeather(
        timestamp_local="2026-01-01T00:00",
        condition="clear",
        temperature_f=10.0,
        apparent_temperature_f=8.0,
        precipitation_probability_pct=0.0,
        precipitation_in=0.0,
        snowfall_in=0.0,
        wind_speed_mph=2.0,
        wind_direction_deg=180.0,
        wind_gust_mph=None if optional_gusts else 3.0,
        is_day=False,
    )
    return WeatherForecast(
        location_id=7,
        display_name="Synthetic location",
        timezone_name="America/Denver",
        generated_at="2026-01-01T12:00:00Z",
        available_start_date="2026-01-01",
        available_end_date="2026-01-01",
        freshness=freshness,
        stale_age_minutes=stale_age_minutes,
        daily=(daily,),
        hourly_by_date={"2026-01-01": (hour,)},
    )


def sample_forecast_with_unknown_final_day():
    base = sample_forecast()
    dates = [date(2026, 11, 7) + timedelta(days=offset) for offset in range(16)]
    daily = tuple(
        replace(
            base.daily[0],
            date=day.isoformat(),
            condition="unknown" if index == 15 else "clear",
            precipitation_probability_max_pct=(
                None
                if index == 15
                else base.daily[0].precipitation_probability_max_pct
            ),
            precipitation_in=None if index == 15 else base.daily[0].precipitation_in,
            snowfall_in=None if index == 15 else base.daily[0].snowfall_in,
            wind_speed_max_mph=None if index == 15 else base.daily[0].wind_speed_max_mph,
            wind_direction_dominant_deg=(
                None
                if index == 15
                else base.daily[0].wind_direction_dominant_deg
            ),
            wind_gust_max_mph=None if index == 15 else base.daily[0].wind_gust_max_mph,
            sunrise_local=None if index == 15 else f"{day.isoformat()}T06:30",
            sunset_local=None if index == 15 else f"{day.isoformat()}T17:45",
        )
        for index, day in enumerate(dates)
    )
    hourly_template = base.hourly_by_date["2026-01-01"][0]
    hourly_by_date = {
        day.isoformat(): tuple(
            replace(
                hourly_template,
                timestamp_local=f"{day.isoformat()}T{hour:02d}:00",
            )
            for hour in range(24)
        )
        for day in dates
    }
    return replace(
        base,
        available_start_date=dates[0].isoformat(),
        available_end_date=dates[-1].isoformat(),
        daily=daily,
        hourly_by_date=hourly_by_date,
    )


class TestWeatherRoutes:
    def setup_method(self):
        self.client = TestClient(training_app)

    def test_forecast_route_is_coordinate_private_and_ti_normalized(self):
        with patch(
            "routes.weather.weather_service.get_forecast",
            return_value=sample_forecast(),
        ):
            response = self.client.get("/api/weather/locations/7/forecast")

        assert response.status_code == 200
        payload = response.json()
        assert payload["freshness"] == "fresh"
        assert payload["daily"][0]["condition"] == "clear"
        response_text = json.dumps(payload)
        for forbidden in (
            "latitude",
            "longitude",
            "weather_code",
            "temperature_2m_max",
            "precipitation_sum",
        ):
            assert forbidden not in response_text

    def test_hourly_route_returns_only_requested_local_date(self):
        with patch(
            "routes.weather.weather_service.get_hourly_forecast",
            return_value=sample_forecast(),
        ):
            response = self.client.get(
                "/api/weather/locations/7/hourly",
                params={"date": "2026-01-01"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["date"] == "2026-01-01"
        assert len(payload["hourly"]) == 1
        assert "daily" not in payload
        assert "latitude" not in response.text
        assert "longitude" not in response.text
        assert "weather_code" not in response.text
        assert "temperature_2m" not in response.text

    def test_unknown_daily_condition_keeps_forecast_and_hourly_routes_available(self):
        forecast = sample_forecast_with_unknown_final_day()
        with patch(
            "routes.weather.weather_service.get_forecast",
            return_value=forecast,
        ):
            daily_response = self.client.get("/api/weather/locations/9/forecast")

        assert daily_response.status_code == 200
        daily_payload = daily_response.json()
        assert daily_payload["available_start_date"] == "2026-11-07"
        assert daily_payload["available_end_date"] == "2026-11-22"
        assert len(daily_payload["daily"]) == 16
        assert daily_payload["daily"][-1]["date"] == "2026-11-22"
        assert daily_payload["daily"][-1]["condition"] == "unknown"
        assert daily_payload["daily"][-1]["temperature_high_f"] == 30.0
        assert daily_payload["daily"][-1]["temperature_low_f"] == 10.0
        assert daily_payload["daily"][-1]["precipitation_probability_max_pct"] is None
        assert daily_payload["daily"][-1]["precipitation_in"] is None
        assert daily_payload["daily"][-1]["snowfall_in"] is None
        assert daily_payload["daily"][-1]["wind_speed_max_mph"] is None
        assert daily_payload["daily"][-1]["wind_direction_dominant_deg"] is None
        assert daily_payload["daily"][-1]["wind_gust_max_mph"] is None
        assert daily_payload["daily"][-1]["sunrise_local"] is None
        assert daily_payload["daily"][-1]["sunset_local"] is None
        assert "precipitation_sum" not in json.dumps(daily_payload)

        with patch(
            "routes.weather.weather_service.get_hourly_forecast",
            return_value=forecast,
        ):
            hourly_response = self.client.get(
                "/api/weather/locations/9/hourly",
                params={"date": "2026-11-22"},
            )

        assert hourly_response.status_code == 200
        assert hourly_response.json()["date"] == "2026-11-22"
        assert len(hourly_response.json()["hourly"]) == 24

    def test_shortened_available_range_is_returned_as_success(self):
        forecast = sample_forecast_with_unknown_final_day()
        retained_daily = forecast.daily[:-1]
        forecast = replace(
            forecast,
            daily=retained_daily,
            hourly_by_date={
                day: hours
                for day, hours in forecast.hourly_by_date.items()
                if day <= retained_daily[-1].date
            },
            available_end_date=retained_daily[-1].date,
        )
        with patch(
            "routes.weather.weather_service.get_forecast",
            return_value=forecast,
        ):
            response = self.client.get("/api/weather/locations/9/forecast")

        assert response.status_code == 200
        payload = response.json()
        assert payload["available_end_date"] == "2026-11-21"
        assert len(payload["daily"]) == 15
        assert payload["daily"][-1]["date"] == "2026-11-21"

    def test_optional_gusts_are_serialized_as_null(self):
        forecast = sample_forecast(optional_gusts=True)
        with patch(
            "routes.weather.weather_service.get_forecast",
            return_value=forecast,
        ):
            daily_response = self.client.get("/api/weather/locations/7/forecast")
        with patch(
            "routes.weather.weather_service.get_hourly_forecast",
            return_value=forecast,
        ):
            hourly_response = self.client.get(
                "/api/weather/locations/7/hourly",
                params={"date": "2026-01-01"},
            )

        assert daily_response.status_code == 200
        assert daily_response.json()["daily"][0]["wind_gust_max_mph"] is None
        assert hourly_response.status_code == 200
        assert hourly_response.json()["hourly"][0]["wind_gust_mph"] is None

    def test_partial_hourly_values_are_serialized_as_null_without_raw_fields(self):
        base = sample_forecast()
        partial_hour = replace(
            base.hourly_by_date["2026-01-01"][0],
            condition="unknown",
            temperature_f=52.0,
            apparent_temperature_f=None,
            precipitation_probability_pct=None,
            precipitation_in=None,
            snowfall_in=None,
            wind_speed_mph=None,
            wind_direction_deg=None,
            wind_gust_mph=None,
            is_day=None,
        )
        forecast = replace(
            base,
            hourly_by_date={"2026-01-01": (partial_hour,)},
        )
        with patch(
            "routes.weather.weather_service.get_hourly_forecast",
            return_value=forecast,
        ):
            response = self.client.get(
                "/api/weather/locations/7/hourly",
                params={"date": "2026-01-01"},
            )

        assert response.status_code == 200
        hour = response.json()["hourly"][0]
        assert hour["condition"] == "unknown"
        assert hour["temperature_f"] == 52.0
        for field in (
            "apparent_temperature_f",
            "precipitation_probability_pct",
            "precipitation_in",
            "snowfall_in",
            "wind_speed_mph",
            "wind_direction_deg",
            "wind_gust_mph",
            "is_day",
        ):
            assert hour[field] is None
        for forbidden in ("latitude", "longitude", "weather_code", "temperature_2m"):
            assert forbidden not in response.text

    def test_daily_route_survives_when_final_date_has_no_hourly_records(self):
        forecast = sample_forecast_with_unknown_final_day()
        final_date = forecast.available_end_date
        forecast = replace(
            forecast,
            hourly_by_date={
                day: hours
                for day, hours in forecast.hourly_by_date.items()
                if day != final_date
            },
        )
        with patch(
            "routes.weather.weather_service.get_forecast",
            return_value=forecast,
        ):
            response = self.client.get("/api/weather/locations/9/forecast")

        assert response.status_code == 200
        assert response.json()["available_end_date"] == final_date
        assert response.json()["daily"][-1]["date"] == final_date

    def test_stale_forecast_remains_http_success(self):
        with patch(
            "routes.weather.weather_service.get_forecast",
            return_value=sample_forecast("stale", 45),
        ):
            response = self.client.get("/api/weather/locations/7/forecast")

        assert response.status_code == 200
        assert response.json()["freshness"] == "stale"
        assert response.json()["stale_age_minutes"] == 45

    def test_weather_errors_map_to_bounded_statuses(self):
        with patch(
            "routes.weather.weather_service.get_forecast",
            side_effect=WeatherLocationNotFoundError(),
        ):
            missing = self.client.get("/api/weather/locations/999/forecast")
        assert missing.status_code == 404
        assert missing.json() == {"detail": "Saved location not found."}

        with patch(
            "routes.weather.weather_service.get_hourly_forecast",
            side_effect=WeatherDateError(),
        ):
            bad_date = self.client.get(
                "/api/weather/locations/7/hourly",
                params={"date": "2035-01-01"},
            )
        assert bad_date.status_code == 422
        assert "outside the available forecast range" in bad_date.json()["detail"]

        with patch(
            "routes.weather.weather_service.get_forecast",
            side_effect=WeatherUnavailableError("provider_unavailable"),
        ):
            unavailable = self.client.get("/api/weather/locations/7/forecast")
        assert unavailable.status_code == 503
        assert unavailable.json() == {
            "detail": "Weather forecast is temporarily unavailable."
        }

    def test_invalid_location_path_is_rejected_without_provider_access(self):
        with patch("routes.weather.weather_service.get_forecast") as get_forecast:
            response = self.client.get("/api/weather/locations/0/forecast")

        assert response.status_code == 422
        get_forecast.assert_not_called()
