"""End-to-end integration tests for MoodSync Database, Auth, Live Camera Detection, Capture Playlist & Online Music APIs."""
from __future__ import annotations

import base64
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from webapp.app import app

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


class MoodSyncApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client_ctx = TestClient(app)
        cls.client = cls.client_ctx.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_ctx.__exit__(None, None, None)

    def test_01_health_and_rich_catalog(self) -> None:
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "ok")
        self.assertGreaterEqual(body["catalog"]["total"], 300)

    def test_02_classic_login_and_me(self) -> None:
        bad = self.client.post("/api/auth/login", json={"username": "demo", "password": "wrong"})
        self.assertEqual(bad.status_code, 401)

        ok = self.client.post("/api/auth/login", json={"username": "demo", "password": "moodsync123"})
        self.assertEqual(ok.status_code, 200)
        data = ok.json()
        self.assertIn("token", data)
        self.assertEqual(data["user"]["username"], "demo")
        self.assertGreaterEqual(len(data["recentScans"]), 3)

        headers = {"Authorization": f"Bearer {data['token']}"}
        me = self.client.get("/api/auth/me", headers=headers)
        self.assertEqual(me.status_code, 200)

    def test_03_live_camera_frame_and_shutter_capture(self) -> None:
        login = self.client.post("/api/auth/login", json={"username": "demo", "password": "moodsync123"}).json()
        headers = {"Authorization": f"Bearer {login['token']}"}

        happy_bytes = (REPO_ROOT / "images" / "happy-photo.jpg").read_bytes()
        data_url = "data:image/jpeg;base64," + base64.b64encode(happy_bytes).decode("ascii")

        live_res = self.client.post("/api/detect/live", json={"imageDataUrl": data_url}, headers=headers)
        self.assertEqual(live_res.status_code, 200)
        live_json = live_res.json()
        self.assertTrue(live_json["detected"])
        self.assertEqual(live_json["mood"], "positive")
        self.assertIsNotNone(live_json["faceBox"])

        cap_res = self.client.post(
            "/api/scans/capture",
            json={
                "imageDataUrl": data_url,
                "deviceLabel": "iPhone 16 Pro · Ön Kamera",
                "language": "all",
                "captureSource": "camera",
            },
            headers=headers,
        )
        self.assertEqual(cap_res.status_code, 200)
        cap_json = cap_res.json()
        session = cap_json["session"]
        self.assertEqual(session["mood"], "positive")
        self.assertGreaterEqual(len(session["tracks"]), 12)
        self.assertTrue(session["snapshotDataUrl"].startswith("data:image/jpeg;base64,"))

        # Verify session is persisted in history and deletable
        detail_res = self.client.get(f"/api/scans/{session['id']}", headers=headers)
        self.assertEqual(detail_res.status_code, 200)
        self.assertEqual(len(detail_res.json()["session"]["tracks"]), len(session["tracks"]))

        del_res = self.client.delete(f"/api/scans/{session['id']}", headers=headers)
        self.assertEqual(del_res.status_code, 200)

    def test_04_tracks_favorite_and_audio_redirect(self) -> None:
        login = self.client.post("/api/auth/login", json={"username": "demo", "password": "moodsync123"}).json()
        headers = {"Authorization": f"Bearer {login['token']}"}

        tracks_res = self.client.get("/api/tracks?mood=negative&limit=10", headers=headers)
        self.assertEqual(tracks_res.status_code, 200)
        tracks = tracks_res.json()["tracks"]
        self.assertGreaterEqual(len(tracks), 5)

        tid = tracks[0]["id"]
        fav1 = self.client.post(f"/api/tracks/{tid}/favorite", headers=headers)
        self.assertEqual(fav1.status_code, 200)

        audio_res = self.client.get(f"/api/tracks/{tid}/audio", headers=headers, follow_redirects=False)
        self.assertIn(audio_res.status_code, (302, 307))
        self.assertTrue(audio_res.headers["location"].startswith("http"))

        # Restore favorite toggle back if needed
        if fav1.json().get("isFavorite"):
            self.client.post(f"/api/tracks/{tid}/favorite", headers=headers)

    def test_05_sad_and_angry_capture_and_playlist(self) -> None:
        login = self.client.post("/api/auth/login", json={"username": "demo", "password": "moodsync123"}).json()
        headers = {"Authorization": f"Bearer {login['token']}"}

        sad_bytes = (REPO_ROOT / "images" / "sad-woman2.jpg").read_bytes()
        sad_url = "data:image/jpeg;base64," + base64.b64encode(sad_bytes).decode("ascii")
        sad_cap = self.client.post(
            "/api/scans/capture",
            json={
                "imageDataUrl": sad_url,
                "deviceLabel": "iPhone 16 Pro · Ön Kamera",
                "language": "all",
                "captureSource": "camera",
            },
            headers=headers,
        )
        self.assertEqual(sad_cap.status_code, 200)
        sad_sess = sad_cap.json()["session"]
        self.assertEqual(sad_sess["mood"], "negative")
        self.assertEqual(sad_sess["emotion"], "sad")
        self.assertGreaterEqual(len(sad_sess["tracks"]), 10)
        self.client.delete(f"/api/scans/{sad_sess['id']}", headers=headers)

        # Also verify angry playlist selection via database directly
        from webapp.app import db

        angry_tracks = db.select_playlist_for_mood("negative", login["user"]["id"], 12, "all", "angry")
        self.assertGreaterEqual(len(angry_tracks), 8)


if __name__ == "__main__":
    unittest.main()
