"""TI-owned geocoding contract backed by the approved Geoapify endpoints."""

import json
import os
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


API_BASE = "https://api.geoapify.com"
REQUEST_TIMEOUT_SECONDS = 8
MAX_SEARCH_RESULTS = 5


class GeoapifyConfigurationError(RuntimeError):
    """The server-side Geoapify key is not configured."""


class GeoapifyUnavailableError(RuntimeError):
    """Geoapify could not return a usable response."""


class GeoapifyPlaceNotFoundError(LookupError):
    """Geoapify could not revalidate the selected place."""


class GeoapifyTimezoneUnavailableError(ValueError):
    """The selected place does not have a valid IANA timezone."""


def _api_key():
    key = os.environ.get("GEOAPIFY_API_KEY", "").strip()
    if not key:
        raise GeoapifyConfigurationError()
    return key


def _request_json(path, params):
    query = urlencode({**params, "apiKey": _api_key()})
    request = Request(
        f"{API_BASE}{path}?{query}",
        headers={"Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 404:
            raise GeoapifyPlaceNotFoundError() from None
        raise GeoapifyUnavailableError() from None
    except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise GeoapifyUnavailableError() from None
    if not isinstance(payload, dict):
        raise GeoapifyUnavailableError()
    return payload


def _feature_properties(payload):
    features = payload.get("features")
    if not isinstance(features, list):
        raise GeoapifyUnavailableError()
    return [
        feature["properties"]
        for feature in features
        if isinstance(feature, dict) and isinstance(feature.get("properties"), dict)
    ]


def _display_text(value, limit):
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _subtitle(properties):
    parts = []
    for value in (
        properties.get("city") or properties.get("locality"),
        properties.get("state") or properties.get("region"),
        properties.get("country"),
    ):
        part = _display_text(value, 100)
        if part and part.casefold() not in {existing.casefold() for existing in parts}:
            parts.append(part)
    return ", ".join(parts)


def search_places(query):
    """Return bounded TI-owned candidates without coordinates or raw provider data."""
    if not isinstance(query, str):
        raise ValueError("Search text must be a string.")
    normalized_query = query.strip()
    if not normalized_query:
        return []
    if len(normalized_query) > 160:
        raise ValueError("Search text is too long.")

    payload = _request_json(
        "/v1/geocode/autocomplete",
        {
            "text": normalized_query,
            "format": "geojson",
            "lang": "en",
            "limit": MAX_SEARCH_RESULTS,
        },
    )
    candidates = []
    for properties in _feature_properties(payload):
        place_id = properties.get("place_id")
        if not isinstance(place_id, str) or not 3 <= len(place_id) <= 2048:
            continue
        display_name = _display_text(
            properties.get("name")
            or properties.get("address_line1")
            or properties.get("formatted"),
            160,
        )
        if not display_name:
            continue
        candidates.append(
            {
                "place_id": place_id,
                "display_name": display_name,
                "subtitle": _subtitle(properties),
            }
        )
        if len(candidates) == MAX_SEARCH_RESULTS:
            break
    return candidates


def _coordinate(value, minimum, maximum):
    if isinstance(value, bool):
        raise GeoapifyPlaceNotFoundError()
    try:
        coordinate = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise GeoapifyPlaceNotFoundError() from None
    if not coordinate.is_finite() or not minimum <= coordinate <= maximum:
        raise GeoapifyPlaceNotFoundError()
    return coordinate


def _timezone_name(properties):
    timezone = properties.get("timezone")
    name = timezone.get("name") if isinstance(timezone, dict) else None
    if not isinstance(name, str) or not name.strip():
        return None
    return name.strip()


def _valid_timezone(name):
    if not name:
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def resolve_place(place_id):
    """Revalidate a provider place ID and return trusted server-only location data."""
    if not isinstance(place_id, str) or not 3 <= len(place_id) <= 2048:
        raise GeoapifyPlaceNotFoundError()
    details = _request_json(
        "/v2/place-details",
        {"id": place_id, "features": "details"},
    )
    properties_list = _feature_properties(details)
    if not properties_list:
        raise GeoapifyPlaceNotFoundError()
    properties = properties_list[0]

    latitude = _coordinate(properties.get("lat"), Decimal("-90"), Decimal("90"))
    longitude = _coordinate(properties.get("lon"), Decimal("-180"), Decimal("180"))
    timezone_name = _timezone_name(properties)
    if not _valid_timezone(timezone_name):
        reverse = _request_json(
            "/v1/geocode/reverse",
            {
                "lat": str(latitude),
                "lon": str(longitude),
                "format": "geojson",
                "lang": "en",
            },
        )
        reverse_properties = _feature_properties(reverse)
        timezone_name = (
            _timezone_name(reverse_properties[0])
            if reverse_properties
            else None
        )
    if not _valid_timezone(timezone_name):
        raise GeoapifyTimezoneUnavailableError()
    return {
        "latitude": latitude,
        "longitude": longitude,
        "timezone_name": timezone_name,
    }
