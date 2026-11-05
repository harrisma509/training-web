"""Cached, read-only provider availability checks for approved Coach models."""

import time
from collections.abc import Callable, Iterable
from concurrent.futures import Future
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
        self._failure_until = 0.0
        self._inflight: Future[frozenset[str]] | None = None

    def get(
        self,
        fetch_model_ids: Callable[[], Iterable[str]],
        force_refresh: bool = False,
    ) -> frozenset[str]:
        with self._lock:
            now = time.monotonic()
            if not force_refresh and self._model_ids is not None and now < self._expires_at:
                return self._model_ids
            if not force_refresh and now < self._failure_until:
                raise AIProviderError("Model availability could not be checked.")
            refresh = self._inflight
            if refresh is None:
                refresh = Future()
                self._inflight = refresh
                is_owner = True
            else:
                is_owner = False

        if not is_owner:
            return refresh.result()

        try:
            model_ids = frozenset(fetch_model_ids())
        except Exception:
            error = AIProviderError("Model availability could not be checked.")
            with self._lock:
                self._failure_until = time.monotonic() + self._failure_ttl_seconds
                self._inflight = None
                refresh.set_exception(error)
            raise error from None

        with self._lock:
            self._model_ids = model_ids
            self._expires_at = time.monotonic() + self._ttl_seconds
            self._failure_until = 0.0
            self._inflight = None
            refresh.set_result(model_ids)
        return model_ids


_model_list_cache = ModelListCache()


def _fetch_provider_model_ids() -> frozenset[str]:
    provider = configured_openai_provider()
    return provider.list_available_model_ids(MODEL_LIST_TIMEOUT_SECONDS)


def get_model_status(configured_model: str | None, force_refresh: bool = False) -> dict:
    try:
        provider_model_ids = _model_list_cache.get(
            _fetch_provider_model_ids,
            force_refresh=force_refresh,
        )
    except AIProviderError:
        provider_model_ids = None
    return model_status(configured_model, provider_model_ids)
