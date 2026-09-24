from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..auth import get_current_user, get_db
from ..database import Category, Entry, User
from ..models import CategoryIn, CategoryOut

router = APIRouter(prefix="/api/categories", tags=["categories"])

@router.get("", response_model=list[CategoryOut])
def list_categories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Category).filter(Category.user_id == user.id).order_by(Category.name).all()

@router.post("", response_model=CategoryOut, status_code=201)
def create(data: CategoryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.query(Category).filter(Category.user_id == user.id, Category.name.ilike(data.name)).first(): raise HTTPException(409, "Category already exists")
    category = Category(user_id=user.id, name=data.name.strip(), icon=data.icon, color=data.color); db.add(category); db.commit(); db.refresh(category); return category

@router.patch("/{category_id}", response_model=CategoryOut)
def rename(category_id: int, data: CategoryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == category_id, Category.user_id == user.id).first()
    if not category: raise HTTPException(404, "Category not found")
    category.name, category.icon, category.color = data.name.strip(), data.icon, data.color; db.commit(); db.refresh(category); return category

@router.delete("/{category_id}", status_code=204)
def delete(category_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == category_id, Category.user_id == user.id).first()
    if not category: raise HTTPException(404, "Category not found")
    db.delete(category); db.commit()

@router.get("/{category_id}/entries")
def category_entries(category_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == category_id, Category.user_id == user.id).first()
    if not category: raise HTTPException(404, "Category not found")
    return [{"id": e.id, "entry_date": e.entry_date, "title": e.title, "mood": e.mood} for e in db.query(Entry).filter(Entry.category_id == category_id, Entry.user_id == user.id).order_by(Entry.entry_date.desc()).all()]
