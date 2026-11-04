import io
import json
import os
from uuid import uuid4
from fastapi.testclient import TestClient

# Disable rate limiting for tests
os.environ["RATE_LIMIT_ENABLED"] = "false"

from backend.main import app

client = TestClient(app)

def account():
    name = "test_" + uuid4().hex[:10]
    response = client.post("/api/auth/register", json={
        "username": name,
        "email": f"{name}@example.com",
        "password": "password123",
        "recovery_question": "Pet?",
        "recovery_answer": "Milo"
    })
    assert response.status_code == 201
    return name, {"Authorization": f"Bearer {response.json()['access_token']}"}

def test_auth_and_entry_crud():
    _, headers = account()
    created = client.post("/api/entries", headers=headers, json={"entry_date": "2026-09-23T12:00:00", "title": "First page", "blocks": [{"type": "text", "content": "Hello", "position": 0}]})
    assert created.status_code == 201
    entry_id = created.json()["id"]
    listed = client.get("/api/entries", headers=headers)
    assert listed.status_code == 200 and listed.json()["total"] >= 1
    updated = client.patch(f"/api/entries/{entry_id}", headers=headers, json={"title": "Updated"})
    assert updated.status_code == 200 and updated.json()["title"] == "Updated"

def test_users_are_isolated():
    _, first = account()
    _, second = account()
    client.post("/api/entries", headers=first, json={"entry_date": "2026-09-23T12:00:00", "title": "Private", "blocks": []})
    response = client.get("/api/entries", headers=second)
    assert response.status_code == 200 and response.json()["total"] == 0

def test_search_query_works():
    _, headers = account()
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-23T12:00:00",
        "title": "A wonderful sunset trip",
        "tags": ["travel", "sunset"],
        "blocks": [{"type": "text", "content": "Today we saw the golden horizon.", "position": 0}]
    })
    # Search by tag
    res_tag = client.get("/api/entries/search/query?q=travel", headers=headers)
    assert res_tag.status_code == 200
    assert res_tag.json()["total"] == 1

    # Search by title
    res_title = client.get("/api/entries/search/query?q=sunset", headers=headers)
    assert res_title.status_code == 200
    assert res_title.json()["total"] == 1

    # Search by block content
    res_content = client.get("/api/entries/search/query?q=horizon", headers=headers)
    assert res_content.status_code == 200
    assert res_content.json()["total"] == 1

def test_category_deletion_preserves_entries():
    _, headers = account()
    # Create category
    cat_res = client.post("/api/categories", headers=headers, json={"name": "Travel", "icon": "✈", "color": "#6b9fd3"})
    assert cat_res.status_code == 201
    cat_id = cat_res.json()["id"]

    # Create entry assigned to category
    entry_res = client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-23T12:00:00",
        "title": "Flight to Tokyo",
        "category_id": cat_id,
        "blocks": [{"type": "text", "content": "Boarding now", "position": 0}]
    })
    assert entry_res.status_code == 201
    entry_id = entry_res.json()["id"]

    # Delete category
    del_res = client.delete(f"/api/categories/{cat_id}", headers=headers)
    assert del_res.status_code == 204

    # Entry should still exist, with category_id None
    entry_check = client.get(f"/api/entries/{entry_id}", headers=headers)
    assert entry_check.status_code == 200
    assert entry_check.json()["id"] == entry_id
    assert entry_check.json()["category_id"] is None

def test_by_date_and_validation():
    _, headers = account()
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T14:30:00",
        "title": "Midday notes",
        "blocks": []
    })
    # Query valid date
    valid_res = client.get("/api/entries/by-date/2026-09-24", headers=headers)
    assert valid_res.status_code == 200
    assert valid_res.json() is not None
    assert valid_res.json()["title"] == "Midday notes"

    # Query invalid date format
    invalid_res = client.get("/api/entries/by-date/invalid-date", headers=headers)
    assert invalid_res.status_code == 400

