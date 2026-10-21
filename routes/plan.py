"""Bounded Plan category/template reads and template mutations."""

import logging
from decimal import Decimal, InvalidOperation
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    BeforeValidator,
    ValidationError,
)
from fastapi.responses import JSONResponse

from db import db_conn, json_safe
from services.plan_service import (
    PlanCategoryNotFound,
    PlanOwnershipCorrupt,
    PlanTemplateNotFound,
    create_template,
    deactivate_template,
    load_template_detail,
    update_template,
)
from services.plan_preferences_service import (
    get_plan_view_preferences,
    update_plan_view_preferences,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _strict_decimal(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("must be a JSON number")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("must be a valid decimal") from None


def _required_text(value):
    if not isinstance(value, str):
        raise ValueError("must be a string")
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


def _optional_text(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("must be a string or null")
    value = value.strip()
    return value or None


PlanDecimal = Annotated[Decimal, BeforeValidator(_strict_decimal)]
RequiredText = Annotated[StrictStr, BeforeValidator(_required_text)]
OptionalText = Annotated[str | None, BeforeValidator(_optional_text)]


class PlanPrescriptionSegmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    segment_order: StrictInt = Field(gt=0)
    segment_name: OptionalText = Field(max_length=200)
    repeat_group_key: StrictInt | None = Field(gt=0, le=32767)
    repeat_count: StrictInt = Field(gt=0, le=32767)
    target_duration_min: PlanDecimal | None = Field(
        ge=0,
        max_digits=7,
        decimal_places=2,
    )
    target_metric: RequiredText = Field(max_length=100)
    zone_min: StrictInt | None = Field(gt=0, le=32767)
    zone_max: StrictInt | None = Field(gt=0, le=32767)
    target_value_min: PlanDecimal | None = Field(
        ge=0,
        max_digits=8,
        decimal_places=2,
    )
    target_value_max: PlanDecimal | None = Field(
        ge=0,
        max_digits=8,
        decimal_places=2,
    )
    instruction_text: OptionalText = Field(max_length=4000)

class PlanPrescriptionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: RequiredText = Field(max_length=200)
    description: OptionalText = Field(max_length=2000)
    sport_type: OptionalText = Field(max_length=100)
    activity_category: OptionalText = Field(max_length=100)
    trainer: StrictBool | None
    target_duration_min: PlanDecimal | None = Field(
        ge=0,
        max_digits=7,
        decimal_places=2,
    )
    target_load: StrictInt | None = Field(ge=0)
    target_load_source: OptionalText = Field(max_length=100)
    target_distance_mi: PlanDecimal | None = Field(
        ge=0,
        max_digits=10,
        decimal_places=3,
    )
    target_elevation_ft: StrictInt | None = Field(ge=0)
    instruction_text: OptionalText = Field(max_length=4000)


class PlanTemplatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_name: RequiredText = Field(max_length=200)
    template_description: OptionalText = Field(max_length=2000)
    category_id: StrictInt = Field(gt=0)
    sort_order: StrictInt = Field(ge=0)
    is_favorite: StrictBool = False
    prescription: PlanPrescriptionPayload
    segments: list[PlanPrescriptionSegmentPayload] = Field(max_length=200)


class PlanViewPreferencesPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hide_past_planned: StrictBool


def _request_origin(request: Request):
    port = request.url.port
    if port is None:
        port = 443 if request.url.scheme == "https" else 80
    return request.url.scheme.lower(), request.url.hostname.lower(), port


def _header_origin(value):
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {"http", "https"} or parsed.hostname is None:
        return None
    if parsed.username or parsed.password:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80
    return parsed.scheme.lower(), parsed.hostname.lower(), port


def _mutation_guard(request: Request):
    expected = _request_origin(request)
    for header_name in ("origin", "referer"):
        header_value = request.headers.get(header_name)
        if header_value is None:
            continue
        parsed = _header_origin(header_value)
        if parsed != expected:
            return JSONResponse(
                {"detail": "Cross-origin Plan mutations are not allowed."},
                status_code=403,
            )
    return None


@router.get("/api/plan/preferences")
def api_plan_preferences_get():
    try:
        return get_plan_view_preferences()
    except Exception:
        logger.exception("Unable to read Plan view preferences")
        return JSONResponse(
            {"detail": "Plan preferences are temporarily unavailable."},
            status_code=503,
        )


@router.put("/api/plan/preferences")
async def api_plan_preferences_update(request: Request):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response

    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"detail": "Invalid Plan preference payload."}, status_code=400)

    try:
        payload = PlanViewPreferencesPayload.model_validate(body)
    except ValidationError:
        return JSONResponse({"detail": "Invalid Plan preference payload."}, status_code=400)

    try:
        return update_plan_view_preferences(payload.hide_past_planned)
    except Exception:
        logger.exception("Unable to update Plan view preferences")
        return JSONResponse(
            {"detail": "Plan preferences are temporarily unavailable."},
            status_code=503,
        )


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
        "is_favorite": row["is_favorite"],
        "category": _category_payload(row, include_sort_order=False),
        "prescription": _prescription_payload(row),
    }


