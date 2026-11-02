# Training Intelligence Weather Architecture

## 1. Purpose and scope

Saved Locations are durable Plan-domain records. Weather is a read-only
training-web service that consumes a location's server-side coordinates and
IANA timezone. Weather is a consumer of Locations, not their owner.

## 2. Implemented architecture

```text
Plan UI / future Coach / future authorized ETL HTTP client
    -> TI read-only Weather API in training-web
    -> Weather service and process-local cache
    -> provider-neutral adapter boundary
    -> Open-Meteo V1
```

`training-web` owns geocoding, saved-location APIs, and Weather behavior.
`training-etl` owns schema evolution and does not import Weather Python code.
A future ETL feature may consume the normalized Weather HTTP API only through a
separately approved integration.

## 3. Saved Locations

A saved location has a stable `location_id`, friendly `display_name`,
server-side latitude and longitude, IANA `timezone_name`, `location_type`,
`lifecycle_state` (`active`, `hidden`, or `archived`), and Home/default
designation. Rename and lifecycle changes preserve identity. Referenced
locations remain durable; permanent deletion is allowed only when no Plan
template or item references the location.

Normal browser/API payloads expose display and selection metadata, not
coordinates. Locations has a dedicated Settings tab. Compact-row visual polish
is deferred UX work, not an architecture change.

## 4. Geocoding and location creation

Geoapify is used only to search for places, revalidate a selected place, and
create a saved location. Calls are server-side. `GEOAPIFY_API_KEY` is supplied
to the `training-web` container through `/etc/training/.env`.

The browser submits an opaque provider place ID, not trusted coordinates.
`training-web` revalidates the place and stores its coordinates and timezone
internally. Normal Plan use, Weather retrieval, and location rename, hide,
archive, or restore do not call Geoapify. Normal client responses include no
raw provider payload or coordinates.

## 5. Plan Environment and location snapshots

The Environment values are `outdoor`, `indoor`, `either`, and
`not_applicable`. Templates require an Environment and may have an optional
`saved_location_id`. Scheduling copies both values to the Plan item snapshot.
An item override changes only that item; later template edits do not rewrite
scheduled items.

Existing records were backfilled to `not_applicable` with null location.
Hidden or archived locations remain readable through existing references but
are unavailable for new selection. A template-scheduled item with no
template-specific location uses active Home when available; without Home its
`saved_location_id` remains null. Manually created items keep their explicit
optional location.

Automatic per-day Weather-location selection is deferred to Slice 5; it is not
implemented by Plan today. See the [Plan vertical-slice architecture](./ARD/PLAN_VERTICAL_SLICE_ARCHITECTURE.md)
for the owning Plan contract.

## 6. Weather provider and normalization

Open-Meteo is the single V1 forecast provider. The selected public forecast
endpoint requires no Open-Meteo account or API key. Forecasts cover up to 16
days. TI requests Fahrenheit, mph, inches, the saved location's IANA timezone,
daily summaries, and hourly details.

Open-Meteo URLs, field names, units, response shape, and WMO weather codes stay
inside the adapter. TI-owned conditions are `clear`, `partly_cloudy`, `cloudy`,
`fog`, `rain`, `snow`, `storm`, and `unknown`.

The normalized daily contract contains local date and condition; high/low
temperature in Fahrenheit; precipitation probability and amounts in inches;
snowfall; maximum wind speed, direction, and gust; and local sunrise/sunset.
The hourly contract contains local timestamp and condition; temperature and
apparent temperature in Fahrenheit; precipitation probability and amounts;
snowfall; wind speed, direction, and gust; and a daylight flag. Daily high and
low temperatures may be null at the incomplete forecast horizon. Unsupported
forecast dates are distinct from provider unavailability.

## 7. Cache architecture

The cache is private, process-local in-memory state in `training-web`. It uses
an `OrderedDict` LRU keyed by `saved_location_id` and stores normalized TI
forecasts only, never raw provider payloads.

