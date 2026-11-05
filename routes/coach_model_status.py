"""Read-only Coach model availability route."""

import os

from fastapi import APIRouter

from coach_model_status import get_model_status

router = APIRouter()


@router.get("/api/coach/model-status")
def coach_model_status():
    configured_model = os.environ.get("TRAINING_AI_MODEL", "").strip()
    return get_model_status(configured_model)


@router.post("/api/coach/model-status/refresh")
def refresh_coach_model_status():
    configured_model = os.environ.get("TRAINING_AI_MODEL", "").strip()
    return get_model_status(configured_model, force_refresh=True)
