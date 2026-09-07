"""Provider-neutral request and response types for bounded AI calls."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class AIRequest:
    model: str
    instructions: str
    input_text: str
    max_output_tokens: int
    timeout_seconds: float


@dataclass(frozen=True)
class AIResponse:
    text: str
    provider: str
    model: str
    provider_response_id: str | None
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    reasoning_tokens: int | None
    total_tokens: int | None
    elapsed_ms: int
    finish_status: str | None


class AIProvider(Protocol):
    provider: str
    model: str

    def complete(self, request: AIRequest) -> AIResponse:
        ...


class AIProviderError(Exception):
    """Base class for sanitized provider failures."""


class AIConfigurationError(AIProviderError):
    """The provider configuration is missing or unsupported."""


class AIAuthenticationError(AIProviderError):
    """The provider rejected authentication or permissions."""


class AIRateLimitError(AIProviderError):
    """The provider rejected the request because of rate or spend limits."""


class AITimeoutError(AIProviderError):
    """The provider request exceeded its timeout."""