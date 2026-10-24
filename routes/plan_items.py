"""Bounded read-only Plan item range API."""

import logging
from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, BeforeValidator, Field, StrictInt
from fastapi.responses import JSONResponse

from db import db_conn, json_safe
from routes.plan import (
    PlanPrescriptionPayload,
    PlanPrescriptionSegmentPayload,
    _mutation_guard,
    _validate_semantic_payload,
)
from services.plan_service import (
    PlanCategoryNotFound,
    PlanDateNotFuture,
    PlanItemNotEditable,
    PlanItemNotFound,
    PlanOwnershipCorrupt,
    PlanTemplateNotFound,
    cancel_plan_item,
    create_item_from_template,
    create_manual_item,
    update_plan_item,
)

router = APIRouter()
MAX_READ_RANGE_DAYS = 119
logger = logging.getLogger(__name__)
DENVER = ZoneInfo("America/Denver")


def _optional_user_note(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("must be a string or null")
    value = value.strip()
    return value or None


UserNote = Annotated[str | None, BeforeValidator(_optional_user_note)]


class CreateFromTemplatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_template_id: StrictInt = Field(gt=0)
    planned_date: date
    sort_order: StrictInt = Field(default=0, ge=0)
    user_note: UserNote = Field(default=None, max_length=4000)


class CreateManualItemPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    planned_date: date
    category_id: StrictInt = Field(gt=0)
    sort_order: StrictInt = Field(default=0, ge=0)
    user_note: UserNote = Field(default=None, max_length=4000)
    prescription: PlanPrescriptionPayload
    segments: list[PlanPrescriptionSegmentPayload] = Field(default_factory=list, max_length=200)


class UpdatePlanItemPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    planned_date: date
    sort_order: StrictInt = Field(default=0, ge=0)
    category_id: StrictInt = Field(gt=0)
    user_note: UserNote = Field(default=None, max_length=4000)
    prescription: PlanPrescriptionPayload
    segments: list[PlanPrescriptionSegmentPayload] = Field(default_factory=list, max_length=200)


def _denver_today() -> date:
    return datetime.now(DENVER).date()


def _future_date_response(planned_date):
    if planned_date <= _denver_today():
        return JSONResponse(
            {"detail": "planned_date must be after today."},
            status_code=400,
        )
    return None


def _item_mutation_error(exc):
    if isinstance(exc, PlanDateNotFuture):
        return JSONResponse(
            {"detail": "planned_date must be after today."},
            status_code=400,
        )
    if isinstance(exc, PlanCategoryNotFound):
        return JSONResponse({"detail": "Plan category not found."}, status_code=404)
    if isinstance(exc, PlanItemNotFound):
        return JSONResponse({"detail": "Plan item not found."}, status_code=404)
    if isinstance(exc, PlanItemNotEditable):
        return JSONResponse(
            {"detail": "Plan item is not editable in its current lifecycle."},
            status_code=409,
        )
    if isinstance(exc, PlanTemplateNotFound):
        return JSONResponse({"detail": "Plan template not found."}, status_code=404)
    if isinstance(exc, PlanOwnershipCorrupt):
        return JSONResponse(
            {"detail": "Plan item ownership is invalid."},
            status_code=409,
        )
    logger.exception("Plan item mutation failed.")
    return JSONResponse(
        {"detail": "Plan item persistence is unavailable."},
        status_code=503,
    )


def _unavailable():
    logger.exception("Plan item persistence read failed.")
    return JSONResponse(
        {"detail": "Plan items are unavailable."},
        status_code=503,
    )


def _safe_row(row, fields):
    return {field: json_safe(row[field]) for field in fields}


def _segment_payload(row):
    return _safe_row(
        row,
        (
            "plan_prescription_segment_id",
            "segment_order",
            "segment_name",
            "repeat_group_key",
            "repeat_count",
            "target_duration_min",
            "target_metric",
            "zone_min",
            "zone_max",
            "target_value_min",
            "target_value_max",
            "instruction_text",
        ),
    )


def _item_payload(row, segments):
    category = _safe_row(
        row,
        (
            "plan_category_id",
            "category_key",
            "category_name",
            "color_key",
            "icon_key",
        ),
    )
    source_template = None
    if row["source_template_id"] is not None:
        source_template = _safe_row(
            row,
            ("source_template_id", "template_name", "template_is_active"),
        )
        source_template = {
            "plan_template_id": source_template["source_template_id"],
            "template_name": source_template["template_name"],
            "is_active": source_template["template_is_active"],
        }

    batch = None
    if row["plan_batch_id"] is not None:
        batch = _safe_row(
            row,
            ("plan_batch_id", "batch_status", "batch_type", "batch_name"),
        )

    prescription = _safe_row(
        row,
        (
            "plan_prescription_id",
            "title",
            "description",
            "sport_type",
            "activity_category",
            "trainer",
            "target_duration_min",
            "target_load",
            "target_load_source",
            "target_distance_mi",
            "target_elevation_ft",
            "instruction_text",
        ),
    )
    prescription["segments"] = [_segment_payload(segment) for segment in segments]

    return {
        "plan_item_id": json_safe(row["plan_item_id"]),
        "planned_date": json_safe(row["planned_date"]),
        "sort_order": json_safe(row["sort_order"]),
        "item_state": json_safe(row["item_state"]),
        "item_source": json_safe(row["item_source"]),
        "user_note": json_safe(row["user_note"]),
        "category": category,
        "source_template": source_template,
        "batch": batch,
        "prescription": prescription,
    }


@router.post("/api/plan/items/from-template", status_code=201)
def api_plan_item_from_template(
    request: Request,
    payload: CreateFromTemplatePayload,
):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    date_response = _future_date_response(payload.planned_date)
    if date_response is not None:
        return date_response
    try:
        detail = create_item_from_template(payload)
    except Exception as exc:
        return _item_mutation_error(exc)
    return JSONResponse(_item_payload(detail.row, detail.segments), status_code=201)


@router.post("/api/plan/items/manual", status_code=201)
def api_plan_item_manual(
    request: Request,
    payload: CreateManualItemPayload,
):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    date_response = _future_date_response(payload.planned_date)
    if date_response is not None:
        return date_response
    _validate_semantic_payload(payload)
    try:
        detail = create_manual_item(payload)
    except Exception as exc:
        return _item_mutation_error(exc)
    return JSONResponse(_item_payload(detail.row, detail.segments), status_code=201)


@router.put("/api/plan/items/{plan_item_id}")
def api_plan_item_update(
    request: Request,
    payload: UpdatePlanItemPayload,
    plan_item_id: int = Path(gt=0),
):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    date_response = _future_date_response(payload.planned_date)
    if date_response is not None:
        return date_response
    _validate_semantic_payload(payload)
    try:
        detail = update_plan_item(plan_item_id, payload)
    except Exception as exc:
        return _item_mutation_error(exc)
    return JSONResponse(_item_payload(detail.row, detail.segments))


@router.post("/api/plan/items/{plan_item_id}/cancel")
def api_plan_item_cancel(request: Request, plan_item_id: int = Path(gt=0)):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    try:
        detail = cancel_plan_item(plan_item_id)
    except Exception as exc:
        return _item_mutation_error(exc)
    return JSONResponse(_item_payload(detail.row, detail.segments))


@router.get("/api/plan/items")
def api_plan_items(start_date: date, end_date: date):
    if start_date >= end_date:
        raise HTTPException(
            status_code=422,
            detail="start_date must be before end_date",
        )
    if (end_date - start_date).days > MAX_READ_RANGE_DAYS:
        raise HTTPException(
            status_code=422,
            detail="date range must not exceed 119 days",
        )

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                        select
                            pi.plan_item_id,
                            pi.planned_date,
                            pi.sort_order,
                            pi.item_state,
                            pi.item_source,
                            pi.user_note,
                            pc.plan_category_id,
                            pc.category_key,
                            pc.category_name,
                            pc.color_key,
                            pc.icon_key,
                            pt.plan_template_id as source_template_id,
                            pt.template_name,
                            pt.is_active as template_is_active,
                            pb.plan_batch_id,
                            pb.batch_status,
                            pb.batch_type,
                            pb.batch_name,
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
                        from public.plan_item pi
                        join public.plan_category pc
                            on pc.plan_category_id = pi.plan_category_id
                        join public.plan_prescription pp
                            on pp.plan_prescription_id = pi.plan_prescription_id
                           and pp.owner_kind = 'item'
                        left join public.plan_template pt
                            on pt.plan_template_id = pi.source_template_id
                        left join public.plan_batch pb
                            on pb.plan_batch_id = pi.plan_batch_id
                        where pi.prescription_owner_kind = 'item'
                          and pi.planned_date >= %s
                          and pi.planned_date < %s
                          and (
                              pi.item_state = 'committed'
                              or (
                                  pi.item_state = 'draft'
                                  and pb.batch_status = 'open'
                              )
                          )
                        order by
                            pi.planned_date asc,
                            pi.sort_order asc,
                            pi.plan_item_id asc
                    """,
                    (start_date, end_date),
                )
                item_rows = cur.fetchall()
                if not item_rows:
                    return JSONResponse(
                        {
                            "start_date": start_date.isoformat(),
                            "end_date": end_date.isoformat(),
                            "items": [],
                        }
                    )

                prescription_ids = [
                    row["plan_prescription_id"] for row in item_rows
                ]
                cur.execute(
                    """
                        select
                            plan_prescription_segment_id,
                            plan_prescription_id,
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
                        where plan_prescription_id = any(%s)
                        order by
                            plan_prescription_id asc,
                            segment_order asc,
                            plan_prescription_segment_id asc
                    """,
                    (prescription_ids,),
                )
                segment_rows = cur.fetchall()
    except Exception:
        return _unavailable()

    segments_by_prescription = {prescription_id: [] for prescription_id in prescription_ids}
    for row in segment_rows:
        segments_by_prescription[row["plan_prescription_id"]].append(
            _segment_payload(row)
        )
    for segments in segments_by_prescription.values():
        segments.sort(
            key=lambda segment: (
                segment["segment_order"],
                segment["plan_prescription_segment_id"],
            )
        )

    return JSONResponse(
        {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "items": [
                _item_payload(
                    row,
                    segments_by_prescription[row["plan_prescription_id"]],
                )
                for row in item_rows
            ],
        }
    )
