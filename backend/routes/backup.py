from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, selectinload
from ..auth import get_current_user, get_db
from ..database import Block, Category, Entry, User
from ..routes.entries import serialize
import json
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from pathlib import Path

router = APIRouter(prefix="/api/backup", tags=["backup"])

@router.get("/export")
def export_data(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    categories = db.query(Category).filter(Category.user_id == user.id).all()
    entries = db.query(Entry).options(selectinload(Entry.blocks)).filter(Entry.user_id == user.id).order_by(Entry.entry_date).all()
    return {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "categories": [{"name": c.name, "icon": c.icon, "color": c.color} for c in categories],
        "entries": [serialize(e).model_dump(mode="json") for e in entries]
    }

@router.post("/import")
async def import_data(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        content = await file.read()
        data = json.loads(content)
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        raise HTTPException(400, "Invalid JSON file")

    for item in data.get("categories", []):
        cat_name = (item.get("name") or "").strip()
        if cat_name and not db.query(Category).filter(Category.user_id == user.id, Category.name == cat_name).first():
            db.add(Category(user_id=user.id, name=cat_name, icon=item.get("icon", "✦"), color=item.get("color", "#d87983")))
    db.commit()

    category_map = {c.name: c.id for c in db.query(Category).filter(Category.user_id == user.id).all()}
    imported = 0
    for item in data.get("entries", []):
        raw_date = item.get("entry_date")
        if not raw_date:
            continue
        try:
            entry_date = datetime.fromisoformat(raw_date)
        except ValueError:
            entry_date = datetime.now(timezone.utc)

        cat_name = item.get("category_name")
        assigned_cat_id = category_map.get(cat_name) if cat_name else None

        entry = Entry(
            user_id=user.id,
            entry_date=entry_date,
            title=item.get("title"),
            mood=item.get("mood", "😊"),
            tags=item.get("tags", []),
            category_id=assigned_cat_id
        )
        for block in item.get("blocks", []):
            entry.blocks.append(Block(type=block.get("type", "text"), content=block.get("content", ""), position=block.get("position", 0)))
        db.add(entry)
        imported += 1
    db.commit()
    return {"message": "Backup imported", "entries_imported": imported, "note": "Media files are not embedded in JSON backups."}

@router.get("/pdf")
def export_pdf(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entries = db.query(Entry).filter(Entry.user_id == user.id).order_by(Entry.entry_date).all()
    upload_dir = Path("uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    path = upload_dir / f"diary_{user.id}.pdf"
    pdf = canvas.Canvas(str(path), pagesize=letter)
    y = 750
    pdf.setTitle(user.diary_title or "My Diary")
    for entry in entries:
        pdf.setFont("Helvetica-Bold", 13)
        date_str = entry.entry_date.strftime("%Y-%m-%d") if isinstance(entry.entry_date, datetime) else str(entry.entry_date)[:10]
        title_str = entry.title or 'Untitled'
        mood_str = entry.mood or ''
        pdf.drawString(50, y, f"{date_str}  {title_str}  {mood_str}")
        y -= 20
        pdf.setFont("Helvetica", 10)
        for block in entry.blocks:
            for line in (block.content or "").splitlines() or [""]:
                pdf.drawString(65, y, line[:110])
                y -= 14
                if y < 60:
                    pdf.showPage()
                    pdf.setFont("Helvetica", 10)
                    y = 750
        y -= 14
        if y < 60:
            pdf.showPage()
            y = 750
    pdf.save()
    return FileResponse(path, media_type="application/pdf", filename=f"diary_{user.username}.pdf")
