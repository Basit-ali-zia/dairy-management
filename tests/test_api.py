import io
import json
from uuid import uuid4
from fastapi.testclient import TestClient
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

