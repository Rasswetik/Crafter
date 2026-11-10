"""Regressions for 64-bit Telegram IDs, modal dismissal and splash performance."""
from pathlib import Path

from app import create_app
from admin_roles import ensure_admin_tables
from test_app import signed


def test_legacy_postgresql_admin_ids_are_migrated_to_bigint_without_dropping_grants():
    class Cursor:
        def fetchall(self):
            return [{"column_name": "user_id", "data_type": "integer"},
                    {"column_name": "updated_by", "data_type": "integer"}]

    class FakePG:
        connection = object()

        def __init__(self):
            self.sql = []

        def execute(self, statement):
            self.sql.append(statement)
            return Cursor()

    db = FakePG()
    ensure_admin_tables(db)
    statements = "\n".join(db.sql)
    assert "user_id BIGINT PRIMARY KEY" in statements
    assert "updated_by BIGINT NOT NULL" in statements
    assert "ALTER TABLE admin_role_grants ALTER COLUMN user_id TYPE BIGINT" in statements
    assert "ALTER TABLE admin_role_grants ALTER COLUMN updated_by TYPE BIGINT" in statements
    assert "DROP" not in statements

    class AlreadyMigratedPG(FakePG):
        def execute(self, statement):
            self.sql.append(statement)
            class Existing:
                def fetchall(self):
                    return [{"column_name":"user_id","data_type":"bigint"},
                            {"column_name":"updated_by","data_type":"bigint"}]
            return Existing()

    clean = AlreadyMigratedPG()
    ensure_admin_tables(clean)
    assert not any("ALTER TABLE" in query for query in clean.sql)


def test_big_telegram_user_id_can_be_granted_and_revoked(tmp_path):
    owner_id = 5_257_227_756
    teammate_id = 6_123_456_789
    app = create_app({
        "TESTING": True, "DATABASE": str(tmp_path / "roles.db"),
        "BOT_TOKEN": "test-token", "ADMIN_IDS": {owner_id},
        "PRIMARY_ADMIN_ID": str(owner_id), "DEMO_MODE": False,
    })
    client = app.test_client()
    owner, teammate = signed(owner_id), signed(teammate_id, username="RoleTester")
    assert client.get("/api/me", headers=owner).json["is_primary_admin"] is True
    assert client.get("/api/me", headers=teammate).status_code == 200
    granted = client.post("/api/admin/admins", headers=owner, json={
        "user_id": teammate_id, "role": "sections", "permissions": ["finance", "audit"],
    })
    assert granted.status_code == 200, granted.json
    assert client.get("/api/me", headers=teammate).json["admin_permissions"] == [
        "finance", "audit"
    ]
    assert client.post("/api/admin/admins/" + str(teammate_id) + "/revoke",
                       headers=owner, json={}).status_code == 200
    assert client.get("/api/me", headers=teammate).json["is_admin"] is False


def test_single_settings_gear_in_all_profiles_and_immediate_announcement_close():
    root = Path(__file__).resolve().parent.parent
    screen = (root / "static/screens.js").read_text(encoding="utf-8")
    prefs = (root / "static/preferences.js").read_text(encoding="utf-8")
    popup = (root / "static/announcements.js").read_text(encoding="utf-8")
    glass = (root / "static/announcements-glass-fix.css").read_text(encoding="utf-8")
    assert 'profile-settings-button" onclick="crafterOpenSettings()' not in screen
    assert "identity.querySelector('.crafter-open-settings, .profile-settings-button')" in prefs
    assert "state.gamesMode || root.querySelector('.crafter-open-settings')" not in prefs
    assert "close.disabled=true" not in popup
    assert "const ring=close.querySelector(" not in popup
    assert "close.addEventListener('click',crafterCloseAnnouncement)" in popup
    assert "banner.addEventListener('cancel',event=>" in popup
    assert "crafter-announcement-cross" in popup
    assert "right:10px!important" in glass
    assert "width:42px!important" in glass


def test_splash_is_full_bleed_and_updates_both_progress_indicators():
    root = Path(__file__).resolve().parent.parent
    layout = (root / "static/splash-v3.css").read_text(encoding="utf-8")
    loader = (root / "static/loading.js").read_text(encoding="utf-8")
    template = (root / "templates/index.html").read_text(encoding="utf-8")
    assert "position:fixed;inset:0" in layout and "min(78vw,50vh" in layout          # one layout, scales with the screen
    assert "querySelectorAll('#splash .splash-progress')" in loader
    assert "Date.now()+2500" not in loader
    assert "splash-v3.css" in template and template.count("/static/assets/splash/pepe-") >= 1
    assert "splash-device-layout.css" not in template and "crafter-approved-splash" not in template
    assert "announcements-glass-fix.css" in template
    assert "/static/preferences.js?v=" in template
