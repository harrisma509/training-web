"""Bounded Coach pricing and budget checks."""

from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from coach_model_catalog import MODEL_CATALOG, model_for_id

_GPT_5_6_PRICING = MODEL_CATALOG["gpt-5.6-luna"]
_GPT_6_PRICING = MODEL_CATALOG["gpt-6-luna"]
INPUT_RATE = _GPT_5_6_PRICING.input_rate
CACHED_INPUT_RATE = _GPT_5_6_PRICING.cached_input_rate
OUTPUT_RATE = _GPT_5_6_PRICING.output_rate
GPT_6_LUNA_STANDARD_INPUT_RATE = _GPT_6_PRICING.input_rate
GPT_6_LUNA_STANDARD_CACHED_INPUT_RATE = _GPT_6_PRICING.cached_input_rate
GPT_6_LUNA_STANDARD_OUTPUT_RATE = _GPT_6_PRICING.output_rate
GPT_6_LUNA_LONG_CONTEXT_TOKEN_THRESHOLD = _GPT_6_PRICING.long_context_token_threshold
GPT_6_LUNA_LONG_CONTEXT_INPUT_MULTIPLIER = _GPT_6_PRICING.long_context_input_multiplier
GPT_6_LUNA_LONG_CONTEXT_OUTPUT_MULTIPLIER = _GPT_6_PRICING.long_context_output_multiplier
DEFAULT_MAX_TURN_COST = Decimal("0.25")
DEFAULT_MONTHLY_COST_LIMIT = Decimal("5.00")
MODEL_PRICING = {
    model.model_id: model.pricing_rates()
    for model in MODEL_CATALOG.values()
    if model.has_pricing
}


class CostLimitError(Exception):
    category = "budget_limit"
    status_code = 429


class MonthlyBudgetDisabledError(CostLimitError):
    category = "budget_disabled"


class MonthlyBudgetLimitError(CostLimitError):
    category = "monthly_budget_limit"


class TurnCostLimitError(CostLimitError):
    category = "turn_cost_limit"


class BudgetUnavailableError(Exception):
    category = "budget_unavailable"
    status_code = 503


def pricing_for_model(model):
    catalog_model = model_for_id(model)
    return catalog_model.pricing_rates() if catalog_model else None


def _long_context_multipliers(model, input_tokens):
    catalog_model = model_for_id(model)
    if (
        catalog_model
        and catalog_model.long_context_token_threshold is not None
        and input_tokens > catalog_model.long_context_token_threshold
    ):
        return (
            catalog_model.long_context_input_multiplier,
            catalog_model.long_context_output_multiplier,
        )
    return Decimal(1), Decimal(1)


def estimated_cost(model, input_tokens, cached_input_tokens, output_tokens):
    rates = pricing_for_model(model)
    if rates is None or input_tokens is None or output_tokens is None:
        return None
    if cached_input_tokens is None or cached_input_tokens > input_tokens:
        return None
    uncached = input_tokens - cached_input_tokens
    input_multiplier, output_multiplier = _long_context_multipliers(model, input_tokens)
    return (
        Decimal(uncached) * rates[0] * input_multiplier
        + Decimal(cached_input_tokens) * rates[1] * input_multiplier
        + Decimal(output_tokens) * rates[2] * output_multiplier
    ).quantize(Decimal("0.000001"))


def preflight_cost(model, estimated_input_tokens, max_output_tokens, max_turn_cost):
    rates = pricing_for_model(model)
    if rates is None:
        raise BudgetUnavailableError()
    input_multiplier, output_multiplier = _long_context_multipliers(model, estimated_input_tokens)
    estimate = (
        Decimal(estimated_input_tokens) * rates[0] * input_multiplier
        + Decimal(max_output_tokens) * rates[2] * output_multiplier
    )
    if estimate > Decimal(str(max_turn_cost)):
        raise TurnCostLimitError()
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
    try:
        recorded = Decimal(str(row["recorded_cost"] or 0))
        unknown_count = int(row["unknown_cost_count"] or 0)
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise BudgetUnavailableError() from exc
    if not recorded.is_finite() or recorded < 0 or unknown_count < 0:
        raise BudgetUnavailableError()
    return recorded, unknown_count


def enforce_monthly_budget(proposed_cost, monthly_cost_limit):
    try:
        proposed_cost = Decimal(str(proposed_cost))
    except (TypeError, ValueError, ArithmeticError) as exc:
        raise BudgetUnavailableError() from exc
    if not proposed_cost.is_finite() or proposed_cost < 0:
        raise BudgetUnavailableError()
    try:
        monthly_cost_limit = Decimal(str(monthly_cost_limit))
    except (TypeError, ValueError, ArithmeticError) as exc:
        raise BudgetUnavailableError() from exc
    if not monthly_cost_limit.is_finite() or monthly_cost_limit < 0:
        raise BudgetUnavailableError()
    if monthly_cost_limit == 0:
        raise MonthlyBudgetDisabledError()
    recorded, unknown_count = check_monthly_budget()
    if not isinstance(recorded, Decimal) or not recorded.is_finite() or recorded < 0:
        raise BudgetUnavailableError()
    if unknown_count < 0 or unknown_count > 0:
        raise BudgetUnavailableError()
    if recorded >= monthly_cost_limit or recorded + proposed_cost > monthly_cost_limit:
        raise MonthlyBudgetLimitError()
    return {"recorded_cost_usd": recorded, "unknown_cost_count": unknown_count}


def current_month_label():
    return datetime.now(ZoneInfo("America/Denver")).strftime("%Y-%m")
