from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    recovery_question: str = Field(min_length=3, max_length=255)
    recovery_answer: str = Field(min_length=1, max_length=255)

class LoginRequest(BaseModel):
    username: str
    password: str

class GoogleAuthRequest(BaseModel):
    credential: str

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: EmailStr
    diary_title: str
    gender: Optional[str] = None
    age_range: Optional[str] = None
    avatar_url: Optional[str] = None
    display_name: Optional[str] = None
    google_id: Optional[str] = None

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class RecoveryOut(BaseModel):
    recovery_question: str

class ResetPassword(BaseModel):
    username: str
    recovery_answer: str
    new_password: str = Field(min_length=8, max_length=128)

class UserSettings(BaseModel):
    diary_title: Optional[str] = Field(default=None, max_length=200)
    recovery_question: Optional[str] = Field(default=None, max_length=255)
    recovery_answer: Optional[str] = Field(default=None, max_length=255)
    gender: Optional[str] = Field(default=None, max_length=32)
    age_range: Optional[str] = Field(default=None, max_length=16)
    avatar_url: Optional[str] = Field(default=None, max_length=10000000)
    display_name: Optional[str] = Field(default=None, max_length=100)

class BlockIn(BaseModel):
    type: str = Field(pattern="^(text|image|video|audio)$")
    content: str = ""
    position: int = Field(default=0, ge=0)

class BlockOut(BlockIn):
    model_config = ConfigDict(from_attributes=True)
    id: int

class EntryIn(BaseModel):
    entry_date: datetime
    title: Optional[str] = Field(default=None, max_length=200)
    mood: Optional[str] = Field(default="😊", max_length=16)
    tags: list[str] = Field(default_factory=list, max_length=20)
    category_id: Optional[int] = None
    blocks: list[BlockIn] = Field(default_factory=list)

class EntryPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    mood: Optional[str] = Field(default=None, max_length=16)
    tags: Optional[list[str]] = None
    blocks: Optional[list[BlockIn]] = None

class EntryOut(BaseModel):
    id: int
    entry_date: datetime
    title: Optional[str]
    mood: str
    tags: list[str]
    category_id: Optional[int]
    category_name: Optional[str] = None
    blocks: list[BlockOut]
    created_at: datetime
    updated_at: Optional[datetime]
    deleted_at: Optional[datetime] = None

class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    icon: str = Field(default="✦", max_length=16)
    color: str = Field(default="#d87983", pattern=r"^#[0-9a-fA-F]{6}$")

class CategoryOut(CategoryIn):
    model_config = ConfigDict(from_attributes=True)
    id: int

class PageOut(BaseModel):
    items: list[EntryOut]
    page: int
    page_size: int
    total: int

class SearchOut(BaseModel):
    items: list[EntryOut]
    page: int
    page_size: int
    total: int
