Summary

The improved item should lock a dedicated Search tab, keep Daily search as a lightweight shortcut, and launch first with trusted fields already stored in Training Intelligence. Canonical geography and historical weather remain valuable later enrichments, but they should not block Search V1 or be presented as trustworthy until their source, confidence, privacy, and backfill contracts are proven.

Accepted architecture boundary

Search V1 is owned by the `training-web` repository and its browser-facing service. The path is:

```text
Browser -> training-web /api/activities/search
	-> bounded parameterized read-only PostgreSQL query
	-> shaped response -> Browser
```

`training-etl` remains the owner of schema evolution, ingestion, normalization, and field semantics. Search V1 does not require a new `training-api` endpoint merely to read processed activity rows. `training-api` remains reserved for explicitly approved synchronous ETL operations and coordinated ETL-owned contracts such as Coach context. See `training-etl/docs/ARD/TRAINING_SYSTEM_SERVICE_BOUNDARIES.md` for the cross-service decision.

Enhanced Activity Search, Preview, and CSV Export

Priority: High | Status/Gate: Architecture investigation, then a minimal vertical slice using trusted existing data

Product need

Training Intelligence contains rich activity data that is difficult to explore outside the fixed Daily, Weekly, Gear, and Coach views. Important fields such as activity start time, elapsed time, detailed metrics, Strava description, and private note may exist locally but remain difficult to search, compare, or export.

Create a reusable:

Search → Filter → Preview → Open → Export

workflow over persisted activity and related training data.

This becomes a low-code integration boundary for:

Historical activity analysis
Battery and equipment research
Excel
Copilot and other trusted AI tools
Future bounded Coach retrieval
Data-quality investigation
Personal reporting

The feature should use authoritative persisted data and stable contracts rather than create a custom endpoint for every historical question.

Product and UX decision

Build a dedicated Search tab as the primary workspace.

Daily may retain or later receive a lightweight search shortcut for finding a known date or activity, but Daily should remain a compact training-summary surface. Advanced filters, result previews, column selection, privacy controls, and export belong in the Search tab.

Both surfaces should eventually use the same typed search contract rather than separate search implementations.

Search V1: Trusted Existing Fields

Launch the first useful vertical slice using fields already stored locally and understood well enough to filter and export.

Date and time

Support:

Local activity date
Start time
Stop time, only when stored or reliably derived
Day of week
Month and year
Moving duration
Elapsed duration
Time-of-day range
Timezone and UTC offset where needed for accurate interpretation

This closes a demonstrated gap where Coach could identify the activity and duration but could not answer when the activity started.

Activity identity

Support:

Strava activity ID
Activity name
Sport type
Training Intelligence category
Main Ride versus Other Activity
Manual activity
Trainer activity
Commute status
Available source or upload metadata when trusted
Bike and gear

Support:

Gear ID
Canonical gear name
Bike filter
Bike role where locally maintained
E-bike versus conventional bike when represented authoritatively
Training and performance data

Support trusted persisted fields such as:

Distance
Elevation gain
Descending, when authoritatively available
Moving time
Elapsed time
Load
TID
Average and maximum heart rate
Heart-rate zone durations
Average and maximum power
Weighted or normalized power when stored
Cadence
Calories
Relative effort or perceived exertion when available
Other persisted activity metrics approved during architecture investigation

Search and export must use persisted authoritative values and must not recalculate Weekly Audit, Load, TID, Fitness, Fatigue, Form, recovery, or other authoritative metrics.

Athlete-authored narrative

Search these as separate fields:

Strava description
Strava private note

Requirements:

Private-note search must be explicitly selected and visibly labeled.
Combined searching must preserve which field matched.
Results show only a short matched excerpt.
Selecting a result opens the existing reusable activity-narrative drawer.
Complete narrative loads only on demand.
Preserve Unicode and line breaks.
Never substitute description for private note or private note for description.
Narrative remains athlete-authored observation, not measured truth or Durable Memory.

High-value use cases include:

Battery percentage remaining
Range extender use
Battery depletion
Drivetrain or suspension observations
Tire and equipment problems
Reasons for stopping early
Handling observations
Falls or technical lessons
Trail and surface comments

Do not create a brittle battery-specific parser in V1. Begin with transparent persisted-text search and collect evidence for any future structured extraction.

