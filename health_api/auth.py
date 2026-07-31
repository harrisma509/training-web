import hmac
import os


def validate_token(body_token: str | None, query_token: str | None) -> bool:
    supplied = body_token or query_token
    expected = os.environ.get("WEBHOOK_SECRET")
    return bool(expected and supplied and hmac.compare_digest(supplied, expected))
