"""Transactional persistence helpers for Plan template mutations."""

from dataclasses import dataclass

from db import db_conn


class PlanServiceError(Exception):
    """Base class for expected Plan persistence errors."""


class PlanCategoryNotFound(PlanServiceError):
    pass


class PlanTemplateNotFound(PlanServiceError):
    pass


class PlanOwnershipCorrupt(PlanServiceError):
    pass


@dataclass(frozen=True)
class TemplateDetail:
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
                segment.segment_order,
                segment.segment_name,
                segment.repeat_group_key,
                segment.repeat_count,
                segment.target_duration_min,
                segment.target_metric,
                segment.zone_min,
                segment.zone_max,
                segment.target_value_min,
                segment.target_value_max,
                segment.instruction_text,
            ),
        )


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
                        is_active
                    )
                    values (%s, %s, 'template', %s, %s, %s, true)
                    returning plan_template_id
                """,
                (
                    payload.category_id,
                    prescription_id,
                    payload.template_name,
                    payload.template_description,
                    payload.sort_order,
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
            cur.execute(
                """
                    update public.plan_template
                    set plan_category_id = %s,
                        template_name = %s,
                        template_description = %s,
                        sort_order = %s,
                        updated_at = now()
                    where plan_template_id = %s
                """,
                (
                    payload.category_id,
                    payload.template_name,
                    payload.template_description,
                    payload.sort_order,
                    plan_template_id,
                ),
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
