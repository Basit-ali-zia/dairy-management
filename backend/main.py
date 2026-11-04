import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import Base, engine, UPLOADS_DIR, PROJECT_DIR, init_fts
from sqlalchemy import inspect, text
from .routes.auth import router as auth_router
from .routes.entries import router as entries_router
from .routes.categories import router as categories_router
from .routes.media import router as media_router
from .routes.backup import router as backup_router
from .rate_limiter import limiter
from .logging_config import setup_logging
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

setup_logging()

Base.metadata.create_all(bind=engine)
init_fts(engine)
if "color" not in {column["name"] for column in inspect(engine).get_columns("categories")}:
	with engine.begin() as connection:
		connection.execute(text("ALTER TABLE categories ADD COLUMN color VARCHAR(20) DEFAULT '#d87983'"))
user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
with engine.begin() as connection:
	if "gender" not in user_columns: connection.execute(text("ALTER TABLE users ADD COLUMN gender VARCHAR(32)"))
	if "age_range" not in user_columns: connection.execute(text("ALTER TABLE users ADD COLUMN age_range VARCHAR(16)"))
	if "avatar_url" not in user_columns: connection.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255)"))
	if "display_name" not in user_columns: connection.execute(text("ALTER TABLE users ADD COLUMN display_name VARCHAR(100)"))
	if "google_id" not in user_columns: connection.execute(text("ALTER TABLE users ADD COLUMN google_id VARCHAR(100)"))

app = FastAPI(title="My Diary API", version="3.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] if cors_origins_env else [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.netlify\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
	response = await call_next(request)
	response.headers["X-Content-Type-Options"] = "nosniff"
	response.headers["X-Frame-Options"] = "DENY"
	response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
	return response
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
assets_dir = os.path.join(PROJECT_DIR, "frontend", "assets")
if os.path.exists(assets_dir):
	app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
app.include_router(auth_router)
app.include_router(entries_router)
app.include_router(categories_router)
app.include_router(media_router)
app.include_router(backup_router)

@app.get("/health")
def health(): return {"status": "ok"}

frontend_dir = os.path.join(PROJECT_DIR, "frontend")
if os.path.exists(frontend_dir):
	app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

