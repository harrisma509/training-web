"""Transactional persistence helpers for Plan template mutations."""

from dataclasses import dataclass

from db import db_conn


class PlanServiceError(Exception):
    """Base class for expected Plan persistence errors."""


class PlanCategoryNotFound(PlanServiceError):
    pass


class PlanTemplateNotFound(PlanServiceError):
    pass


class PlanDateNotFuture(PlanServiceError):
    pass


class PlanItemNotFound(PlanServiceError):
    pass


class PlanItemNotEditable(PlanServiceError):
    pass


class PlanOwnershipCorrupt(PlanServiceError):
    pass


@dataclass(frozen=True)
class TemplateDetail:
    row: dict
    segments: list[dict]


@dataclass(frozen=True)
class PlanItemDetail:
    row: dict
    segments: list[dict]


def _detail_queries(cur, plan_template_id, *, active_only):
    active_clause = "and pt.is_active = true" if active_only else ""
    cur.execute(
        f"""
            select
                pt.plan_template_id,
                pt.template_name,
                pt.template_description,
                pt.sort_order,
                pt.is_active,
                pt.is_favorite,
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
              {active_clause}
        """,
        (plan_template_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None

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
    return TemplateDetail(row=row, segments=cur.fetchall())


def load_template_detail(cur, plan_template_id, *, active_only=True):
    """Load one template detail using the shared Plan detail query shape."""
    return _detail_queries(cur, plan_template_id, active_only=active_only)


def _require_active_category(cur, category_id):
    cur.execute(
        """
            select plan_category_id
            from public.plan_category
            where plan_category_id = %s
              and is_active = true
        """,
        (category_id,),
    )
    if cur.fetchone() is None:
        raise PlanCategoryNotFound()


def _segment_value(segment, key):
    if isinstance(segment, dict):
        return segment[key]
    return getattr(segment, key)


def _insert_segments(cur, prescription_id, segments):
    for segment in segments:
        cur.execute(
            """
                insert into public.plan_prescription_segment (
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
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                prescription_id,
                _segment_value(segment, "segment_order"),
                _segment_value(segment, "segment_name"),
                _segment_value(segment, "repeat_group_key"),
                _segment_value(segment, "repeat_count"),
                _segment_value(segment, "target_duration_min"),
                _segment_value(segment, "target_metric"),
                _segment_value(segment, "zone_min"),
                _segment_value(segment, "zone_max"),
                _segment_value(segment, "target_value_min"),
                _segment_value(segment, "target_value_max"),
                _segment_value(segment, "instruction_text"),
            ),
        )


def _require_future_date(cur, planned_date):
    cur.execute(
        """
            select (
                (current_timestamp at time zone 'America/Denver')::date
                < %s::date
            ) as is_future
        """,
        (planned_date,),
    )
    if not cur.fetchone()["is_future"]:
        raise PlanDateNotFuture()


def _require_not_past_date(cur, planned_date):
    cur.execute(
        """
            select (
                (current_timestamp at time zone 'America/Denver')::date
                <= %s::date
            ) as is_not_past
        """,
        (planned_date,),
    )
    if not cur.fetchone()["is_not_past"]:
        raise PlanDateNotFuture()


def _load_item_detail(cur, plan_item_id):
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
            where pi.plan_item_id = %s
              and pi.prescription_owner_kind = 'item'
        """,
        (plan_item_id,),
    )
    row = cur.fetchone()
    if row is None:
        return None
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
            where plan_prescription_id = %s
            order by segment_order asc
        """,
        (row["plan_prescription_id"],),
    )
    return PlanItemDetail(row=row, segments=cur.fetchall())


def create_template(payload):
    with db_conn() as conn:
        with conn.cursor() as cur:
            _require_active_category(cur, payload.category_id)
            cur.execute(
                """
                    insert into public.plan_prescription (
                        owner_kind,
                        title,
                        description,
                        sport_type,
                        activity_category,
                        trainer,
                        target_duration_min,
                        target_load,
                        target_load_source,
                        target_distance_mi,
                        target_elevation_ft,
                        instruction_text
                    )
                    values ('template', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    returning plan_prescription_id
                """,
                (
                    payload.prescription.title,
                    payload.prescription.description,
                    payload.prescription.sport_type,
                    payload.prescription.activity_category,
                    payload.prescription.trainer,
                    payload.prescription.target_duration_min,
                    payload.prescription.target_load,
                    payload.prescription.target_load_source,
                    payload.prescription.target_distance_mi,
                    payload.prescription.target_elevation_ft,
                    payload.prescription.instruction_text,
                ),
            )
            prescription_id = cur.fetchone()["plan_prescription_id"]
            _insert_segments(cur, prescription_id, payload.segments)
            cur.execute(
                """
                    insert into public.plan_template (
                        plan_category_id,
                        plan_prescription_id,
                        prescription_owner_kind,
                        template_name,
                        template_description,
                        sort_order,
                        is_favorite,
                        is_active
                    )
                    values (%s, %s, 'template', %s, %s, %s, %s, true)
                    returning plan_template_id
                """,
                (
                    payload.category_id,
                    prescription_id,
                    payload.template_name,
                    payload.template_description,
                    payload.sort_order,
                    payload.is_favorite,
                ),
            )
            template_id = cur.fetchone()["plan_template_id"]
            detail = load_template_detail(cur, template_id)
            if detail is None:
                raise PlanTemplateNotFound()
            conn.commit()
            return detail


def update_template(plan_template_id, payload):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select
                        plan_template_id,
                        plan_prescription_id,
                        prescription_owner_kind,
                        is_active
                    from public.plan_template
                    where plan_template_id = %s
                    for update
                """,
                (plan_template_id,),
            )
            template = cur.fetchone()
            if template is None or not template["is_active"]:
                raise PlanTemplateNotFound()
            if template["prescription_owner_kind"] != "template":
                raise PlanOwnershipCorrupt()

            cur.execute(
                """
                    select plan_prescription_id, owner_kind
                    from public.plan_prescription
                    where plan_prescription_id = %s
                    for update
                """,
                (template["plan_prescription_id"],),
            )
            prescription = cur.fetchone()
            if (
                prescription is None
                or prescription["owner_kind"] != "template"
            ):
                raise PlanOwnershipCorrupt()

            _require_active_category(cur, payload.category_id)
            update_fields = [
                "plan_category_id = %s",
                "template_name = %s",
                "template_description = %s",
                "sort_order = %s",
            ]
            update_params = [
                payload.category_id,
                payload.template_name,
                payload.template_description,
                payload.sort_order,
            ]
            if "is_favorite" in getattr(payload, "model_fields_set", set()):
                update_fields.append("is_favorite = %s")
                update_params.append(payload.is_favorite)
            update_fields.append("updated_at = now()")
            update_params.append(plan_template_id)
            cur.execute(
                f"""
                    update public.plan_template
                    set {", ".join(update_fields)}
                    where plan_template_id = %s
                """,
                tuple(update_params),
            )
            cur.execute(
                """
                    update public.plan_prescription
                    set title = %s,
                        description = %s,
                        sport_type = %s,
                        activity_category = %s,
                        trainer = %s,
                        target_duration_min = %s,
                        target_load = %s,
                        target_load_source = %s,
                        target_distance_mi = %s,
                        target_elevation_ft = %s,
                        instruction_text = %s,
                        updated_at = now()
                    where plan_prescription_id = %s
                """,
                (
                    payload.prescription.title,
                    payload.prescription.description,
                    payload.prescription.sport_type,
                    payload.prescription.activity_category,
                    payload.prescription.trainer,
                    payload.prescription.target_duration_min,
                    payload.prescription.target_load,
                    payload.prescription.target_load_source,
                    payload.prescription.target_distance_mi,
                    payload.prescription.target_elevation_ft,
                    payload.prescription.instruction_text,
                    template["plan_prescription_id"],
                ),
            )
            cur.execute(
                """
                    delete from public.plan_prescription_segment
                    where plan_prescription_id = %s
                """,
                (template["plan_prescription_id"],),
            )
            _insert_segments(
                cur,
                template["plan_prescription_id"],
                payload.segments,
            )
            detail = load_template_detail(cur, plan_template_id)
            if detail is None:
                raise PlanTemplateNotFound()
            conn.commit()
            return detail


def deactivate_template(plan_template_id):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select is_active
                    from public.plan_template
                    where plan_template_id = %s
                    for update
                """,
                (plan_template_id,),
            )
            template = cur.fetchone()
            if template is None:
                raise PlanTemplateNotFound()
            if template["is_active"]:
                cur.execute(
                    """
                        update public.plan_template
                        set is_active = false,
                            updated_at = now()
                        where plan_template_id = %s
                    """,
                    (plan_template_id,),
                )
                conn.commit()
            return {
                "plan_template_id": plan_template_id,
                "is_active": False,
            }


def _insert_item_prescription(cur, prescription):
    cur.execute(
        """
            insert into public.plan_prescription (
                owner_kind,
                title,
                description,
                sport_type,
                activity_category,
                trainer,
                target_duration_min,
                target_load,
                target_load_source,
                target_distance_mi,
                target_elevation_ft,
                instruction_text
            )
            values ('item', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning plan_prescription_id
        """,
        (
            _segment_value(prescription, "title"),
            _segment_value(prescription, "description"),
            _segment_value(prescription, "sport_type"),
            _segment_value(prescription, "activity_category"),
            _segment_value(prescription, "trainer"),
            _segment_value(prescription, "target_duration_min"),
            _segment_value(prescription, "target_load"),
            _segment_value(prescription, "target_load_source"),
            _segment_value(prescription, "target_distance_mi"),
            _segment_value(prescription, "target_elevation_ft"),
            _segment_value(prescription, "instruction_text"),
        ),
    )
    return cur.fetchone()["plan_prescription_id"]


def _insert_committed_item(
    cur,
    *,
    planned_date,
    sort_order,
    user_note,
    category_id,
    prescription_id,
    item_source,
    source_template_id,
):
    cur.execute(
        """
            insert into public.plan_item (
                plan_batch_id,
                source_template_id,
                plan_category_id,
                plan_prescription_id,
                prescription_owner_kind,
                planned_date,
                sort_order,
                item_state,
                item_source,
                user_note,
                committed_at
            )
            values (
                null,
                %s,
                %s,
                %s,
                'item',
                %s,
                %s,
                'committed',
                %s,
                %s,
                now()
            )
            returning plan_item_id
        """,
        (
            source_template_id,
            category_id,
            prescription_id,
            planned_date,
            sort_order,
            item_source,
            user_note,
        ),
    )
    return cur.fetchone()["plan_item_id"]


def create_item_from_template(payload):
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                    select
                        plan_template_id,
                        plan_category_id,
                        plan_prescription_id,
                        prescription_owner_kind,
                        is_active
                    from public.plan_template
                    where plan_template_id = %s
                    for update
                """,
                (payload.plan_template_id,),
            )
            template = cur.fetchone()
            if template is None or not template["is_active"]:
                raise PlanTemplateNotFound()
            if template["prescription_owner_kind"] != "template":
                raise PlanOwnershipCorrupt()

            _require_active_category(cur, template["plan_category_id"])
            cur.execute(
                """
                    select
                        plan_prescription_id,
                        owner_kind,
                        title,
                        description,
                        sport_type,
                        activity_category,
                        trainer,
                        target_duration_min,
                        target_load,
                        target_load_source,
                        target_distance_mi,
                        target_elevation_ft,
                        instruction_text
                    from public.plan_prescription
                    where plan_prescription_id = %s
                    for update
                """,
                (template["plan_prescription_id"],),
            )
            prescription = cur.fetchone()
            if prescription is None or prescription["owner_kind"] != "template":
                raise PlanOwnershipCorrupt()

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
                    where plan_prescription_id = %s
                    order by segment_order asc
                """,
                (template["plan_prescription_id"],),
            )
            segments = cur.fetchall()
            _require_future_date(cur, payload.planned_date)

            item_prescription_id = _insert_item_prescription(cur, prescription)
            _insert_segments(cur, item_prescription_id, segments)
            item_id = _insert_committed_item(
                cur,
                planned_date=payload.planned_date,
                sort_order=payload.sort_order,
                user_note=payload.user_note,
                category_id=template["plan_category_id"],
                prescription_id=item_prescription_id,
                item_source="template",
                source_template_id=payload.plan_template_id,
            )
            detail = _load_item_detail(cur, item_id)
            if detail is None:
                raise PlanOwnershipCorrupt()
            conn.commit()
            return detail


def create_manual_item(payload):
    with db_conn() as conn:
        with conn.cursor() as cur:
            _require_active_category(cur, payload.category_id)
            _require_future_date(cur, payload.planned_date)

            item_prescription_id = _insert_item_prescription(
                cur,
                payload.prescription,
            )
            _insert_segments(cur, item_prescription_id, payload.segments)
            item_id = _insert_committed_item(
                cur,
                planned_date=payload.planned_date,
                sort_order=payload.sort_order,
                user_note=payload.user_note,
                category_id=payload.category_id,
                prescription_id=item_prescription_id,
                item_source="manual",
                source_template_id=None,
            )
            detail = _load_item_detail(cur, item_id)
            if detail is None:
                raise PlanOwnershipCorrupt()
            conn.commit()
            return detail


def _lock_item_for_update(cur, plan_item_id):
    cur.execute(
        """
            select
                plan_item_id,
                planned_date,
                item_state,
                plan_category_id,
                plan_prescription_id,
                prescription_owner_kind,
                plan_batch_id
            from public.plan_item
            where plan_item_id = %s
            for update
        """,
        (plan_item_id,),
    )
    item = cur.fetchone()
    if item is None:
        raise PlanItemNotFound()
    return item


def _require_committed_manageable_item(cur, item):
    if item["item_state"] != "committed" or item["plan_batch_id"] is not None:
        raise PlanItemNotEditable()
    if item["prescription_owner_kind"] != "item":
        raise PlanOwnershipCorrupt()
    _require_not_past_date(cur, item["planned_date"])


def update_plan_item(plan_item_id, payload):
    with db_conn() as conn:
        with conn.cursor() as cur:
            item = _lock_item_for_update(cur, plan_item_id)
            _require_committed_manageable_item(cur, item)
            _require_active_category(cur, payload.category_id)
            if payload.planned_date != item["planned_date"]:
                _require_future_date(cur, payload.planned_date)

            cur.execute(
                """
                    select
                        plan_prescription_id,
                        owner_kind
                    from public.plan_prescription
                    where plan_prescription_id = %s
                    for update
                """,
                (item["plan_prescription_id"],),
            )
            prescription = cur.fetchone()
            if (
                prescription is None
                or prescription["owner_kind"] != "item"
            ):
                raise PlanOwnershipCorrupt()

            cur.execute(
                """
                    update public.plan_prescription
                    set
                        title = %s,
                        description = %s,
                        sport_type = %s,
                        activity_category = %s,
                        trainer = %s,
                        target_duration_min = %s,
                        target_load = %s,
                        target_load_source = %s,
                        target_distance_mi = %s,
                        target_elevation_ft = %s,
                        instruction_text = %s,
                        updated_at = now()
                    where plan_prescription_id = %s
                """,
                (
                    _segment_value(payload.prescription, "title"),
                    _segment_value(payload.prescription, "description"),
                    _segment_value(payload.prescription, "sport_type"),
                    _segment_value(payload.prescription, "activity_category"),
                    _segment_value(payload.prescription, "trainer"),
                    _segment_value(payload.prescription, "target_duration_min"),
                    _segment_value(payload.prescription, "target_load"),
                    _segment_value(payload.prescription, "target_load_source"),
                    _segment_value(payload.prescription, "target_distance_mi"),
                    _segment_value(payload.prescription, "target_elevation_ft"),
                    _segment_value(payload.prescription, "instruction_text"),
                    item["plan_prescription_id"],
                ),
            )
            cur.execute(
                """
                    delete from public.plan_prescription_segment
                    where plan_prescription_id = %s
                """,
                (item["plan_prescription_id"],),
            )
            _insert_segments(cur, item["plan_prescription_id"], payload.segments)
            cur.execute(
                """
                    update public.plan_item
                    set
                        planned_date = %s,
                        plan_category_id = %s,
                        sort_order = %s,
                        user_note = %s,
                        updated_at = now()
                    where plan_item_id = %s
                """,
                (
                    payload.planned_date,
                    payload.category_id,
                    payload.sort_order,
                    payload.user_note,
                    plan_item_id,
                ),
            )
            detail = _load_item_detail(cur, plan_item_id)
            if detail is None:
                raise PlanOwnershipCorrupt()
            conn.commit()
            return detail


def cancel_plan_item(plan_item_id):
    with db_conn() as conn:
        with conn.cursor() as cur:
            item = _lock_item_for_update(cur, plan_item_id)
            if item["item_state"] == "cancelled":
                detail = _load_item_detail(cur, plan_item_id)
                if detail is None:
                    raise PlanOwnershipCorrupt()
                return detail
            _require_committed_manageable_item(cur, item)
            cur.execute(
                """
                    update public.plan_item
                    set
                        item_state = 'cancelled',
                        cancelled_at = now(),
                        updated_at = now()
                    where plan_item_id = %s
                """,
                (plan_item_id,),
            )
            detail = _load_item_detail(cur, plan_item_id)
            if detail is None:
                raise PlanOwnershipCorrupt()
            conn.commit()
            return detail
