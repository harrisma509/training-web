"""Browser-facing bounded Coach response route."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from coach_orchestrator import CoachOrchestrationError, respond_to_coach
from routes.coach import (
    CoachActiveTurn,
    CoachSessionArchived,
    CoachSessionNotFound,
    MAX_MESSAGE_LENGTH,
    _parse_positive_id,
    _text_value,
)

router = APIRouter()


@router.post("/api/coach/sessions/{session_id}/respond")
async def respond_to_coach_route(session_id: str, request: Request):
    parsed_id = _parse_positive_id(session_id)
    if parsed_id is None:
        return JSONResponse({"detail": "session_id must be a positive integer."}, status_code=400)
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"detail": "Invalid request body."}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"detail": "Request body must be an object."}, status_code=400)
    message, error = _text_value(payload.get("message"), "message", MAX_MESSAGE_LENGTH)
    if error:
        return JSONResponse({"detail": error}, status_code=400)

    try:
        return respond_to_coach(parsed_id, message)
    except CoachSessionNotFound:
        return JSONResponse({"detail": "Coach session not found."}, status_code=404)
    except CoachSessionArchived:
        return JSONResponse({"detail": "Archived Coach sessions cannot accept responses."}, status_code=409)
    except CoachActiveTurn:
        return JSONResponse({"detail": "Coach session already has an active turn."}, status_code=409)
    except ValueError:
        return JSONResponse({"detail": "Invalid Coach request."}, status_code=400)
    except CoachOrchestrationError as exc:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    except Exception:
        return JSONResponse({"detail": "Unable to complete Coach response."}, status_code=500)
