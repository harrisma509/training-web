"""Protected retrieval route for historical Coach context receipts."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from coach_context_receipt import ContextReceiptUnavailable, load_receipt
from routes.coach import _parse_positive_id


router = APIRouter()


@router.get("/api/coach/turns/{coach_turn_id}/context-receipt")
def get_coach_context_receipt(coach_turn_id: str):
    parsed_id = _parse_positive_id(coach_turn_id)
    if parsed_id is None:
        return JSONResponse({"detail": "coach_turn_id must be a positive integer."}, status_code=400)
    try:
        receipt = load_receipt(parsed_id)
    except ContextReceiptUnavailable:
        return JSONResponse({"detail": "Context receipt is unavailable."}, status_code=503)
    if receipt is None:
        return JSONResponse({"detail": "Context receipt is not available for this turn."}, status_code=404)
    return receipt