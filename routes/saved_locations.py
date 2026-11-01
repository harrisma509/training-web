"""Read-only browser-facing saved-location metadata route."""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from services.saved_locations_service import list_active_saved_locations


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/saved-locations")
def api_saved_locations_list():
    try:
        return {"locations": list_active_saved_locations()}
    except Exception:
        logger.exception("Unable to read saved locations")
        return JSONResponse(
            {"detail": "Saved locations are temporarily unavailable."},
            status_code=503,
        )
