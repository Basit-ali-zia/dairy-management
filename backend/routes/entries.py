from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, String, text
from sqlalchemy.orm import Session, selectinload
from ..auth import get_current_user, get_db
from ..database import Block, Category, Entry, User
from ..models import EntryIn, EntryOut, EntryPatch, PageOut, SearchOut

router = APIRouter(prefix="/api/entries", tags=["entries"])

def serialize(entry: Entry) -> EntryOut:
    dt = entry.entry_date
    if dt is not None and dt.tzinfo is None:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    cat = entry.created_at
    if cat is not None and cat.tzinfo is None:
        from datetime import timezone
        cat = cat.replace(tzinfo=timezone.utc)
    deleted = entry.deleted_at
    if deleted is not None and deleted.tzinfo is None:
        from datetime import timezone
        deleted = deleted.replace(tzinfo=timezone.utc)
    return EntryOut(id=entry.id, entry_date=dt, title=entry.title, mood=entry.mood, tags=entry.tags or [], category_id=entry.category_id, category_name=entry.category.name if entry.category else None, blocks=entry.blocks, created_at=cat, updated_at=entry.updated_at, deleted_at=deleted)

def active_entries_query(user: User, db: Session):
    return db.query(Entry).options(selectinload(Entry.blocks)).filter(Entry.user_id == user.id, Entry.deleted_at.is_(None))

def owned_entry(entry_id: int, user: User, db: Session, include_deleted: bool = False):
    query = db.query(Entry).options(selectinload(Entry.blocks)).filter(Entry.id == entry_id, Entry.user_id == user.id)
    if not include_deleted:
        query = query.filter(Entry.deleted_at.is_(None))
    entry = query.first()
    if not entry: raise HTTPException(404, "Entry not found")
    return entry

def replace_blocks(entry: Entry, blocks, db: Session):
    entry.blocks.clear()
    entry.blocks.extend([Block(type=b.type, content=b.content, position=b.position) for b in blocks])

@router.post("", response_model=EntryOut, status_code=201)
def create(data: EntryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.category_id and not db.query(Category).filter(Category.id == data.category_id, Category.user_id == user.id).first(): raise HTTPException(400, "Invalid category")
    entry = Entry(user_id=user.id, entry_date=data.entry_date, title=data.title, mood=data.mood or "😊", tags=data.tags, category_id=data.category_id)
    replace_blocks(entry, data.blocks, db); db.add(entry); db.commit(); db.refresh(entry)
    return serialize(entry)

@router.get("", response_model=PageOut)
def list_entries(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), category_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = active_entries_query(user, db)
    if category_id is not None: query = query.filter(Entry.category_id == category_id)
    total = query.count(); items = query.order_by(Entry.entry_date.desc()).offset((page-1)*page_size).limit(page_size).all()
    return PageOut(items=[serialize(e) for e in items], page=page, page_size=page_size, total=total)

@router.get("/trash", response_model=PageOut)
def list_trash(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Entry).options(selectinload(Entry.blocks)).filter(Entry.user_id == user.id, Entry.deleted_at.isnot(None))
    total = query.count(); items = query.order_by(Entry.deleted_at.desc()).offset((page-1)*page_size).limit(page_size).all()
    return PageOut(items=[serialize(e) for e in items], page=page, page_size=page_size, total=total)

@router.get("/by-date/{date}", response_model=EntryOut | None)
def by_date(date: str, category_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        start_date = datetime.fromisoformat(date)
    except ValueError:
        raise HTTPException(400, "Invalid date format")
    end_date = start_date + timedelta(days=1)
    query = active_entries_query(user, db).filter(Entry.entry_date >= start_date, Entry.entry_date < end_date)
    if category_id is not None: query = query.filter(Entry.category_id == category_id)
    entry = query.first(); return serialize(entry) if entry else None

@router.get("/{entry_id}", response_model=EntryOut)
def get_one(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)): return serialize(owned_entry(entry_id, user, db))

@router.patch("/{entry_id}", response_model=EntryOut)
def update(entry_id: int, data: EntryPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = owned_entry(entry_id, user, db)
    for field in ("title", "mood", "tags"):
        value = getattr(data, field)
        if value is not None: setattr(entry, field, value)
    if data.blocks is not None: replace_blocks(entry, data.blocks, db)
    db.commit(); db.refresh(entry); return serialize(entry)

@router.patch("/{entry_id}/delete", response_model=EntryOut)
def soft_delete(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = owned_entry(entry_id, user, db)
    entry.deleted_at = datetime.now(entry.deleted_at.tzinfo if entry.deleted_at else None)
    db.commit(); db.refresh(entry)
    return serialize(entry)

@router.post("/{entry_id}/restore", response_model=EntryOut)
def restore(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = owned_entry(entry_id, user, db, include_deleted=True)
    if entry.deleted_at is None:
        raise HTTPException(400, "Entry is not in trash")
    entry.deleted_at = None
    db.commit(); db.refresh(entry)
    return serialize(entry)

@router.delete("/{entry_id}", status_code=204)
def hard_delete(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = owned_entry(entry_id, user, db, include_deleted=True); db.delete(entry); db.commit()

@router.delete("/{entry_id}/blocks/{block_id}", status_code=204)
def delete_block(entry_id: int, block_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = owned_entry(entry_id, user, db); block = next((b for b in entry.blocks if b.id == block_id), None)
    if not block: raise HTTPException(404, "Block not found")
    db.delete(block); db.commit()

@router.get("/search/query", response_model=SearchOut)
def search(q: str = "", start: datetime | None = None, end: datetime | None = None, mood: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = active_entries_query(user, db)
    if q: query = query.filter(or_(Entry.title.ilike(f"%{q}%"), Entry.tags.cast(String).ilike(f"%{q}%"), Entry.blocks.any(Block.content.ilike(f"%{q}%"))))
    if start: query = query.filter(Entry.entry_date >= start)
    if end: query = query.filter(Entry.entry_date <= end)
    if mood: query = query.filter(Entry.mood == mood)
    total = query.count()
    items = query.order_by(Entry.entry_date.desc()).offset((page-1)*page_size).limit(page_size).all()
    return SearchOut(items=[serialize(e) for e in items], page=page, page_size=page_size, total=total)

@router.get("/search/fts", response_model=SearchOut)
def search_fts(q: str = "", page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not q:
        return SearchOut(items=[], page=page, page_size=page_size, total=0)
    try:
        result = db.execute(text("""
            SELECT e.* FROM entries e
            JOIN entries_fts fts ON e.id = fts.entry_id
            WHERE fts MATCH :q AND e.user_id = :user_id AND e.deleted_at IS NULL
            ORDER BY rank
            LIMIT :limit OFFSET :offset
        """), {"q": q, "user_id": user.id, "limit": page_size, "offset": (page-1)*page_size})
        entries = [Entry(**dict(row._mapping)) for row in result]
        
        # Get total count
        count_result = db.execute(text("""
            SELECT COUNT(*) FROM entries e
            JOIN entries_fts fts ON e.id = fts.entry_id
            WHERE fts MATCH :q AND e.user_id = :user_id AND e.deleted_at IS NULL
        """), {"q": q, "user_id": user.id})
        total = count_result.scalar() or 0
        
        return SearchOut(items=[serialize(e) for e in entries], page=page, page_size=page_size, total=total)
    except Exception:
        # Fallback to regular search if FTS not available
        return search(q=q, page=page, page_size=page_size, user=user, db=db)
