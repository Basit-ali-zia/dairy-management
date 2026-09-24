import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from ..auth import get_current_user, get_db
from ..database import Block, Entry, User, UPLOADS_DIR

router = APIRouter(prefix="/api/media", tags=["media"])
ALLOWED = {"image": ("image/", 10 * 1024 * 1024), "video": ("video/", 50 * 1024 * 1024), "audio": ("audio/", 25 * 1024 * 1024)}

@router.post("/upload/{entry_id}")
async def upload(entry_id: int, kind: str, file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if kind not in ALLOWED or not file.content_type or not file.content_type.startswith(ALLOWED[kind][0]): raise HTTPException(415, "Unsupported media type")
    entry = db.query(Entry).filter(Entry.id == entry_id, Entry.user_id == user.id).first()
    if not entry: raise HTTPException(404, "Entry not found")
    data = await file.read(ALLOWED[kind][1] + 1)
    if len(data) > ALLOWED[kind][1]: raise HTTPException(413, "File too large")
    folder = Path(UPLOADS_DIR) / str(user.id); folder.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{Path(file.filename or '').suffix.lower()}"; path = folder / name; path.write_bytes(data)
    block = Block(entry_id=entry.id, type=kind, content=f"/uploads/{user.id}/{name}", position=len(entry.blocks)); db.add(block); db.commit(); db.refresh(block)
    return {"id": block.id, "url": block.content, "type": kind}
