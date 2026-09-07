"""Provider-neutral construction for configured AI providers."""

from ai_provider import AIConfigurationError, AIProvider
from openai_adapter import configured_openai_provider


def configured_ai_provider() -> AIProvider:
    """Build the configured provider without exposing vendor details to callers."""
    import os

    provider_name = os.environ.get("TRAINING_AI_PROVIDER", "").strip().lower()
    if provider_name == "openai":
        return configured_openai_provider()
    if not provider_name:
        raise AIConfigurationError("AI provider configuration is missing.")
    raise AIConfigurationError("Unsupported AI provider.")