Search interface
Search bar

Provide a compact primary search field:

Search activities, descriptions, and private notes…

Example queries:

battery left
extender
ran out
fork harsh
cassette skipping
Trestle
Moab
knee hurt
Filter groups

Use collapsible filter groups to keep the initial page approachable.

When
Start date
End date
Quick ranges such as:
This year
Last 12 months
All history
Start-time range
Day of week
Activity
Sport type
Training Intelligence category
Main Ride or Other Activity
Manual, trainer, or commute status
Bike and gear
Bike
Gear ID
Bike role when available
Training metrics
Distance range
Elevation range
Duration range
Load range
TID range
Available heart-rate, power, cadence, and zone filters
Narrative source
Description
Private note
Both

Private-note search must require an explicit selection rather than being silently included in every text search.

Active filters

Show selected filters as removable chips, for example:

Wild ×   2025–2026 ×   Elevation > 2,500 ft ×
Private notes ×   Start before 10:00 AM ×

Sorting

Support deliberate ordering:

Newest first
Oldest first
Start time
Highest elevation
Longest distance
Longest duration
Highest Load

Column-heading sorting may be added where it remains understandable and consistent, but the initial product should not depend on turning every result-table heading into a sort control.

Relevance ranking should wait until ordinary text matching, filtering, and explicit sorting prove insufficient.

Search results

Use a compact table or result list with configurable columns.

Recommended default columns
Date
Start time
Activity
Category or type
Bike
Distance
Elevation
Duration
Load
Narrative-match indicator

When narrative matches:

Show a short highlighted excerpt.
Label the matched field as Description or Private note.
Do not show full private-note text in the result table.
Do not place private-note text in hover content.
Result actions

Selecting a result should allow Mike to:

Open the reusable activity-narrative drawer
Navigate to the corresponding Daily date
View the complete approved activity-detail fields
Select the activity for export where applicable

Do not create separate narrative presentation components for Search and Daily.

Column selection and presets

Allow Mike to choose visible and exported columns without making the default results table excessively wide.

Candidate presets:

Compact
Date
Start time
Activity
Bike
Distance
Elevation
Duration
Load
Ride analysis
Compact fields
Category
Heart rate
Power
Cadence
TID
Zone durations
Other trusted performance fields
Battery research
Date
Start time
Bike
Activity
Distance
Elevation
Duration
Description match
Private-note match

Future structured battery observations may be added only after repeated use proves that text search is insufficient.

Custom

Allow explicit selection from the approved field inventory.

CSV export

Export should follow the search workflow:

Search → Filter → Preview → Choose Columns → Export

Export requirements
Require a bounded date range or an explicit result-count ceiling.
Show an export preview containing:
Number of activities
Date range
Selected columns
Sort order
Whether description is included
Whether private note is included
Approximate output size when practical
Use stable documented column names.
Document:
Units
Timezone
Provenance
Null and missing-data semantics
Export timestamp
Preserve Unicode and line breaks safely.
Use a consistent CSV encoding suitable for modern Excel.
Safe defaults

Include normal activity metadata and measurements by default.

Exclude by default:

Private note
Description
Daily Check-in notes
Sensitive health narrative
Exact coordinates
Raw provider data
Internal database fields
Secrets or operational metadata

If private notes are selected, display a concise warning:

This export contains private athlete-authored notes.

AI-safe exports

Support an explicitly selected sanitized export appropriate for upload to trusted AI tools.

The sanitized preset should:

Exclude credentials, raw JSON, and internal identifiers not needed for analysis
Exclude private notes unless specifically selected
Exclude sensitive health text by default
Use clear units and dates
Preserve field provenance
Avoid implying that athlete narrative is measured fact
Daily integration

Daily should not become the full Search workspace.

A future lightweight Daily search may support:

Date
Activity name
Bike
Basic text
Top five to ten results

Selecting a result should:

Navigate to the correct Daily date
Identify the relevant activity
Open the narrative drawer when appropriate

An Advanced Search action may open the dedicated Search tab while carrying the current query or filters forward.

Daily-table column sorting should be considered separately. It should not be bundled into Search V1 unless the architecture investigation proves it uses the same query and state contract cleanly.

Location, weather, and environmental enrichment

