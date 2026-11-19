"""Online music catalog sync & live song discovery from iTunes Search API and Deezer API."""
from __future__ import annotations

import concurrent.futures
import logging
import random
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import requests

from .database import Database

logger = logging.getLogger("moodsync.music")

# Rich multi-genre Turkish & Global seed queries mapped to ('mood', 'language', 'energy_tag', 'genre_override', 'term')
ONLINE_SEED_MATRIX: list[tuple[str, str, str, str | None, str]] = [
    # ─── POSITIVE (Pozitif, Enerjik, Neşeli) ───
    ("positive", "tr", "upbeat", "Türkçe Pop", "Tarkan"),
    ("positive", "tr", "joyful", "Türkçe Pop", "Kenan Doğulu"),
    ("positive", "tr", "joyful", "Türkçe Pop", "Sezen Aksu Gülümse"),
    ("positive", "tr", "upbeat", "Türkçe Pop", "Sertab Erener Rengarenk"),
    ("positive", "tr", "energetic", "Türkçe Pop", "Edis"),
    ("positive", "tr", "joyful", "Türkçe Pop", "Mabel Matiz"),
    ("positive", "tr", "sunny", "Türkçe Pop", "Yalın"),
    ("positive", "tr", "upbeat", "Türkçe Rock", "Athena"),
    ("positive", "tr", "joyful", "Türkçe Pop", "Nil Karaibrahimgil"),
    ("positive", "tr", "groovy", "Alternatif", "Evdeki Saat"),
    ("positive", "tr", "retro", "Anadolu Pop", "Barış Manço"),
    ("positive", "tr", "sunny", "Türkçe Pop", "MFÖ"),
    ("positive", "tr", "dance", "Türkçe Pop", "Gülşen"),
    ("positive", "tr", "upbeat", "Türkçe Pop", "Simge"),
    ("positive", "tr", "dance", "Türkçe Pop", "Zeynep Bastık"),
    ("positive", "global", "joyful", "Pop", "Pharrell Williams Happy"),
    ("positive", "global", "dance", "Dance Pop", "Dua Lipa"),
    ("positive", "global", "funk", "Funk & Pop", "Bruno Mars"),
    ("positive", "global", "groovy", "Electronic", "Daft Punk"),
    ("positive", "global", "euphoric", "Pop Rock", "Coldplay Viva La Vida"),
    ("positive", "global", "upbeat", "Synth Pop", "The Weeknd"),
    ("positive", "global", "disco", "Neo-Soul", "Jungle"),
    ("positive", "global", "groovy", "Disco Funk", "Parcels"),
    ("positive", "global", "classic", "Soul & Funk", "Earth Wind & Fire"),
    ("positive", "global", "sunny", "Pop", "Harry Styles"),
    ("positive", "global", "joyful", "Pop", "Justin Timberlake"),
    ("positive", "global", "sunny", "Classic Pop", "Walking on Sunshine"),
    ("positive", "global", "dance", "House & Dance", "Calvin Harris"),
    ("positive", "global", "feelgood", "Indie Pop", "Empire of the Sun"),

    # ─── NEUTRAL (Dingin, Dengeli, Odak, Chill) ───
    ("neutral", "tr", "chill", "Türkçe Indie", "Kalben"),
    ("neutral", "tr", "dreamy", "Türkçe Alternatif", "Sedef Sebüktekin"),
    ("neutral", "tr", "synth", "Synthwave TR", "Jakuzi"),
    ("neutral", "tr", "calm", "Akustik", "Can Kazaz"),
    ("neutral", "tr", "instrumental", "Modern Klasik", "Fazıl Say"),
    ("neutral", "tr", "ambient", "Sufi Elektronik", "Mercan Dede"),
    ("neutral", "tr", "breeze", "Akustik Folk", "Ezginin Günlüğü"),
    ("neutral", "tr", "indie", "Türkçe Alternatif", "Büyük Ev Ablukada"),
    ("neutral", "tr", "mellow", "Türkçe Alternatif", "Yüzyüzeyken Konuşuruz"),
    ("neutral", "tr", "mellow", "Türkçe Indie", "Gaye Su Akyol"),
    ("neutral", "tr", "chill", "Türkçe Indie", "Palmiyeler"),
    ("neutral", "tr", "calm", "Türkçe Pop", "Melike Şahin"),
    ("neutral", "tr", "acoustic", "Akustik", "Birsen Tezer"),
    ("neutral", "tr", "classic", "Kent Ozanı", "Bülent Ortaçgil"),
    ("neutral", "global", "chill", "Chill Electronic", "Tycho"),
    ("neutral", "global", "sunset", "Chillwave", "Petit Biscuit"),
    ("neutral", "global", "focus", "Piyano", "Ludovico Einaudi"),
    ("neutral", "global", "warm", "Vocal Jazz", "Norah Jones"),
    ("neutral", "global", "groovy-chill", "Psychedelic Soul", "Khruangbin"),
    ("neutral", "global", "downtempo", "Downtempo", "Bonobo"),
    ("neutral", "global", "dreamy", "Dream Pop", "Men I Trust"),
    ("neutral", "global", "focus", "Neo-Classical", "Olafur Arnalds"),
    ("neutral", "global", "smooth", "Nu-Jazz", "FKJ"),
    ("neutral", "global", "jazz", "Cool Jazz", "Chet Baker"),
    ("neutral", "global", "dreamy", "Dream Pop", "Beach House"),
    ("neutral", "global", "chill", "Lo-Fi & Chillhop", "Nujabes"),
    ("neutral", "global", "indie", "Indie Chill", "Mac DeMarco"),
    ("neutral", "global", "ambient", "Ambient Pop", "Air Moon Safari"),

    # ─── NEGATIVE (Duygusal, Hüzünlü, İçsel, Melankolik) ───
    ("negative", "tr", "emotional", "Türkçe Balad", "Sezen Aksu Sen Ağlama"),
    ("negative", "tr", "emotional", "Türkçe Balad", "Sezen Aksu Tükeneceğiz"),
    ("negative", "tr", "melancholic", "Türkçe Rock", "Teoman"),
    ("negative", "tr", "powerful", "Türkçe Rock", "Şebnem Ferah"),
    ("negative", "tr", "melancholic", "Türkçe Rock", "Duman"),
    ("negative", "tr", "deep", "Akustik & Vokal", "Cem Adrian"),
    ("negative", "tr", "classic", "Arabesk Klasik", "Müslüm Gürses"),
    ("negative", "tr", "soundtrack", "Dizi & Film Müziği", "Toygar Işıklı"),
    ("negative", "tr", "acoustic", "Türkçe Indie", "Can Ozan"),
    ("negative", "tr", "emotional", "Alternatif Rock", "Dedublüman"),
    ("negative", "tr", "melancholic", "Türkçe Alternatif", "Emir Can İğrek"),
    ("negative", "tr", "nostalgic", "Anadolu Rock", "Cem Karaca"),
    ("negative", "tr", "emotional", "Türkçe Rock", "Mor ve Ötesi"),
    ("negative", "tr", "emotional", "Türkçe Alternatif", "Dolu Kadehi Ters Tut"),
    ("negative", "tr", "melancholic", "Türkçe Alternatif", "Madrigal"),
    ("negative", "tr", "melancholic", "Türkçe Pop", "Semicenk"),
    ("negative", "global", "ballad", "Soul Ballad", "Adele"),
    ("negative", "global", "intimate", "Alt Pop", "Billie Eilish"),
    ("negative", "global", "melancholic", "Alt Rock", "Radiohead"),
    ("negative", "global", "cinematic", "Cinematic Pop", "Lana Del Rey"),
    ("negative", "global", "healing", "Ambient", "Marconi Union Weightless"),
    ("negative", "global", "piano", "Solo Piyano", "Yiruma"),
    ("negative", "global", "cinematic", "Post-Rock & Orchestral", "Sleeping At Last"),
    ("negative", "global", "indie-folk", "Indie Folk", "Sufjan Stevens"),
    ("negative", "global", "soulful", "Alt Rock", "Jeff Buckley"),
    ("negative", "global", "melancholic", "Alt R&B", "Joji"),
    ("negative", "global", "ballad", "Brit Rock", "Coldplay Fix You"),
    ("negative", "global", "cinematic", "Film Müziği", "Hans Zimmer"),
    ("negative", "global", "acoustic", "Indie Folk", "Bon Iver"),
    ("negative", "global", "dreamy", "Dream Pop", "Cigarettes After Sex"),
]

