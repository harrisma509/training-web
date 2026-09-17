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

## Components Two-Clock Contract

`GET /api/gear/components` preserves `latest_event` and `usage_since_latest_event` for compatibility. Each active component also includes additive `component_clocks` data:

```json
{
	"component_clocks": {
		"life": {
			"enabled": true,
			"state": "ready",
			"baseline_event": {},
			"baseline_event_id": 123,
			"baseline_action": "Replacement",
			"baseline_service_date": "2026-09-11",
			"usage": {"miles": 13.2, "hours": 1.2, "rides": 1, "elevation_ft": 100, "days": 5},
			"metric_availability": {"miles": true, "hours": true, "rides": true, "elevation_ft": true, "days": true},
			"snapshot_source": {"miles": "event_snapshot", "hours": "event_snapshot", "rides": "event_snapshot", "elevation_ft": "event_snapshot", "days": "event_date"},
			"review_reasons": []
		},
		"service": {}
	}
}
```

The physical-life clock is enabled by `track_life` and selects the newest normalized action `New`, `Installation`, `Replace`, or `Replacement`. The maintenance-service clock is enabled by `track_service` and selects the newest lifecycle action or one of `Inspection`, `Adjustment`, `Cleaning`, `Lubrication`, `Brake Bleed`, `Bleed`, `Sealant`, `Refresh`, `Suspension Service`, `Rebuild`, or `Lowers`. Ambiguous actions such as `Warranty`, `Tire`, `Brake Pads`, `Chain`, `Rotor`, `Wheel`, `Bearing`, and `Other` are excluded in this version.

Both clocks use the same deterministic ordering: `service_date` descending, then `created_at` descending, then `service_event_id` descending. Stored action text is preserved. No baseline IDs are persisted.

Clock states are `ready`, `partial`, `review`, `no_baseline`, or `disabled`. Disabled clocks have no baseline or usage. Enabled clocks without a qualifying event return `no_baseline`. NULL event snapshots remain unavailable in the new contract; no post-date activity fallback is used. A negative metric delta is returned as NULL, marked unavailable, and produces `newer_current_total_below_baseline_snapshot` in `review_reasons`. Explicit zero snapshots and zero deltas remain valid.

The existing compatibility usage object retains its previous latest-event selection, date fallback, and non-negative clamping behavior during this additive transition.

## Components UI Adoption

The Components table consumes `component_clocks` when it is present. The seven-column table uses `Last Event`, `Usage / Status`, `Interval`, and `Notes`; the four former Since columns are removed. A service-enabled component uses the service clock for its compact primary context; otherwise the life clock is used. Components with both clocks enabled show labeled Life and Service summaries in `Usage / Status` without adding duplicate metric columns. Disabled, no-baseline, partial, and review states remain visible and unavailable metrics render as `-`. A defensive legacy fallback uses `usage_since_latest_event` only when `component_clocks` is absent during rolling deployment.

Record Service keeps one required Action control, grouped as Replacement / installation, Maintenance, and Unclassified / other. The effect badge is explanatory only: it previews the current conservative V1 classification from the selected action and component flags. It does not add fields to the service-event payload. Ambiguous actions remain visibly unclassified and do not establish a trusted baseline.

Edit Service Event uses the same grouped Action control and effect badge. A stored action outside the standard groups is preserved unchanged in a temporary `Legacy / custom` option and remains unclassified; selecting a different action only shows a local impact notice comparing the semantic reset effect. Action changes do not recalculate snapshots or send a request, and the stored value changes only when `Save Changes` is submitted.

Add Component exposes Template and Component starting point choices (`Installed now` or `Installed previously`). Edit Component hides those controls because the existing component history owns its starting point and configuration changes do not rewrite history. Historical correction remains Service History -> Edit -> Recalculate from Strava. Tracking, preferred metric, maintenance target, and approaching-due threshold labels include plain-language guidance; the warning threshold is stored configuration for future alerts and does not currently drive alerts.