Canonical geography and weather are later enrichments, not Search V1 prerequisites.

Raw Strava location

Existing Strava location fields may be exposed only when clearly labeled:

Strava-reported location
Potentially missing
Potentially inconsistent
Not canonical
Not suitable for authoritative geographic aggregation without validation

Search may initially find place names through:

Activity name
Description
Private note
Existing source metadata

Do not claim that this provides trusted trail-system, route, city, or regional classification.

Canonical geography

Future investigation may establish:

Riding area
Trail system
City or region
State or country
Repeat-route identity
Generalized privacy-safe display location

This requires explicit provenance, correction, privacy, and confidence contracts.

Historical weather

Weather enrichment remains deferred because it requires decisions about:

Which point or route segment represents the activity
Activity start, midpoint, or route-average conditions
Elevation variation
Timezone and daylight-saving interpretation
Historical provider accuracy and availability
Provider cost and quotas
Confidence and missing-data semantics
Privacy-safe location inputs
Full-history backfill
Reprocessing after corrections

⚠ Risk: Inaccurate weather or location can appear authoritative and cause Coach or external analysis to explain performance, battery consumption, or safety using false conditions.

Mitigation: Do not expose enriched weather or canonical geography until source, provenance, confidence, and correction contracts are proven.

Location and weather should be added incrementally within the Search/Export capability after separate architecture investigation. They should not delay the first useful Search release.

Recommended implementation slices
Slice 0: Architecture and field inventory
Confirm repository ownership.
Inventory trustworthy strava_activities fields.
Identify joins required for gear, categories, zones, and related training data.
Define typed search parameters.
Define privacy and provenance behavior.
Identify existing reusable narrative endpoint and drawer.
Establish query, row, date-range, and export limits.
Define query-performance and indexing requirements from measured needs.
Slice 1: Minimal activity search
Dedicated Search tab
Keyword search
Date range
Start-time display
Bike
Activity type and category
Distance, elevation, duration, and Load
Bounded result count
Newest/oldest ordering
Open corresponding Daily date
Slice 2: Narrative search and drawer reuse
Separate description and private-note search
Explicit private-note control
Short labeled excerpts
Existing narrative drawer
Unicode and line-break preservation
Privacy and logging validation
Slice 3: Configurable columns and CSV export
Column selector
Safe presets
Export preview
Stable CSV contract
Explicit sensitive-field selection
Sanitized AI-upload preset
Slice 4: Additional trusted metrics and usability
Additional persisted activity metrics
More filters and sort choices
Daily shortcut into Advanced Search
Performance optimization based on measured usage
Saved searches only after repeated use proves value
Later enrichment slices
Canonical geography
Route identity
Historical weather
Surface conditions
Structured battery observations
Coach-directed retrieval using the approved bounded query contract
Acceptance direction

The initial feature is successful when:

Mike can locate historical activities using trusted existing fields.
Exact start time is available when persisted.
Description and private note remain distinct throughout search and display.
Private-note searching is explicit.
Results remain bounded and responsive.
Selecting a narrative result reuses the existing drawer.
CSV exports have stable, documented columns, units, timezone, and provenance.
Sensitive fields are excluded by default.
Sanitized exports can be safely supplied to trusted AI tools.
Search results match authoritative persisted values.
No raw provider payload, secret, or private narrative appears in logs or diagnostics.
Existing Daily, Weekly, Coach, sync, narrative, and export behavior remains stable.
Location and weather remain clearly deferred until trustworthy.
Guardrail

This is potentially large. Start with architecture investigation and a minimal vertical slice over trusted existing activity fields. Do not delay useful Search for unproven location or weather enrichment, and do not allow export flexibility to become unrestricted database access.

Main writing improvements
Locked the dedicated Search tab instead of leaving Search-tab versus Daily-panel placement unresolved.
Separated trusted Search V1 fields from future enrichment, avoiding premature promises about Strava location and historical weather.
Converted the pasted Coach example into a clear start-time product requirement.
Added the complete Search → Filter → Preview → Open → Export workflow.
Defined narrative privacy and field-fidelity behavior.
Added concrete result columns, filters, sorting, presets, export defaults, implementation slices, and acceptance criteria.
Preserved future AI and Coach integration while preventing Search from becoming an unrestricted query system.