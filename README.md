# My Diary

A private, multi-user journaling app with a warm paper-diary interface.

## Run locally

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, serve the frontend:

```bash
python3 -m http.server 5173 --directory frontend
```

Open http://localhost:5173. API docs are at http://localhost:8000/docs.

## Database and migrations

SQLite is used by default at `backend/diary.db`. Set `DATABASE_URL` to a PostgreSQL URL for deployment. The SQLAlchemy metadata is in `backend/database.py`; Alembic is configured in `backend/alembic.ini`.

```bash
cd backend
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

For a clean dev database, delete `backend/diary.db`; the app creates tables on startup.

## Tests

```bash
pytest -q
```

## Features

- Account registration/login with Argon2/bcrypt hashes and hashed recovery answers
- Per-user entries, ordered text/media blocks, mood and tags
- Categories, paginated archive, search, calendar activity heatmap
- Debounced autosave, dark-mode toggle, JSON export/import
- Media type/size validation and per-user file storage
