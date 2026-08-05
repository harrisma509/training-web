"""
Training Dashboard FastAPI entrypoint.

This file wires together the web app:
- FastAPI app setup
- health API router
- training dashboard route modules
- static file serving
- index.html response

Route implementation details live in routes/*.py.
Database and JSON helpers live in db.py.

This refactor is intended to preserve existing behavior.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from health_api.ingest_routes import router as health_router
from routes.daily import router as daily_router
from routes.weekly import router as weekly_router
from routes.weekly_audit import router as weekly_audit_router
from routes.zones import router as zones_router
from routes.weekly_commentary import router as weekly_commentary_router
from routes.status import router as status_router
from routes.sync import router as sync_router

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Training Dashboard")
app.include_router(health_router)
app.include_router(daily_router)
app.include_router(weekly_router)
app.include_router(weekly_audit_router)
app.include_router(zones_router)
app.include_router(weekly_commentary_router)
app.include_router(status_router)
app.include_router(sync_router)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    return (BASE_DIR / "index.html").read_text(encoding="utf-8")