def _template_detail_payload(row, segments):
    return {
        "plan_template_id": row["plan_template_id"],
        "template_name": row["template_name"],
        "template_description": row["template_description"],
        "sort_order": row["sort_order"],
        "is_favorite": row["is_favorite"],
        "is_active": row["is_active"],
        "category": _category_payload(row),
        "prescription": _prescription_payload(row, segments),
    }


def _unavailable(detail):
    logger.exception("Plan persistence read failed.")
    return JSONResponse({"detail": detail}, status_code=503)


def _validate_semantic_payload(payload: PlanTemplatePayload):
    orders = [segment.segment_order for segment in payload.segments]
    if orders != list(range(1, len(payload.segments) + 1)):
        raise HTTPException(
            status_code=400,
            detail="segment_order values must be contiguous from 1",
        )

    for segment in payload.segments:
        if segment.repeat_group_key is None and segment.repeat_count != 1:
            raise HTTPException(
                status_code=400,
                detail="repeat_count must be 1 without a repeat group",
            )
        zones_complete = (
            segment.zone_min is not None and segment.zone_max is not None
        )
        values_complete = (
            segment.target_value_min is not None
            and segment.target_value_max is not None
        )
        if (segment.zone_min is None) != (segment.zone_max is None):
            raise HTTPException(
                status_code=400,
                detail="zone_min and zone_max must be provided together",
            )
        if (segment.target_value_min is None) != (
            segment.target_value_max is None
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "target_value_min and target_value_max must be provided "
                    "together"
                ),
            )
        if zones_complete and segment.zone_min > segment.zone_max:
            raise HTTPException(
                status_code=400,
                detail="zone_min must not exceed zone_max",
            )
        if values_complete and (
            segment.target_value_min > segment.target_value_max
        ):
            raise HTTPException(
                status_code=400,
                detail="target_value_min must not exceed target_value_max",
            )
        if zones_complete and values_complete:
            raise HTTPException(
                status_code=400,
                detail="zone and value targets are mutually exclusive",
            )
        if segment.target_metric == "none" and (
            zones_complete or values_complete
        ):
            raise HTTPException(
                status_code=400,
                detail="target_metric none cannot have a target",
            )
        if segment.target_metric != "none" and not (
            zones_complete or values_complete
        ):
            raise HTTPException(
                status_code=400,
                detail="non-none target_metric requires a zone or value target",
            )
        if not any(
            (
                segment.segment_name,
                segment.instruction_text,
                segment.target_duration_min is not None,
                zones_complete,
                values_complete,
            )
        ):
            raise HTTPException(
                status_code=400,
                detail="segment must contain meaningful content",
            )


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
                            pt.is_favorite,
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
                            pt.is_favorite,
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
                detail = load_template_detail(cur, plan_template_id)
                if detail is None:
                    return JSONResponse({"detail": "Plan template not found."}, status_code=404)
    except Exception:
        return _unavailable("Plan templates are unavailable.")

    return JSONResponse(_template_detail_payload(detail.row, detail.segments))


def _mutation_error(exc):
    if isinstance(exc, PlanCategoryNotFound):
        return JSONResponse({"detail": "Plan category not found."}, status_code=404)
    if isinstance(exc, PlanTemplateNotFound):
        return JSONResponse({"detail": "Plan template not found."}, status_code=404)
    if isinstance(exc, PlanOwnershipCorrupt):
        return JSONResponse(
            {"detail": "Plan template ownership is invalid."},
            status_code=409,
        )
    logger.exception("Plan template mutation failed.")
    return JSONResponse(
        {"detail": "Plan template persistence is unavailable."},
        status_code=503,
    )


@router.post("/api/plan/templates", status_code=201)
def api_plan_template_create(request: Request, payload: PlanTemplatePayload):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    _validate_semantic_payload(payload)
    try:
        detail = create_template(payload)
    except Exception as exc:
        return _mutation_error(exc)
    return JSONResponse(_template_detail_payload(detail.row, detail.segments), status_code=201)


@router.put("/api/plan/templates/{plan_template_id}")
def api_plan_template_update(
    plan_template_id: int,
    request: Request,
    payload: PlanTemplatePayload,
):
    if plan_template_id <= 0:
        return JSONResponse(
            {"detail": "plan_template_id must be positive."},
            status_code=400,
        )
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    _validate_semantic_payload(payload)
    try:
        detail = update_template(plan_template_id, payload)
    except Exception as exc:
        return _mutation_error(exc)
    return JSONResponse(_template_detail_payload(detail.row, detail.segments))


@router.post("/api/plan/templates/{plan_template_id}/deactivate")
def api_plan_template_deactivate(plan_template_id: int, request: Request):
    if plan_template_id <= 0:
        return JSONResponse(
            {"detail": "plan_template_id must be positive."},
            status_code=400,
        )
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    try:
        return JSONResponse(deactivate_template(plan_template_id))
    except Exception as exc:
        return _mutation_error(exc)
