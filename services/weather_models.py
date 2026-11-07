"""TI-owned normalized Weather contract models."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


WeatherCondition = Literal[
    "clear",
    "partly_cloudy",
    "cloudy",
    "fog",
    "rain",
    "snow",
    "storm",
    "unknown",
]
WeatherFreshness = Literal["fresh", "stale", "unavailable"]


@dataclass(frozen=True)
class DailyWeather:
    date: str
    condition: WeatherCondition
    temperature_high_f: float | None
    temperature_low_f: float | None
    precipitation_probability_max_pct: float | None
    precipitation_in: float | None
    snowfall_in: float | None
    wind_speed_max_mph: float | None
    wind_direction_dominant_deg: float | None
    wind_gust_max_mph: float | None
    sunrise_local: str | None
    sunset_local: str | None

    def to_dict(self) -> dict[str, str | float | None]:
        return {
            "date": self.date,
            "condition": self.condition,
            "temperature_high_f": self.temperature_high_f,
            "temperature_low_f": self.temperature_low_f,
            "precipitation_probability_max_pct": self.precipitation_probability_max_pct,
            "precipitation_in": self.precipitation_in,
            "snowfall_in": self.snowfall_in,
            "wind_speed_max_mph": self.wind_speed_max_mph,
            "wind_direction_dominant_deg": self.wind_direction_dominant_deg,
            "wind_gust_max_mph": self.wind_gust_max_mph,
            "sunrise_local": self.sunrise_local,
            "sunset_local": self.sunset_local,
        }


@dataclass(frozen=True)
class HourlyWeather:
    timestamp_local: str
    condition: WeatherCondition
    temperature_f: float
    apparent_temperature_f: float
    precipitation_probability_pct: float
    precipitation_in: float
    snowfall_in: float
    wind_speed_mph: float
    wind_direction_deg: float
    wind_gust_mph: float | None
    is_day: bool

    def to_dict(self) -> dict[str, str | float | bool | None]:
        return {
            "timestamp_local": self.timestamp_local,
            "condition": self.condition,
            "temperature_f": self.temperature_f,
            "apparent_temperature_f": self.apparent_temperature_f,
            "precipitation_probability_pct": self.precipitation_probability_pct,
            "precipitation_in": self.precipitation_in,
            "snowfall_in": self.snowfall_in,
            "wind_speed_mph": self.wind_speed_mph,
            "wind_direction_deg": self.wind_direction_deg,
            "wind_gust_mph": self.wind_gust_mph,
            "is_day": self.is_day,
        }


@dataclass(frozen=True)
class NormalizedWeather:
    daily: tuple[DailyWeather, ...]
    hourly_by_date: dict[str, tuple[HourlyWeather, ...]]
    available_start_date: str
    available_end_date: str


@dataclass(frozen=True)
class WeatherForecast:
    location_id: int
    display_name: str
    timezone_name: str
    generated_at: str
    available_start_date: str
    available_end_date: str
    freshness: WeatherFreshness
    stale_age_minutes: int | None
    daily: tuple[DailyWeather, ...]
    hourly_by_date: dict[str, tuple[HourlyWeather, ...]]

    def with_location(
        self,
        *,
        location_id: int,
        display_name: str,
        timezone_name: str,
    ) -> WeatherForecast:
        return replace(
            self,
            location_id=location_id,
            display_name=display_name,
            timezone_name=timezone_name,
        )

    def with_freshness(
        self,
        freshness: WeatherFreshness,
        stale_age_minutes: int | None,
    ) -> WeatherForecast:
        return replace(
            self,
            freshness=freshness,
            stale_age_minutes=stale_age_minutes,
        )

    def daily_response(self) -> dict[str, object]:
        return {
            "location_id": self.location_id,
            "display_name": self.display_name,
            "timezone_name": self.timezone_name,
            "generated_at": self.generated_at,
            "available_start_date": self.available_start_date,
            "available_end_date": self.available_end_date,
            "freshness": self.freshness,
            "stale_age_minutes": self.stale_age_minutes,
            "daily": [item.to_dict() for item in self.daily],
        }

    def hourly_response(self, requested_date: str) -> dict[str, object]:
        return {
            "location_id": self.location_id,
            "display_name": self.display_name,
            "timezone_name": self.timezone_name,
            "generated_at": self.generated_at,
            "available_start_date": self.available_start_date,
            "available_end_date": self.available_end_date,
            "freshness": self.freshness,
            "stale_age_minutes": self.stale_age_minutes,
            "date": requested_date,
            "hourly": [
                item.to_dict()
                for item in self.hourly_by_date[requested_date]
            ],
        }