LIVE_DISCOVERY_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "positive": {
        "tr": ["Tarkan", "Mabel Matiz", "Edis", "Sertab Erener", "Kenan Doğulu", "Hadise", "Murda", "Zeynep Bastık", "Athena", "Yalın", "Evdeki Saat", "Köfn"],
        "global": ["Dua Lipa", "The Weeknd", "Calvin Harris", "Jamiroquai", "Kylie Minogue", "Charlie Puth", "Sabrina Carpenter", "Kaytranada", "Disclosure", "Avicii", "ABBA", "Queen"],
    },
    "neutral": {
        "tr": ["Kalben", "Melike Şahin", "Jakuzi", "Büyük Ev Ablukada", "Fazıl Say", "Birsen Tezer", "Bülent Ortaçgil", "Ceylan Ertem", "Lin Pesto", "Nova Norda"],
        "global": ["Tycho", "Bonobo", "Khruangbin", "Norah Jones", "Ludovico Einaudi", "Max Richter", "Nils Frahm", "Four Tet", "Beach House", "Tame Impala", "Zero 7"],
    },
    "negative": {
        "tr": ["Sezen Aksu", "Teoman", "Şebnem Ferah", "Duman", "Cem Adrian", "Dedublüman", "Canozan", "Emir Can İğrek", "Perdenin Ardındakiler", "Madrigal", "Semicenk", "Mavi Gri"],
        "global": ["Adele", "Billie Eilish", "Lana Del Rey", "Radiohead", "Hozier", "Phoebe Bridgers", "Mitski", "Cigarettes After Sex", "Keane", "Lewis Capaldi", "Sam Smith"],
    },
}

