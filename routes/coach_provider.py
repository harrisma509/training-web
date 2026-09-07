"""Bounded provider connectivity diagnostic route."""

from dataclasses import replace

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ai_provider import (
    AIAuthenticationError,
    AIConfigurationError,
    AIProvider,
    AIRequest,
    AIRateLimitError,
    AITimeoutError,
    AIProviderError,
)
from ai_factory import configured_ai_provider
from coach_guards import ProviderCapacityError, provider_capacity

router = APIRouter()


def _usage_payload(response):
    return {
        "input_tokens": response.input_tokens,
        "cached_input_tokens": response.cached_input_tokens,
        "output_tokens": response.output_tokens,
        "reasoning_tokens": response.reasoning_tokens,
        "total_tokens": response.total_tokens,
    }


# Remove or disable this diagnostic route after provider integration is proven.
@router.post("/api/coach/provider/test")
def test_provider_connection():
    request = AIRequest(
        model="",
        instructions="Return the requested connection-test phrase exactly and add nothing else.",
        input_text="Training AI connected",
        max_output_tokens=150,
        timeout_seconds=60.0,
        reasoning_effort="none",
    )
    try:
        provider: AIProvider = configured_ai_provider()
        with provider_capacity():
            response = provider.complete(replace(request, model=provider.model))
    except AIConfigurationError:
        return JSONResponse({"status": "unavailable", "connected": False}, status_code=503)
    except AIAuthenticationError:
        return JSONResponse({"status": "provider_authentication_failed", "connected": False}, status_code=502)
    except AIRateLimitError:
        return JSONResponse({"status": "provider_rate_limited", "connected": False}, status_code=429)
    except AITimeoutError:
        return JSONResponse({"status": "provider_timeout", "connected": False}, status_code=504)
    except ProviderCapacityError:
        return JSONResponse({"status": "provider_capacity_unavailable", "connected": False}, status_code=429)
    except AIProviderError:
        return JSONResponse({"status": "provider_failed", "connected": False}, status_code=502)

    return {
        "status": "connected",
        "connected": True,
        "provider": response.provider,
        "model": response.model,
        "response_text": response.text,
        "provider_response_id": response.provider_response_id,
        "token_usage": _usage_payload(response),
        "elapsed_ms": response.elapsed_ms,
    }