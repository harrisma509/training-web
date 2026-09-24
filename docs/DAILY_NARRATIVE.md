# Daily Main Ride Narrative

The Daily API exposes only two presence fields for the Main Ride:

- `main_ride_has_description`
- `main_ride_has_private_note`

They are derived from non-null, non-empty persisted values in `strava_activities`. Provider observation flags do not create a content indicator. The ordinary Daily response never includes narrative text.

The read-only endpoint is:

```text
GET /api/activities/{activity_id}/narrative
```

It validates the activity ID through the route contract, performs one bounded lookup in `strava_activities`, and returns only `activity_id`, nullable `description`, nullable `private_note`, the two `has_*` booleans, and `narrative_observed_at`. Unknown activities return 404; database failures return a sanitized 503. It does not return `raw_json`, unrelated activity fields, or provider credentials.

The route accepts a numeric activity ID for request validation, then converts it to a text query parameter at the PostgreSQL boundary because the canonical `strava_activities.activity_id` column is text.

The Daily table renders one compact accessible note button beside a Main Ride link when either presence field is true on desktop. At widths up to 1050px, the Main Ride trigger is hidden and an equivalent 32px trigger is shown beside the visible Load value, so phone and tablet users can discover the control without horizontal scrolling even when later columns are not visible. Both triggers use the same activity ID, endpoint, and drawer target; no new table column is added. The button opens one drawer directly below the originating row and fetches the narrative on demand. Description and clearly labeled Private Note content are rendered as text with preserved line breaks; narrative is never interpreted as HTML or Markdown. Only one drawer is open at a time. Switching rows replaces the drawer, closing the active button removes it, and stale responses are ignored. Successful responses are cached in page memory only and are never written to local or session storage.

Narrative search, Other Activity indicators, exports, Coach context, editing, and Strava write-back remain outside this slice.