ANGRY_DISCOVERY_KEYWORDS: dict[str, list[str]] = {
    "tr": ["maNga", "Mor ve Ötesi", "Şebnem Ferah", "Duman", "Ceza", "Sagopa Kajmer", "Pentagram", "Hayko Cepkin", "Athena"],
    "global": ["Linkin Park", "Eminem", "Arctic Monkeys", "Imagine Dragons", "Muse", "Nirvana", "Bring Me The Horizon", "Royal Blood"],
}


def _normalize_key(artist: str, title: str) -> str:
    clean_a = re.sub(r"[^a-z0-9çğıöşü]+", "", artist.lower())
    clean_t = re.sub(r"\([^)]*\)|\[[^\]]*\]", "", title.lower())
    clean_t = re.sub(r"[^a-z0-9çğıöşü]+", "", clean_t)
    return f"{clean_a}::{clean_t}"


def _fetch_itunes_query(
    mood: str,
    language: str,
    energy_tag: str,
    genre_override: str | None,
    term: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    country = "TR" if language == "tr" else "US"
    try:
        resp = requests.get(
            "https://itunes.apple.com/search",
            params={"term": term, "entity": "song", "country": country, "limit": limit},
            timeout=8,
        )
        if resp.status_code != 200:
            return []
        results = resp.json().get("results", [])
    except Exception as exc:
        logger.debug("iTunes query failed (%s): %s", term, exc)
        return []

    parsed: list[dict[str, Any]] = []
    for idx, item in enumerate(results):
        track_id = item.get("trackId")
        title = (item.get("trackName") or "").strip()
        artist = (item.get("artistName") or "").strip()
        preview = (item.get("previewUrl") or "").strip()
        if not track_id or not title or not artist or not preview:
            continue
        # Skip karaoke / tribute / ringtone noise
        lowered = f"{title} {artist}".lower()
        if any(bad in lowered for bad in ("karaoke", "ringtone", "tribute", "8-bit")):
            continue
        artwork = (item.get("artworkUrl100") or "").replace("100x100bb.jpg", "600x600bb.jpg")
        rel = item.get("releaseDate") or ""
        year = int(rel[:4]) if len(rel) >= 4 and rel[:4].isdigit() else None
        genre = genre_override or (item.get("primaryGenreName") or "Pop")
        parsed.append(
            {
                "external_source": "itunes",
                "external_id": str(track_id),
                "title": title,
                "artist": artist,
                "album": item.get("collectionName") or "",
                "genre": genre,
                "mood": mood,
                "energy_tag": energy_tag,
                "language": language,
                "artwork_url": artwork,
                "preview_url": preview,
                "store_url": item.get("trackViewUrl") or "",
                "youtube_url": f"https://www.youtube.com/results?search_query={quote_plus(f'{artist} {title}')}",
                "duration_ms": int(item.get("trackTimeMillis") or 0),
                "release_year": year,
                "popularity": max(55, 92 - idx * 4),
            }
        )
    return parsed


def _fetch_deezer_query(
    mood: str,
    language: str,
    energy_tag: str,
    genre_override: str | None,
    term: str,
    limit: int = 6,
) -> list[dict[str, Any]]:
    try:
        resp = requests.get(
            "https://api.deezer.com/search",
            params={"q": term, "limit": limit},
            timeout=8,
        )
        if resp.status_code != 200:
            return []
        data = resp.json().get("data", [])
    except Exception as exc:
        logger.debug("Deezer query failed (%s): %s", term, exc)
        return []

    parsed: list[dict[str, Any]] = []
    for idx, item in enumerate(data):
        dz_id = item.get("id")
        title = (item.get("title") or "").strip()
        artist = (item.get("artist", {}).get("name") or "").strip()
        preview = (item.get("preview") or "").strip()
        if not dz_id or not title or not artist:
            continue
        album_obj = item.get("album") or {}
        artwork = album_obj.get("cover_xl") or album_obj.get("cover_big") or album_obj.get("cover_medium") or ""
        rank = int(item.get("rank") or 500000)
        pop = min(98, max(52, int(rank / 10000)))
        parsed.append(
            {
                "external_source": "deezer",
                "external_id": str(dz_id),
                "title": title,
                "artist": artist,
                "album": album_obj.get("title") or "",
                "genre": genre_override or ("Türkçe Müzik" if language == "tr" else "Pop & Alternatif"),
                "mood": mood,
                "energy_tag": energy_tag,
                "language": language,
                "artwork_url": artwork,
                "preview_url": preview,
                "store_url": item.get("link") or "",
                "youtube_url": f"https://www.youtube.com/results?search_query={quote_plus(f'{artist} {title}')}",
                "duration_ms": int(item.get("duration") or 0) * 1000,
                "release_year": None,
                "popularity": max(pop, 85 - idx * 4),
            }
        )
    return parsed


class MusicCatalogService:
    """Manages initial online seeding + live internet track expansion + fresh audio preview resolution."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def ensure_rich_catalog(self, min_tracks: int = 400) -> dict[str, Any]:
        stats = self.db.count_tracks()
        if stats["total"] >= min_tracks:
            return stats

        logger.info("Seeding MoodSync database from online music APIs (current=%d)...", stats["total"])
        seen_keys: set[str] = set()
        collected: list[dict[str, Any]] = []

        def fetch_entry(entry: tuple[str, str, str, str | None, str]) -> list[dict[str, Any]]:
            mood, lang, energy, genre, term = entry
            items = _fetch_itunes_query(mood, lang, energy, genre, term, limit=8)
            if len(items) < 4:
                dz_items = _fetch_deezer_query(mood, lang, energy, genre, term, limit=8)
                items.extend(dz_items)
            return items

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(fetch_entry, row) for row in ONLINE_SEED_MATRIX]
            for fut in concurrent.futures.as_completed(futures):
                for track in fut.result():
                    nk = _normalize_key(track["artist"], track["title"])
                    if nk in seen_keys:
                        continue
                    seen_keys.add(nk)
                    collected.append(track)

        self.db.upsert_tracks(collected)
        return self.db.count_tracks()

    def expand_online(
        self,
        mood: str,
        language: str = "all",
        custom_query: str | None = None,
        limit: int = 18,
        emotion: str | None = None,
    ) -> list[dict[str, Any]]:
        """Actively pulls fresh songs from both iTunes and Deezer internet databases and saves them to SQLite."""
        if mood not in ("positive", "neutral", "negative"):
            mood = "neutral"

        energy_tag = "angry_rock" if emotion == "angry" else "live"
        genre_override = "Rock & Rap" if emotion == "angry" else None

        queries: list[tuple[str, str]] = []
        if custom_query and custom_query.strip():
            target_lang = language if language in ("tr", "global") else "tr"
            queries.append((target_lang, custom_query.strip()))
            if language == "all":
                queries.append(("global", custom_query.strip()))
        else:
            langs = ["tr", "global"] if language in ("all", "") else [language]
            for lg in langs:
                pool = ANGRY_DISCOVERY_KEYWORDS[lg] if emotion == "angry" else LIVE_DISCOVERY_KEYWORDS[mood][lg]
                picks = random.sample(pool, k=min(3, len(pool)))
                for p in picks:
                    queries.append((lg, p))

        fetched: list[dict[str, Any]] = []
        seen: set[str] = set()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futs = []
            for lg, q in queries:
                futs.append(executor.submit(_fetch_itunes_query, mood, lg, energy_tag, genre_override, q, 6))
                futs.append(executor.submit(_fetch_deezer_query, mood, lg, energy_tag, genre_override, q, 4))
            for f in concurrent.futures.as_completed(futs):
                for item in f.result():
                    nk = _normalize_key(item["artist"], item["title"])
                    if nk in seen:
                        continue
                    seen.add(nk)
                    fetched.append(item)

        if fetched:
            self.db.upsert_tracks(fetched[: limit * 2])

        if custom_query and custom_query.strip():
            return self.db.query_tracks(mood=mood, search=custom_query.strip(), limit=limit)
        return self.db.select_playlist_for_mood(mood=mood, count=limit, language_filter=language, emotion=emotion)

    def resolve_fresh_preview(self, track_id: int) -> str:
        """Refreshes expiring Deezer preview URLs or missing previews via live API lookup."""
        track = self.db.get_track_by_id(track_id)
        if not track:
            return ""
        if track["source"] == "deezer" and track["externalId"].isdigit():
            try:
                resp = requests.get(f"https://api.deezer.com/track/{track['externalId']}", timeout=6)
                if resp.status_code == 200:
                    fresh = (resp.json().get("preview") or "").strip()
                    if fresh:
                        return fresh
            except Exception:
                pass
        return track.get("previewUrl") or ""

    def export_sql_server_seed(self, output_path: Path) -> int:
        """Exports the synced SQLite catalog into a ready-to-run SQL Server seed script."""
        all_tracks = self.db.query_tracks(limit=200) + self.db.query_tracks(limit=200, offset=200)
        seen_ids: set[int] = set()
        unique_tracks = []
        for tr in all_tracks:
            if tr["id"] not in seen_ids:
                seen_ids.add(tr["id"])
                unique_tracks.append(tr)

        def esc(val: str) -> str:
            return (val or "").replace("'", "''")

        lines = [
            "-- Auto-generated MoodSync Rich Music Catalog Seed for SQL Server",
            "-- Sourced from Apple iTunes & Deezer Music Databases",
            "SET NOCOUNT ON;",
            "BEGIN TRANSACTION;",
        ]
        for tr in unique_tracks:
            yr = str(tr["releaseYear"]) if tr["releaseYear"] else "NULL"
            lines.append(
                f"IF NOT EXISTS (SELECT 1 FROM dbo.MoodSyncTracks WHERE ExternalSource='{esc(tr['source'])}' AND ExternalId='{esc(tr['externalId'])}')\n"
                f"INSERT INTO dbo.MoodSyncTracks (ExternalSource, ExternalId, Title, Artist, Album, Genre, Mood, EnergyTag, Language, ArtworkUrl, PreviewUrl, StoreUrl, YoutubeUrl, DurationMs, ReleaseYear, Popularity)\n"
                f"VALUES ('{esc(tr['source'])}', '{esc(tr['externalId'])}', N'{esc(tr['title'])}', N'{esc(tr['artist'])}', N'{esc(tr['album'])}', N'{esc(tr['genre'])}', '{esc(tr['mood'])}', '{esc(tr['energyTag'])}', '{esc(tr['language'])}', N'{esc(tr['artworkUrl'])}', N'{esc(tr['previewUrl'])}', N'{esc(tr['storeUrl'])}', N'{esc(tr['youtubeUrl'])}', {int(tr['durationMs'])}, {yr}, {int(tr['popularity'])});"
            )
        lines.append("COMMIT;")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return len(unique_tracks)