def test_backup_export_import_and_pdf():
    _, headers = account()
    # Create entry
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "Export Test",
        "mood": "✨",
        "blocks": [{"type": "text", "content": "Important thoughts", "position": 0}]
    })

    # Export
    exp_res = client.get("/api/backup/export", headers=headers)
    assert exp_res.status_code == 200
    backup_data = exp_res.json()
    assert len(backup_data["entries"]) >= 1

    # PDF Export
    pdf_res = client.get("/api/backup/pdf", headers=headers)
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"

    # Import into a new user account
    _, new_headers = account()
    backup_file = io.BytesIO(json.dumps(backup_data).encode("utf-8"))
    imp_res = client.post("/api/backup/import", headers=new_headers, files={"file": ("backup.json", backup_file, "application/json")})
    assert imp_res.status_code == 200
    assert imp_res.json()["entries_imported"] >= 1

    # Check imported entry in new account
    new_entries = client.get("/api/entries", headers=new_headers)
    assert new_entries.status_code == 200
    assert new_entries.json()["total"] >= 1

def test_forgot_password_flow():
    username, _ = account()
    # 1. Fetch question
    q_res = client.get(f"/api/auth/recovery-question?username={username}")
    assert q_res.status_code == 200
    assert q_res.json()["recovery_question"] == "Pet?"

    # 2. Reset password
    reset_res = client.post("/api/auth/forgot-password", json={
        "username": username,
        "recovery_answer": "Milo",
        "new_password": "newpassword456"
    })
    assert reset_res.status_code == 200

    # 3. Login with new password
    login_res = client.post("/api/auth/login", json={
        "username": username,
        "password": "newpassword456"
    })
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()

def test_intro_onboarding_and_avatar_upload():
    import io
    _, headers = account()
    # 1. Update gender and age_range
    set_res = client.patch("/api/auth/settings", json={
        "gender": "female",
        "age_range": "19-25",
        "display_name": "Sarah",
        "avatar_url": "/assets/intro/avatar_19_25.png"
    }, headers=headers)
    assert set_res.status_code == 200
    data = set_res.json()
    assert data["gender"] == "female"
    assert data["age_range"] == "19-25"
    assert data["display_name"] == "Sarah"
    assert data["avatar_url"] == "/assets/intro/avatar_19_25.png"

    # 2. Upload custom avatar
    fake_img = io.BytesIO(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
    fake_img.name = "my_photo.png"
    upload_res = client.post("/api/auth/avatar", files={"file": ("my_photo.png", fake_img, "image/png")}, headers=headers)
    assert upload_res.status_code == 200
    upload_data = upload_res.json()
    assert upload_data["avatar_url"].startswith("/uploads/avatar_")

    # 3. Check /auth/me returns updated avatar and display_name
    me_res = client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["avatar_url"] == upload_data["avatar_url"]
    assert me_res.json()["display_name"] == "Sarah"


def test_media_upload_image():
    _, headers = account()
    # Create entry first
    entry_res = client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "Media Test",
        "blocks": []
    })
    assert entry_res.status_code == 201
    entry_id = entry_res.json()["id"]

    # Upload image
    fake_img = io.BytesIO(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
    fake_img.name = "test.png"
    upload_res = client.post(f"/api/media/upload/{entry_id}?kind=image", files={"file": ("test.png", fake_img, "image/png")}, headers=headers)
    assert upload_res.status_code == 200
    data = upload_res.json()
    assert data["type"] == "image"
    assert data["url"].startswith("/uploads/")
    block_id = data["id"]

    # Verify block was added to entry
    entry_check = client.get(f"/api/entries/{entry_id}", headers=headers)
    assert entry_check.status_code == 200
    blocks = entry_check.json()["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["id"] == block_id
    assert blocks[0]["type"] == "image"


def test_media_upload_rejects_wrong_type():
    _, headers = account()
    entry_res = client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "Media Test",
        "blocks": []
    })
    entry_id = entry_res.json()["id"]

    # Try to upload text file as image
    fake_text = io.BytesIO(b"not an image")
    upload_res = client.post(f"/api/media/upload/{entry_id}?kind=image", files={"file": ("test.txt", fake_text, "text/plain")}, headers=headers)
    assert upload_res.status_code == 415


