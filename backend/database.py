"""
Database configuration and SQLAlchemy setup.
Uses SQLite for development, designed to be PostgreSQL-compatible.
"""
import os
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, ForeignKey, Index, JSON, event
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.sql import func

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
UPLOADS_DIR = os.path.join(PROJECT_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'diary.db')}")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
    echo=False,
)

if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

Base = declarative_base()


# ──────────────────────────────────────────────────────────────────────
# ORM Models
# ──────────────────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    diary_title = Column(String(200), default="My Diary")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    recovery_question = Column(String(255), nullable=False, default="What was your first pet's name?")
    recovery_answer_hash = Column(String(255), nullable=False)
    gender = Column(String(32), nullable=True)
    age_range = Column(String(16), nullable=True)
    avatar_url = Column(Text, nullable=True)
    display_name = Column(String(100), nullable=True)

    # Relationships
    categories = relationship("Category", back_populates="owner", cascade="all, delete-orphan")
    entries = relationship("Entry", back_populates="owner", cascade="all, delete-orphan")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    icon = Column(String(50), default="📝")  # emoji or icon name
    color = Column(String(20), default="#d87983")

    owner = relationship("User", back_populates="categories")
    entries = relationship("Entry", back_populates="category")


class Entry(Base):
    __tablename__ = "entries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    entry_date = Column(DateTime(timezone=True), nullable=False, default=func.now())  # the date of the entry
    title = Column(String(200), nullable=True)
    mood = Column(String(16), nullable=False, default="😊")
    tags = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    owner = relationship("User", back_populates="entries")
    category = relationship("Category", back_populates="entries")
    blocks = relationship("Block", back_populates="entry", cascade="all, delete-orphan")


class Block(Base):
    __tablename__ = "blocks"

    id = Column(Integer, primary_key=True, index=True)
    entry_id = Column(Integer, ForeignKey("entries.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(20), nullable=False)  # text, image, video, audio
    content = Column(Text)  # text content or file_path
    position = Column(Integer, nullable=False, default=0)  # ordering position
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    entry = relationship("Entry", back_populates="blocks")


# ──────────────────────────────────────────────────────────────────────
# Indexes for performance
# ──────────────────────────────────────────────────────────────────────
Index("ix_entries_user_date", Entry.user_id, Entry.entry_date)
Index("ix_blocks_entry_id", Block.entry_id)
Index("ix_blocks_entry_position", Block.entry_id, Block.position)