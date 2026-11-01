"""Browser-facing saved-location search and management contracts."""

import logging
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from routes.plan import _mutation_guard
from services.geocoding_service import (
    GeoapifyConfigurationError,
    GeoapifyPlaceNotFoundError,
    GeoapifyTimezoneUnavailableError,
    GeoapifyUnavailableError,
)
from services.saved_locations_service import (
    SavedLocationInUseError,
    SavedLocationNotFoundError,
    create_saved_location_from_place,
    delete_saved_location,
    list_active_saved_locations,
    list_saved_locations_for_management,
    search_saved_locations,
    set_home_location,
    update_saved_location,
)


logger = logging.getLogger(__name__)
router = APIRouter()

LOCATION_SEARCH_UNAVAILABLE = "Location search is temporarily unavailable."
LOCATION_SAVE_UNAVAILABLE = "Location saving is temporarily unavailable."


class SavedLocationCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_place_id: str = Field(min_length=3, max_length=2048)
    display_name: str = Field(min_length=1, max_length=120)
    location_type: Literal["home", "work", "training", "other"]


class SavedLocationUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, max_length=120)
    lifecycle_state: Literal["active", "hidden", "archived"]


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


@router.get("/api/saved-locations/search")
def api_saved_locations_search(q: str = Query(default="", max_length=160)):
    if not q.strip():
        return {"results": []}
    try:
        return {"results": search_saved_locations(q)}
    except (GeoapifyConfigurationError, GeoapifyUnavailableError):
        logger.warning("Geoapify location search is unavailable.")
        return JSONResponse(
            {"detail": LOCATION_SEARCH_UNAVAILABLE},
            status_code=503,
        )
    except ValueError as error:
        return JSONResponse({"detail": str(error)}, status_code=422)
    except Exception:
        logger.exception("Unable to search saved locations")
        return JSONResponse(
            {"detail": LOCATION_SEARCH_UNAVAILABLE},
            status_code=503,
        )


@router.get("/api/saved-locations/manage")
def api_saved_locations_manage():
    try:
        return {"locations": list_saved_locations_for_management()}
    except Exception:
        logger.exception("Unable to read saved locations for management")
        return JSONResponse(
            {"detail": "Saved locations are temporarily unavailable."},
            status_code=503,
        )


@router.post("/api/saved-locations")
def api_saved_location_create(
    request: Request,
    payload: SavedLocationCreatePayload,
):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    try:
        location = create_saved_location_from_place(
            provider_place_id=payload.provider_place_id,
            display_name=payload.display_name,
            location_type=payload.location_type,
        )
        return {"location": location}
    except GeoapifyConfigurationError:
        logger.warning("Geoapify location saving is not configured.")
        return JSONResponse(
            {"detail": LOCATION_SAVE_UNAVAILABLE},
            status_code=503,
        )
    except GeoapifyUnavailableError:
        logger.warning("Geoapify location revalidation is unavailable.")
        return JSONResponse(
            {"detail": LOCATION_SAVE_UNAVAILABLE},
            status_code=503,
        )
    except GeoapifyPlaceNotFoundError:
        return JSONResponse(
            {"detail": "The selected place could not be verified. Search again."},
            status_code=422,
        )
    except GeoapifyTimezoneUnavailableError:
        return JSONResponse(
            {
                "detail": (
                    "This result has no valid timezone. Choose another result "
                    "or retry."
                )
            },
            status_code=422,
        )
    except ValueError as error:
        return JSONResponse({"detail": str(error)}, status_code=422)
    except Exception:
        logger.exception("Unable to save selected location")
        return JSONResponse(
            {"detail": LOCATION_SAVE_UNAVAILABLE},
            status_code=503,
        )


@router.patch("/api/saved-locations/{location_id}")
def api_saved_location_update(
    location_id: int,
    request: Request,
    payload: SavedLocationUpdatePayload,
):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    try:
        return {
            "location": update_saved_location(
                location_id,
                display_name=payload.display_name,
                lifecycle_state=payload.lifecycle_state,
            )
        }
    except SavedLocationNotFoundError:
        return JSONResponse(
            {"detail": "Saved location was not found."},
            status_code=404,
        )
    except ValueError as error:
        return JSONResponse({"detail": str(error)}, status_code=422)
    except Exception:
        logger.exception("Unable to update saved location")
        return JSONResponse(
            {"detail": "Saved locations are temporarily unavailable."},
            status_code=503,
        )


@router.put("/api/saved-locations/{location_id}/home")
def api_saved_location_set_home(location_id: int, request: Request):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    try:
        return {"location": set_home_location(location_id)}
    except SavedLocationNotFoundError:
        return JSONResponse(
            {"detail": "Saved location was not found."},
            status_code=404,
        )
    except ValueError as error:
        return JSONResponse({"detail": str(error)}, status_code=422)
    except Exception:
        logger.exception("Unable to change Home saved location")
        return JSONResponse(
            {"detail": "Saved locations are temporarily unavailable."},
            status_code=503,
        )


@router.delete("/api/saved-locations/{location_id}")
def api_saved_location_delete(location_id: int, request: Request):
    guard_response = _mutation_guard(request)
    if guard_response is not None:
        return guard_response
    try:
        return delete_saved_location(location_id)
    except SavedLocationNotFoundError:
        return JSONResponse(
            {"detail": "Saved location was not found."},
            status_code=404,
        )
    except SavedLocationInUseError:
        return JSONResponse(
            {
                "detail": (
                    "This location is referenced by a Plan or template and "
                    "cannot be deleted."
                )
            },
            status_code=409,
        )
    except Exception:
        logger.exception("Unable to delete saved location")
        return JSONResponse(
            {"detail": "Saved locations are temporarily unavailable."},
            status_code=503,
        )
