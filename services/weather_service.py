"""Saved-location resolution, normalized forecast orchestration, and local cache."""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from threading import Lock
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg

from db import db_conn
from services.open_meteo_provider import OpenMeteoError, fetch_forecast
from services.weather_models import NormalizedWeather, WeatherForecast


logger = logging.getLogger(__name__)
FRESH_TTL_SECONDS = 30 * 60
STALE_TTL_SECONDS = 6 * 60 * 60
MAX_CACHE_ENTRIES = 32
VALID_LIFECYCLE_STATES = frozenset({"active", "hidden", "archived"})


class WeatherLocationNotFoundError(LookupError):
    """The requested saved location does not exist."""


class WeatherDateError(ValueError):
    """The requested date is invalid or outside the available forecast."""

    detail = "Requested date is invalid or outside the available forecast range."


class WeatherUnavailableError(RuntimeError):
    """No usable forecast is available."""

    def __init__(self, category: str = "weather_unavailable"):
        super().__init__(category)
        self.category = category


@dataclass(frozen=True)
class _CacheEntry:
    forecast: WeatherForecast
    fetched_at: float


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coordinate(value: object, minimum: Decimal, maximum: Decimal) -> Decimal:
    if isinstance(value, bool):
        raise ValueError
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError from None
    if not number.is_finite() or not minimum <= number <= maximum:
        raise ValueError
    return number


class WeatherService:
    def __init__(
        self,
        *,
        provider=None,
        monotonic=None,
        utcnow=None,
    ):
        self._provider = provider or fetch_forecast
        self._monotonic = monotonic or time.monotonic
        self._utcnow = utcnow or _utc_now
        self._cache: OrderedDict[int, _CacheEntry] = OrderedDict()
        self._cache_lock = Lock()

    def _load_location(self, location_id: int) -> dict[str, object]:
        try:
            with db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                            location_id,
                            display_name,
                            latitude,
                            longitude,
                            timezone_name,
                            lifecycle_state
                        FROM public.saved_location
                        WHERE location_id = %s
                        """,
                        (location_id,),
                    )
                    row = cur.fetchone()
        except (psycopg.Error, KeyError, OSError):
            logger.warning(
                "Weather location lookup unavailable; saved_location_id=%s category=database_unavailable",
                location_id,
            )
            raise WeatherUnavailableError("database_unavailable") from None

        if row is None:
            raise WeatherLocationNotFoundError()

        try:
            if type(row["location_id"]) is not int or row["location_id"] != location_id:
                raise ValueError
            display_name = row["display_name"]
            if not isinstance(display_name, str) or not display_name.strip():
                raise ValueError
            timezone_name = row["timezone_name"]
            if not isinstance(timezone_name, str):
                raise ValueError
            ZoneInfo(timezone_name)
            lifecycle_state = row["lifecycle_state"]
            if lifecycle_state not in VALID_LIFECYCLE_STATES:
                raise ValueError
            latitude = _coordinate(row["latitude"], Decimal("-90"), Decimal("90"))
            longitude = _coordinate(row["longitude"], Decimal("-180"), Decimal("180"))
        except (InvalidOperation, KeyError, TypeError, ValueError, ZoneInfoNotFoundError):
            logger.warning(
                "Weather location is invalid; saved_location_id=%s category=invalid_saved_location",
                location_id,
            )
            raise WeatherUnavailableError("invalid_saved_location") from None

        return {
            "location_id": location_id,
            "display_name": display_name,
            "latitude": latitude,
            "longitude": longitude,
            "timezone_name": timezone_name,
            "lifecycle_state": lifecycle_state,
        }

    def _cached_entry(self, location_id: int) -> tuple[_CacheEntry | None, float | None]:
        now = self._monotonic()
        with self._cache_lock:
            entry = self._cache.get(location_id)
            if entry is None:
                return None, None
            age = max(0.0, now - entry.fetched_at)
            if age >= STALE_TTL_SECONDS:
                del self._cache[location_id]
                return None, None
            self._cache.move_to_end(location_id)
            return entry, age

    @staticmethod
    def _with_location(
        forecast: WeatherForecast,
        location: dict[str, object],
    ) -> WeatherForecast:
        return forecast.with_location(
            location_id=location["location_id"],
            display_name=location["display_name"],
            timezone_name=location["timezone_name"],
        )

    def _freshness(self, forecast: WeatherForecast) -> WeatherForecast:
        return forecast.with_freshness("fresh", None)

    def _insert_cache(self, location_id: int, forecast: WeatherForecast) -> None:
        entry = _CacheEntry(forecast=forecast, fetched_at=self._monotonic())
        with self._cache_lock:
            self._cache[location_id] = entry
            self._cache.move_to_end(location_id)
            while len(self._cache) > MAX_CACHE_ENTRIES:
                self._cache.popitem(last=False)

    def get_forecast(self, location_id: int) -> WeatherForecast:
        if type(location_id) is not int or location_id < 1:
            raise WeatherLocationNotFoundError()
        location = self._load_location(location_id)
        entry, age = self._cached_entry(location_id)
        if entry is not None and age is not None and age < FRESH_TTL_SECONDS:
            return self._freshness(self._with_location(entry.forecast, location))

        try:
            normalized = self._provider(
                location["latitude"],
                location["longitude"],
                location["timezone_name"],
            )
        except OpenMeteoError as error:
            if entry is not None:
                stale_age = max(0.0, self._monotonic() - entry.fetched_at)
                if stale_age < STALE_TTL_SECONDS:
                    logger.warning(
                        "Weather stale fallback; saved_location_id=%s category=%s",
                        location_id,
                        error.category,
                    )
                    stale = self._with_location(entry.forecast, location)
                    return stale.with_freshness("stale", int(stale_age // 60))
            logger.warning(
                "Weather unavailable; saved_location_id=%s category=%s",
                location_id,
                error.category,
            )
            raise WeatherUnavailableError(error.category) from None

        if not isinstance(normalized, NormalizedWeather):
            raise WeatherUnavailableError("invalid_normalized_forecast")
        generated_at = self._utcnow()
        if generated_at.tzinfo is None or generated_at.utcoffset() is None:
            raise WeatherUnavailableError("invalid_generation_time")
        forecast = WeatherForecast(
            location_id=location["location_id"],
            display_name=location["display_name"],
            timezone_name=location["timezone_name"],
            generated_at=generated_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            available_start_date=normalized.available_start_date,
            available_end_date=normalized.available_end_date,
            freshness="fresh",
            stale_age_minutes=None,
            daily=normalized.daily,
            hourly_by_date=normalized.hourly_by_date,
        )
        self._insert_cache(location_id, forecast)
        return forecast

    def get_hourly_forecast(self, location_id: int, requested_date: str) -> WeatherForecast:
        try:
            parsed_date = date.fromisoformat(requested_date)
        except (TypeError, ValueError):
            raise WeatherDateError() from None
        if parsed_date.isoformat() != requested_date:
            raise WeatherDateError()

        forecast = self.get_forecast(location_id)
        start = date.fromisoformat(forecast.available_start_date)
        end = date.fromisoformat(forecast.available_end_date)
        if not start <= parsed_date <= end or requested_date not in forecast.hourly_by_date:
            raise WeatherDateError()
        return forecast


weather_service = WeatherService()
