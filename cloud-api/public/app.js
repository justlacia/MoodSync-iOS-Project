/* MoodSync Cloud Web & Visual Admin Explorer */
(() => {
  const TOKEN_KEY = 'moodsync_web_token';
  const THEME_KEY = 'moodsync_web_theme';
  const VOLUME_KEY = 'moodsync_web_volume';
  const MUTED_KEY = 'moodsync_web_muted';
  const QUICK_TAGS = ['Kahve', 'İş', 'Spor', 'Gece', 'Arkadaşlar', 'Yürüyüş', 'Ders', 'Yolculuk'];

  const ALL_EMOTIONS = [
    { key: 'happy', label: 'Mutlu', color: '#ffa047', soft: 'rgba(255,160,71,0.16)' },
    { key: 'surprise', label: 'Heyecanlı', color: '#fb923c', soft: 'rgba(251,146,60,0.16)' },
    { key: 'neutral', label: 'Dingin', color: '#2ed1bf', soft: 'rgba(46,209,191,0.16)' },
    { key: 'sad', label: 'Üzgün', color: '#639bff', soft: 'rgba(99,155,255,0.16)' },
    { key: 'angry', label: 'Kızgın', color: '#ff4d4d', soft: 'rgba(255,77,77,0.16)' },
  ];

  const SQL_PRESETS = [
    {
      label: 'Tablolar',
      sql: "SELECT tablename AS name, 'table' AS type FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    },
    {
      label: 'Kullanıcılar',
      sql: 'SELECT id, username, display_name, role, created_at FROM users ORDER BY id',
    },
    {
      label: 'Son 15 Tarama',
      sql: 'SELECT s.id, u.username, s.mood, s.emotion, ROUND((s.confidence * 100)::numeric) AS pct, s.created_at FROM scan_sessions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 15',
    },
    {
      label: 'Mod Dağılımı',
      sql: 'SELECT mood, language, COUNT(*)::int AS adet FROM tracks GROUP BY mood, language ORDER BY mood, language',
    },
  ];

  const savedVolRaw = Number(localStorage.getItem(VOLUME_KEY));
  const initialVolume =
    localStorage.getItem(VOLUME_KEY) !== null &&
    Number.isFinite(savedVolRaw) &&
    savedVolRaw >= 0 &&
    savedVolRaw <= 1
      ? savedVolRaw
      : 0.75;
  const initialMuted = localStorage.getItem(MUTED_KEY) === 'true';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,
    authMode: 'login',
    view: 'my-scans',
    theme: localStorage.getItem(THEME_KEY) || 'dark',
    // Library state
    libMood: '',
    libLang: '',
    libFavOnly: false,
    libSearch: '',
    libPage: 1,
    libTotal: 0,
    libTracks: [],
    // Admin state
    adminScanUserId: null,
    adminTable: 'users',
    adminTablePage: 1,
    adminTableSearch: '',
    adminTablesSummary: [],
    adminOverview: null,
    // Audio player state
    queue: [],
    queueIdx: -1,
    isPlaying: false,
    volume: initialVolume,
    muted: initialMuted,
    lastNonZeroVolume: initialVolume > 0 ? initialVolume : 0.75,
    loop: false,
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  function escapeHtml(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n || n <= 0) return '0 KB';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatDateTR(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(iso);
    }
  }

  function formatClock(sec) {
    const s = Math.max(0, Math.floor(Number(sec || 0)));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  function resolveMoodMeta(mood, emotion) {
    const em = ALL_EMOTIONS.find((x) => x.key === emotion);
    if (em) return em;
    if (mood === 'positive') return ALL_EMOTIONS[0];
    if (mood === 'negative') return ALL_EMOTIONS[3];
    return ALL_EMOTIONS[2];
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  async function api(path, options = {}) {
    const { method = 'GET', body, auth = true } = options;
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;

    const resp = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (resp.status === 401 && auth) {
        logout();
      }
      throw new Error(data.error || `Hata (${resp.status})`);
    }
    return data;
  }

  // Theme
  function applyTheme(t) {
    state.theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem(THEME_KEY, state.theme);
  }
  applyTheme(state.theme);

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // Lightbox & Modal
  function openLightbox(src, caption = '', mirrored = false) {
    if (!src) return;
    const img = $('lightbox-img');
    img.src = src;
    img.style.transform = mirrored ? 'scaleX(-1)' : '';
    $('lightbox-caption').textContent = caption;
    $('lightbox-overlay').classList.remove('hidden');
  }

  function closeLightbox() {
    $('lightbox-overlay').classList.add('hidden');
    $('lightbox-img').src = '';
  }

  function openModal(title, htmlContent) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = htmlContent;
    $('modal-overlay').classList.remove('hidden');
  }

  function closeModal() {
    $('modal-overlay').classList.add('hidden');
    $('modal-body').innerHTML = '';
  }

  // Audio Player
  const audioEl = $('html-audio');

  function syncVolumeUI() {
    const pct = state.muted ? 0 : Math.round(state.volume * 100);
    audioEl.volume = state.volume;
    audioEl.muted = state.muted;

    const slider = $('player-volume');
    const pctEl = $('player-volume-pct');
    const muteBtn = $('player-mute-btn');
    if (slider) slider.value = String(pct);
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (muteBtn) {
      let icon = '🔊';
      if (state.muted || pct === 0) icon = '🔇';
      else if (pct < 35) icon = '🔈';
      else if (pct < 70) icon = '🔉';
      muteBtn.textContent = icon;
      muteBtn.title = state.muted ? 'Sesi Aç (M)' : 'Sessize Al (M)';
      muteBtn.classList.toggle('active', state.muted || pct === 0);
    }
  }

  function setVolume(vol01, persist = true) {
    const clamped = Math.min(1, Math.max(0, Number(vol01)));
    const safeVol = Number.isFinite(clamped) ? clamped : 0.75;
    state.volume = safeVol;
    if (safeVol > 0) {
      state.lastNonZeroVolume = safeVol;
    }
    state.muted = safeVol === 0;
    if (persist) {
      localStorage.setItem(VOLUME_KEY, String(state.volume));
      localStorage.setItem(MUTED_KEY, String(state.muted));
    }
    syncVolumeUI();
  }

  function toggleMute() {
    if (state.muted || state.volume === 0) {
      state.muted = false;
      if (state.volume === 0) {
        state.volume = state.lastNonZeroVolume > 0 ? state.lastNonZeroVolume : 0.75;
      }
    } else {
      state.lastNonZeroVolume = state.volume > 0 ? state.volume : 0.75;
      state.muted = true;
    }
    localStorage.setItem(VOLUME_KEY, String(state.volume));
    localStorage.setItem(MUTED_KEY, String(state.muted));
    syncVolumeUI();
  }

  function syncLoopUI() {
    audioEl.loop = state.loop;
    const loopBtn = $('player-loop-btn');
    if (loopBtn) {
      loopBtn.classList.toggle('active', state.loop);
      loopBtn.setAttribute('aria-pressed', String(state.loop));
      loopBtn.title = state.loop ? 'Tekrar Çal (Açık)' : 'Tekrar Çal (Kapalı)';
    }
  }

  function syncTrackRowPlayStates() {
    const curId = state.queue[state.queueIdx]?.id;
    document.querySelectorAll('.track-row').forEach((row) => {
      const rowId = Number(row.dataset.trackId);
      const isCur = curId !== undefined && rowId === curId;
      row.classList.toggle('playing', isCur);
      const playBtn = row.querySelector('.play-track-btn');
      if (playBtn) {
        playBtn.textContent = isCur && state.isPlaying ? '⏸' : '▶';
      }
    });
  }

  syncVolumeUI();
  syncLoopUI();

  async function playQueue(tracks, index) {
    const tr = tracks[index];
    if (!tr) return;
    const current = state.queue[state.queueIdx];
    if (current && current.id === tr.id && audioEl.src) {
      if (audioEl.paused) {
        audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
      return;
    }

    state.queue = tracks;
    state.queueIdx = index;
    updatePlayerUI(tr);
    $('audio-player-bar').classList.remove('hidden');

    try {
      const res = await api(`/api/tracks/${tr.id}/preview`);
      const url = res.previewUrl || tr.previewUrl;
      if (!url) {
        showToast('Bu şarkı için önizleme bulunamadı; Spotify veya YouTube linkini kullanabilirsin.');
        return;
      }
      audioEl.src = url;
      syncVolumeUI();
      await audioEl.play();
    } catch (err) {
      showToast(err.message || 'Şarkı çalınamadı.');
    }
  }

  function updatePlayerUI(tr) {
    if (!tr) return;
    $('player-art').src = tr.artworkUrl || '';
    $('player-title').textContent = tr.title || '—';
    $('player-artist').textContent = tr.artist || '—';
    $('player-fav-btn').textContent = tr.isFavorite ? '♥' : '♡';
    $('player-fav-btn').style.color = tr.isFavorite ? 'var(--brand)' : '';
    const q = encodeURIComponent(`${tr.artist} ${tr.title}`);
    $('player-apple-link').href = tr.storeUrl || `https://music.apple.com/search?term=${q}`;
    $('player-spotify-link').href = `https://open.spotify.com/search/${q}`;
    $('player-yt-link').href = tr.youtubeUrl || `https://music.youtube.com/search?q=${q}`;
    syncTrackRowPlayStates();
  }

  function stopPlayer() {
    audioEl.pause();
    audioEl.removeAttribute('src');
    state.queue = [];
    state.queueIdx = -1;
    $('audio-player-bar').classList.add('hidden');
    syncTrackRowPlayStates();
  }

  audioEl.addEventListener('play', () => {
    state.isPlaying = true;
    $('player-play-btn').textContent = '⏸';
    syncTrackRowPlayStates();
  });
  audioEl.addEventListener('pause', () => {
    state.isPlaying = false;
    $('player-play-btn').textContent = '▶';
    syncTrackRowPlayStates();
  });
  audioEl.addEventListener('timeupdate', () => {
    const dur = Number.isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 30;
    $('player-seek').max = String(dur);
    $('player-seek').value = String(audioEl.currentTime || 0);
    $('player-cur-time').textContent = formatClock(audioEl.currentTime);
    $('player-dur-time').textContent = formatClock(dur);
  });
  audioEl.addEventListener('ended', () => {
    if (state.queueIdx + 1 < state.queue.length) {
      playQueue(state.queue, state.queueIdx + 1);
    }
  });

  // Auth Flow
  function showAuth() {
    $('app-shell').classList.add('hidden');
    $('auth-screen').classList.remove('hidden');
    stopPlayer();
  }

  function showApp() {
    $('auth-screen').classList.add('hidden');
    $('app-shell').classList.remove('hidden');

    const u = state.user;
    $('user-avatar').textContent = (u.displayName || u.username || 'U').slice(0, 1).toUpperCase();
    $('user-display-name').textContent = u.displayName || u.username;
    $('user-handle').textContent = `@${u.username}`;
    const isAdmin = u.role === 'admin' || u.username.toLowerCase() === 'haluk';
    $('user-role-badge').classList.toggle('hidden', !isAdmin);
    $('admin-nav-section').classList.toggle('hidden', !isAdmin);

    if (window.location.pathname === '/admin' && isAdmin) {
      switchView('admin-overview');
    } else {
      switchView(state.view);
    }
  }

  function logout() {
    state.token = '';
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }

  async function bootstrap() {
    api('/health', { auth: false })
      .then((h) => {
        if (h.catalogTracks) {
          $('sidebar-catalog-badge').textContent = `${h.catalogTracks} Bulut Şarkısı`;
        }
      })
      .catch(() => {});

    if (!state.token) {
      showAuth();
      return;
    }
    try {
      const res = await api('/api/auth/me');
      state.user = res.user;
      showApp();
    } catch {
      logout();
    }
  }

  // Navigation
  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    renderCurrentView();
  }

  async function renderCurrentView() {
    const main = $('main-content');
    main.innerHTML = '<div class="loading-center">Veriler Azure bulutundan yükleniyor…</div>';
    try {
      switch (state.view) {
        case 'my-scans':
          await renderMyScans(main);
          break;
        case 'library':
          await renderLibrary(main);
          break;
        case 'playlists':
          await renderPlaylists(main);
          break;
        case 'admin-overview':
          await renderAdminOverview(main);
          break;
        case 'admin-users':
          await renderAdminUsers(main);
          break;
        case 'admin-scans':
          await renderAdminScans(main);
          break;
        case 'admin-blobs':
          await renderAdminBlobs(main);
          break;
        case 'admin-tables':
          await renderAdminTables(main);
          break;
        default:
          await renderMyScans(main);
      }
    } catch (err) {
      main.innerHTML = `<div class="empty-box">⚠️ ${escapeHtml(err.message)}</div>`;
    }
  }

  // Reusable Track Row HTML
  function renderTrackRowsHtml(tracks, listPrefix, options = {}) {
    if (!tracks || tracks.length === 0) {
      return '<div class="empty-box">Gösterilecek şarkı bulunamadı.</div>';
    }
    const curId = state.queue[state.queueIdx]?.id;
    return `<div class="track-list">${tracks
      .map((t, idx) => {
        const meta = resolveMoodMeta(t.mood, null);
        const isCurrent = curId === t.id;
        return `
          <div class="track-row ${isCurrent ? 'playing' : ''}" data-track-id="${t.id}">
            <img class="track-cover" src="${escapeHtml(t.artworkUrl)}" alt="" onerror="this.style.visibility='hidden'" />
            <div class="track-info">
              <div class="track-title">${escapeHtml(t.title)}</div>
              <div class="track-sub">
                ${escapeHtml(t.artist)} · ${escapeHtml(t.genre)} ·
                <span style="color:${meta.color};font-weight:700;">${t.language === 'tr' ? 'Türkçe' : 'Yabancı'}</span>
              </div>
            </div>
            <div class="track-actions">
              <button type="button" class="btn-secondary btn-sm play-track-btn" data-idx="${idx}" data-prefix="${escapeHtml(listPrefix)}">
                ${isCurrent && state.isPlaying ? '⏸' : '▶'}
              </button>
              <button type="button" class="btn-ghost btn-sm fav-track-btn" data-id="${t.id}" style="color:${t.isFavorite ? 'var(--brand)' : ''}">
                ${t.isFavorite ? '♥' : '♡'}
              </button>
              <button type="button" class="btn-ghost btn-sm add-pl-btn" data-id="${t.id}" title="Listeye Ekle">+ Liste</button>
              ${
                options.playlistId
                  ? `<button type="button" class="btn-ghost btn-sm danger-text remove-pl-track-btn" data-pl="${options.playlistId}" data-id="${t.id}" title="Listeden Çıkar">✕</button>`
                  : `<button type="button" class="btn-ghost btn-sm dislike-track-btn" data-id="${t.id}" title="Bir Daha Önerme">🚫</button>`
              }
            </div>
          </div>`;
      })
      .join('')}</div>`;
  }

  function wireTrackActions(container, trackList, onRefresh) {
    container.querySelectorAll('.play-track-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        playQueue(trackList, Number(btn.dataset.idx));
      });
    });

    container.querySelectorAll('.fav-track-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const res = await api(`/api/tracks/${id}/favorite`, { method: 'POST' });
        const target = trackList.find((x) => x.id === id);
        if (target) target.isFavorite = res.liked;
        btn.textContent = res.liked ? '♥' : '♡';
        btn.style.color = res.liked ? 'var(--brand)' : '';
        if (state.queue[state.queueIdx]?.id === id) {
          state.queue[state.queueIdx].isFavorite = res.liked;
          updatePlayerUI(state.queue[state.queueIdx]);
        }
      });
    });

    container.querySelectorAll('.add-pl-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPlaylistPickerModal([Number(btn.dataset.id)]));
    });

    container.querySelectorAll('.dislike-track-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        await api(`/api/tracks/${id}/dislike`, { method: 'POST' });
        showToast('Şarkı gizlendi ("Bir Daha Önerme").');
        onRefresh?.();
      });
    });

    container.querySelectorAll('.remove-pl-track-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const plId = Number(btn.dataset.pl);
        const id = Number(btn.dataset.id);
        await api(`/api/playlists/${plId}/tracks/${id}`, { method: 'DELETE' });
        showToast('Şarkı listeden çıkarıldı.');
        onRefresh?.();
      });
    });
  }

  // ─────────────── VIEW 1: MY SCANS ───────────────
  async function renderMyScans(main) {
    const [scansRes, stats] = await Promise.all([api('/api/scans'), api('/api/dashboard/stats')]);
    const scans = scansRes.sessions || [];
    const domMeta = stats.dominantMood
      ? resolveMoodMeta(stats.dominantMood, stats.dominantEmotion)
      : null;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Taramalarım</h1>
          <p class="page-sub">iPhone kamerasıyla yaptığın tüm duygu analizleri, Blob fotoğraflar ve şarkı listelerin.</p>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Toplam Tarama</div><div class="kpi-val">${stats.totalScans}</div></div>
        <div class="kpi-card"><div class="kpi-label">Baskın Mod</div><div class="kpi-val" style="color:${domMeta ? domMeta.color : 'inherit'}">${domMeta ? escapeHtml(domMeta.label) : '—'}</div></div>
        <div class="kpi-card"><div class="kpi-label">Favori Şarkılar</div><div class="kpi-val">${stats.favoriteCount}</div></div>
        <div class="kpi-card"><div class="kpi-label">Bulut Kataloğu</div><div class="kpi-val">${stats.catalogTotal}</div></div>
      </div>

      ${
        scans.length === 0
          ? '<div class="empty-box">Henüz kayıtlı tarama yok. iPhone uygulamasından ilk fotoğrafını çektiğinde hemen burada görünecek.</div>'
          : `<div class="cards-grid">${scans
              .map((s) => {
                const meta = resolveMoodMeta(s.mood, s.emotion);
                const mirrored = (s.deviceLabel || '').toLowerCase().includes('ön kamera');
                const pct = Math.round((s.confidence || 0) * 100);
                return `
                  <div class="scan-card">
                    <div class="scan-top" data-open-scan="${s.id}">
                      ${
                        s.snapshotUri
                          ? `<img class="scan-thumb ${mirrored ? 'mirrored' : ''}" src="${escapeHtml(s.snapshotUri)}" alt="" />`
                          : `<div class="scan-thumb-fallback">🎭</div>`
                      }
                      <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                          <span class="mood-pill" style="background:${meta.soft};color:${meta.color};">${escapeHtml(meta.label)} · %${pct}</span>
                          ${s.moodStrategy === 'uplift' ? '<span class="tag-mini">Yükselt</span>' : ''}
                        </div>
                        <div style="font-size:12.5px;font-weight:600;margin-top:6px;">${escapeHtml(s.deviceLabel)}</div>
                        <div style="font-size:11.5px;color:var(--ink-muted);margin-top:2px;">${formatDateTR(s.createdAt)}</div>
                        <div>${(s.tags || []).map((t) => `<span class="tag-mini">#${escapeHtml(t)}</span>`).join('')}</div>
                        ${s.note ? `<div style="font-size:12px;color:var(--ink-secondary);margin-top:5px;">“${escapeHtml(s.note)}”</div>` : ''}
                      </div>
                    </div>
                    <div class="scan-footer">
                      <button type="button" class="btn-secondary btn-sm" data-open-scan="${s.id}">🎵 Şarkıları Aç (${s.trackCount})</button>
                      <button type="button" class="btn-ghost btn-sm danger-text" data-del-scan="${s.id}">Sil</button>
                    </div>
                  </div>`;
              })
              .join('')}</div>`
      }
    `;

    main.querySelectorAll('[data-open-scan]').forEach((el) => {
      el.addEventListener('click', () => openScanDetailModal(Number(el.dataset.openScan), false));
    });
    main.querySelectorAll('[data-del-scan]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu tarama ve fotoğrafı Azure bulutundan silinsin mi?')) return;
        await api(`/api/scans/${btn.dataset.delScan}`, { method: 'DELETE' });
        showToast('Tarama silindi.');
        renderMyScans(main);
      });
    });
  }

  async function openScanDetailModal(sessionId, isAdminView) {
    const endpoint = isAdminView ? `/api/admin/scans/${sessionId}` : `/api/scans/${sessionId}`;
    const res = await api(endpoint);
    const s = res.session;
    if (!s) return;

    const meta = resolveMoodMeta(s.mood, s.emotion);
    const mirrored = (s.deviceLabel || '').toLowerCase().includes('ön kamera');
    const scores = s.emotionScores || {};
    const breakdownHtml = ALL_EMOTIONS.map((em) => {
      const val = Math.round((Number(scores[em.key] || 0)) * 100);
      return val > 1
        ? `<div class="bar-row"><div class="bar-head"><span>${em.label}</span><span>%${val}</span></div><div class="bar-track"><div class="bar-fill" style="width:${val}%;background:${em.color};"></div></div></div>`
        : '';
    }).join('');

    const html = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
        ${
          s.snapshotUri
            ? `<img id="modal-scan-photo" src="${escapeHtml(s.snapshotUri)}" style="width:140px;height:170px;border-radius:14px;object-fit:cover;cursor:zoom-in;${mirrored ? 'transform:scaleX(-1);' : ''}" />`
            : `<div class="scan-thumb-fallback" style="width:140px;height:170px;">🎭</div>`
        }
        <div style="flex:1;min-width:220px;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="mood-pill" style="background:${meta.soft};color:${meta.color};">${escapeHtml(meta.label)} · %${Math.round(s.confidence * 100)}</span>
            ${s.username ? `<span class="tag-mini">@${escapeHtml(s.username)}</span>` : ''}
          </div>
          <div style="font-size:13px;color:var(--ink-secondary);margin-bottom:10px;">
            ${escapeHtml(s.deviceLabel)} · ${formatDateTR(s.createdAt)}
          </div>
          ${breakdownHtml}
        </div>
      </div>

      ${
        !isAdminView
          ? `
        <div class="card-panel" style="margin-bottom:14px;">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px;">
            <strong style="font-size:13px;">Mod Stratejisi &amp; Duygu</strong>
            <div class="chips-row">
              <button type="button" class="chip ${s.moodStrategy !== 'uplift' ? 'active' : ''}" data-strat="match">Moduma Eşlik Et</button>
              <button type="button" class="chip ${s.moodStrategy === 'uplift' ? 'active' : ''}" data-strat="uplift">Modumu Yükselt</button>
            </div>
          </div>
          <div class="chips-row" style="margin-bottom:10px;">
            ${ALL_EMOTIONS.map((em) => `<button type="button" class="chip ${s.emotion === em.key ? 'active' : ''}" data-set-emo="${em.key}">${em.label}</button>`).join('')}
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--ink-muted);margin-bottom:6px;">DUYGU GÜNLÜĞÜ &amp; ETİKETLER</div>
          <div class="chips-row" style="margin-bottom:8px;" id="modal-tag-chips">
            ${QUICK_TAGS.map((tg) => `<button type="button" class="chip ${(s.tags || []).includes(tg) ? 'active' : ''}" data-tag="${tg}">#${tg}</button>`).join('')}
          </div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="modal-note-input" value="${escapeHtml(s.note || '')}" placeholder="Kısa bir günlük notu…" />
            <button type="button" id="modal-save-journal" class="btn-primary">Kaydet</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="btn-secondary btn-sm" data-expand="5">+5 Şarkı Ekle</button>
          <button type="button" class="btn-secondary btn-sm" data-expand="10">+10 Şarkı Ekle</button>
          <button type="button" class="btn-secondary btn-sm" id="modal-save-all-pl">💿 Tümünü Listeye Kaydet</button>
        </div>`
          : ''
      }

      <div id="modal-tracks-container">${renderTrackRowsHtml(s.tracks || [], `scan-${s.id}`)}</div>
    `;

    openModal(`Tarama #${s.id}`, html);

    const photoEl = $('modal-scan-photo');
    if (photoEl) {
      photoEl.addEventListener('click', () =>
        openLightbox(s.snapshotUri, `${meta.label} · ${formatDateTR(s.createdAt)}`, mirrored)
      );
    }

    const modalTracksEl = $('modal-tracks-container');
    wireTrackActions(modalTracksEl, s.tracks || [], () => openScanDetailModal(sessionId, isAdminView));

    if (!isAdminView) {
      const selectedTags = new Set(s.tags || []);
      $('modal-body').querySelectorAll('[data-tag]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const t = btn.dataset.tag;
          if (selectedTags.has(t)) selectedTags.delete(t);
          else selectedTags.add(t);
          btn.classList.toggle('active', selectedTags.has(t));
        });
      });

      $('modal-save-journal').addEventListener('click', async () => {
        await api(`/api/scans/${s.id}/journal`, {
          method: 'PATCH',
          body: { note: $('modal-note-input').value, tags: Array.from(selectedTags) },
        });
        showToast('Günlük notu kaydedildi.');
        renderCurrentView();
      });

      $('modal-body').querySelectorAll('[data-strat]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await api(`/api/scans/${s.id}/mood`, {
            method: 'PATCH',
            body: { strategy: btn.dataset.strat, language: 'all' },
          });
          showToast('Liste güncellendi.');
          openScanDetailModal(sessionId, false);
        });
      });

      $('modal-body').querySelectorAll('[data-set-emo]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await api(`/api/scans/${s.id}/mood`, {
            method: 'PATCH',
            body: { emotion: btn.dataset.setEmo, isManualOverride: true, language: 'all' },
          });
          showToast('Duygu güncellendi.');
          openScanDetailModal(sessionId, false);
        });
      });

      $('modal-body').querySelectorAll('[data-expand]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const r = await api(`/api/scans/${s.id}/expand`, {
            method: 'POST',
            body: { addCount: Number(btn.dataset.expand), language: 'all' },
          });
          showToast(`+${r.addedCount} yeni şarkı eklendi.`);
          openScanDetailModal(sessionId, false);
        });
      });

      $('modal-save-all-pl').addEventListener('click', () => {
        openPlaylistPickerModal((s.tracks || []).map((t) => t.id), `${meta.label} Modum`);
      });
    }
  }

  // ─────────────── VIEW 2: LIBRARY ───────────────
  let searchDebounce = null;
  async function renderLibrary(main) {
    const params = new URLSearchParams();
    if (state.libMood) params.set('mood', state.libMood);
    if (state.libLang) params.set('language', state.libLang);
    if (state.libFavOnly) params.set('favoritesOnly', 'true');
    if (state.libSearch.trim()) params.set('search', state.libSearch.trim());
    params.set('page', String(state.libPage));
    params.set('pageSize', '30');

    const data = await api(`/api/tracks?${params.toString()}`);
    state.libTracks = data.tracks || [];
    state.libTotal = Number(data.totalCount || 0);
    const totalPages = Math.max(1, Math.ceil(state.libTotal / 30));

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Bulut Şarkı Kataloğu</h1>
          <p class="page-sub">${state.libTotal} şarkı listeleniyor · Azure PostgreSQL üzerinde kalıcı havuz</p>
        </div>
        <div class="chips-row">
          <button type="button" id="lib-disliked-btn" class="btn-secondary">🚫 Gizlenenler</button>
          <button type="button" id="lib-pull-btn" class="btn-primary">☁️ İnternetten Buluta Çek</button>
        </div>
      </div>

      <div class="toolbar">
        <input id="lib-search-input" type="search" value="${escapeHtml(state.libSearch)}" placeholder="Sanatçı, şarkı veya tür ara…" style="max-width:340px;" />
        <div class="chips-row">
          <button type="button" class="chip ${state.libMood === '' ? 'active' : ''}" data-mood="">Tüm Modlar</button>
          <button type="button" class="chip ${state.libMood === 'positive' ? 'active' : ''}" data-mood="positive">Mutlu</button>
          <button type="button" class="chip ${state.libMood === 'neutral' ? 'active' : ''}" data-mood="neutral">Dingin</button>
          <button type="button" class="chip ${state.libMood === 'negative' ? 'active' : ''}" data-mood="negative">Üzgün &amp; Kızgın</button>
        </div>
        <div class="chips-row">
          <button type="button" class="chip ${state.libLang === '' ? 'active' : ''}" data-lang="">Tüm Diller</button>
          <button type="button" class="chip ${state.libLang === 'tr' ? 'active' : ''}" data-lang="tr">Türkçe</button>
          <button type="button" class="chip ${state.libLang === 'global' ? 'active' : ''}" data-lang="global">Yabancı</button>
          <button type="button" id="lib-fav-chip" class="chip ${state.libFavOnly ? 'active' : ''}">♥ Favorilerim</button>
        </div>
      </div>

      <div class="pagination-bar">
        <span class="page-info">Sayfa ${state.libPage} / ${totalPages} · Toplam ${state.libTotal} şarkı</span>
        <div class="chips-row">
          <button type="button" class="btn-secondary btn-sm" id="lib-prev-page" ${state.libPage <= 1 ? 'disabled' : ''}>← Önceki</button>
          <button type="button" class="btn-secondary btn-sm" id="lib-next-page" ${state.libPage >= totalPages ? 'disabled' : ''}>Sonraki →</button>
        </div>
      </div>

      <div id="lib-tracks-wrap">${renderTrackRowsHtml(state.libTracks, 'lib')}</div>
    `;

    const searchInput = $('lib-search-input');
    searchInput.addEventListener('input', (e) => {
      state.libSearch = e.target.value;
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.libPage = 1;
        renderLibrary(main);
      }, 280);
    });

    main.querySelectorAll('[data-mood]').forEach((b) =>
      b.addEventListener('click', () => {
        state.libMood = b.dataset.mood;
        state.libPage = 1;
        renderLibrary(main);
      })
    );
    main.querySelectorAll('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        state.libLang = b.dataset.lang;
        state.libPage = 1;
        renderLibrary(main);
      })
    );
    $('lib-fav-chip').addEventListener('click', () => {
      state.libFavOnly = !state.libFavOnly;
      state.libPage = 1;
      renderLibrary(main);
    });
    $('lib-prev-page').addEventListener('click', () => {
      if (state.libPage > 1) {
        state.libPage--;
        renderLibrary(main);
      }
    });
    $('lib-next-page').addEventListener('click', () => {
      if (state.libPage < totalPages) {
        state.libPage++;
        renderLibrary(main);
      }
    });

    $('lib-pull-btn').addEventListener('click', async () => {
      const btn = $('lib-pull-btn');
      btn.disabled = true;
      btn.textContent = 'Çekiliyor…';
      try {
        const res = await api('/api/tracks/pull-online', {
          method: 'POST',
          body: {
            mood: state.libMood || 'positive',
            language: state.libLang || 'all',
            customQuery: state.libSearch.trim() || undefined,
          },
        });
        showToast(`${res.added} şarkı bulut kataloğuna eklendi.`);
        renderLibrary(main);
      } finally {
        btn.disabled = false;
      }
    });

    $('lib-disliked-btn').addEventListener('click', openDislikedModal);
    wireTrackActions($('lib-tracks-wrap'), state.libTracks, () => renderLibrary(main));
  }

  async function openDislikedModal() {
    const res = await api('/api/tracks/disliked');
    const tracks = res.tracks || [];
    const html =
      tracks.length === 0
        ? '<div class="empty-box">Henüz gizlediğiniz şarkı yok.</div>'
        : `<div class="track-list">${tracks
            .map(
              (t) => `
          <div class="track-row">
            <img class="track-cover" src="${escapeHtml(t.artworkUrl)}" alt="" />
            <div class="track-info">
              <div class="track-title">${escapeHtml(t.title)}</div>
              <div class="track-sub">${escapeHtml(t.artist)}</div>
            </div>
            <button type="button" class="btn-secondary btn-sm" data-undislike="${t.id}">Geri Al</button>
          </div>`
            )
            .join('')}</div>`;
    openModal('Gizlenen Şarkılar', html);
    $('modal-body')
      .querySelectorAll('[data-undislike]')
      .forEach((btn) =>
        btn.addEventListener('click', async () => {
          await api(`/api/tracks/${btn.dataset.undislike}/dislike`, { method: 'DELETE' });
          showToast('Şarkı geri alındı.');
          openDislikedModal();
        })
      );
  }

  // ─────────────── VIEW 3: PLAYLISTS ───────────────
  async function renderPlaylists(main) {
    const data = await api('/api/playlists');
    const pls = data.playlists || [];

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Çalma Listelerim</h1>
          <p class="page-sub">Telefon ve web arasında eşzamanlı özel çalma listelerin.</p>
        </div>
        <button type="button" id="pl-new-btn" class="btn-primary">+ Yeni Çalma Listesi</button>
      </div>

      ${
        pls.length === 0
          ? '<div class="empty-box">Henüz çalma listen yok. Yukarıdan yeni bir liste oluşturabilir veya Şarkılar sekmesinden ekleyebilirsin.</div>'
          : `<div class="cards-grid">${pls
              .map((pl) => {
                const arts = pl.coverArtworks || [];
                const mosaic =
                  arts.length > 0
                    ? `<div class="mosaic">${[0, 1, 2, 3]
                        .map((i) => (arts[i] ? `<img src="${escapeHtml(arts[i])}" alt="" />` : '<div></div>'))
                        .join('')}</div>`
                    : `<div class="mosaic" style="display:flex;align-items:center;justify-content:center;font-size:22px;">💿</div>`;
                return `
                  <div class="scan-card">
                    <div class="scan-top" data-open-pl="${pl.id}">
                      ${mosaic}
                      <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:800;">${escapeHtml(pl.name)}</div>
                        <div style="font-size:12.5px;color:var(--ink-secondary);margin-top:3px;">${pl.trackCount} şarkı</div>
                        <div style="font-size:11.5px;color:var(--ink-muted);margin-top:2px;">Güncelleme: ${formatDateTR(pl.updatedAt)}</div>
                      </div>
                    </div>
                    <div class="scan-footer">
                      <button type="button" class="btn-secondary btn-sm" data-open-pl="${pl.id}">Listeyi Aç</button>
                      <div class="chips-row">
                        <button type="button" class="btn-ghost btn-sm" data-rename-pl="${pl.id}" data-name="${escapeHtml(pl.name)}">Yeniden Adlandır</button>
                        <button type="button" class="btn-ghost btn-sm danger-text" data-del-pl="${pl.id}">Sil</button>
                      </div>
                    </div>
                  </div>`;
              })
              .join('')}</div>`
      }
    `;

    $('pl-new-btn').addEventListener('click', () => openPlaylistPickerModal([], ''));
    main.querySelectorAll('[data-open-pl]').forEach((el) =>
      el.addEventListener('click', () => openPlaylistDetailModal(Number(el.dataset.openPl)))
    );
    main.querySelectorAll('[data-rename-pl]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const nextName = prompt('Yeni çalma listesi adı:', btn.dataset.name);
        if (!nextName || !nextName.trim()) return;
        await api(`/api/playlists/${btn.dataset.renamePl}`, {
          method: 'PATCH',
          body: { name: nextName.trim() },
        });
        showToast('Liste adı güncellendi.');
        renderPlaylists(main);
      })
    );
    main.querySelectorAll('[data-del-pl]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('Çalma listesi silinsin mi?')) return;
        await api(`/api/playlists/${btn.dataset.delPl}`, { method: 'DELETE' });
        showToast('Liste silindi.');
        renderPlaylists(main);
      })
    );
  }

  async function openPlaylistDetailModal(plId) {
    const res = await api(`/api/playlists/${plId}`);
    const pl = res.playlist;
    if (!pl) return;
    openModal(
      `${pl.name} (${pl.trackCount} şarkı)`,
      `<div id="pl-detail-tracks">${renderTrackRowsHtml(pl.tracks || [], `pl-${pl.id}`, {
        playlistId: pl.id,
      })}</div>`
    );
    wireTrackActions($('pl-detail-tracks'), pl.tracks || [], () => openPlaylistDetailModal(plId));
  }

  async function openPlaylistPickerModal(trackIds, suggestedName = '') {
    const data = await api('/api/playlists');
    const pls = data.playlists || [];
    openModal(
      trackIds.length ? 'Çalma Listesine Ekle' : 'Yeni Çalma Listesi Oluştur',
      `
        <div class="card-panel" style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink-muted);margin-bottom:8px;">YENİ LİSTE OLUŞTUR</div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="picker-new-name" value="${escapeHtml(suggestedName)}" placeholder="Liste adı (ör. Gece Sürüşü)" />
            <button type="button" id="picker-create-btn" class="btn-primary">Oluştur</button>
          </div>
        </div>
        ${
          trackIds.length > 0 && pls.length > 0
            ? `<div class="track-list">${pls
                .map(
                  (pl) => `
              <div class="track-row" style="cursor:pointer;" data-pick-pl="${pl.id}">
                <div class="track-info">
                  <div class="track-title">${escapeHtml(pl.name)}</div>
                  <div class="track-sub">${pl.trackCount} şarkı</div>
                </div>
                <button type="button" class="btn-secondary btn-sm">+ Ekle</button>
              </div>`
                )
                .join('')}</div>`
            : ''
        }
      `
    );

    $('picker-create-btn').addEventListener('click', async () => {
      const name = $('picker-new-name').value.trim();
      if (!name) return;
      await api('/api/playlists', {
        method: 'POST',
        body: { name, initialTrackIds: trackIds },
      });
      closeModal();
      showToast(`“${name}” oluşturuldu.`);
      if (state.view === 'playlists') renderCurrentView();
    });

    $('modal-body')
      .querySelectorAll('[data-pick-pl]')
      .forEach((row) =>
        row.addEventListener('click', async () => {
          const r = await api(`/api/playlists/${row.dataset.pickPl}/tracks`, {
            method: 'POST',
            body: { trackIds },
          });
          closeModal();
          showToast(`${r.added} şarkı listeye eklendi.`);
        })
      );
  }

  // ─────────────── ADMIN VIEWS ───────────────
  async function renderAdminOverview(main) {
    const ov = await api('/api/admin/overview');
    state.adminOverview = ov;
    state.adminTablesSummary = ov.tables || [];

    const trCount = ov.languageBreakdown?.find((l) => l.language === 'tr')?.count || 0;
    const glCount = ov.languageBreakdown?.find((l) => l.language === 'global')?.count || 0;

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Azure Bulut Yönetim Özeti</h1>
          <p class="page-sub">PostgreSQL Flexible Server (Poland Central) &amp; Private Blob Storage (Sweden Central)</p>
        </div>
        <button type="button" id="ov-refresh-btn" class="btn-secondary">↻ Yenile</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Toplam Hesap</div><div class="kpi-val">${ov.userCount}</div><div class="kpi-sub">${ov.adminCount} Admin · ${Math.max(0, ov.userCount - ov.adminCount)} Normal</div></div>
        <div class="kpi-card"><div class="kpi-label">Tüm Taramalar</div><div class="kpi-val">${ov.scanCount}</div><div class="kpi-sub">${ov.sessionTrackLinkCount} şarkı eşleşmesi</div></div>
        <div class="kpi-card"><div class="kpi-label">Şarkı Kataloğu</div><div class="kpi-val">${ov.trackCount}</div><div class="kpi-sub">${trCount} Türkçe · ${glCount} Yabancı</div></div>
        <div class="kpi-card"><div class="kpi-label">Azure Blob Fotoğraflar</div><div class="kpi-val">${ov.photoCount}</div><div class="kpi-sub">${formatBytes(ov.photoBytes)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Azure PostgreSQL</div><div class="kpi-val">${formatBytes(ov.dbBytes)}</div><div class="kpi-sub">${ov.tables?.length || 10} Tablo · SSL</div></div>
      </div>

      <div class="cards-grid" style="margin-bottom:18px;">
        <div class="card-panel">
          <h3 style="margin:0 0 12px;font-size:15px;">Duygu Analizi Dağılımı</h3>
          ${
            (ov.emotionBreakdown || []).length === 0
              ? '<div style="color:var(--ink-muted);font-size:13px;">Henüz tarama yok.</div>'
              : ov.emotionBreakdown
                  .map((e) => {
                    const m = resolveMoodMeta(e.emotion, e.emotion);
                    const pct = ov.scanCount > 0 ? Math.round((e.count / ov.scanCount) * 100) : 0;
                    return `<div class="bar-row"><div class="bar-head"><span>${escapeHtml(m.label)}</span><span>${e.count} (%${pct})</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${m.color};"></div></div></div>`;
                  })
                  .join('')
          }
        </div>

        <div class="card-panel">
          <h3 style="margin:0 0 12px;font-size:15px;">Katalog &amp; Kaynak Dağılımı</h3>
          <div class="bar-row"><div class="bar-head"><span>Türkçe Şarkılar</span><span>${trCount}</span></div><div class="bar-track"><div class="bar-fill" style="width:${ov.trackCount ? Math.round((trCount / ov.trackCount) * 100) : 0}%;background:var(--brand);"></div></div></div>
          <div class="bar-row"><div class="bar-head"><span>Yabancı (Global)</span><span>${glCount}</span></div><div class="bar-track"><div class="bar-fill" style="width:${ov.trackCount ? Math.round((glCount / ov.trackCount) * 100) : 0}%;background:var(--mood-neutral);"></div></div></div>
          <div class="chips-row" style="margin-top:10px;">
            ${(ov.sourceBreakdown || []).map((s) => `<span class="tag-mini">${escapeHtml(s.source.toUpperCase())}: ${s.count} şarkı</span>`).join('')}
          </div>
        </div>
      </div>

      <div class="card-panel">
        <h3 style="margin:0 0 12px;font-size:15px;">Hızlı Bakım &amp; İşlemler</h3>
        <div class="chips-row">
          <button type="button" id="ov-seed-btn" class="btn-primary">☁️ Bulut Şarkı Havuzunu Genişlet</button>
          <button type="button" id="ov-clean-btn" class="btn-secondary">🧹 Sahipsiz Blob Fotoğrafları Temizle</button>
          <button type="button" id="ov-wipe-btn" class="btn-danger">🗑️ Kullanıcı Verilerini Sıfırla</button>
        </div>
      </div>
    `;

    $('ov-refresh-btn').addEventListener('click', () => renderAdminOverview(main));
    $('ov-seed-btn').addEventListener('click', async () => {
      const btn = $('ov-seed-btn');
      btn.disabled = true;
      btn.textContent = 'Şarkılar Çekiliyor…';
      try {
        const res = await api('/api/admin/seed-catalog', { method: 'POST', body: { tracksPerArtist: 12 } });
        showToast(`Tamamlandı! Toplam ${res.totalCatalog} şarkı.`);
        renderAdminOverview(main);
      } finally {
        btn.disabled = false;
      }
    });
    $('ov-clean-btn').addEventListener('click', async () => {
      const res = await api('/api/admin/clean-orphans', { method: 'POST' });
      showToast(`${res.removed} sahipsiz Blob dosyası temizlendi.`);
      renderAdminOverview(main);
    });
    $('ov-wipe-btn').addEventListener('click', async () => {
      if (!confirm('Admin haluk ve şarkı kataloğu korunur; tüm diğer hesaplar, taramalar, Blob fotoğraflar ve playlistler silinir. Emin misin?')) return;
      await api('/api/admin/wipe-all', { method: 'POST' });
      showToast('Kullanıcı verileri sıfırlandı.');
      renderAdminOverview(main);
    });
  }

  async function renderAdminUsers(main) {
    const res = await api('/api/admin/users');
    const users = res.users || [];

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Hesaplar (${users.length})</h1>
          <p class="page-sub">Kayıtlı tüm kullanıcılar, tarama ve favori istatistikleri.</p>
        </div>
        <button type="button" id="new-user-modal-btn" class="btn-primary">+ Yeni Hesap Oluştur</button>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Kullanıcı</th>
              <th>Ad Soyad</th>
              <th>Rol</th>
              <th>Tarama</th>
              <th>Favori</th>
              <th>Katılım</th>
              <th>Son Tarama</th>
              <th>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            ${users
              .map(
                (u) => `
              <tr>
                <td>#${u.id}</td>
                <td><strong>@${escapeHtml(u.username)}</strong></td>
                <td>${escapeHtml(u.displayName)}</td>
                <td><span class="role-badge" style="background:${u.role === 'admin' ? 'var(--brand-soft)' : 'var(--subtle)'};color:${u.role === 'admin' ? 'var(--brand)' : 'var(--ink-secondary)'};">${escapeHtml(u.role.toUpperCase())}</span></td>
                <td>${u.scanCount}</td>
                <td>${u.favoriteCount}</td>
                <td>${formatDateTR(u.createdAt)}</td>
                <td>${formatDateTR(u.lastScanAt)}</td>
                <td>
                  <div class="chips-row">
                    <button type="button" class="btn-ghost btn-sm" data-user-scans="${u.id}">Taramalar</button>
                    <button type="button" class="btn-ghost btn-sm" data-reset-pw="${u.id}" data-uname="${escapeHtml(u.username)}">Şifre</button>
                    ${
                      u.role !== 'admin'
                        ? `<button type="button" class="btn-ghost btn-sm danger-text" data-del-user="${u.id}" data-uname="${escapeHtml(u.username)}">Sil</button>`
                        : ''
                    }
                  </div>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    $('new-user-modal-btn').addEventListener('click', () => {
      openModal(
        'Yeni Standart Hesap Oluştur',
        `
          <form id="create-user-form">
            <div class="field"><label>Ad Soyad</label><input id="cu-name" type="text" placeholder="Örn: Ayşe Yılmaz" /></div>
            <div class="field"><label>Kullanıcı Adı</label><input id="cu-user" type="text" required placeholder="En az 3 karakter" /></div>
            <div class="field"><label>Şifre</label><input id="cu-pass" type="password" required placeholder="En az 4 karakter" /></div>
            <button type="submit" class="btn-primary full-width">Hesap Oluştur</button>
          </form>
        `
      );
      $('create-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/admin/users', {
            method: 'POST',
            body: {
              displayName: $('cu-name').value,
              username: $('cu-user').value,
              password: $('cu-pass').value,
            },
          });
          closeModal();
          showToast('Kullanıcı oluşturuldu.');
          renderAdminUsers(main);
        } catch (err) {
          alert(err.message);
        }
      });
    });

    main.querySelectorAll('[data-user-scans]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.adminScanUserId = Number(btn.dataset.userScans);
        switchView('admin-scans');
      })
    );

    main.querySelectorAll('[data-reset-pw]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const uid = Number(btn.dataset.resetPw);
        openModal(
          `@${btn.dataset.uname} Şifresini Sıfırla`,
          `
            <form id="reset-pw-form">
              <div class="field"><label>Yeni Şifre</label><input id="rp-val" type="password" required placeholder="En az 4 karakter" /></div>
              <button type="submit" class="btn-primary full-width">Şifreyi Güncelle</button>
            </form>
          `
        );
        $('reset-pw-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api(`/api/admin/users/${uid}/password`, {
              method: 'PATCH',
              body: { newPassword: $('rp-val').value },
            });
            closeModal();
            showToast('Şifre güncellendi.');
          } catch (err) {
            alert(err.message);
          }
        });
      })
    );

    main.querySelectorAll('[data-del-user]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm(`@${btn.dataset.uname} hesabı ve tüm tarama/fotoğrafları silinsin mi?`)) return;
        await api(`/api/admin/users/${btn.dataset.delUser}`, { method: 'DELETE' });
        showToast('Hesap silindi.');
        renderAdminUsers(main);
      })
    );
  }

  async function renderAdminScans(main) {
    const q = state.adminScanUserId ? `?limit=120&userId=${state.adminScanUserId}` : '?limit=120';
    const [scansRes, usersRes] = await Promise.all([
      api(`/api/admin/scans${q}`),
      api('/api/admin/users'),
    ]);
    const scans = scansRes.scans || [];
    const users = usersRes.users || [];

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Tüm Taramalar (${scans.length})</h1>
          <p class="page-sub">Kullanıcıların yaptığı tüm yüz taramaları ve fotoğraflar.</p>
        </div>
      </div>

      <div class="chips-row" style="margin-bottom:16px;">
        <button type="button" class="chip ${state.adminScanUserId === null ? 'active' : ''}" data-filter-uid="">Tümü</button>
        ${users
          .map(
            (u) =>
              `<button type="button" class="chip ${state.adminScanUserId === u.id ? 'active' : ''}" data-filter-uid="${u.id}">@${escapeHtml(u.username)} (${u.scanCount})</button>`
          )
          .join('')}
      </div>

      ${
        scans.length === 0
          ? '<div class="empty-box">Seçili filtreye uygun tarama bulunamadı.</div>'
          : `<div class="cards-grid">${scans
              .map((s) => {
                const meta = resolveMoodMeta(s.mood, s.emotion);
                const mirrored = (s.deviceLabel || '').toLowerCase().includes('ön kamera');
                return `
                  <div class="scan-card">
                    <div class="scan-top" data-admin-scan="${s.id}">
                      ${
                        s.snapshotUri
                          ? `<img class="scan-thumb ${mirrored ? 'mirrored' : ''}" src="${escapeHtml(s.snapshotUri)}" alt="" />`
                          : `<div class="scan-thumb-fallback">🎭</div>`
                      }
                      <div style="flex:1;min-width:0;">
                        <div class="chips-row" style="margin-bottom:5px;">
                          <span class="tag-mini" style="margin:0;">@${escapeHtml(s.username)}</span>
                          <span class="mood-pill" style="background:${meta.soft};color:${meta.color};">${escapeHtml(meta.label)} · %${Math.round(s.confidence * 100)}</span>
                        </div>
                        <div style="font-size:12.5px;font-weight:600;">#${s.id} · ${escapeHtml(s.deviceLabel)}</div>
                        <div style="font-size:11.5px;color:var(--ink-muted);margin-top:2px;">${formatDateTR(s.createdAt)} · ${s.trackCount} şarkı</div>
                      </div>
                    </div>
                    <div class="scan-footer">
                      <button type="button" class="btn-secondary btn-sm" data-admin-scan="${s.id}">İncele</button>
                      <button type="button" class="btn-ghost btn-sm danger-text" data-admin-del-scan="${s.id}">Sil</button>
                    </div>
                  </div>`;
              })
              .join('')}</div>`
      }
    `;

    main.querySelectorAll('[data-filter-uid]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.adminScanUserId = btn.dataset.filterUid ? Number(btn.dataset.filterUid) : null;
        renderAdminScans(main);
      })
    );
    main.querySelectorAll('[data-admin-scan]').forEach((el) =>
      el.addEventListener('click', () => openScanDetailModal(Number(el.dataset.adminScan), true))
    );
    main.querySelectorAll('[data-admin-del-scan]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm(`#${btn.dataset.adminDelScan} numaralı tarama ve Blob fotoğrafı silinsin mi?`)) return;
        await api(`/api/admin/scans/${btn.dataset.adminDelScan}`, { method: 'DELETE' });
        showToast('Tarama silindi.');
        renderAdminScans(main);
      })
    );
  }

  async function renderAdminBlobs(main) {
    const res = await api('/api/admin/blobs');
    const blobs = res.blobs || [];
    const totalBytes = blobs.reduce((acc, b) => acc + Number(b.sizeBytes || 0), 0);

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Azure Blob Fotoğraf Galerisi (${blobs.length})</h1>
          <p class="page-sub">Gizli (private) <code>snapshots</code> container içeriği · Toplam ${formatBytes(totalBytes)}</p>
        </div>
        <button type="button" id="blob-clean-btn" class="btn-secondary">🧹 Sahipsizleri Temizle</button>
      </div>

      ${
        blobs.length === 0
          ? '<div class="empty-box">Henüz Azure Blob Storage içinde fotoğraf yok.</div>'
          : `<div class="blob-grid">${blobs
              .map((b) => {
                const meta = b.mood ? resolveMoodMeta(b.mood, b.emotion) : null;
                return `
                  <div class="blob-card">
                    <div class="blob-img-wrap" data-blob-zoom="${escapeHtml(b.url)}" data-caption="${escapeHtml(b.name)}">
                      <img src="${escapeHtml(b.url)}" alt="" />
                      <span class="blob-badge ${b.isOrphan ? 'orphan' : ''}">
                        ${b.isOrphan ? 'Sahipsiz' : `@${escapeHtml(b.username)} · #${b.scanId}`}
                      </span>
                    </div>
                    <div class="blob-meta">
                      <div style="font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(b.name)}</div>
                      <div>${formatBytes(b.sizeBytes)} · ${meta ? escapeHtml(meta.label) : 'Bağlantısız'}</div>
                      <div>${formatDateTR(b.createdAt)}</div>
                    </div>
                  </div>`;
              })
              .join('')}</div>`
      }
    `;

    $('blob-clean-btn').addEventListener('click', async () => {
      const r = await api('/api/admin/clean-orphans', { method: 'POST' });
      showToast(`${r.removed} sahipsiz fotoğraf silindi.`);
      renderAdminBlobs(main);
    });
    main.querySelectorAll('[data-blob-zoom]').forEach((el) =>
      el.addEventListener('click', () => openLightbox(el.dataset.blobZoom, el.dataset.caption))
    );
  }

  async function renderAdminTables(main) {
    if (state.adminTablesSummary.length === 0) {
      const ov = await api('/api/admin/overview');
      state.adminTablesSummary = ov.tables || [];
    }
    const tableRes = await api(
      `/api/admin/tables/${state.adminTable}?page=${state.adminTablePage}&pageSize=50`
    );
    const cols = tableRes.columns || [];
    const rows = tableRes.rows || [];
    const totalCount = Number(tableRes.totalCount || 0);
    const totalPages = Math.max(1, Math.ceil(totalCount / 50));

    const q = state.adminTableSearch.trim().toLowerCase();
    const filteredRows = q
      ? rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)))
      : rows;

    const showActions = state.adminTable === 'tracks' || state.adminTable === 'scan_sessions';

    main.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Görsel Tablo Gezgini</h1>
          <p class="page-sub">SQL yazmadan tüm Azure PostgreSQL tablolarını tıklayarak incele.</p>
        </div>
      </div>

      <div class="chips-row" style="margin-bottom:14px;">
        ${state.adminTablesSummary
          .map(
            (t) =>
              `<button type="button" class="chip ${state.adminTable === t.name ? 'active' : ''}" data-tbl="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${t.rowCount})</button>`
          )
          .join('')}
      </div>

      <div class="pagination-bar">
        <input id="tbl-search" type="search" value="${escapeHtml(state.adminTableSearch)}" placeholder="${escapeHtml(state.adminTable)} içinde filtrele…" style="max-width:300px;" />
        <div class="chips-row" style="align-items:center;">
          <span class="page-info">Sayfa ${state.adminTablePage} / ${totalPages} (${totalCount} kayıt)</span>
          <button type="button" class="btn-secondary btn-sm" id="tbl-prev" ${state.adminTablePage <= 1 ? 'disabled' : ''}>←</button>
          <button type="button" class="btn-secondary btn-sm" id="tbl-next" ${state.adminTablePage >= totalPages ? 'disabled' : ''}>→</button>
        </div>
      </div>

      <div class="table-wrap">
        ${
          filteredRows.length === 0
            ? '<div class="empty-box" style="border:0;">Bu tabloda görüntülenecek kayıt yok.</div>'
            : `<table class="data-table">
                <thead>
                  <tr>
                    ${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}
                    ${showActions ? '<th>İşlem</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${filteredRows
                    .map(
                      (row) => `
                    <tr>
                      ${cols
                        .map((c) => {
                          const v = row[c];
                          if (
                            (c === 'snapshot_preview_url' || c === 'artwork_url') &&
                            typeof v === 'string' &&
                            v.startsWith('http')
                          ) {
                            return `<td><img class="table-thumb" src="${escapeHtml(v)}" data-tbl-zoom="${escapeHtml(v)}" alt="" /></td>`;
                          }
                          return `<td title="${escapeHtml(v === null || v === undefined ? 'NULL' : String(v))}">${escapeHtml(v === null || v === undefined ? 'NULL' : String(v))}</td>`;
                        })
                        .join('')}
                      ${
                        showActions && row.id !== undefined
                          ? `<td><button type="button" class="btn-ghost btn-sm danger-text" data-tbl-del="${row.id}">Sil</button></td>`
                          : showActions
                            ? '<td></td>'
                            : ''
                      }
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>`
        }
      </div>

      <details class="sql-drawer">
        <summary>Gelişmiş SQL Sorgu Konsolu (İsteğe Bağlı · Salt-Okunur)</summary>
        <div style="margin-top:12px;">
          <div class="chips-row" style="margin-bottom:10px;">
            ${SQL_PRESETS.map((p, idx) => `<button type="button" class="chip" data-sql-preset="${idx}">${escapeHtml(p.label)}</button>`).join('')}
          </div>
          <textarea id="sql-input" rows="3" placeholder="SELECT * FROM users;">${escapeHtml(SQL_PRESETS[0].sql)}</textarea>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
            <button type="button" id="sql-run-btn" class="btn-primary btn-sm">▶ Çalıştır</button>
            <span id="sql-meta" style="font-size:12px;color:var(--ink-muted);"></span>
          </div>
          <div id="sql-output" style="margin-top:12px;"></div>
        </div>
      </details>
    `;

    main.querySelectorAll('[data-tbl]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.adminTable = btn.dataset.tbl;
        state.adminTablePage = 1;
        state.adminTableSearch = '';
        renderAdminTables(main);
      })
    );
    $('tbl-search').addEventListener('input', (e) => {
      state.adminTableSearch = e.target.value;
      renderAdminTables(main);
    });
    $('tbl-prev').addEventListener('click', () => {
      if (state.adminTablePage > 1) {
        state.adminTablePage--;
        renderAdminTables(main);
      }
    });
    $('tbl-next').addEventListener('click', () => {
      if (state.adminTablePage < totalPages) {
        state.adminTablePage++;
        renderAdminTables(main);
      }
    });
    main.querySelectorAll('[data-tbl-zoom]').forEach((img) =>
      img.addEventListener('click', () => openLightbox(img.dataset.tblZoom, state.adminTable))
    );
    main.querySelectorAll('[data-tbl-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.tblDel);
        if (!confirm(`#${id} kaydı silinsin mi?`)) return;
        const ep =
          state.adminTable === 'tracks' ? `/api/admin/tracks/${id}` : `/api/admin/scans/${id}`;
        await api(ep, { method: 'DELETE' });
        state.adminTablesSummary = [];
        showToast('Kayıt silindi.');
        renderAdminTables(main);
      })
    );

    main.querySelectorAll('[data-sql-preset]').forEach((btn) =>
      btn.addEventListener('click', () => {
        $('sql-input').value = SQL_PRESETS[Number(btn.dataset.sqlPreset)].sql;
      })
    );
    $('sql-run-btn').addEventListener('click', async () => {
      const sql = $('sql-input').value;
      const outEl = $('sql-output');
      const metaEl = $('sql-meta');
      try {
        const res = await api('/api/admin/sql', { method: 'POST', body: { sql } });
        metaEl.textContent = `${res.totalRows} satır · ${res.elapsedMs} ms`;
        if (!res.rows || res.rows.length === 0) {
          outEl.innerHTML = '<div style="font-size:13px;color:var(--ink-muted);">Sonuç boş.</div>';
          return;
        }
        outEl.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr>${res.columns
          .map((c) => `<th>${escapeHtml(c)}</th>`)
          .join('')}</tr></thead><tbody>${res.rows
          .map(
            (r) =>
              `<tr>${res.columns
                .map((c) => `<td>${escapeHtml(r[c] === null || r[c] === undefined ? 'NULL' : String(r[c]))}</td>`)
                .join('')}</tr>`
          )
          .join('')}</tbody></table></div>`;
      } catch (err) {
        metaEl.textContent = '';
        outEl.innerHTML = `<div class="alert-error">${escapeHtml(err.message)}</div>`;
      }
    });
  }

  // Static Event Listeners
  document.querySelectorAll('#auth-mode-switch .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.authMode = btn.dataset.mode;
      document.querySelectorAll('#auth-mode-switch .seg-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      $('auth-displayname-wrap').classList.toggle('hidden', state.authMode !== 'register');
      $('auth-submit-btn').textContent =
        state.authMode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur ve Başla';
      $('auth-error').classList.add('hidden');
    });
  });

  $('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('auth-error');
    const btn = $('auth-submit-btn');
    errEl.classList.add('hidden');
    btn.disabled = true;

    try {
      const username = $('auth-username').value.trim();
      const password = $('auth-password').value;
      const displayName = $('auth-displayname').value.trim();
      const endpoint = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        state.authMode === 'login'
          ? { username, password }
          : { displayName, username, password };
      const res = await api(endpoint, { method: 'POST', auth: false, body });
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem(TOKEN_KEY, res.token);
      showApp();
    } catch (err) {
      errEl.textContent = err.message || 'Giriş başarısız.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('theme-toggle-btn').addEventListener('click', toggleTheme);
  $('mobile-theme-btn').addEventListener('click', toggleTheme);
  $('logout-btn').addEventListener('click', logout);
  $('mobile-logout-btn').addEventListener('click', logout);

  $('modal-close-btn').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
  });
  $('lightbox-close-btn').addEventListener('click', closeLightbox);
  $('lightbox-overlay').addEventListener('click', (e) => {
    if (e.target === $('lightbox-overlay')) closeLightbox();
  });

  $('player-play-btn').addEventListener('click', () => {
    if (audioEl.paused) audioEl.play().catch(() => {});
    else audioEl.pause();
  });
  $('player-prev-btn').addEventListener('click', () => {
    if (state.queueIdx > 0) playQueue(state.queue, state.queueIdx - 1);
  });
  $('player-next-btn').addEventListener('click', () => {
    if (state.queueIdx + 1 < state.queue.length) playQueue(state.queue, state.queueIdx + 1);
  });
  $('player-loop-btn').addEventListener('click', () => {
    state.loop = !state.loop;
    syncLoopUI();
    showToast(state.loop ? 'Tekrar çalma açıldı.' : 'Tekrar çalma kapatıldı.');
  });
  $('player-seek').addEventListener('input', (e) => {
    audioEl.currentTime = Number(e.target.value || 0);
  });
  $('player-volume').addEventListener('input', (e) => {
    setVolume(Number(e.target.value) / 100);
  });
  $('player-mute-btn').addEventListener('click', toggleMute);
  $('player-volume-wrap').addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const baseVol = state.muted ? 0 : state.volume;
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      setVolume(baseVol + delta);
    },
    { passive: false }
  );
  document.addEventListener('keydown', (e) => {
    if ($('audio-player-bar').classList.contains('hidden')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMute();
    } else if (e.code === 'Space' && tag !== 'BUTTON' && tag !== 'A') {
      e.preventDefault();
      if (audioEl.paused) audioEl.play().catch(() => {});
      else audioEl.pause();
    }
  });
  $('player-close-btn').addEventListener('click', stopPlayer);
  $('player-fav-btn').addEventListener('click', async () => {
    const tr = state.queue[state.queueIdx];
    if (!tr) return;
    const res = await api(`/api/tracks/${tr.id}/favorite`, { method: 'POST' });
    tr.isFavorite = res.liked;
    updatePlayerUI(tr);
  });

  bootstrap();
})();
