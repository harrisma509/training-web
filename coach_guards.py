"""Small process-local guards for paid provider calls."""

from contextlib import contextmanager
from threading import BoundedSemaphore


_PROVIDER_SLOTS = BoundedSemaphore(2)


class ProviderCapacityError(Exception):
    """No provider-call slot is available in this process."""


@contextmanager
def provider_capacity():
    if not _PROVIDER_SLOTS.acquire(blocking=False):
        raise ProviderCapacityError()
    try:
        yield
    finally:
        _PROVIDER_SLOTS.release()
