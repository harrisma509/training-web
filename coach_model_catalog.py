"""Approved Coach models and their locally maintained pricing metadata."""

from dataclasses import dataclass
from decimal import Decimal
from types import MappingProxyType


@dataclass(frozen=True)
class CoachModel:
    model_id: str
    display_name: str
    family: str
    approval_order: int
    input_rate: Decimal | None
    cached_input_rate: Decimal | None
    output_rate: Decimal | None
    long_context_token_threshold: int | None = None
    long_context_input_multiplier: Decimal = Decimal(1)
    long_context_output_multiplier: Decimal = Decimal(1)
    approved: bool = True

    @property
    def has_pricing(self) -> bool:
        return all(
            rate is not None
            for rate in (self.input_rate, self.cached_input_rate, self.output_rate)
        )

    def pricing_rates(self) -> tuple[Decimal, Decimal, Decimal] | None:
        if (
            self.input_rate is None
            or self.cached_input_rate is None
            or self.output_rate is None
        ):
            return None
        return self.input_rate, self.cached_input_rate, self.output_rate


_GPT_5_6_INPUT_RATE = Decimal("0.20") / Decimal(1_000_000)
_GPT_5_6_CACHED_INPUT_RATE = Decimal("0.02") / Decimal(1_000_000)
_GPT_5_6_OUTPUT_RATE = Decimal("1.20") / Decimal(1_000_000)
_GPT_6_INPUT_RATE = Decimal("0.10") / Decimal(1_000_000)
_GPT_6_CACHED_INPUT_RATE = Decimal("0.01") / Decimal(1_000_000)
_GPT_6_OUTPUT_RATE = Decimal("0.50") / Decimal(1_000_000)

MODEL_CATALOG = MappingProxyType(
    {
        model.model_id: model
        for model in (
            CoachModel(
                model_id="gpt-5.6-luna",
                display_name="GPT-5.6 Luna",
                family="luna",
                approval_order=56,
                input_rate=_GPT_5_6_INPUT_RATE,
                cached_input_rate=_GPT_5_6_CACHED_INPUT_RATE,
                output_rate=_GPT_5_6_OUTPUT_RATE,
            ),
            CoachModel(
                model_id="gpt-5.6-luna-standard",
                display_name="GPT-5.6 Luna Standard",
                family="luna",
                approval_order=56,
                input_rate=_GPT_5_6_INPUT_RATE,
                cached_input_rate=_GPT_5_6_CACHED_INPUT_RATE,
                output_rate=_GPT_5_6_OUTPUT_RATE,
            ),
            CoachModel(
                model_id="gpt-6-luna",
                display_name="GPT-6 Luna",
                family="luna",
                approval_order=60,
                input_rate=_GPT_6_INPUT_RATE,
                cached_input_rate=_GPT_6_CACHED_INPUT_RATE,
                output_rate=_GPT_6_OUTPUT_RATE,
                long_context_token_threshold=272_000,
                long_context_input_multiplier=Decimal("2"),
                long_context_output_multiplier=Decimal("1.5"),
            ),
        )
    }
)


def model_for_id(model_id: str | None) -> CoachModel | None:
    if not isinstance(model_id, str):
        return None
    return MODEL_CATALOG.get(model_id.strip().lower())


def newer_available_approved_model(
    configured_model: str | None,
    provider_model_ids: frozenset[str],
) -> CoachModel | None:
    configured = model_for_id(configured_model)
    if configured is None or not configured.approved:
        return None
    candidates = (
        model
        for model in MODEL_CATALOG.values()
        if model.approved
        and model.has_pricing
        and model.family == configured.family
        and model.approval_order > configured.approval_order
        and model.model_id in provider_model_ids
    )
    return max(candidates, key=lambda model: model.approval_order, default=None)


def model_status(
    configured_model: str | None,
    provider_model_ids: frozenset[str] | None,
) -> dict:
    normalized_model = configured_model.strip().lower() if isinstance(configured_model, str) else ""
    configured = model_for_id(normalized_model)
    configured_available = normalized_model in provider_model_ids if provider_model_ids is not None else None
    newer = None
    if provider_model_ids is None:
        status = "status_unavailable"
    elif configured is None or not configured.approved or not configured.has_pricing:
        status = "pricing_unavailable"
    elif not configured_available:
        status = "configured_model_unavailable"
    else:
        newer = newer_available_approved_model(normalized_model, provider_model_ids)
        status = "update_available" if newer else "current"
    return {
        "configured_model": normalized_model,
        "configured_display_name": (
            configured.display_name if configured else normalized_model or "Model unavailable"
        ),
        "configured_model_known": configured is not None,
        "available_to_provider": configured_available,
        "pricing_supported": bool(configured and configured.has_pricing),
        "status": status,
        "newer_approved_model": newer.model_id if newer else None,
        "newer_approved_display_name": newer.display_name if newer else None,
    }
