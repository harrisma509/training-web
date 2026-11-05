"""Cached, read-only provider availability checks for approved Coach models."""

import time
from collections.abc import Callable, Iterable
from threading import Lock

from ai_provider import AIProviderError
from coach_model_catalog import model_status
from openai_adapter import configured_openai_provider

MODEL_LIST_TIMEOUT_SECONDS = 4.0
MODEL_LIST_CACHE_SECONDS = 24 * 60 * 60
MODEL_LIST_FAILURE_CACHE_SECONDS = 60


class ModelListCache:
    def __init__(
        self,
        ttl_seconds: int = MODEL_LIST_CACHE_SECONDS,
        failure_ttl_seconds: int = MODEL_LIST_FAILURE_CACHE_SECONDS,
    ):
        self._ttl_seconds = ttl_seconds
        self._failure_ttl_seconds = failure_ttl_seconds
        self._lock = Lock()
        self._model_ids: frozenset[str] | None = None
        self._expires_at = 0.0
        self._failed = False

    def get(self, fetch_model_ids: Callable[[], Iterable[str]]) -> frozenset[str]:
        with self._lock:
            now = time.monotonic()
            if now < self._expires_at:
                if self._failed:
                    raise AIProviderError("Model availability could not be checked.")
                return self._model_ids or frozenset()

            try:
                model_ids = frozenset(fetch_model_ids())
            except AIProviderError:
                self._model_ids = None
                self._failed = True
                self._expires_at = now + self._failure_ttl_seconds
                raise AIProviderError("Model availability could not be checked.") from None

            self._model_ids = model_ids
            self._failed = False
            self._expires_at = now + self._ttl_seconds
            return model_ids


_model_list_cache = ModelListCache()


def _fetch_provider_model_ids() -> frozenset[str]:
    provider = configured_openai_provider()
    return provider.list_available_model_ids(MODEL_LIST_TIMEOUT_SECONDS)


def get_model_status(configured_model: str | None) -> dict:
    try:
        provider_model_ids = _model_list_cache.get(_fetch_provider_model_ids)
    except AIProviderError:
        provider_model_ids = None
    return model_status(configured_model, provider_model_ids)