def test_category_crud():
    _, headers = account()
    # Create
    create_res = client.post("/api/categories", headers=headers, json={"name": "Work", "icon": "💼", "color": "#ff5722"})
    assert create_res.status_code == 201
    cat = create_res.json()
    cat_id = cat["id"]
    assert cat["name"] == "Work"
    assert cat["icon"] == "💼"
    assert cat["color"] == "#ff5722"

    # List
    list_res = client.get("/api/categories", headers=headers)
    assert list_res.status_code == 200
    categories = list_res.json()
    assert len(categories) == 1
    assert categories[0]["id"] == cat_id

    # Update
    update_res = client.patch(f"/api/categories/{cat_id}", headers=headers, json={"name": "Personal", "icon": "🏠", "color": "#4caf50"})
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["name"] == "Personal"
    assert updated["icon"] == "🏠"
    assert updated["color"] == "#4caf50"

    # Delete
    del_res = client.delete(f"/api/categories/{cat_id}", headers=headers)
    assert del_res.status_code == 204

    # Verify deleted
    list_res = client.get("/api/categories", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) == 0


def test_category_duplicate_rejected():
    _, headers = account()
    client.post("/api/categories", headers=headers, json={"name": "Work", "icon": "💼", "color": "#ff5722"})
    dup_res = client.post("/api/categories", headers=headers, json={"name": "Work", "icon": "💼", "color": "#ff5722"})
    assert dup_res.status_code == 409


def test_search_pagination():
    _, headers = account()
    # Create 5 entries
    for i in range(5):
        client.post("/api/entries", headers=headers, json={
            "entry_date": f"2026-09-{20+i:02d}T12:00:00",
            "title": f"Entry {i}",
            "tags": ["tag1"],
            "blocks": [{"type": "text", "content": f"Content {i}", "position": 0}]
        })

    # Page 1
    page1 = client.get("/api/entries/search/query?q=tag1&page=1&page_size=2", headers=headers)
    assert page1.status_code == 200
    data1 = page1.json()
    assert data1["page"] == 1
    assert data1["page_size"] == 2
    assert data1["total"] == 5
    assert len(data1["items"]) == 2

    # Page 2
    page2 = client.get("/api/entries/search/query?q=tag1&page=2&page_size=2", headers=headers)
    assert page2.status_code == 200
    data2 = page2.json()
    assert data2["page"] == 2
    assert len(data2["items"]) == 2

    # Page 3 (last page, 1 item)
    page3 = client.get("/api/entries/search/query?q=tag1&page=3&page_size=2", headers=headers)
    assert page3.status_code == 200
    data3 = page3.json()
    assert data3["page"] == 3
    assert len(data3["items"]) == 1


def test_entries_list_pagination():
    _, headers = account()
    for i in range(5):
        client.post("/api/entries", headers=headers, json={
            "entry_date": f"2026-09-{20+i:02d}T12:00:00",
            "title": f"Entry {i}",
            "blocks": []
        })

    page1 = client.get("/api/entries?page=1&page_size=2", headers=headers)
    assert page1.status_code == 200
    data1 = page1.json()
    assert data1["page"] == 1
    assert data1["page_size"] == 2
    assert data1["total"] == 5
    assert len(data1["items"]) == 2

    page2 = client.get("/api/entries?page=2&page_size=2", headers=headers)
    assert page2.status_code == 200
    assert len(page2.json()["items"]) == 2


