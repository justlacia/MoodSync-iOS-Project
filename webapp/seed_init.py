"""Initializes MoodSync SQLite database, syncs 300+ tracks from online APIs, and seeds demo history."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from .database import Database
from .detector_service import EmotionDetectorService
from .music_service import MusicCatalogService

REPO_ROOT = Path(__file__).resolve().parent.parent


def bootstrap_database(db: Database, music: MusicCatalogService, detector: EmotionDetectorService | None = None) -> dict:
    catalog_stats = music.ensure_rich_catalog(min_tracks=220)

    # Export SQL Server seed script if not yet generated
    sql_seed_path = REPO_ROOT / "src" / "MoodSync" / "database" / "seed_tracks.sql"
    if not sql_seed_path.is_file() and catalog_stats["total"] > 0:
        music.export_sql_server_seed(sql_seed_path)

    # Ensure classic 'demo' account exists with realistic past scan sessions
    demo_user = db.authenticate_user("demo", "moodsync123")
    if demo_user is None:
        try:
            demo_user = db.register_user(
                username="demo",
                password="moodsync123",
                display_name="Demo Kullanıcı",
                email="demo@moodsync.app",
            )
            _seed_demo_sessions(db, demo_user["id"], detector)
        except ValueError:
            pass

    return catalog_stats


def _seed_demo_sessions(db: Database, user_id: int, detector: EmotionDetectorService | None) -> None:
    now = datetime.now(timezone.utc)
    samples = [
        ("images/happy-photo.jpg", "positive", "happy", 0.88, "iPhone 16 Pro · Ön Kamera", now - timedelta(days=2, hours=4)),
        ("images/neutral2.jpg", "neutral", "neutral", 0.74, "iPhone 16 Pro · Ön Kamera", now - timedelta(days=1, hours=6)),
        ("images/sad-woman.jpg", "negative", "sad", 0.82, "Masaüstü Web Kamera", now - timedelta(hours=5)),
    ]
    for rel_path, fallback_mood, fallback_emotion, fallback_conf, device_lbl, dt in samples:
        img_path = REPO_ROOT / rel_path
        snap_url = None
        mood = fallback_mood
        emotion = fallback_emotion
        conf = fallback_conf
        scores = {fallback_mood: fallback_conf}
        box = None
        if img_path.is_file() and detector is not None:
            try:
                det = detector.detect_image_bytes(img_path.read_bytes(), live_mode=False, create_thumbnail=True)
                snap_url = det.get("snapshotDataUrl")
                if det.get("detected") and det.get("mood"):
                    mood = det["mood"]
                    emotion = det.get("emotion") or fallback_emotion
                    conf = det["confidence"]
                    scores = det["scores"]
                    box = det["faceBox"]
            except Exception:
                pass
        playlist = db.select_playlist_for_mood(mood=mood, user_id=user_id, count=14, emotion=emotion)
        db.create_scan_session(
            user_id=user_id,
            mood=mood,
            confidence=conf,
            scores=scores,
            face_box=box,
            snapshot_data_url=snap_url,
            capture_source="demo",
            device_label=device_lbl,
            track_ids=[t["id"] for t in playlist],
            created_at=dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            emotion=emotion,
        )


if __name__ == "__main__":
    database = Database()
    music_svc = MusicCatalogService(database)
    det_svc = EmotionDetectorService()
    stats = bootstrap_database(database, music_svc, det_svc)
    print("Database ready:", stats)
