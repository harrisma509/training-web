"""Read-only Coach model availability route."""

import os

from fastapi import APIRouter

from coach_model_status import get_model_status

router = APIRouter()


@router.get("/api/coach/model-status")
def coach_model_status():
    configured_model = os.environ.get("TRAINING_AI_MODEL", "").strip()
    return get_model_status(configured_model)
