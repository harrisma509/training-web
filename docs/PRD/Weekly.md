# Weekly CSV export

Weekly CSV export is a browser-only download of the latest rows selected by the existing Weekly rows control. The selected limit is exactly `10`, `52`, or `520`; the displayed table request and export use the same value. The server accepts and returns up to 520 rows. Each CSV row represents one returned week, ordered by `week_start` descending. The export does not synthesize missing calendar weeks.

The export reuses the current bounded, read-only Weekly query and its existing derived values and joins. Daily activity totals, weekly average weight, and falls remain pre-aggregated to week grain. Weekly Audit and Weekly Commentary join once per week; audit-item details are not joined. Export does not recalculate training metrics.

Stable ordered CSV fields:

`week_start,week_end,weekly_total_hours,weekly_total_miles,weekly_total_elevation_ft,weekly_avg_weight,total_load,main_ride_load,other_load,activity_days,ride_count,walk_count,hike_count,strength_count,very_hard_epic_days,chronic_weekly_cw,ac_ratio,ramp_pct,status_level,status_text,vo2max,falls,audit_grade,audit_green_count,audit_yellow_count,audit_red_count,audit_summary,audit_next_week_action,weekly_comment,week_type,event,planned_focus,actual_focus,risk_note,lesson_learned,status_override,is_travel_week,is_sick_week,is_injury_week,is_bike_park_week,is_recovery_week,is_goal_week`

Nulls remain blank; numeric zeroes and booleans retain their values. CSV encoding, quoting, line endings, and spreadsheet formula protection use the shared E1 serializer. The fixed filename is `training-weekly.csv`.

The export excludes `coach_note`, `task_note`, `weekly_audit_item` details, display priority, dashboard visibility flags, audit and commentary source/timestamps, display-formatted ramp text, raw payloads, AI Coach data, SQL details, and operational metadata. There is no preview, column picker, cloud upload, or ETL artifact.
