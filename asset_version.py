"""Load the immutable asset version supplied by deployment metadata."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path


ASSET_VERSION_FILENAME = ".deployment-version.json"
_SAFE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_PRODUCTION_VALUES = {"prod", "production"}


def _validate_asset_version(value: object, *, source: str) -> str:
    if not isinstance(value, str) or not _SAFE_VERSION.fullmatch(value):
        raise RuntimeError(f"Invalid asset version from {source}.")
    return value


def load_asset_version(base_dir: Path) -> str:
    environment_version = os.getenv("TRAINING_WEB_ASSET_VERSION")
    if environment_version:
        return _validate_asset_version(environment_version, source="TRAINING_WEB_ASSET_VERSION")

    metadata_path = base_dir / ASSET_VERSION_FILENAME
    if metadata_path.is_file():
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("Unable to read deployment asset metadata.") from error
        if not isinstance(payload, dict):
            raise RuntimeError(f"Invalid asset version from {metadata_path}.")
        return _validate_asset_version(payload.get("asset_version"), source=str(metadata_path))

    if os.getenv("TRAINING_WEB_ENV", "development").lower() not in _PRODUCTION_VALUES:
        return "dev"

    raise RuntimeError("Deployment asset metadata is required in production.")
