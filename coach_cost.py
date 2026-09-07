"""Bounded Coach pricing and budget checks."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

INPUT_RATE = Decimal("0.20") / Decimal(1_000_000)
CACHED_INPUT_RATE = Decimal("0.02") / Decimal(1_000_000)
OUTPUT_RATE = Decimal("1.20") / Decimal(1_000_000)
MAX_TURN_COST = Decimal("0.25")
MONTHLY_COST_LIMIT = Decimal("5.00")
MODEL_PRICING = {
    "gpt-5.6-luna": (INPUT_RATE, CACHED_INPUT_RATE, OUTPUT_RATE),
    "gpt-5.6-luna-standard": (INPUT_RATE, CACHED_INPUT_RATE, OUTPUT_RATE),
}


class CostLimitError(Exception):
    category = "budget_limit"
    status_code = 429


class BudgetUnavailableError(Exception):
    category = "budget_unavailable"
    status_code = 503


def pricing_for_model(model):
    return MODEL_PRICING.get((model or "").strip().lower())


def estimated_cost(model, input_tokens, cached_input_tokens, output_tokens):
    rates = pricing_for_model(model)
    if rates is None or input_tokens is None or output_tokens is None:
        return None
    if cached_input_tokens is None or cached_input_tokens > input_tokens:
        return None
    uncached = input_tokens - cached_input_tokens
    return (
        Decimal(uncached) * rates[0]
        + Decimal(cached_input_tokens) * rates[1]
        + Decimal(output_tokens) * rates[2]
    ).quantize(Decimal("0.000001"))


def preflight_cost(model, input_characters, max_output_tokens):
    rates = pricing_for_model(model)
    if rates is None:
        rates = (INPUT_RATE, CACHED_INPUT_RATE, OUTPUT_RATE)
    # One character per input token is intentionally conservative for the bound.
    estimate = Decimal(input_characters) * rates[0] + Decimal(max_output_tokens) * rates[2]
    if estimate > MAX_TURN_COST:
        raise CostLimitError()
    return estimate


def check_monthly_budget():
    from db import db_conn

    try:
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(estimated_cost_usd), 0) AS recorded_cost,
                           COUNT(*) FILTER (WHERE estimated_cost_usd IS NULL) AS unknown_cost_count
                    FROM public.coach_turn
                    WHERE status = 'completed'
                      AND completed_at >= date_trunc('month', now() AT TIME ZONE 'America/Denver')
                                             AT TIME ZONE 'America/Denver'
                    """
                )
                row = cur.fetchone()
    except Exception as exc:
        raise BudgetUnavailableError() from exc
    recorded = Decimal(str(row["recorded_cost"] or 0))
    return recorded, int(row["unknown_cost_count"] or 0)


def enforce_monthly_budget():
    recorded, unknown_count = check_monthly_budget()
    if recorded >= MONTHLY_COST_LIMIT:
        raise CostLimitError()
    return {"recorded_cost_usd": recorded, "unknown_cost_count": unknown_count}


def current_month_label():
    return datetime.now(ZoneInfo("America/Denver")).strftime("%Y-%m")