- Fresh TTL: 30 minutes.
- Stale fallback limit: 6 hours from the last successful provider retrieval.
- Maximum entries: 32, with least-recently-used eviction.
- One global `threading.Lock` protects cache structure; network calls happen
  outside the lock.
- Duplicate simultaneous provider calls are acceptable at current scale.
- There is no retry loop, background refresh, cache warming, SQL, Redis, disk
  persistence, Docker volume, or separate cache service.

The current single Uvicorn process shares its cache across clients using the
same `training-web` API. Application reload, deployment, or container restart
clears the cache. A future multi-process deployment would have one cache per
process and would require a separate architecture decision only if that became
operationally material.

## 8. Read-only Weather API

```text
GET /api/weather/locations/{saved_location_id}/forecast
GET /api/weather/locations/{saved_location_id}/hourly?date=YYYY-MM-DD
```

`saved_location_id` is the public lookup input; coordinates remain internal.
The forecast response contains location metadata, freshness, available date
range, and daily summaries. The hourly response contains one supported local
date and normalized hourly entries. Neither endpoint mutates Plan data.

- `404`: saved location does not exist.
- `422`: date is invalid or outside the available forecast.
- `503`: provider is unavailable and no usable stale forecast exists.
- `200` with `freshness=stale`: an eligible stale forecast is returned.

Responses contain no coordinates, raw provider fields, or provider weather
codes.

## 9. Failure behavior

A fresh cache hit is returned without a provider request. An expired entry
triggers a provider refresh. If refresh fails, an entry younger than the
six-hour stale limit may be returned as stale; otherwise the request is
unavailable. Provider failure does not extend the stale lifetime. Malformed
provider responses fail safely.

Weather unavailability does not block Plan, Locations, or training-data
workflows. Nullable daily temperature extremes and daily/hourly wind-gust
values remain null when Open-Meteo reports them unavailable; required weather
values are not replaced with zero.

## 10. Privacy and security boundaries

Exact coordinates and Home address are server-side data. Normal API responses
may include a friendly `display_name` but never coordinates. Sanitized logs may
include `location_id`, provider, cache outcome, freshness, elapsed time, date
range, and exception category. Logs must not include coordinates, Home address,
secrets, environment variables, or complete provider payloads.

Automated tests patch external network boundaries.

## 11. Testing and validation

Automated tests use synthetic provider payloads and fake clocks. Default tests
make no real Geoapify, Open-Meteo, OpenAI, Strava, production API, or production
PostgreSQL calls. Provider integration work may use one early sanitized live
contract probe only when explicitly authorized; fixtures should then reflect
the observed valid shape. Full provider payloads, coordinates, and secrets are
never printed.

Focused tests cover normalization, privacy, cache freshness and stale
behavior, LRU limits, error mapping, and route contracts. Read-only live checks
report only sanitized metadata. Playwright is not used for server-only Weather
foundation work.

## 12. Current implementation status

Completed through Slice 4:

- Reverse Plan calendar order.
- Saved-location foundation.
- Plan Environment and location snapshots.
- Location search and management.
- Dedicated Locations Settings tab.
- Normalized Weather service, cache, and read-only APIs.

Plan day-header Weather and Coach Weather integration are not implemented.

## 13. Deferred roadmap and integration rules

- Slice 5: Plan Weather UI, automatic daily location resolution, compact
  header, `+N` summary, and hourly detail.
- Slice 6: Coach Weather context.
- Future optional ETL HTTP consumption requires a separately approved slice.
- Locations-tab visual polish remains deferred.
- Provider replacement belongs inside the adapter while TI contracts remain
  stable. Plan UI, Coach, and ETL must not depend on Open-Meteo field names or
  weather codes.

## 14. Operational notes

Open-Meteo requires no secret for this V1 endpoint. Geoapify requires
`GEOAPIFY_API_KEY` in `/etc/training/.env`; the `training-web` container must
be recreated to load changed container environment variables. The Weather
cache is intentionally empty after restart and refills on demand. Forecasts
are not persisted, so there is no Weather database migration or cleanup
procedure.
