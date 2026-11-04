from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from ..auth import create_token, get_current_user, get_db, hash_value, verify_value
from ..database import User
from ..models import LoginRequest, RecoveryOut, ResetPassword, TokenOut, UserCreate, UserOut, UserSettings
from ..rate_limiter import limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])

def output(user: User) -> UserOut:
    return UserOut.model_validate(user)

@router.post("/register", response_model=TokenOut, status_code=201)
@limiter.limit("5/minute")
def register(request: Request, data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter((User.username == data.username.strip()) | (User.email == data.email.strip().lower())).first():
        raise HTTPException(409, "Username or email already exists")
    user = User(
        username=data.username.strip(),
        email=data.email.strip().lower(),
        password_hash=hash_value(data.password),
        recovery_question=data.recovery_question.strip(),
        recovery_answer_hash=hash_value(data.recovery_answer.strip().lower())
    )
    db.add(user); db.commit(); db.refresh(user)
    return TokenOut(access_token=create_token(user.id), user=output(user))

@router.post("/login", response_model=TokenOut)
@limiter.limit("10/minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username.strip()).first()
    if not user or not verify_value(data.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return TokenOut(access_token=create_token(user.id), user=output(user))

@router.post("/logout")
@limiter.limit("20/minute")
def logout(request: Request):
    return {"message": "Logged out"}

@router.get("/me", response_model=UserOut)
@limiter.limit("60/minute")
def me(request: Request, user: User = Depends(get_current_user)):
    return output(user)

@router.get("/recovery-question", response_model=RecoveryOut)
@limiter.limit("10/minute")
def recovery_question(request: Request, username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username.strip()).first()
    if not user: raise HTTPException(404, "User not found")
    return RecoveryOut(recovery_question=user.recovery_question)

@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, data: ResetPassword, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username.strip()).first()
    if not user:
        raise HTTPException(404, "User not found")
    raw = data.recovery_answer.strip()
    candidates = list(dict.fromkeys([raw, raw.lower(), raw.capitalize(), raw.title(), raw.upper()]))
    if not any(verify_value(c, user.recovery_answer_hash) for c in candidates):
        raise HTTPException(400, "Recovery answer is incorrect")
    user.password_hash = hash_value(data.new_password)
    db.commit()
    return {"message": "Password reset successfully"}

import uuid
import shutil
import base64
from pathlib import Path
from fastapi import UploadFile, File
from ..database import UPLOADS_DIR

@router.patch("/settings", response_model=UserOut)
def settings(data: UserSettings, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.diary_title is not None: user.diary_title = data.diary_title.strip() or "My Diary"
    if data.recovery_question is not None: user.recovery_question = data.recovery_question.strip()
    if data.recovery_answer is not None: user.recovery_answer_hash = hash_value(data.recovery_answer.strip().lower())
    if data.gender is not None: user.gender = data.gender
    if data.age_range is not None: user.age_range = data.age_range
    if data.avatar_url is not None:
        avatar_val = data.avatar_url.strip()
        if avatar_val.startswith("data:image/"):
            try:
                header, encoded = avatar_val.split(",", 1)
                mime = header.split(";")[0].split(":")[1] if ":" in header else "image/png"
                ext = ".png"
                if "jpeg" in mime or "jpg" in mime: ext = ".jpg"
                elif "webp" in mime: ext = ".webp"
                elif "gif" in mime: ext = ".gif"
                raw_bytes = base64.b64decode(encoded)
                filename = f"avatar_{user.id}_{uuid.uuid4().hex[:8]}{ext}"
                target_path = Path(UPLOADS_DIR) / filename
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(raw_bytes)
                user.avatar_url = f"/uploads/{filename}"
            except Exception:
                user.avatar_url = avatar_val
        else:
            user.avatar_url = avatar_val
    if data.display_name is not None: user.display_name = data.display_name.strip()
    db.commit(); db.refresh(user)
    return output(user)

@router.post("/avatar", response_model=UserOut)
def upload_avatar(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".heif", ".svg"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in valid_exts:
        if file.content_type and "jpeg" in file.content_type:
            ext = ".jpg"
        elif file.content_type and "webp" in file.content_type:
            ext = ".webp"
        else:
            ext = ".png"
    filename = f"avatar_{user.id}_{uuid.uuid4().hex[:8]}{ext}"
    target_path = Path(UPLOADS_DIR) / filename
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    user.avatar_url = f"/uploads/{filename}"
    db.commit()
    db.refresh(user)
    return output(user)
