# Zones CSV export

Cross-export ownership, transport safety, and live validation guidance is
documented in [CSV_EXPORTS.md](../CSV_EXPORTS.md).

The Zones pane has one `Export CSV` action beside the existing row-limit control. The visible table is rendered directly from `AppState.zonesRows` in array order; the `zonesLimit` selection controls the request limit (`26`, `60`, or `260`). There are no client filters, pagination, expansion, or secondary visible tables.

The browser posts only the structured values from the current visible rows to the feature-owned `POST /api/zones/export` endpoint. This preserves the exact rendered row set and order if the underlying weekly summary changes after the table loads. The endpoint accepts only the selected allowed limit and the exact Zones row schema, rejects empty, oversized, duplicate, or non-newest-first input, and uses the shared E1 CSV serializer. It does not accept HTML, arbitrary columns, SQL, filenames, or a generic row export contract.

One CSV row corresponds to one visible table row. The ordered fields match the structured values rendered by the current 12-column Zones table:

`week_start,ride_time_hhmm,zone_flag,z1_z2_pct,z3_pct,z4_z5_pct,z1_hhmm,z2_hhmm,z3_hhmm,z4_hhmm,z5_hhmm,ride_count`

The hidden `week_end` API value and any other unrendered fields are excluded. Percentages remain numeric, durations use the existing `HH:MM` values, nulls remain blank, and numeric zeroes remain zero. Rows remain newest week first. The fixed filename is `training-zones.csv`; download and CSV serialization use the existing web-owned `window.api.downloadCsv` and `csv_export.py` helpers with no server-side file retention.
