"""Bounded read routes for Plan categories and templates."""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import db_conn, json_safe

router = APIRouter()
logger = logging.getLogger(__name__)


def _json_value(value):
    return json_safe(value)


def _category_payload(row, include_sort_order=True):
    payload = {
        "plan_category_id": row["plan_category_id"],
        "category_key": row["category_key"],
        "category_name": row["category_name"],
        "color_key": row["color_key"],
        "icon_key": row["icon_key"],
    }
    if include_sort_order:
        payload["sort_order"] = row.get("category_sort_order", row["sort_order"])
    return {key: _json_value(value) for key, value in payload.items()}


def _prescription_payload(row, segments=None):
    payload = {
        "plan_prescription_id": row["plan_prescription_id"],
        "title": row["title"],
        "description": row["description"],
        "sport_type": row["sport_type"],
        "activity_category": row["activity_category"],
        "trainer": row["trainer"],
        "target_duration_min": row["target_duration_min"],
        "target_load": row["target_load"],
        "target_load_source": row["target_load_source"],
        "target_distance_mi": row["target_distance_mi"],
        "target_elevation_ft": row["target_elevation_ft"],
        "instruction_text": row["instruction_text"],
    }
    if "owner_kind" in row:
        payload["owner_kind"] = row["owner_kind"]
    if segments is None and "segment_count" in row:
        payload["segment_count"] = row["segment_count"]
    if segments is not None:
        payload["segments"] = [
            {
                key: _json_value(value)
                for key, value in segment.items()
            }
            for segment in segments
        ]
    return {key: _json_value(value) for key, value in payload.items()}


def _template_summary_payload(row):
    return {
        "plan_template_id": row["plan_template_id"],
        "template_name": row["template_name"],
        "template_description": row["template_description"],
        "sort_order": row["sort_order"],
        "category": _category_payload(row, include_sort_order=False),
        "prescription": _prescription_payload(row),
    }


def _template_detail_payload(row, segments):
    return {
        "plan_template_id": row["plan_template_id"],
        "template_name": row["template_name"],
        "template_description": row["template_description"],
        "sort_order": row["sort_order"],
        "is_active": row["is_active"],
        "category": _category_payload(row),
        "prescription": _prescription_payload(row, segments),
    }


def _unavailable(detail):
    logger.exception("Plan persistence read failed.")
    return JSONResponse({"detail": detail}, status_code=503)


@router.get("/api/plan/categories")
def api_plan_categories():
    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                        select
                            plan_category_id,
                            category_key,
                            category_name,
                            color_key,
                            icon_key,
                            sort_order
                        from public.plan_category
                        where is_active = true
                        order by sort_order asc, category_name asc, plan_category_id asc
                    """
                )
                rows = cur.fetchall()
    except Exception:
        return _unavailable("Plan categories are unavailable.")

    return JSONResponse({"categories": [_category_payload(row) for row in rows]})


@router.get("/api/plan/templates")
def api_plan_templates(category_id: int | None = None, limit: int = 100):
    if category_id is not None and category_id <= 0:
        return JSONResponse({"detail": "category_id must be positive."}, status_code=400)
    if limit < 1 or limit > 200:
        return JSONResponse({"detail": "limit must be between 1 and 200."}, status_code=400)

    category_filter = ""
    params = [limit]
    if category_id is not None:
        category_filter = "and pt.plan_category_id = %s"
        params = [category_id, limit]

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                        select
                            pt.plan_template_id,
                            pt.template_name,
                            pt.template_description,
                            pt.sort_order,
                            pc.plan_category_id,
                            pc.category_key,
                            pc.category_name,
                            pc.color_key,
                            pc.icon_key,
                            pp.plan_prescription_id,
                            pp.title,
                            pp.description,
                            pp.sport_type,
                            pp.activity_category,
                            pp.trainer,
                            pp.target_duration_min,
                            pp.target_load,
                            pp.target_load_source,
                            pp.target_distance_mi,
                            pp.target_elevation_ft,
                            pp.instruction_text,
                            count(pps.plan_prescription_segment_id)::integer as segment_count
                        from public.plan_template pt
                        join public.plan_category pc
                            on pc.plan_category_id = pt.plan_category_id
                        join public.plan_prescription pp
                            on pp.plan_prescription_id = pt.plan_prescription_id
                           and pp.owner_kind = 'template'
                        left join public.plan_prescription_segment pps
                            on pps.plan_prescription_id = pp.plan_prescription_id
                        where pt.is_active = true
                          {category_filter}
                        group by
                            pt.plan_template_id,
                            pt.template_name,
                            pt.template_description,
                            pt.sort_order,
                            pc.plan_category_id,
                            pc.category_key,
                            pc.category_name,
                            pc.color_key,
                            pc.icon_key,
                            pp.plan_prescription_id,
                            pp.title,
                            pp.description,
                            pp.sport_type,
                            pp.activity_category,
                            pp.trainer,
                            pp.target_duration_min,
                            pp.target_load,
                            pp.target_load_source,
                            pp.target_distance_mi,
                            pp.target_elevation_ft,
                            pp.instruction_text
                        order by pt.sort_order asc, pt.template_name asc, pt.plan_template_id asc
                        limit %s
                    """,
                    params,
                )
                rows = cur.fetchall()
    except Exception:
        return _unavailable("Plan templates are unavailable.")

    return JSONResponse({"templates": [_template_summary_payload(row) for row in rows]})


@router.get("/api/plan/templates/{plan_template_id}")
def api_plan_template_detail(plan_template_id: int):
    if plan_template_id <= 0:
        return JSONResponse({"detail": "plan_template_id must be positive."}, status_code=400)

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                        select
                            pt.plan_template_id,
                            pt.template_name,
                            pt.template_description,
                            pt.sort_order,
                            pt.is_active,
                            pc.plan_category_id,
                            pc.category_key,
                            pc.category_name,
                            pc.color_key,
                            pc.icon_key,
                            pc.sort_order as category_sort_order,
                            pp.plan_prescription_id,
                            pp.owner_kind,
                            pp.title,
                            pp.description,
                            pp.sport_type,
                            pp.activity_category,
                            pp.trainer,
                            pp.target_duration_min,
                            pp.target_load,
                            pp.target_load_source,
                            pp.target_distance_mi,
                            pp.target_elevation_ft,
                            pp.instruction_text
                        from public.plan_template pt
                        join public.plan_category pc
                            on pc.plan_category_id = pt.plan_category_id
                        join public.plan_prescription pp
                            on pp.plan_prescription_id = pt.plan_prescription_id
                           and pp.owner_kind = 'template'
                        where pt.plan_template_id = %s
                          and pt.is_active = true
                    """,
                    (plan_template_id,),
                )
                row = cur.fetchone()
                if row is None:
                    return JSONResponse({"detail": "Plan template not found."}, status_code=404)

                cur.execute(
                    """
                        select
                            plan_prescription_segment_id,
                            segment_order,
                            segment_name,
                            repeat_group_key,
                            repeat_count,
                            target_duration_min,
                            target_metric,
                            zone_min,
                            zone_max,
                            target_value_min,
                            target_value_max,
                            instruction_text
                        from public.plan_prescription_segment
                        where plan_prescription_id = %s
                        order by segment_order asc
                    """,
                    (row["plan_prescription_id"],),
                )
                segments = cur.fetchall()
    except Exception:
        return _unavailable("Plan templates are unavailable.")

    return JSONResponse(_template_detail_payload(row, segments))
