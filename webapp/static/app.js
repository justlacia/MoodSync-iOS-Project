/* ═══════════════════════════════════════════════════════════════════════════
   MoodSync Frontend Application (Vanilla JS — iPhone 16 Pro & Desktop Ready)
   ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const MOOD_SHORT_TR = {
    positive: "Pozitif",
    neutral: "Dingin",
    negative: "Duygusal",
  };

  const MOOD_FULL_TR = {
    positive: "Pozitif & Enerjik",
    neutral: "Dingin & Dengeli",
    negative: "Duygusal & Melankolik",
  };

  const state = {
    token: localStorage.getItem("moodsync_token") || null,
    user: null,
    stats: null,
    recentScans: [],
    activeView: "studio",
    activeSession: null,
    sessionLangFilter: "all",

    // Live camera state
    stream: null,
    facingMode: "user",
    liveTimer: null,
    liveBusy: false,
    liveHistory: [],
    lastLockedMood: null,
    lastLockedConf: 0,
    lastLockedAt: 0,

    // Library filters
    libMood: "",
    libLang: "",
    libFavOnly: false,
    libQuery: "",
    libraryTracks: [],

    // Audio queue
    queue: [],
    queueIndex: -1,
    playingTrackId: null,
  };

  const offscreenCanvas = document.createElement("canvas");
  const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: false });

  const $ = (id) => document.getElementById(id);

  // ───────────────────────── API Helper ─────────────────────────

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.token) {
      headers["Authorization"] = `Bearer ${state.token}`;
    }
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const resp = await fetch(path, { ...options, headers });
    let data = null;
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await resp.json();
    }
    if (!resp.ok) {
      const msg = (data && (data.detail || data.error)) || `İstek başarısız oldu (${resp.status})`;
      const err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  function showToast(message) {
    const container = $("toast-container");
    if (!container) return;
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    container.appendChild(item);
    setTimeout(() => {
      item.style.opacity = "0";
      item.style.transition = "opacity 0.25s ease";
      setTimeout(() => item.remove(), 260);
    }, 2800);
  }

  function formatDateTR(isoStr) {
    if (!isoStr) return "Az önce";
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoStr;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function detectDeviceName() {
    const ua = navigator.userAgent || "";
    if (/iPhone/i.test(ua)) {
      return state.facingMode === "user" ? "iPhone · Ön Kamera" : "iPhone · Arka Kamera";
    }
    if (/iPad/i.test(ua)) return "iPad Kamera";
    if (/Android/i.test(ua)) return "Android Kamera";
    return "Web Kamera";
  }

  // ───────────────────────── Theme Management ─────────────────────────

  function applyTheme(theme) {
    const clean = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", clean);
    localStorage.setItem("moodsync_theme", clean);
    const metaTheme = $("meta-theme-color");
    if (metaTheme) {
      metaTheme.setAttribute("content", clean === "dark" ? "#14161A" : "#FAF8F4");
    }
  }

  // ───────────────────────── 1. Splash & Auth Lifecycle ─────────────────────────

  async function bootstrapApp() {
    applyTheme(localStorage.getItem("moodsync_theme") || "light");
    bindEvents();

    const minSplashDelay = new Promise((resolve) => setTimeout(resolve, 1950));
    let sessionData = null;

    if (state.token) {
      try {
        sessionData = await api("/api/auth/me");
      } catch {
        state.token = null;
        localStorage.removeItem("moodsync_token");
      }
    }

    await minSplashDelay;

    const splash = $("splash-screen");
    splash.classList.add("fade-out");
    setTimeout(() => splash.classList.add("hidden"), 560);

    if (sessionData && sessionData.user) {
      enterAuthenticatedApp(sessionData);
    } else {
      showAuthScreen();
    }
  }

  function showAuthScreen() {
    stopCamera();
    $("app-screen").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("login-username").focus();
  }

  function enterAuthenticatedApp(payload) {
    state.user = payload.user;
    state.stats = payload.stats;
    state.recentScans = payload.recentScans || [];

    $("auth-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");

    renderHeaderAndStats();
    renderRecentScans();

    // Load most recent session if available so user sees rich history immediately
    if (state.recentScans.length > 0 && !state.activeSession) {
      openPastSession(state.recentScans[0].id, false);
    }

    switchView("studio");
  }

  function renderHeaderAndStats() {
    if (!state.user) return;
    const displayName = state.user.displayName || state.user.username;
    $("user-display-name").textContent = displayName;
    $("user-avatar-dot").textContent = displayName.charAt(0).toUpperCase();
    $("studio-greeting-heading").textContent = `Merhaba ${displayName.split(" ")[0]}, bugün hangi ritimdesin?`;

    if (state.stats) {
      const totalTracks = state.stats.catalog ? state.stats.catalog.total : 0;
      $("header-catalog-count").textContent = `${totalTracks} Çevrimiçi Şarkı`;
      $("stat-total-scans").textContent = String(state.stats.totalScans || 0);
      $("stat-dominant-mood").textContent = state.stats.dominantMoodLabel || "—";
      $("stat-fav-count").textContent = String(state.stats.favoriteTracksCount || 0);
      $("stat-db-tracks").textContent = `${totalTracks} Şarkı`;
    }
  }

  // ───────────────────────── 2. Navigation ─────────────────────────

  function switchView(viewName) {
    state.activeView = viewName;
    ["studio", "history", "library"].forEach((v) => {
      const el = $(`view-${v}`);
      if (el) el.classList.toggle("hidden", v !== viewName);
    });
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
    });

    if (viewName === "history") {
      refreshHistoryList();
    } else if (viewName === "library") {
      if (state.libraryTracks.length === 0) {
        loadLibraryTracks();
      }
    }
  }

  // ───────────────────────── 3. Live Camera & Real-Time Mood HUD ─────────────────────────

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $("camera-helper-msg").textContent =
        "iOS Safari canlı kamera için güvenli bağlantı (HTTPS) gerektirir. Bilgisayarınızda açılan https://<IP>:8443 adresini kullanabilir veya aşağıdaki 'Fotoğraf Seç / Çek' düğmesiyle kameranızı doğrudan açabilirsiniz.";
      showToast("Tarayıcı kamera erişimi için HTTPS bağlantısı gerekiyor.");
      return;
    }

    stopCamera();

    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: state.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.stream = stream;

      const video = $("camera-video");
      video.srcObject = stream;
      video.classList.toggle("mirrored", state.facingMode === "user");
      await video.play();

      $("captured-preview-img").classList.add("hidden");
      $("camera-placeholder").classList.add("hidden");
      video.classList.remove("hidden");
      $("camera-controls-bar").classList.remove("hidden");
      $("camera-status-pill").classList.remove("hidden");
      $("stop-camera-btn").classList.remove("hidden");
      $("camera-lens-label").textContent = state.facingMode === "user" ? "ÖN KAMERA" : "ARKA KAMERA";

      updateLiveHud("idle", "Yüz Aranıyor…");

      state.liveHistory = [];
      state.liveTimer = setInterval(runLiveMoodTick, 650);
    } catch (err) {
      console.error("Camera error:", err);
      $("camera-helper-msg").textContent =
        "Kamera izni verilemedi veya cihaz meşgul. Lütfen kamera iznini onaylayın ya da 'Fotoğraf Seç / Çek' ile devam edin.";
      showToast("Kamera açılamadı. İzinleri kontrol edin.");
    }
  }

  function stopCamera() {
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    const video = $("camera-video");
    if (video) {
      video.srcObject = null;
      video.classList.add("hidden");
    }
    $("camera-controls-bar").classList.add("hidden");
    $("camera-status-pill").classList.add("hidden");
    $("stop-camera-btn").classList.add("hidden");
    $("face-reticle").classList.add("hidden");
    $("camera-placeholder").classList.remove("hidden");
    updateLiveHud("idle", "Kamera Kapalı");
  }

  async function flipCamera() {
    state.facingMode = state.facingMode === "user" ? "environment" : "user";
    await startCamera();
  }

  function grabVideoDataUrl(maxSide = 384, quality = 0.72) {
    const video = $("camera-video");
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const cw = Math.max(64, Math.round(vw * scale));
    const ch = Math.max(64, Math.round(vh * scale));
    offscreenCanvas.width = cw;
    offscreenCanvas.height = ch;
    offscreenCtx.drawImage(video, 0, 0, cw, ch);
    return offscreenCanvas.toDataURL("image/jpeg", quality);
  }

  function updateLiveHud(moodKey, labelText) {
    const hud = $("live-mood-hud");
    const txt = $("live-mood-text");
    if (!hud || !txt) return;
    hud.setAttribute("data-mood", moodKey || "idle");
    txt.textContent = labelText;
  }

  function updateFaceReticle(normBox) {
    const reticle = $("face-reticle");
    if (!reticle) return;
    if (!normBox || normBox.length !== 4 || !state.stream) {
      reticle.classList.add("hidden");
      return;
    }
    let [x1, y1, x2, y2] = normBox;
    if (state.facingMode === "user") {
      // Video is visually mirrored horizontally via CSS scaleX(-1)
      const mirroredX1 = 1 - x2;
      const mirroredX2 = 1 - x1;
      x1 = mirroredX1;
      x2 = mirroredX2;
    }
    const wPct = Math.max(12, (x2 - x1) * 100);
    const hPct = Math.max(12, (y2 - y1) * 100);
    reticle.style.left = `${x1 * 100}%`;
    reticle.style.top = `${y1 * 100}%`;
    reticle.style.width = `${wPct}%`;
    reticle.style.height = `${hPct}%`;
    reticle.classList.remove("hidden");
  }

  async function runLiveMoodTick() {
    if (state.liveBusy || !state.stream || state.activeView !== "studio") return;
    const frameUrl = grabVideoDataUrl(384, 0.72);
    if (!frameUrl) return;

    state.liveBusy = true;
    try {
      const res = await api("/api/detect/live", {
        method: "POST",
        body: JSON.stringify({ imageDataUrl: frameUrl }),
      });

      if (!state.stream) return;

      if (res && res.detected && res.mood) {
        state.liveHistory.push({ mood: res.mood, conf: res.confidence });
        if (state.liveHistory.length > 3) state.liveHistory.shift();

        // Smooth mood via recent majority vote + averaged confidence
        const counts = {};
        let confSum = 0;
        for (const item of state.liveHistory) {
          counts[item.mood] = (counts[item.mood] || 0) + 1;
          confSum += item.conf;
        }
        const stableMood = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const avgConf = confSum / state.liveHistory.length;
        const pct = Math.round(avgConf * 100);

        state.lastLockedMood = stableMood;
        state.lastLockedConf = avgConf;
        state.lastLockedAt = Date.now();

        updateLiveHud(stableMood, `${MOOD_SHORT_TR[stableMood] || stableMood} · %${pct}`);
        updateFaceReticle(res.faceBox);
      } else {
        updateLiveHud("idle", "Yüz Aranıyor…");
        updateFaceReticle(null);
      }
    } catch {
      // Ignore transient network hiccups during live polling
    } finally {
      state.liveBusy = false;
    }
  }

  // ───────────────────────── 4. Shutter Capture & Playlist Generation ─────────────────────────

  async function captureFromCamera() {
    const shutterBtn = $("capture-shutter-btn");
    if (!state.stream || shutterBtn.classList.contains("busy")) return;

    const highResDataUrl = grabVideoDataUrl(860, 0.88);
    if (!highResDataUrl) return;

    // Trigger crisp shutter flash
    const flash = $("shutter-flash");
    flash.classList.remove("active");
    void flash.offsetWidth;
    flash.classList.add("active");

    shutterBtn.classList.add("busy");
    shutterBtn.disabled = true;
    updateLiveHud(state.lastLockedMood || "idle", "Analiz Ediliyor…");

    const recentLockValid = Date.now() - state.lastLockedAt < 3500;
    try {
      const response = await api("/api/scans/capture", {
        method: "POST",
        body: JSON.stringify({
          imageDataUrl: highResDataUrl,
          fallbackMood: recentLockValid ? state.lastLockedMood : null,
          fallbackConfidence: recentLockValid ? state.lastLockedConf : null,
          deviceLabel: detectDeviceName(),
          language: state.sessionLangFilter,
          captureSource: "camera",
        }),
      });

      handleNewCaptureSuccess(response);
    } catch (err) {
      showToast(err.message || "Fotoğraf analiz edilemedi.");
    } finally {
      shutterBtn.classList.remove("busy");
      shutterBtn.disabled = false;
    }
  }

  async function handleFileUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    event.target.value = "";

    updateLiveHud("idle", "Fotoğraf İşleniyor…");
    showToast("Fotoğraf analiz ediliyor…");

    const formData = new FormData();
    formData.append("photo", file);
    formData.append("language", state.sessionLangFilter);
    formData.append("deviceLabel", /iPhone/i.test(navigator.userAgent) ? "iPhone Fotoğraf" : "Yüklenen Fotoğraf");

    try {
      const response = await api("/api/scans/upload-file", {
        method: "POST",
        body: formData,
      });
      if (!state.stream && response.session && response.session.snapshotDataUrl) {
        const prevImg = $("captured-preview-img");
        prevImg.src = response.session.snapshotDataUrl;
        prevImg.classList.remove("hidden");
        $("camera-placeholder").classList.add("hidden");
        $("stop-camera-btn").classList.remove("hidden");
      }
      handleNewCaptureSuccess(response);
    } catch (err) {
      showToast(err.message || "Fotoğraf analiz edilemedi.");
      updateLiveHud("idle", state.stream ? "Yüz Aranıyor…" : "Kamera Kapalı");
    }
  }

  function handleNewCaptureSuccess(response) {
    const session = response.session;
    state.activeSession = session;
    state.stats = response.stats || state.stats;

    // Prepend to recent scans
    state.recentScans = [session, ...state.recentScans.filter((s) => s.id !== session.id)];

    const pct = Math.round((session.confidence || 0) * 100);
    updateLiveHud(session.mood, `${MOOD_SHORT_TR[session.mood]} · %${pct}`);

    renderHeaderAndStats();
    renderActiveSession();
    renderRecentScans();

    showToast(`${MOOD_FULL_TR[session.mood]} moduna uygun ${session.tracks.length} şarkı hazırlandı!`);

    if (window.innerWidth < 900) {
      $("session-result-card").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ───────────────────────── 5. Render Active Session & Track Lists ─────────────────────────

  function renderActiveSession() {
    const session = state.activeSession;
    if (!session) {
      $("empty-result-state").classList.remove("hidden");
      $("active-session-content").classList.add("hidden");
      return;
    }

    $("empty-result-state").classList.add("hidden");
    $("active-session-content").classList.remove("hidden");

    const badge = $("result-mood-badge");
    badge.setAttribute("data-mood", session.mood);
    badge.textContent = MOOD_FULL_TR[session.mood] || session.moodLabel;

    $("result-confidence-label").textContent = `%${Math.round((session.confidence || 0) * 100)} Güven`;
    $("result-playlist-title").textContent = `${MOOD_SHORT_TR[session.mood] || ""} Moduna Özel Seçki`;
    $("result-timestamp-label").textContent = `${formatDateTR(session.createdAt)} · ${session.deviceLabel || "Kamera"}`;

    const snapImg = $("result-snap-img");
    const snapFallback = $("result-snap-fallback");
    if (session.snapshotDataUrl) {
      snapImg.src = session.snapshotDataUrl;
      snapImg.classList.remove("hidden");
      snapFallback.classList.add("hidden");
    } else {
      snapImg.classList.add("hidden");
      snapFallback.classList.remove("hidden");
    }

    const allTracks = session.tracks || [];
    const filtered =
      state.sessionLangFilter === "all"
        ? allTracks
        : allTracks.filter((t) => t.language === state.sessionLangFilter);

    $("session-tracks-count").textContent = `${filtered.length} şarkı`;
    renderTrackRows($("session-tracks-list"), filtered);
  }

  function renderTrackRows(container, tracks) {
    container.innerHTML = "";
    if (!tracks || tracks.length === 0) {
      container.innerHTML = `<p class="page-subtitle" style="padding:18px 6px;">Bu filtreye uygun şarkı bulunamadı.</p>`;
      return;
    }

    tracks.forEach((track, idx) => {
      const row = document.createElement("article");
      const isPlaying = state.playingTrackId === track.id && !$("global-audio").paused;
      row.className = `track-item${state.playingTrackId === track.id ? " playing" : ""}`;
      row.dataset.trackId = String(track.id);

      const coverSrc = track.artworkUrl || "/assets/icon-192.png";
      const langBadge = track.language === "tr" ? "TR" : "GLOBAL";

      row.innerHTML = `
        <button type="button" class="track-cover-btn" aria-label="${escapeHtml(track.title)} önizlemesini çal">
          <img src="${escapeHtml(coverSrc)}" alt="" loading="lazy" />
          <span class="track-play-badge">${isPlaying ? "❚❚" : "▶"}</span>
        </button>
        <div class="track-info">
          <strong class="track-title">${escapeHtml(track.title)}</strong>
          <div class="track-sub">
            <span class="lang-pill">${langBadge}</span>
            <span>${escapeHtml(track.artist)} · ${escapeHtml(track.genre)}</span>
          </div>
        </div>
        <div class="track-actions">
          <button type="button" class="fav-btn${track.isFavorite ? " liked" : ""}" title="Favorilere ekle" aria-label="Favori">
            ${track.isFavorite ? "♥" : "♡"}
          </button>
          <a href="${escapeHtml(track.youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link-btn">YT ↗</a>
        </div>
      `;

      row.querySelector(".track-cover-btn").addEventListener("click", () => {
        playTrackFromList(tracks, idx);
      });

      const favBtn = row.querySelector(".fav-btn");
      favBtn.addEventListener("click", async () => {
        try {
          const res = await api(`/api/tracks/${track.id}/favorite`, { method: "POST" });
          track.isFavorite = res.isFavorite;
          favBtn.classList.toggle("liked", track.isFavorite);
          favBtn.textContent = track.isFavorite ? "♥" : "♡";
          if (state.stats) {
            state.stats.favoriteTracksCount = Math.max(
              0,
              (state.stats.favoriteTracksCount || 0) + (track.isFavorite ? 1 : -1)
            );
            renderHeaderAndStats();
          }
        } catch (err) {
          showToast(err.message);
        }
      });

      container.appendChild(row);
    });
  }

  // ───────────────────────── 6. Past Scan Sessions (History) ─────────────────────────

  function renderRecentScans() {
    const strip = $("home-recent-strip");
    if (!strip) return;
    strip.innerHTML = "";

    if (!state.recentScans || state.recentScans.length === 0) {
      strip.innerHTML = `<p class="page-subtitle">Henüz geçmiş taramanız bulunmuyor. Kameradan ilk fotoğrafınızı çekerek başlayın.</p>`;
      return;
    }

    state.recentScans.slice(0, 6).forEach((scan) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scan-mini-card";
      const pct = Math.round((scan.confidence || 0) * 100);
      const thumbHtml = scan.snapshotDataUrl
        ? `<img src="${escapeHtml(scan.snapshotDataUrl)}" alt="" class="scan-mini-thumb" />`
        : `<div class="scan-mini-thumb">◈</div>`;

      btn.innerHTML = `
        ${thumbHtml}
        <div class="scan-mini-body">
          <span class="mood-tag" data-mood="${escapeHtml(scan.mood)}">${escapeHtml(MOOD_SHORT_TR[scan.mood] || scan.mood)} · %${pct}</span>
          <span class="scan-mini-time">${escapeHtml(formatDateTR(scan.createdAt))} · ${scan.trackCount || 14} şarkı</span>
        </div>
      `;
      btn.addEventListener("click", () => openPastSession(scan.id, true));
      strip.appendChild(btn);
    });
  }

  async function refreshHistoryList() {
    try {
      const data = await api("/api/scans?limit=50");
      state.recentScans = data.scans || [];
      state.stats = data.stats || state.stats;
      renderHeaderAndStats();
      renderRecentScans();
      renderFullHistoryGrid();
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderFullHistoryGrid() {
    const grid = $("history-sessions-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!state.recentScans.length) {
      grid.innerHTML = `<p class="page-subtitle">Henüz kaydedilmiş bir tarama oturumu yok.</p>`;
      return;
    }

    state.recentScans.forEach((scan) => {
      const card = document.createElement("article");
      card.className = "history-card";
      const pct = Math.round((scan.confidence || 0) * 100);
      const imgHtml = scan.snapshotDataUrl
        ? `<img src="${escapeHtml(scan.snapshotDataUrl)}" alt="Tarama" class="history-thumb" />`
        : `<div class="history-thumb" style="display:flex;align-items:center;justify-content:center;font-size:22px;">◈</div>`;

      card.innerHTML = `
        <div class="history-card-top">
          ${imgHtml}
          <div style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
              <span class="mood-tag" data-mood="${escapeHtml(scan.mood)}">${escapeHtml(MOOD_FULL_TR[scan.mood] || scan.mood)}</span>
              <span class="mono-stat">%${pct}</span>
            </div>
            <div style="font-size:13px;font-weight:600;">${escapeHtml(scan.deviceLabel || "Kamera")}</div>
            <div style="font-size:12px;color:var(--ink-muted);">${escapeHtml(formatDateTR(scan.createdAt))}</div>
          </div>
        </div>
        <div class="history-card-actions">
          <button type="button" class="btn btn-secondary btn-sm open-session-btn">Şarkı Listesini Aç (${scan.trackCount || 0})</button>
          <button type="button" class="btn btn-ghost btn-sm delete-session-btn" aria-label="Sil">Sil</button>
        </div>
      `;

      card.querySelector(".open-session-btn").addEventListener("click", () => openPastSession(scan.id, true));
      card.querySelector(".delete-session-btn").addEventListener("click", async () => {
        try {
          const res = await api(`/api/scans/${scan.id}`, { method: "DELETE" });
          state.recentScans = state.recentScans.filter((s) => s.id !== scan.id);
          state.stats = res.stats || state.stats;
          if (state.activeSession && state.activeSession.id === scan.id) {
            state.activeSession = state.recentScans[0] ? null : null;
            renderActiveSession();
          }
          renderHeaderAndStats();
          renderRecentScans();
          renderFullHistoryGrid();
          showToast("Tarama kaydı silindi.");
        } catch (err) {
          showToast(err.message);
        }
      });

      grid.appendChild(card);
    });
  }

  async function openPastSession(sessionId, navigateToStudio = true) {
    try {
      const data = await api(`/api/scans/${sessionId}`);
      state.activeSession = data.session;
      renderActiveSession();
      if (navigateToStudio) {
        switchView("studio");
        $("session-result-card").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (err) {
      showToast(err.message);
    }
  }

  // ───────────────────────── 7. Music Database & Live Online Fetch ─────────────────────────

  async function loadLibraryTracks() {
    const params = new URLSearchParams();
    if (state.libMood) params.set("mood", state.libMood);
    if (state.libLang) params.set("language", state.libLang);
    if (state.libQuery.trim()) params.set("q", state.libQuery.trim());
    if (state.libFavOnly) params.set("favoritesOnly", "true");
    params.set("limit", "100");

    try {
      const data = await api(`/api/tracks?${params.toString()}`);
      state.libraryTracks = data.tracks || [];
      if (data.catalog && state.stats) {
        state.stats.catalog = data.catalog;
        renderHeaderAndStats();
      }
      renderTrackRows($("library-tracks-list"), state.libraryTracks);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function expandCatalogOnline(mood, queryText, targetContainer) {
    try {
      showToast("Çevrimiçi müzik veritabanlarından yeni şarkılar çekiliyor…");
      const data = await api("/api/music/expand", {
        method: "POST",
        body: JSON.stringify({
          mood: mood || "positive",
          language: targetContainer === "session" ? state.sessionLangFilter : state.libLang || "all",
          query: queryText || null,
          limit: 18,
        }),
      });
      if (data.catalog && state.stats) {
        state.stats.catalog = data.catalog;
        renderHeaderAndStats();
      }
      if (targetContainer === "session" && state.activeSession) {
        state.activeSession.tracks = data.tracks || [];
        renderActiveSession();
        showToast("Şarkı listesi internetten taze parçalarla yenilendi!");
      } else {
        await loadLibraryTracks();
        showToast(`Veritabanı genişletildi! Toplam ${data.catalog.total} şarkı hazır.`);
      }
    } catch (err) {
      showToast(err.message || "Çevrimiçi şarkı çekilemedi.");
    }
  }

  // ───────────────────────── 8. In-App 30s Audio Preview Player ─────────────────────────

  function playTrackFromList(list, index) {
    const track = list[index];
    if (!track) return;
    const audio = $("global-audio");

    if (state.playingTrackId === track.id) {
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
      syncPlayerUi();
      return;
    }

    state.queue = list.slice();
    state.queueIndex = index;
    state.playingTrackId = track.id;

    $("audio-player-bar").classList.remove("hidden");
    $("player-cover-img").src = track.artworkUrl || "/assets/icon-192.png";
    $("player-title").textContent = track.title;
    $("player-artist").textContent = `${track.artist} · ${track.genre}`;
    $("player-yt-link").href = track.youtubeUrl || "#";

    audio.src = `/api/tracks/${track.id}/audio`;
    audio.play().catch(() => {
      showToast("Bu parçanın önizlemesi şu an açılamadı, YouTube bağlantısını kullanabilirsiniz.");
    });

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album || "MoodSync",
          artwork: track.artworkUrl ? [{ src: track.artworkUrl, sizes: "600x600", type: "image/jpeg" }] : [],
        });
      } catch {
        // Ignore MediaMetadata errors on older browsers
      }
    }

    syncPlayerUi();
  }

  function syncPlayerUi() {
    const audio = $("global-audio");
    const playing = !audio.paused && state.playingTrackId !== null;
    $("player-toggle-btn").textContent = playing ? "❚❚" : "▶";

    document.querySelectorAll(".track-item").forEach((el) => {
      const tid = Number(el.dataset.trackId);
      const match = tid === state.playingTrackId;
      el.classList.toggle("playing", match);
      const badge = el.querySelector(".track-play-badge");
      if (badge) badge.textContent = match && playing ? "❚❚" : "▶";
    });
  }

  function formatSec(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ───────────────────────── Event Bindings ─────────────────────────

  function bindEvents() {
    // Auth Mode Tabs
    $("tab-login-btn").addEventListener("click", () => {
      $("tab-login-btn").classList.add("active");
      $("tab-register-btn").classList.remove("active");
      $("login-form").classList.remove("hidden");
      $("register-form").classList.add("hidden");
    });

    $("tab-register-btn").addEventListener("click", () => {
      $("tab-register-btn").classList.add("active");
      $("tab-login-btn").classList.remove("active");
      $("register-form").classList.remove("hidden");
      $("login-form").classList.add("hidden");
    });

    // Show / Hide Password
    $("toggle-login-pw").addEventListener("click", () => {
      const inp = $("login-password");
      const show = inp.type === "password";
      inp.type = show ? "text" : "password";
      $("toggle-login-pw").textContent = show ? "Gizle" : "Göster";
    });

    // Demo Autofill
    $("fill-demo-btn").addEventListener("click", () => {
      $("login-username").value = "demo";
      $("login-password").value = "moodsync123";
      $("login-error").classList.add("hidden");
    });

    // Classic Login Submit
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errBox = $("login-error");
      errBox.classList.add("hidden");
      const btn = $("login-submit-btn");
      btn.disabled = true;
      btn.textContent = "Giriş yapılıyor…";

      try {
        const res = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: $("login-username").value.trim(),
            password: $("login-password").value,
          }),
        });
        state.token = res.token;
        localStorage.setItem("moodsync_token", res.token);
        enterAuthenticatedApp(res);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
      } finally {
        btn.disabled = false;
        btn.textContent = "Giriş Yap";
      }
    });

    // Register Submit
    $("register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errBox = $("register-error");
      errBox.classList.add("hidden");
      const btn = $("register-submit-btn");
      btn.disabled = true;
      btn.textContent = "Hesap oluşturuluyor…";

      try {
        const res = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            displayName: $("reg-displayname").value.trim(),
            username: $("reg-username").value.trim(),
            password: $("reg-password").value,
          }),
        });
        state.token = res.token;
        localStorage.setItem("moodsync_token", res.token);
        state.activeSession = null;
        enterAuthenticatedApp(res);
        showToast("Hoş geldiniz! Hesabınız oluşturuldu.");
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
      } finally {
        btn.disabled = false;
        btn.textContent = "Hesap Oluştur ve Başla";
      }
    });

    // Logout
    $("logout-btn").addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch {
        // Ignore
      }
      state.token = null;
      state.user = null;
      state.activeSession = null;
      localStorage.removeItem("moodsync_token");
      $("global-audio").pause();
      $("audio-player-bar").classList.add("hidden");
      showAuthScreen();
    });

    // Theme Toggle
    $("theme-toggle-btn").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });

    // Navigation
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.getAttribute("data-view")));
    });
    $("header-brand-home").addEventListener("click", () => switchView("studio"));
    $("see-all-history-btn").addEventListener("click", () => switchView("history"));
    $("history-new-scan-btn").addEventListener("click", () => {
      switchView("studio");
      startCamera();
    });

    // Camera Controls
    $("start-camera-btn").addEventListener("click", startCamera);
    $("stop-camera-btn").addEventListener("click", () => {
      stopCamera();
      $("captured-preview-img").classList.add("hidden");
    });
    $("flip-camera-btn").addEventListener("click", flipCamera);
    $("capture-shutter-btn").addEventListener("click", captureFromCamera);
    $("file-upload-input").addEventListener("change", handleFileUpload);

    $("retake-photo-btn").addEventListener("click", () => {
      if (!state.stream) startCamera();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    $("refresh-online-playlist-btn").addEventListener("click", () => {
      if (state.activeSession) {
        expandCatalogOnline(state.activeSession.mood, null, "session");
      }
    });

    // Quick Mood Preview Chips (Empty State)
    document.querySelectorAll("[data-quick-mood]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mood = btn.getAttribute("data-quick-mood");
        try {
          const data = await api(`/api/tracks?mood=${mood}&limit=16`);
          state.activeSession = {
            id: 0,
            mood,
            moodLabel: MOOD_FULL_TR[mood],
            confidence: 1,
            createdAt: new Date().toISOString(),
            deviceLabel: "Hızlı Mod Önizlemesi",
            snapshotDataUrl: null,
            tracks: data.tracks || [],
          };
          renderActiveSession();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    // Session Language Filters
    $("session-lang-filters").querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("session-lang-filters").querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.sessionLangFilter = btn.getAttribute("data-lang") || "all";
        renderActiveSession();
      });
    });

    // Library Filters & Search
    let searchDebounce = null;
    $("library-search-input").addEventListener("input", (e) => {
      state.libQuery = e.target.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(loadLibraryTracks, 280);
    });

    $("library-online-search-btn").addEventListener("click", () => {
      const q = $("library-search-input").value.trim();
      expandCatalogOnline(state.libMood || "positive", q || null, "library");
    });

    $("pull-more-online-btn").addEventListener("click", () => {
      const q = $("library-search-input").value.trim();
      expandCatalogOnline(state.libMood || "positive", q || null, "library");
    });

    $("lib-mood-filters").querySelectorAll("[data-mood]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("lib-mood-filters").querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.libMood = btn.getAttribute("data-mood") || "";
        loadLibraryTracks();
      });
    });

    $("lib-lang-filters").querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("lib-lang-filters").querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.libLang = btn.getAttribute("data-lang") || "";
        loadLibraryTracks();
      });
    });

    $("lib-fav-toggle-btn").addEventListener("click", () => {
      state.libFavOnly = !state.libFavOnly;
      $("lib-fav-toggle-btn").classList.toggle("active", state.libFavOnly);
      loadLibraryTracks();
    });

    // Global Audio Player Events
    const audio = $("global-audio");
    $("player-toggle-btn").addEventListener("click", () => {
      if (!state.playingTrackId) return;
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });

    $("player-prev-btn").addEventListener("click", () => {
      if (state.queue.length && state.queueIndex > 0) {
        playTrackFromList(state.queue, state.queueIndex - 1);
      }
    });

    $("player-next-btn").addEventListener("click", () => {
      if (state.queue.length && state.queueIndex < state.queue.length - 1) {
        playTrackFromList(state.queue, state.queueIndex + 1);
      }
    });

    $("player-close-btn").addEventListener("click", () => {
      audio.pause();
      state.playingTrackId = null;
      $("audio-player-bar").classList.add("hidden");
      syncPlayerUi();
    });

    audio.addEventListener("play", syncPlayerUi);
    audio.addEventListener("pause", syncPlayerUi);
    audio.addEventListener("ended", () => {
      if (state.queue.length && state.queueIndex < state.queue.length - 1) {
        playTrackFromList(state.queue, state.queueIndex + 1);
      } else {
        syncPlayerUi();
      }
    });

    audio.addEventListener("timeupdate", () => {
      const dur = audio.duration || 30;
      const cur = audio.currentTime || 0;
      $("player-current-time").textContent = formatSec(cur);
      $("player-total-time").textContent = formatSec(dur);
      $("player-seek-range").value = String(Math.min(100, Math.round((cur / dur) * 100)));
    });

    $("player-seek-range").addEventListener("input", (e) => {
      const dur = audio.duration || 30;
      audio.currentTime = (Number(e.target.value) / 100) * dur;
    });
  }

  document.addEventListener("DOMContentLoaded", bootstrapApp);
})();