def test_soft_delete_and_restore():
    _, headers = account()
    # Create entry
    entry_res = client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "To Delete",
        "blocks": [{"type": "text", "content": "Will be deleted", "position": 0}]
    })
    assert entry_res.status_code == 201
    entry_id = entry_res.json()["id"]

    # Soft delete
    del_res = client.patch(f"/api/entries/{entry_id}/delete", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["deleted_at"] is not None

    # Entry should not appear in normal list
    list_res = client.get("/api/entries", headers=headers)
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 0

    # But should appear in trash
    trash_res = client.get("/api/entries/trash", headers=headers)
    assert trash_res.status_code == 200
    assert trash_res.json()["total"] == 1
    assert trash_res.json()["items"][0]["id"] == entry_id

    # Restore
    restore_res = client.post(f"/api/entries/{entry_id}/restore", headers=headers)
    assert restore_res.status_code == 200
    assert restore_res.json()["deleted_at"] is None

    # Entry should appear in normal list again
    list_res = client.get("/api/entries", headers=headers)
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 1


def test_hard_delete_permanently_removes():
    _, headers = account()
    entry_res = client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "Hard Delete",
        "blocks": []
    })
    entry_id = entry_res.json()["id"]

    # Soft delete first
    client.patch(f"/api/entries/{entry_id}/delete", headers=headers)

    # Hard delete
    hard_del = client.delete(f"/api/entries/{entry_id}", headers=headers)
    assert hard_del.status_code == 204

    # Should not appear anywhere
    list_res = client.get("/api/entries", headers=headers)
    assert list_res.json()["total"] == 0
    trash_res = client.get("/api/entries/trash", headers=headers)
    assert trash_res.json()["total"] == 0

    # 404 on get
    get_res = client.get(f"/api/entries/{entry_id}", headers=headers)
    assert get_res.status_code == 404


def test_backup_excludes_deleted():
    _, headers = account()
    # Create normal entry
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "Active Entry",
        "blocks": []
    })
    # Create and soft delete entry
    del_entry = client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T13:00:00",
        "title": "Deleted Entry",
        "blocks": []
    })
    del_id = del_entry.json()["id"]
    client.patch(f"/api/entries/{del_id}/delete", headers=headers)

    # Export should only have active entry
    exp_res = client.get("/api/backup/export", headers=headers)
    assert exp_res.status_code == 200
    data = exp_res.json()
    assert len(data["entries"]) == 1
    assert data["entries"][0]["title"] == "Active Entry"


def test_search_fts():
    _, headers = account()
    # Create entries with searchable content
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-24T12:00:00",
        "title": "Sunset walk",
        "blocks": [{"type": "text", "content": "Beautiful golden sunset", "position": 0}]
    })
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-25T12:00:00",
        "title": "Morning run",
        "blocks": [{"type": "text", "content": "Early morning jogging", "position": 0}]
    })
    client.post("/api/entries", headers=headers, json={
        "entry_date": "2026-09-26T12:00:00",
        "title": "Beach day",
        "blocks": [{"type": "text", "content": "Sunset at the beach", "position": 0}]
    })

    # FTS search for "sunset"
    fts_res = client.get("/api/entries/search/fts?q=sunset", headers=headers)
    assert fts_res.status_code == 200
    data = fts_res.json()
    assert data["total"] == 2
    titles = [e["title"] for e in data["items"]]
    assert "Sunset walk" in titles
    assert "Beach day" in titles

    # FTS search for "morning"
    fts_res = client.get("/api/entries/search/fts?q=morning", headers=headers)
    assert fts_res.status_code == 200
    assert fts_res.json()["total"] == 1

    # FTS search with pagination
    fts_res = client.get("/api/entries/search/fts?q=sunset&page=1&page_size=1", headers=headers)
    assert fts_res.status_code == 200
    data = fts_res.json()
    assert data["page"] == 1
    assert data["page_size"] == 1
    assert len(data["items"]) == 1

def test_google_auth(monkeypatch):
    import backend.routes.auth as auth_mod
    # Mock verify_google_token
    from fastapi import HTTPException
    def mock_verify(credential):
        if credential == "valid_token":
            return {
                "sub": "google_123456",
                "email": "user@gmail.com",
                "email_verified": "true",
                "name": "Basit Ali",
                "picture": "https://example.com/avatar.jpg"
            }
        raise HTTPException(401, "Invalid token")

    monkeypatch.setattr(auth_mod, "verify_google_token", mock_verify)

    # Valid token creates user
    res = client.post("/api/auth/google", json={"credential": "valid_token"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["email"] == "user@gmail.com"
    assert data["user"]["display_name"] == "Basit Ali"
    assert data["user"]["google_id"] == "google_123456"

    # Existing user login
    res2 = client.post("/api/auth/google", json={"credential": "valid_token"})
    assert res2.status_code == 200
    assert res2.json()["user"]["email"] == "user@gmail.com"

    # Invalid token fails
    res_err = client.post("/api/auth/google", json={"credential": "invalid"})
    assert res_err.status_code == 401

