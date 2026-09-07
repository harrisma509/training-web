"""OpenAI Responses API adapter for the generic AI provider boundary."""

import os
import time

from openai import APIStatusError, APITimeoutError, AuthenticationError, OpenAI, PermissionDeniedError
from openai import RateLimitError

from ai_provider import (
    AIAuthenticationError,
    AIConfigurationError,
    AIRequest,
    AIResponse,
    AIRateLimitError,
    AITimeoutError,
    AIProviderError,
)


def _required_setting(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise AIConfigurationError("Required AI configuration is missing.")
    return value


def _optional_int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _reasoning_argument(value):
    if value is None:
        return {}
    if value not in {"none", "low", "medium", "high"}:
        raise AIConfigurationError("Unsupported reasoning effort.")
    return {"reasoning": {"effort": value}}


class OpenAIProvider:
    provider = "openai"

    def __init__(self, api_key: str, model: str):
        self._client = OpenAI(api_key=api_key, max_retries=0)
        self.model = model

    def complete(self, request: AIRequest) -> AIResponse:
        started = time.perf_counter()
        try:
            request_args = {
                "model": request.model,
                "instructions": request.instructions,
                "input": request.input_text,
                "max_output_tokens": request.max_output_tokens,
                "timeout": request.timeout_seconds,
            }
            request_args.update(_reasoning_argument(request.reasoning_effort))
            response = self._client.responses.create(
                **request_args,
            )
        except APITimeoutError as exc:
            raise AITimeoutError("AI provider request timed out.") from exc
        except (AuthenticationError, PermissionDeniedError) as exc:
            raise AIAuthenticationError("AI provider authentication failed.") from exc
        except RateLimitError as exc:
            raise AIRateLimitError("AI provider rate limit reached.") from exc
        except APIStatusError as exc:
            raise AIProviderError("AI provider request failed.") from exc
        except Exception as exc:
            raise AIProviderError("AI provider request failed.") from exc

        usage = getattr(response, "usage", None)
        input_details = getattr(usage, "input_tokens_details", None)
        output_details = getattr(usage, "output_tokens_details", None)
        text = getattr(response, "output_text", None)
        if not isinstance(text, str) or not text:
            raise AIProviderError("AI provider returned no response text.")

        return AIResponse(
            text=text,
            provider=self.provider,
            model=getattr(response, "model", None) or self.model,
            provider_response_id=getattr(response, "id", None),
            input_tokens=_optional_int(getattr(usage, "input_tokens", None)),
            cached_input_tokens=_optional_int(getattr(input_details, "cached_tokens", None)),
            output_tokens=_optional_int(getattr(usage, "output_tokens", None)),
            reasoning_tokens=_optional_int(getattr(output_details, "reasoning_tokens", None)),
            total_tokens=_optional_int(getattr(usage, "total_tokens", None)),
            elapsed_ms=round((time.perf_counter() - started) * 1000),
            finish_status=getattr(response, "status", None),
        )


def configured_openai_provider() -> OpenAIProvider:
    provider = _required_setting("TRAINING_AI_PROVIDER").lower()
    if provider != "openai":
        raise AIConfigurationError("Unsupported AI provider.")
    try:
        return OpenAIProvider(
            api_key=_required_setting("OPENAI_API_KEY"),
            model=_required_setting("TRAINING_AI_MODEL"),
        )
    except AIConfigurationError:
        raise
    except Exception as exc:
        raise AIConfigurationError("AI provider configuration failed.") from exc