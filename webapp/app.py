"""FastAPI backend for MoodSync (Auth, Real-time YOLOv8 Camera Mood Detection, Online Music Sync & Scan History)."""
from __future__ import annotations

import asyncio
import base64
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Cookie, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .database import EMOTION_FULL_LABELS_TR, MOOD_LABELS_TR, Database
from .detector_service import EmotionDetectorService
from .music_service import MusicCatalogService
from .seed_init import bootstrap_database

STATIC_DIR = Path(__file__).resolve().parent / "static"

db = Database()
music_service = MusicCatalogService(db)
detector_service = EmotionDetectorService()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(bootstrap_database, db, music_service, detector_service)
    await asyncio.to_thread(detector_service.warmup)
    yield


app = FastAPI(
    title="MoodSync API",
    description="Canlı kamera yüz ifadesi analizi ve çevrimiçi müzik öneri platformu",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ───────────────────────── Request Models ─────────────────────────

class LoginPayload(BaseModel):
    username: str
    password: str


class RegisterPayload(BaseModel):
    username: str
    password: str
    displayName: str = ""
    email: str | None = None


class FramePayload(BaseModel):
    imageDataUrl: str


class CapturePayload(BaseModel):
    imageDataUrl: str
    fallbackMood: str | None = None
    fallbackEmotion: str | None = None
    fallbackConfidence: float | None = None
    deviceLabel: str = "Kamera"
    language: str = "all"
    captureSource: str = "camera"
    fetchFreshOnline: bool = False


class ExpandMusicPayload(BaseModel):
    mood: str = "positive"
    emotion: str | None = None
    language: str = "all"
    query: str | None = None
    limit: int = 18


# ───────────────────────── Helpers & Auth Dependency ─────────────────────────

def _decode_data_url(data_url: str) -> bytes:
    if "," in data_url:
        _, encoded = data_url.split(",", 1)
    else:
        encoded = data_url
    try:
        return base64.b64decode(encoded)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Geçersiz görsel verisi gönderildi.") from exc


def _extract_token(authorization: str | None, cookie_token: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return cookie_token


def get_optional_user(
    authorization: str | None = Header(default=None),
    moodsync_session: str | None = Cookie(default=None),
) -> dict[str, Any] | None:
    token = _extract_token(authorization, moodsync_session)
    return db.get_user_by_token(token)


def get_current_user(user: dict[str, Any] | None = Depends(get_optional_user)) -> dict[str, Any]:
    if user is None:
        raise HTTPException(status_code=401, detail="Oturum açmanız gerekiyor.")
    return user


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="moodsync_session",
        value=token,
        max_age=30 * 24 * 3600,
        httponly=True,
        samesite="lax",
    )


# ───────────────────────── Auth Endpoints ─────────────────────────

@app.post("/api/auth/register")
async def register(payload: RegisterPayload, request: Request, response: Response):
    try:
        user = await asyncio.to_thread(
            db.register_user,
            payload.username,
            payload.password,
            payload.displayName,
            payload.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ua = request.headers.get("user-agent", "")
    token = await asyncio.to_thread(db.create_auth_session, user["id"], ua)
    _set_auth_cookie(response, token)
    stats = await asyncio.to_thread(db.get_user_dashboard_stats, user["id"])
    return {"token": token, "user": user, "stats": stats, "recentScans": []}


@app.post("/api/auth/login")
async def login(payload: LoginPayload, request: Request, response: Response):
    user = await asyncio.to_thread(db.authenticate_user, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı.")

    ua = request.headers.get("user-agent", "")
    token = await asyncio.to_thread(db.create_auth_session, user["id"], ua)
    _set_auth_cookie(response, token)
    stats = await asyncio.to_thread(db.get_user_dashboard_stats, user["id"])
    scans = await asyncio.to_thread(db.list_scan_sessions, user["id"], 25)
    return {"token": token, "user": user, "stats": stats, "recentScans": scans}


@app.post("/api/auth/logout")
async def logout(
    response: Response,
    authorization: str | None = Header(default=None),
    moodsync_session: str | None = Cookie(default=None),
):
    token = _extract_token(authorization, moodsync_session)
    await asyncio.to_thread(db.delete_auth_session, token)
    response.delete_cookie("moodsync_session")
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: dict[str, Any] = Depends(get_current_user)):
    stats = await asyncio.to_thread(db.get_user_dashboard_stats, user["id"])
    scans = await asyncio.to_thread(db.list_scan_sessions, user["id"], 25)
    return {"user": user, "stats": stats, "recentScans": scans}


# ───────────────────────── Live Camera & Capture Endpoints ─────────────────────────

@app.post("/api/detect/live")
async def detect_live_json(
    payload: FramePayload,
    _: dict[str, Any] = Depends(get_current_user),
):
    raw_bytes = _decode_data_url(payload.imageDataUrl)
    try:
        return await asyncio.to_thread(
            detector_service.detect_image_bytes,
            raw_bytes,
            True,
            False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/detect/live-upload")
async def detect_live_upload(
    frame: UploadFile = File(...),
    _: dict[str, Any] = Depends(get_current_user),
):
    raw_bytes = await frame.read()
    try:
        return await asyncio.to_thread(
            detector_service.detect_image_bytes,
            raw_bytes,
            True,
            False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class MobileDetectPayload(BaseModel):
    imageBase64: str
    live: bool = True


@app.post("/api/detect/mobile")
async def detect_mobile_frame(payload: MobileDetectPayload):
    raw_bytes = _decode_data_url(payload.imageBase64)
    try:
        return await asyncio.to_thread(
            detector_service.detect_image_bytes,
            raw_bytes,
            payload.live,
            False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/scans/capture")
async def capture_scan(
    payload: CapturePayload,
    user: dict[str, Any] = Depends(get_current_user),
):
    raw_bytes = _decode_data_url(payload.imageDataUrl)
    try:
        det = await asyncio.to_thread(
            detector_service.detect_image_bytes,
            raw_bytes,
            False,
            True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    mood = det.get("mood")
    emotion = det.get("emotion")
    confidence = float(det.get("confidence") or 0.0)
    scores = det.get("scores") or {}
    face_box = det.get("faceBox")

    # If shutter frame had brief motion blur, use the live viewfinder's locked mood seamlessly
    if not mood and payload.fallbackMood in ("positive", "neutral", "negative"):
        mood = payload.fallbackMood
        emotion = payload.fallbackEmotion if payload.fallbackEmotion in ("happy", "surprise", "neutral", "sad", "angry") else None
        confidence = float(payload.fallbackConfidence or 0.78)
        scores = {mood: confidence}

    if mood not in ("positive", "neutral", "negative"):
        raise HTTPException(
            status_code=422,
            detail="Kamerada yüz ifadesi net yakalanamadı. Lütfen yüzünüzü aydınlık şekilde kadraja alıp tekrar çekin.",
        )

    if not emotion:
        if payload.fallbackEmotion in ("happy", "surprise", "neutral", "sad", "angry"):
            emotion = payload.fallbackEmotion
        else:
            emotion = "happy" if mood == "positive" else ("sad" if mood == "negative" else "neutral")

    clean_lang = payload.language if payload.language in ("all", "tr", "global") else "all"

    if payload.fetchFreshOnline:
        await asyncio.to_thread(music_service.expand_online, mood, clean_lang, None, 12, emotion)

    playlist = await asyncio.to_thread(
        db.select_playlist_for_mood,
        mood,
        user["id"],
        16,
        clean_lang,
        emotion,
    )

    # Trigger background expansion so future scans keep getting even more songs from the internet
    asyncio.create_task(asyncio.to_thread(music_service.expand_online, mood, "all", None, 8, emotion))

    session = await asyncio.to_thread(
        db.create_scan_session,
        user["id"],
        mood,
        confidence,
        scores,
        face_box,
        det.get("snapshotDataUrl"),
        payload.captureSource if payload.captureSource in ("camera", "upload") else "camera",
        payload.deviceLabel,
        [t["id"] for t in playlist],
        None,
        emotion,
    )
    stats = await asyncio.to_thread(db.get_user_dashboard_stats, user["id"])
    mood_label = EMOTION_FULL_LABELS_TR.get(emotion) if emotion else MOOD_LABELS_TR[mood]
    return {
        "session": session,
        "moodLabel": mood_label,
        "stats": stats,
    }


@app.post("/api/scans/upload-file")
async def capture_uploaded_file(
    photo: UploadFile = File(...),
    language: str = Form(default="all"),
    deviceLabel: str = Form(default="Galeri / Dosya"),
    user: dict[str, Any] = Depends(get_current_user),
):
    raw_bytes = await photo.read()
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    payload = CapturePayload(
        imageDataUrl=f"data:image/jpeg;base64,{b64}",
        deviceLabel=deviceLabel,
        language=language,
        captureSource="upload",
    )
    return await capture_scan(payload, user)


# ───────────────────────── Past Scan Sessions Endpoints ─────────────────────────

@app.get("/api/scans")
async def list_scans(
    limit: int = Query(default=40, ge=1, le=100),
    user: dict[str, Any] = Depends(get_current_user),
):
    scans = await asyncio.to_thread(db.list_scan_sessions, user["id"], limit)
    stats = await asyncio.to_thread(db.get_user_dashboard_stats, user["id"])
    return {"scans": scans, "stats": stats}


@app.get("/api/scans/{session_id}")
async def get_scan_detail(session_id: int, user: dict[str, Any] = Depends(get_current_user)):
    session = await asyncio.to_thread(db.get_scan_session, session_id, user["id"])
    if session is None:
        raise HTTPException(status_code=404, detail="Tarama kaydı bulunamadı.")
    return {"session": session}


@app.delete("/api/scans/{session_id}")
async def delete_scan(session_id: int, user: dict[str, Any] = Depends(get_current_user)):
    removed = await asyncio.to_thread(db.delete_scan_session, session_id, user["id"])
    if not removed:
        raise HTTPException(status_code=404, detail="Tarama kaydı bulunamadı.")
    stats = await asyncio.to_thread(db.get_user_dashboard_stats, user["id"])
    return {"ok": True, "stats": stats}


# ───────────────────────── Music Catalog & Live Online Expansion ─────────────────────────

@app.get("/api/tracks")
async def list_tracks(
    mood: str | None = Query(default=None),
    language: str | None = Query(default=None),
    genre: str | None = Query(default=None),
    q: str | None = Query(default=None),
    favoritesOnly: bool = Query(default=False),
    limit: int = Query(default=60, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict[str, Any] = Depends(get_current_user),
):
    tracks = await asyncio.to_thread(
        db.query_tracks,
        user["id"],
        mood,
        language,
        genre,
        q,
        favoritesOnly,
        limit,
        offset,
    )
    catalog = await asyncio.to_thread(db.count_tracks)
    genres = await asyncio.to_thread(db.list_distinct_genres)
    return {"tracks": tracks, "catalog": catalog, "genres": genres}


@app.post("/api/music/expand")
async def expand_music_online(
    payload: ExpandMusicPayload,
    user: dict[str, Any] = Depends(get_current_user),
):
    clean_emotion = payload.emotion if payload.emotion in ("happy", "surprise", "neutral", "sad", "angry") else None
    await asyncio.to_thread(
        music_service.expand_online,
        payload.mood,
        payload.language,
        payload.query,
        payload.limit,
        clean_emotion,
    )
    if payload.query and payload.query.strip():
        tracks = await asyncio.to_thread(
            db.query_tracks,
            user["id"],
            payload.mood if payload.mood in ("positive", "neutral", "negative") else None,
            payload.language if payload.language in ("tr", "global") else None,
            None,
            payload.query.strip(),
            False,
            payload.limit,
            0,
        )
    else:
        tracks = await asyncio.to_thread(
            db.select_playlist_for_mood,
            payload.mood if payload.mood in ("positive", "neutral", "negative") else "positive",
            user["id"],
            payload.limit,
            payload.language if payload.language in ("tr", "global") else "all",
            clean_emotion,
        )
    catalog = await asyncio.to_thread(db.count_tracks)
    return {"tracks": tracks, "catalog": catalog}


@app.get("/api/tracks/{track_id}/audio")
async def stream_track_preview(
    track_id: int,
    user: dict[str, Any] | None = Depends(get_optional_user),
):
    preview_url = await asyncio.to_thread(music_service.resolve_fresh_preview, track_id)
    if not preview_url:
        raise HTTPException(status_code=404, detail="Bu şarkı için ses önizlemesi bulunamadı.")
    uid = user["id"] if user else None
    asyncio.create_task(asyncio.to_thread(db.increment_play, track_id, uid))
    return RedirectResponse(url=preview_url, status_code=307)


@app.post("/api/tracks/{track_id}/favorite")
async def toggle_favorite(track_id: int, user: dict[str, Any] = Depends(get_current_user)):
    try:
        is_fav = await asyncio.to_thread(db.toggle_favorite, user["id"], track_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"trackId": track_id, "isFavorite": is_fav}


@app.api_route("/api/health", methods=["GET", "HEAD"])
async def health():
    catalog = await asyncio.to_thread(db.count_tracks)
    return {"status": "ok", "catalog": catalog, "model": str(detector_service.model_path.name)}


# ───────────────────────── Static PWA & Assets ─────────────────────────

app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")


@app.api_route("/manifest.json", methods=["GET", "HEAD"])
async def pwa_manifest():
    return FileResponse(STATIC_DIR / "manifest.json", media_type="application/manifest+json")


@app.api_route("/styles.css", methods=["GET", "HEAD"])
async def stylesheet():
    return FileResponse(STATIC_DIR / "styles.css", media_type="text/css")


@app.api_route("/app.js", methods=["GET", "HEAD"])
async def frontend_script():
    return FileResponse(STATIC_DIR / "app.js", media_type="application/javascript")


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
async def spa_index(full_path: str):
    candidate = (STATIC_DIR / full_path).resolve()
    if full_path and candidate.is_file() and str(candidate).startswith(str(STATIC_DIR.resolve())):
        return FileResponse(candidate)
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")
