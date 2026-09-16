# Components Service API

## Historical Snapshot Preview

`GET /api/components/{gear_component_id}/service-snapshot?service_date=YYYY-MM-DD`

The route is read-only. It derives the bike from the component and calculates usage through the requested local service date, inclusively (`date_local <= service_date`). Future dates and malformed dates are rejected.

The response uses canonical snapshot names:

- `odometer_miles`
- `odometer_hours`
- `odometer_rides`
- `odometer_elevation_ft`
- `metric_availability`
- `calculation_succeeded`

A component with no qualifying activities returns valid zero values with all metrics available. If qualifying rows exist but every source value for one metric is `NULL`, that metric is returned as `NULL` and marked unavailable. Mixed known and missing source values sum the known values and remain marked available as a lower-bound total. Ride count remains available when the ride predicate can be evaluated.

## Create Service Event

`POST /api/components/{gear_component_id}/services`

Canonical request fields are:

- `service_date`
- `action`
- `product_name`
- `manufacturer`
- `model`
- `notes`
- `cost`
- `performed_by`
- `service_location`

`service_type`, `service_provider`, and `service_cost` remain temporary compatibility aliases. Canonical fields take precedence when both names are supplied.

The server derives `gear_id` from the component and recalculates the snapshot immediately before insert. Client-supplied snapshot fields are rejected. Stored snapshot values are historical facts and are not recalculated later.

Optional blank text and numeric values become `NULL`. Explicit numeric zero remains zero. Cost and snapshot values cannot be negative. Rides and elevation require integer values. `service_date` and `action` are required, and future service dates are rejected.

The response includes canonical service-event fields and the existing compatibility aliases used by the deployed history editor, including `service_type`, `service_provider`, `mileage_at_service`, `hours_at_service`, `rides_at_service`, and `elevation_at_service`.

## Update Compatibility

`PATCH /api/components/{gear_component_id}/services/{service_event_id}` retains the existing history-editor contract. Omitted fields preserve their current values. Explicit clearing follows the existing compatibility behavior. Future dates are rejected, negative values are rejected, and decimal rides or elevation values are rejected rather than truncated.

The Edit Service Event form loads the stored snapshot unchanged. Recalculation is explicit and uses the read-only preview route; the editor shows saved versus calculated values before any fields change. `Use Calculated Snapshot` applies available values in browser memory only, while unavailable metrics preserve their existing values. The existing `Save Changes` action is required to send the update.
