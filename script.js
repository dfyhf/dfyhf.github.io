const titleEl = document.getElementById("title");
const artistEl = document.getElementById("artist");
const music = document.getElementById("audio");
const progressContainer = document.getElementById("progress-container");
const progress = document.getElementById("progress");
const currentTimeEle = document.getElementById("current-time");
const durationEle = document.getElementById("duration");
const prevBtn = document.getElementById("prev");
const playBtn = document.getElementById("play");
const nextBtn = document.getElementById("next");
const playIcon = playBtn.querySelector("i");
const downloadLink = document.getElementById("download-mp3");
const playlistEl = document.getElementById("playlist");
const playlistTitleEl = document.querySelector(".playlist-album-title");
const playerMainEl = document.getElementById("player-main");
const playerShell = document.querySelector(".player-shell");

let isPlaying = false;
let songIndex = 0;

/** @typedef {"iteration1" | "iteration2" | "studioTakes"} Mode */
/** @type {Mode | null} */
let mode = null;
/** @type {null | { trackIndex: number }} */
let studioTakesView = null;

const ALBUM_TITLE = "The Garden Path";
/** Playlist header when browsing Studio Takes (track list, not drilled into a song). */
const STUDIO_TAKES_LIST_TITLE = "Studio Takes";
const ARTIST = "iterations";

const MUSIC_DIR = "/music";
const ITERATION_1_DIR = `${MUSIC_DIR}/iteration-1`;
const ITERATION_2_DIR = `${MUSIC_DIR}/iteration-2`;
const ITERATION_1_MANIFEST_SRC = `${ITERATION_1_DIR}/files.json`;
const ITERATION_2_MANIFEST_SRC = `${ITERATION_2_DIR}/files.json`;
const ITERATION_2_SEED_GLOBAL = "__ITERATION_2_MANIFEST__";
/** Studio takes: `.mp3` files under `music/studio-takes/<trackId>/`, listed in `files.json`. */
const STUDIO_TAKES_DIR = `${MUSIC_DIR}/studio-takes`;
/**
 * Manifest: which `.mp3` basenames exist under `music/studio-takes/<id>/`.
 * Omitted or empty = that track stays grey until you add files (re-run build script or edit JSON).
 */
const STUDIO_TAKES_MANIFEST_SRC = `${STUDIO_TAKES_DIR}/files.json`;

function musicSrcInDir(dir, downloadName) {
  return `${dir}/${encodeURIComponent(downloadName)}`;
}

function readSeededManifest(globalName) {
  const value = globalThis[globalName];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function studioTakeFileSrc(trackId, fileName) {
  return `${STUDIO_TAKES_DIR}/${trackId}/${encodeURIComponent(fileName)}`;
}

/**
 * @type {{ id: string, displayName: string, downloadName: string }[]}
 */
const albumTrackDefs = [
  { id: "01-the-garden-path", displayName: "The Garden Path", downloadName: "01 - The Garden Path.mp3" },
  { id: "02-decades", displayName: "Decades", downloadName: "02 - Decades.mp3" },
  { id: "03-arrows", displayName: "← ↑ Arrows ↓→", downloadName: "03 - ← ↑ Arrows ↓→.mp3" },
  { id: "04-smoke-filled-rooms", displayName: "Smoke-Filled Rooms", downloadName: "04 - Smoke-Filled Rooms.mp3" },
  { id: "05-passing-thoughts", displayName: "Passing Thoughts", downloadName: "05 - Passing Thoughts.mp3" },
  { id: "06-reorient", displayName: "Reorient", downloadName: "06 - Reorient.mp3" },
  { id: "07-recursion", displayName: "Recursion", downloadName: "07 - Recursion.mp3" },
  { id: "08-the-weighout", displayName: "The Weighout", downloadName: "08 - The Weighout.mp3" },
  { id: "09-permaculture", displayName: "Permaculture", downloadName: "09 - Permaculture.mp3" },
];

/**
 * Flat playlist manifests resolve the exact `.mp3` basename for each track id.
 * This keeps Iteration 1/2 in sync with whatever static filenames are actually in each folder.
 * @type {Record<string, string | string[]>}
 */
let iteration1ManifestCurrent = {};
/** @type {Record<string, string | string[]>} */
let iteration2ManifestCurrent = readSeededManifest(ITERATION_2_SEED_GLOBAL);
/** @type {Promise<void> | null} */
let iteration1ManifestFetchInFlight = null;
/** @type {Promise<void> | null} */
let iteration2ManifestFetchInFlight = null;

function manifestSingleFileForTrack(manifest, trackId) {
  const files = normalizeManifestFileList(manifest[trackId]);
  return files[0] || "";
}

function buildFlatTracks(dir, manifest) {
  return albumTrackDefs.map((t) => {
    const downloadName = manifestSingleFileForTrack(manifest, t.id);
    return {
      ...t,
      artist: ARTIST,
      downloadName,
      src: downloadName ? musicSrcInDir(dir, downloadName) : "",
    };
  });
}

/** @type {{ id: string, displayName: string, artist: string, src: string, downloadName: string }[]} */
let iteration1Tracks = buildFlatTracks(ITERATION_1_DIR, iteration1ManifestCurrent);
/** @type {{ id: string, displayName: string, artist: string, src: string, downloadName: string }[]} */
let iteration2Tracks = buildFlatTracks(ITERATION_2_DIR, iteration2ManifestCurrent);

/**
 * Parsed `studio-takes/files.json`. Keys = track `id`; value = filename or list under `music/studio-takes/<id>/`.
 * @type {Record<string, string | string[]>}
 */
let studioTakesManifestCurrent = {};

/** @type {Promise<void> | null} */
let studioTakesManifestFetchInFlight = null;

function normalizeManifestFileList(value) {
  if (value == null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.filter((x) => typeof x === "string" && x.trim()).map((s) => s.trim());
  }
  return [];
}

function scheduleFlatManifestRefresh(kind) {
  const manifestSrc = kind === "iteration1" ? ITERATION_1_MANIFEST_SRC : ITERATION_2_MANIFEST_SRC;
  const getPromise = () => (kind === "iteration1" ? iteration1ManifestFetchInFlight : iteration2ManifestFetchInFlight);
  const setPromise = (promise) => {
    if (kind === "iteration1") {
      iteration1ManifestFetchInFlight = promise;
    } else {
      iteration2ManifestFetchInFlight = promise;
    }
  };
  if (getPromise()) return;
  const promise = fetch(`${manifestSrc}?_=${Date.now()}`, { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) return {};
      try {
        return await r.json();
      } catch {
        return {};
      }
    })
    .catch(() => ({}))
    .then((data) => {
      const manifest = data && typeof data === "object" && !Array.isArray(data) ? data : {};
      let tracks = [];
      if (kind === "iteration1") {
        iteration1ManifestCurrent = manifest;
        iteration1Tracks = buildFlatTracks(ITERATION_1_DIR, iteration1ManifestCurrent);
        iteration1ManifestFetchInFlight = null;
        warmFlatTrackDurations(iteration1Tracks);
        tracks = iteration1Tracks;
      } else {
        iteration2ManifestCurrent = manifest;
        iteration2Tracks = buildFlatTracks(ITERATION_2_DIR, iteration2ManifestCurrent);
        iteration2ManifestFetchInFlight = null;
        warmFlatTrackDurations(iteration2Tracks);
        tracks = iteration2Tracks;
      }
      if (mode === kind) {
        if (!music.dataset.playlistSrc) {
          const firstIndex = firstPlayableIndex(tracks);
          if (firstIndex >= 0) {
            songIndex = firstIndex;
            const first = tracks[firstIndex];
            loadAndPrime(first.src, first.displayName, first.artist, first.downloadName);
          }
        }
        renderPlaylist();
      }
    });
  setPromise(promise);
}

/** Alternate-only filenames for a track (not including the root master). */
function manifestAlternateFilesForTrack(trackId) {
  return normalizeManifestFileList(studioTakesManifestCurrent[trackId]);
}

/**
 * Studio Takes drill-in: only files listed in the manifest for that track folder.
 * @param {{ id: string, displayName: string, artist: string, src: string, downloadName: string }} track
 */
function studioTakesRowsForTrack(track) {
  return manifestAlternateFilesForTrack(track.id).map((fn) => ({
    label: fn.replace(/\.mp3$/i, ""),
    src: studioTakeFileSrc(track.id, fn),
    downloadName: fn,
  }));
}

function scheduleStudioTakesManifestRefresh() {
  if (studioTakesManifestFetchInFlight) return;
  // Always request a full body. `cache: "no-cache"` can yield 304 + empty/undecodable bodies in
  // some browsers, which makes `json()` throw → we’d treat the manifest as {} and break Studio Takes.
  studioTakesManifestFetchInFlight = fetch(`${STUDIO_TAKES_MANIFEST_SRC}?_=${Date.now()}`, { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) return {};
      try {
        return await r.json();
      } catch {
        return {};
      }
    })
    .catch(() => ({}))
    .then((data) => {
      studioTakesManifestFetchInFlight = null;
      studioTakesManifestCurrent = data && typeof data === "object" && !Array.isArray(data) ? data : {};
      warmStudioTakesDurationsFromManifest();
      if (mode === "studioTakes" && !studioTakesView) {
        renderStudioTakesAlbumList({ skipManifestRefresh: true });
      }
    });
}

/** True when `studio-takes/<id>/` has at least one file in the manifest. */
function trackHasStudioTakesContent(trackId) {
  return manifestAlternateFilesForTrack(trackId).length > 0;
}

function absSrc(pathOrUrl) {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return `${location.origin}${pathOrUrl}`;
  return `${location.origin}/${pathOrUrl}`;
}

function playSong() {
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "studio-play-debug",
      hypothesisId: "H2,H4",
      location: "script.js:playSong:entry",
      message: "playSong called",
      data: {
        mode,
        paused: music.paused,
        currentSrc: music.currentSrc || "",
        datasetSrc: music.dataset.playlistSrc || "",
        readyState: music.readyState,
        currentTime: music.currentTime,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  playIcon.classList.replace("fa-play", "fa-pause");
  playBtn.setAttribute("title", "Pause");
  playBtn.querySelector(".sr-only").textContent = "Pause";
  const p = music.play();
  if (p !== undefined) {
    p
      .then(() => {
        isPlaying = true;
        // #region agent log
        fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
          body: JSON.stringify({
            sessionId: "505fcf",
            runId: "studio-play-debug",
            hypothesisId: "H4",
            location: "script.js:playSong:resolved",
            message: "play resolved",
            data: {
              mode,
              currentSrc: music.currentSrc || "",
              datasetSrc: music.dataset.playlistSrc || "",
              readyState: music.readyState,
              currentTime: music.currentTime,
              paused: music.paused,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      })
      .catch((err) => {
        isPlaying = false;
        playIcon.classList.replace("fa-pause", "fa-play");
        playBtn.setAttribute("title", "Play");
        playBtn.querySelector(".sr-only").textContent = "Play";
        // #region agent log
        fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
          body: JSON.stringify({
            sessionId: "505fcf",
            runId: "studio-play-debug",
            hypothesisId: "H4",
            location: "script.js:playSong:rejected",
            message: "play rejected",
            data: {
              mode,
              currentSrc: music.currentSrc || "",
              datasetSrc: music.dataset.playlistSrc || "",
              readyState: music.readyState,
              currentTime: music.currentTime,
              paused: music.paused,
              errorName: err && err.name ? err.name : "",
              errorMessage: err && err.message ? err.message : "",
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      });
  } else {
    isPlaying = true;
  }
}

function pauseSong() {
  isPlaying = false;
  playIcon.classList.replace("fa-pause", "fa-play");
  playBtn.setAttribute("title", "Play");
  playBtn.querySelector(".sr-only").textContent = "Play";
  music.pause();
}

function loadAndPrime(src, title, artist, downloadName) {
  titleEl.textContent = title;
  artistEl.textContent = artist;
  const abs = absSrc(src);
  music.dataset.playlistSrc = src;
  music.src = abs;
  music.load();
  downloadLink.href = abs;
  if (downloadName) downloadLink.setAttribute("download", downloadName);
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "seek-debug",
      hypothesisId: "H2",
      location: "script.js:loadAndPrime",
      message: "player source loaded",
      data: { mode, src, abs, downloadName: downloadName || "", readyState: music.readyState },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function setPlaylistTitle(text) {
  if (!playlistTitleEl) return;
  const t = text.trim();
  if (mode === null) {
    playlistTitleEl.classList.remove("playlist-album-title--with-back");
    playlistTitleEl.textContent = t;
  } else {
    playlistTitleEl.classList.add("playlist-album-title--with-back");
    playlistTitleEl.innerHTML = "";
    const arrow = document.createElement("span");
    arrow.className = "playlist-back-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "‹";
    const label = document.createElement("span");
    label.className = "playlist-album-title-text";
    label.textContent = t;
    playlistTitleEl.appendChild(arrow);
    playlistTitleEl.appendChild(label);
  }
}

/** Return to mode picker (iteration / Studio Takes tiles). */
function goToPickMode() {
  mode = null;
  studioTakesView = null;
  songIndex = 0;
  pauseSong();
  music.removeAttribute("src");
  delete music.dataset.playlistSrc;
  music.load();
  applyPickModeShell();
  playerMainEl?.classList.add("player-main--pick-mode");
  hidePlayerChrome();
  if (downloadLink) {
    downloadLink.href = "#";
    downloadLink.removeAttribute("download");
  }
  if (titleEl) titleEl.textContent = "";
  if (artistEl) artistEl.textContent = "";
  renderPlaylist();
  syncPlaylistDrawer();
  playlistToggle?.setAttribute("aria-label", "Choose how to listen");
}

/** @type {Map<string, number>} */
const durationCacheSeconds = new Map();

/** Bounded parallel `<audio>` metadata probes (~6 HTTP connections/host; metadata responses are tiny). */
const durationProbeQueue = [];
let durationProbeActive = 0;
const DURATION_PROBE_PARALLEL = 5;
/** Src values already queued (not yet running). */
const durationProbeQueuedSrc = new Set();

function pumpDurationProbeQueue() {
  while (
    durationProbeActive < DURATION_PROBE_PARALLEL &&
    durationProbeQueue.length > 0
  ) {
    const job = durationProbeQueue.shift();
    if (!job) break;
    durationProbeQueuedSrc.delete(job.src);
    durationProbeActive++;
    runSingleDurationProbe(job.src, job.opts, () => {
      durationProbeActive--;
      pumpDurationProbeQueue();
    });
  }
}

function formatDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function setPlaylistItemDurationBySrc(src, seconds) {
  playlistEl.querySelectorAll(".playlist-item[data-src]").forEach((li) => {
    if (li.dataset.src !== src) return;
    const el = li.querySelector(".playlist-item-duration");
    if (el) el.textContent = formatDuration(seconds);
  });
}

/**
 * Warm playlist duration labels from a lightweight metadata load.
 * @param {string} src Path relative to origin (e.g. `/music/01 - ….mp3`).
 * @param {{ force?: boolean }} [opts] Pass `force: true` after replacing files at the same URL so we re-read length.
 */
function ensureTrackDuration(src, opts = {}) {
  if (opts.force) {
    durationCacheSeconds.delete(src);
    for (let i = durationProbeQueue.length - 1; i >= 0; i--) {
      if (durationProbeQueue[i].src === src) {
        durationProbeQueue.splice(i, 1);
        durationProbeQueuedSrc.delete(src);
      }
    }
  }
  if (durationCacheSeconds.has(src)) return;
  if (durationProbeQueuedSrc.has(src)) return;

  durationProbeQueuedSrc.add(src);
  durationProbeQueue.push({ src, opts });
  pumpDurationProbeQueue();
}

function runSingleDurationProbe(src, opts, releaseSlot) {
  const probe = new Audio();
  probe.preload = "metadata";
  const base = absSrc(src);
  probe.src = opts.force ? `${base}${src.includes("?") ? "&" : "?"}_probe=${Date.now()}` : base;

  let released = false;
  let settleTimer = 0;
  /** Free the probe slot as soon as we have a length; drop `src` shortly after (keeps the queue moving). */
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(settleTimer);
    detachListeners();
    releaseSlot();
    settleTimer = setTimeout(() => {
      try {
        probe.removeAttribute("src");
        probe.load();
      } catch {
        /* ignore */
      }
    }, 400);
  };

  let applied = false;
  const applyMeta = () => {
    const d = probe.duration;
    if (!d || !isFinite(d)) return;
    durationCacheSeconds.set(src, d);
    setPlaylistItemDurationBySrc(src, d);
    if (!applied) {
      applied = true;
      release();
    }
  };

  const detachListeners = () => {
    probe.removeEventListener("loadedmetadata", applyMeta);
    probe.removeEventListener("durationchange", applyMeta);
    probe.removeEventListener("canplay", applyMeta);
  };

  probe.addEventListener("loadedmetadata", applyMeta);
  probe.addEventListener("durationchange", applyMeta);
  probe.addEventListener("canplay", applyMeta);
  probe.addEventListener(
    "error",
    () => {
      durationCacheSeconds.set(src, NaN);
      setPlaylistItemDurationBySrc(src, NaN);
      release();
    },
    { once: true },
  );
  setTimeout(release, 45000);
}

/** Warm the durations for any flat playlist rows that currently resolve to real files. */
function warmFlatTrackDurations(tracks) {
  tracks.forEach((t) => {
    if (t.src) ensureTrackDuration(t.src);
  });
}

/** After studio-takes `files.json` loads, probe each listed file. */
function warmStudioTakesDurationsFromManifest() {
  albumTrackDefs.forEach((t) => {
    manifestAlternateFilesForTrack(t.id).forEach((fn) => {
      ensureTrackDuration(studioTakeFileSrc(t.id, fn));
    });
  });
}

/** When the main player loads a file, treat its duration as source of truth for that row (fixes stale probe/cache). */
function syncPlaylistRowDurationFromPlayer() {
  const key = music.dataset.playlistSrc;
  if (!key) return;
  const d = music.duration;
  if (!d || !isFinite(d)) return;
  durationCacheSeconds.set(key, d);
  setPlaylistItemDurationBySrc(key, d);
}

function clearPlaylistActive() {
  playlistEl.querySelectorAll(".playlist-item").forEach((li) => {
    li.classList.remove("is-active");
    li.setAttribute("aria-selected", "false");
  });
}

function setActivePlaylistIndex(i) {
  playlistEl.querySelectorAll(".playlist-item").forEach((li, idx) => {
    const on = idx === i;
    li.classList.toggle("is-active", on);
    li.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function firstPlayableIndex(tracks) {
  return tracks.findIndex((track) => !!track.src);
}

function advancePlayableIndex(tracks, currentIndex, delta) {
  if (!tracks.some((track) => !!track.src)) return -1;
  let next = currentIndex;
  for (let i = 0; i < tracks.length; i++) {
    next += delta;
    if (next < 0) next = tracks.length - 1;
    if (next > tracks.length - 1) next = 0;
    if (tracks[next] && tracks[next].src) return next;
  }
  return -1;
}

function renderModePickerList() {
  playlistEl.innerHTML = "";
  playlistEl.setAttribute("role", "list");

  const rows = [
    { mode: /** @type {const} */ ("iteration1"), title: "iteration 1", sub: "Early Demo Passes", era: "Fall 2020" },
    { mode: /** @type {const} */ ("iteration2"), title: "iteration 2", sub: "Most Recent Demos", era: "Fall 2021" },
    { mode: /** @type {const} */ ("studioTakes"), title: "Studio Takes", sub: "Various Takes of Each Track", era: "Summer 2022" },
  ];

  rows.forEach(({ mode: m, title, sub, era }) => {
    const li = document.createElement("li");
    li.setAttribute("role", "listitem");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "playlist-item playlist-item--mode";
    btn.setAttribute("aria-label", `${title}: ${sub}: ${era}`);

    const labelWrap = document.createElement("span");
    labelWrap.className = "playlist-item-mode-label";

    const name = document.createElement("span");
    name.className = "playlist-item-name";
    name.textContent = title;

    const subEl = document.createElement("span");
    subEl.className = "playlist-item-subline";
    subEl.textContent = sub;

    const eraEl = document.createElement("span");
    eraEl.className = "playlist-item-tertiary";
    eraEl.textContent = era;

    labelWrap.appendChild(name);
    labelWrap.appendChild(subEl);
    labelWrap.appendChild(eraEl);

    const spacer = document.createElement("span");
    spacer.className = "playlist-item-duration playlist-item-mode-spacer";
    spacer.setAttribute("aria-hidden", "true");

    btn.appendChild(labelWrap);
    btn.appendChild(spacer);
    btn.addEventListener("click", () => setMode(m));

    li.appendChild(btn);
    playlistEl.appendChild(li);
  });
}

/**
 * @param {{ id: string, displayName: string, artist: string, src: string, downloadName: string }[]} tracks
 */
function renderAlbumListForFlatMode(tracks) {
  playlistEl.innerHTML = "";
  playlistEl.setAttribute("role", "listbox");
  tracks.forEach((track, i) => {
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.src = track.src;

    const name = document.createElement("span");
    name.className = "playlist-item-name";
    name.textContent = track.displayName;

    const duration = document.createElement("span");
    duration.className = "playlist-item-duration";
    const cached = durationCacheSeconds.get(track.src);
    duration.textContent = cached ? formatDuration(cached) : "";

    li.appendChild(name);
    li.appendChild(duration);
    if (!track.src) {
      li.classList.add("playlist-item--disabled");
      li.setAttribute("aria-disabled", "true");
    } else {
      li.addEventListener("click", () => {
        songIndex = i;
        studioTakesView = null;
        loadAndPrime(track.src, track.displayName, track.artist, track.downloadName);
        setActivePlaylistIndex(songIndex);
        playSong();
      });
    }
    playlistEl.appendChild(li);

    if (track.src) ensureTrackDuration(track.src);
  });
  setActivePlaylistIndex(songIndex);
}

/**
 * @param {{ skipManifestRefresh?: boolean }} [options]
 * If true, do not refetch `files.json` (used after the manifest load completes).
 */
function renderStudioTakesAlbumList(options = {}) {
  const { skipManifestRefresh = false } = options;
  playlistEl.innerHTML = "";
  playlistEl.setAttribute("role", "listbox");
  if (titleEl) titleEl.textContent = "";
  if (artistEl) artistEl.textContent = "";
  updateProgressBar();
  iteration1Tracks.forEach((track, i) => {
    const li = document.createElement("li");
    li.className = "playlist-item playlist-item--versions-index";
    li.setAttribute("role", "option");
    li.tabIndex = -1;

    const labelWrap = document.createElement("span");
    labelWrap.className = "playlist-item-versions-label";

    const name = document.createElement("span");
    name.className = "playlist-item-name";
    name.textContent = track.displayName;

    const cue = document.createElement("span");
    cue.className = "playlist-item-versions-cue";
    cue.setAttribute("aria-hidden", "true");

    const browsable = trackHasStudioTakesContent(track.id);
    if (!browsable) {
      li.classList.add("playlist-item--disabled");
      li.setAttribute("aria-disabled", "true");
      const sub = document.createElement("span");
      sub.className = "playlist-item-subline";
      sub.textContent = "No takes yet";
      labelWrap.appendChild(name);
      labelWrap.appendChild(sub);
      cue.textContent = "";
    } else {
      cue.textContent = "›";
      li.setAttribute("aria-label", `Open studio takes for ${track.displayName}`);
      li.addEventListener("click", () => {
        // #region agent log
        fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
          body: JSON.stringify({
            sessionId: "505fcf",
            runId: "studio-play-debug",
            hypothesisId: "H1,H3",
            location: "script.js:renderStudioTakesAlbumList:click",
            message: "studio track folder opened",
            data: {
              trackId: track.id,
              displayName: track.displayName,
              takeCount: studioTakesRowsForTrack(track).length,
              currentSrc: music.currentSrc || "",
              datasetSrc: music.dataset.playlistSrc || "",
              songIndex,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        studioTakesView = { trackIndex: i };
        songIndex = 0;
        renderPlaylist();
      });
      labelWrap.appendChild(name);
    }
    li.appendChild(labelWrap);
    li.appendChild(cue);

    playlistEl.appendChild(li);
  });
  clearPlaylistActive();
  if (!skipManifestRefresh) {
    scheduleStudioTakesManifestRefresh();
  }
}

function renderStudioTakesTrackList(trackIndex) {
  const track = iteration1Tracks[trackIndex];
  if (titleEl) titleEl.textContent = track.displayName;
  if (artistEl) artistEl.textContent = track.artist;
  updateProgressBar();
  const takes = studioTakesRowsForTrack(track);
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "studio-play-debug",
      hypothesisId: "H1,H3",
      location: "script.js:renderStudioTakesTrackList",
      message: "studio takes list rendered",
      data: {
        trackId: track.id,
        displayName: track.displayName,
        takeCount: takes.length,
        songIndex,
        currentSrc: music.currentSrc || "",
        datasetSrc: music.dataset.playlistSrc || "",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  playlistEl.innerHTML = "";
  playlistEl.setAttribute("role", "listbox");
  takes.forEach((v, i) => {
    const li = document.createElement("li");
    li.className = "playlist-item";
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.src = v.src;

    const name = document.createElement("span");
    name.className = "playlist-item-name";
    name.textContent = v.label;

    const duration = document.createElement("span");
    duration.className = "playlist-item-duration";
    const cached = durationCacheSeconds.get(v.src);
    duration.textContent = cached ? formatDuration(cached) : "";

    li.appendChild(name);
    li.appendChild(duration);
    li.addEventListener("click", () => {
      // #region agent log
      fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
        body: JSON.stringify({
          sessionId: "505fcf",
          runId: "studio-play-debug",
          hypothesisId: "H1,H4",
          location: "script.js:renderStudioTakesTrackList:takeClick",
          message: "studio take clicked",
          data: {
            trackId: track.id,
            takeLabel: v.label,
            src: v.src,
            index: i,
            currentSrcBefore: music.currentSrc || "",
            datasetSrcBefore: music.dataset.playlistSrc || "",
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      songIndex = i;
      showPlayerChrome();
      loadAndPrime(v.src, track.displayName, track.artist, v.downloadName || `${track.displayName} - ${v.label}.mp3`);
      setActivePlaylistIndex(songIndex);
      playSong();
    });

    playlistEl.appendChild(li);
    ensureTrackDuration(v.src);
  });
  const currentPlaylistSrc = music.dataset.playlistSrc || "";
  if (takes.length > 0 && !takes.some((take) => take.src === currentPlaylistSrc)) {
    const firstTake = takes[0];
    songIndex = 0;
    loadAndPrime(firstTake.src, track.displayName, track.artist, firstTake.downloadName || `${track.displayName} - ${firstTake.label}.mp3`);
    // #region agent log
    fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
      body: JSON.stringify({
        sessionId: "505fcf",
        runId: "post-fix",
        hypothesisId: "H1,H2,H3",
        location: "script.js:renderStudioTakesTrackList:defaultLoad",
        message: "default studio take loaded",
        data: {
          trackId: track.id,
          takeLabel: firstTake.label,
          src: firstTake.src,
          downloadName: firstTake.downloadName || "",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }
  setActivePlaylistIndex(songIndex);
}

function renderPlaylist() {
  if (mode === null) {
    setPlaylistTitle(ALBUM_TITLE);
    renderModePickerList();
    return;
  }
  // Title line + playlist contents depend on mode / drilldown state
  if (mode === "iteration1") {
    studioTakesView = null;
    setPlaylistTitle(ALBUM_TITLE);
    renderAlbumListForFlatMode(iteration1Tracks);
    return;
  }
  if (mode === "iteration2") {
    studioTakesView = null;
    setPlaylistTitle(ALBUM_TITLE);
    renderAlbumListForFlatMode(iteration2Tracks);
    return;
  }

  if (mode === "studioTakes") {
    if (studioTakesView && iteration1Tracks[studioTakesView.trackIndex]) {
      const track = iteration1Tracks[studioTakesView.trackIndex];
      setPlaylistTitle(track.displayName);
      renderStudioTakesTrackList(studioTakesView.trackIndex);
    } else {
      setPlaylistTitle(STUDIO_TAKES_LIST_TITLE);
      renderStudioTakesAlbumList();
    }
  }
}

const playerChromeEl = document.getElementById("player-chrome");
const playerTransportEl = document.getElementById("player-transport");
const playerDownloadRowEl = document.getElementById("player-download-row");

function hidePlayerChrome() {
  playerChromeEl?.setAttribute("hidden", "");
  playerTransportEl?.setAttribute("hidden", "");
  playerDownloadRowEl?.setAttribute("hidden", "");
}

function showPlayerChrome() {
  playerShell?.classList.remove("player-shell--pick-mode");
  playerMainEl?.classList.remove("player-main--pick-mode");
  playerChromeEl?.removeAttribute("hidden");
  playerTransportEl?.removeAttribute("hidden");
  playerDownloadRowEl?.removeAttribute("hidden");
}

function applyPickModeShell() {
  if (mode === null) {
    playerShell?.classList.add("player-shell--pick-mode");
  } else {
    playerShell?.classList.remove("player-shell--pick-mode");
  }
}

function setMode(nextMode) {
  mode = nextMode;
  applyPickModeShell();
  playerMainEl?.classList.remove("player-main--pick-mode");
  studioTakesView = null;
  songIndex = 0;
  if (mode === "iteration1") {
    scheduleFlatManifestRefresh("iteration1");
    showPlayerChrome();
    const firstIndex = firstPlayableIndex(iteration1Tracks);
    if (firstIndex >= 0) {
      songIndex = firstIndex;
      const first = iteration1Tracks[firstIndex];
      loadAndPrime(first.src, first.displayName, first.artist, first.downloadName);
    } else {
      pauseSong();
      music.removeAttribute("src");
      delete music.dataset.playlistSrc;
      music.load();
      if (titleEl) titleEl.textContent = "";
      if (artistEl) artistEl.textContent = "";
      updateProgressBar();
    }
  } else if (mode === "iteration2") {
    if (Object.keys(iteration2ManifestCurrent).length === 0) {
      scheduleFlatManifestRefresh("iteration2");
    }
    showPlayerChrome();
    const firstIndex = firstPlayableIndex(iteration2Tracks);
    if (firstIndex >= 0) {
      songIndex = firstIndex;
      const first = iteration2Tracks[firstIndex];
      loadAndPrime(first.src, first.displayName, first.artist, first.downloadName);
    } else {
      pauseSong();
      music.removeAttribute("src");
      delete music.dataset.playlistSrc;
      music.load();
      if (titleEl) titleEl.textContent = "";
      if (artistEl) artistEl.textContent = "";
      updateProgressBar();
    }
  } else if (mode === "studioTakes") {
    showPlayerChrome();
    pauseSong();
    music.removeAttribute("src");
    delete music.dataset.playlistSrc;
    music.load();
    if (titleEl) titleEl.textContent = "";
    if (artistEl) artistEl.textContent = "";
    updateProgressBar();
  }
  renderPlaylist();
  syncPlaylistDrawer();
  if (playlistToggle && mode !== null) {
    playlistToggle.setAttribute("aria-label", "Back to mode selection");
  }
}

function step(delta) {
  if (mode === null) return;
  if (mode === "iteration1") {
    const nextIndex = advancePlayableIndex(iteration1Tracks, songIndex, delta);
    if (nextIndex < 0) return;
    songIndex = nextIndex;
    const track = iteration1Tracks[songIndex];
    loadAndPrime(track.src, track.displayName, track.artist, track.downloadName);
    setActivePlaylistIndex(songIndex);
    playSong();
    return;
  }
  if (mode === "iteration2") {
    const nextIndex = advancePlayableIndex(iteration2Tracks, songIndex, delta);
    if (nextIndex < 0) return;
    songIndex = nextIndex;
    const track = iteration2Tracks[songIndex];
    loadAndPrime(track.src, track.displayName, track.artist, track.downloadName);
    setActivePlaylistIndex(songIndex);
    playSong();
    return;
  }

  if (mode !== "studioTakes" || !studioTakesView) return;
  const track = iteration1Tracks[studioTakesView.trackIndex];
  const takes = studioTakesRowsForTrack(track);
  if (takes.length === 0) return;

  songIndex += delta;
  if (songIndex < 0) songIndex = takes.length - 1;
  if (songIndex > takes.length - 1) songIndex = 0;
  const v = takes[songIndex];
  loadAndPrime(v.src, track.displayName, track.artist, v.downloadName || `${track.displayName} - ${v.label}.mp3`);
  setActivePlaylistIndex(songIndex);
  playSong();
}

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function updateProgressBar() {
  const { duration, currentTime } = music;
  if (!duration || !isFinite(duration)) {
    progress.style.width = "0%";
    durationEle.textContent = "0:00";
    currentTimeEle.textContent = formatTime(currentTime);
    return;
  }
  const progressPercent = (currentTime / duration) * 100;
  progress.style.width = `${progressPercent}%`;
  durationEle.textContent = formatTime(duration);
  currentTimeEle.textContent = formatTime(currentTime);
}

function setProgressBar(e) {
  const width = progressContainer.clientWidth;
  const clickX = e.offsetX;
  const { duration } = music;
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "seek-debug",
      hypothesisId: "H1,H2,H3",
      location: "script.js:setProgressBar:entry",
      message: "progress bar clicked",
      data: {
        mode,
        width,
        clickX,
        duration,
        currentTime: music.currentTime,
        readyState: music.readyState,
        paused: music.paused,
        src: music.currentSrc || music.src || "",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!duration || !isFinite(duration) || !width) {
    // #region agent log
    fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
      body: JSON.stringify({
        sessionId: "505fcf",
        runId: "seek-debug",
        hypothesisId: "H2,H3",
        location: "script.js:setProgressBar:abort",
        message: "seek aborted",
        data: { duration, width, currentTime: music.currentTime, readyState: music.readyState },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return;
  }
  const nextTime = (clickX / width) * duration;
  music.currentTime = nextTime;
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "seek-debug",
      hypothesisId: "H3,H4",
      location: "script.js:setProgressBar:assigned",
      message: "seek assigned",
      data: { width, clickX, duration, nextTime, currentTimeAfterAssign: music.currentTime, seekable: music.seekable.length },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

playBtn.addEventListener("click", () => {
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "studio-play-debug",
      hypothesisId: "H2,H4",
      location: "script.js:playBtn:click",
      message: "play button clicked",
      data: {
        mode,
        isPlaying,
        currentSrc: music.currentSrc || "",
        datasetSrc: music.dataset.playlistSrc || "",
        readyState: music.readyState,
        paused: music.paused,
        currentTime: music.currentTime,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (mode === null) return;
  isPlaying ? pauseSong() : playSong();
});
prevBtn.addEventListener("click", () => step(-1));
nextBtn.addEventListener("click", () => step(1));

music.addEventListener("timeupdate", updateProgressBar);
music.addEventListener("loadedmetadata", () => {
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "seek-debug",
      hypothesisId: "H2",
      location: "script.js:loadedmetadata",
      message: "metadata loaded",
      data: {
        duration: music.duration,
        currentTime: music.currentTime,
        readyState: music.readyState,
        seekable: music.seekable.length,
        src: music.currentSrc || music.src || "",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  syncPlaylistRowDurationFromPlayer();
  updateProgressBar();
});
music.addEventListener("loadeddata", updateProgressBar);
music.addEventListener("durationchange", () => {
  syncPlaylistRowDurationFromPlayer();
  updateProgressBar();
});
music.addEventListener("canplay", updateProgressBar);
music.addEventListener("ended", () => {
  if (mode === null) return;
  // Explicitly advance on end; some browsers won't continue without this.
  step(1);
});
music.addEventListener("error", () => {
  if (music.error) {
    console.warn("Audio error", music.error.code, music.error.message, music.src);
  }
});
music.addEventListener("seeked", () => {
  // #region agent log
  fetch("http://127.0.0.1:7357/ingest/0f7642a4-1bac-474e-a702-30ee67b48ba4", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "505fcf" },
    body: JSON.stringify({
      sessionId: "505fcf",
      runId: "seek-debug",
      hypothesisId: "H4",
      location: "script.js:seeked",
      message: "seek completed",
      data: {
        currentTime: music.currentTime,
        duration: music.duration,
        readyState: music.readyState,
        src: music.currentSrc || music.src || "",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
});
progressContainer.addEventListener("click", setProgressBar);

progressContainer.addEventListener("keydown", (e) => {
  const d = music.duration;
  if (!d || !isFinite(d)) return;
  if (e.key === "ArrowRight" || e.key === "ArrowUp") {
    e.preventDefault();
    music.currentTime = Math.min(d, music.currentTime + 5);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
    e.preventDefault();
    music.currentTime = Math.max(0, music.currentTime - 5);
  }
});

const playlistToggle = document.getElementById("playlist-toggle");
const playlistPanel = document.getElementById("playlist-panel");
const NARROW_SHELL_PX = 440;

/** Matches `@container player (max-width: 440px)` — content-box inline size, not clientWidth (padding broke hide/show). */
function playerShellContentInlineSize(shell) {
  if (!shell) return Infinity;
  const style = getComputedStyle(shell);
  const rect = shell.getBoundingClientRect();
  const bl = parseFloat(style.borderLeftWidth) || 0;
  const br = parseFloat(style.borderRightWidth) || 0;
  const pl = parseFloat(style.paddingLeft) || 0;
  const pr = parseFloat(style.paddingRight) || 0;
  return Math.max(0, rect.width - bl - br - pl - pr);
}

function syncPlaylistDrawer() {
  if (!playerShell || !playlistToggle || !playlistPanel) return;

  const narrow = playerShellContentInlineSize(playerShell) <= NARROW_SHELL_PX;

  // #region agent log
  {
    const sh = playerShell.getBoundingClientRect().height;
    const ih =
      playerShell.querySelector(".player-shell-inner")?.getBoundingClientRect().height ?? 0;
    fetch("http://127.0.0.1:7626/ingest/fcca8389-a788-4691-a60a-d529e0a47596", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b5d82f" },
      body: JSON.stringify({
        sessionId: "b5d82f",
        runId: "viewport-card",
        hypothesisId: "H5",
        location: "script.js:syncPlaylistDrawer",
        message: "drawer sync",
        data: {
          mode,
          narrow,
          playlistExpanded: playerShell.classList.contains("playlist-expanded"),
          panelParentId: playlistPanel.parentElement?.id || null,
          vpH: typeof window !== "undefined" ? Math.round(window.innerHeight) : null,
          shellH: Math.round(sh),
          innerH: Math.round(ih),
          shellMaxH: getComputedStyle(playerShell).maxHeight,
          shellOverflow: getComputedStyle(playerShell).overflow,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  if (mode === null && narrow) {
    playlistToggle.setAttribute("aria-expanded", "true");
    syncPickPlaylistPanelSlot();
    return;
  }

  if (!narrow) {
    playlistToggle.setAttribute("aria-expanded", "true");
    playerShell.classList.remove("playlist-expanded");
  } else {
    if (mode !== null) {
      playerShell.classList.add("playlist-expanded");
    }
    const open = playerShell.classList.contains("playlist-expanded");
    playlistToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  syncPickPlaylistPanelSlot();
}

/**
 * Narrow pick: keep #playlist-panel inside #player-main so absolute inset is clipped to the
 * hero image (WebKit often mis-sizes abspos grid children against the full shell).
 */
function syncPickPlaylistPanelSlot() {
  if (!playerShell || !playlistPanel || !playerMainEl) return;
  const suite = playerShell.querySelector(".playlist-suite");
  const header = suite?.querySelector(".playlist-header");
  if (!suite || !header) {
    // #region agent log
    fetch("http://127.0.0.1:7626/ingest/fcca8389-a788-4691-a60a-d529e0a47596", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b5d82f" },
      body: JSON.stringify({
        sessionId: "b5d82f",
        runId: "pre-fix",
        hypothesisId: "H4",
        location: "script.js:syncPickPlaylistPanelSlot",
        message: "early return: missing suite or header",
        data: {
          hasSuite: !!suite,
          hasHeader: !!header,
          mode,
          panelParentId: playlistPanel.parentElement?.id || null,
          panelInMain: playlistPanel.parentElement === playerMainEl,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return;
  }

  const narrow = playerShellContentInlineSize(playerShell) <= NARROW_SHELL_PX;
  const pick = mode === null;

  if (pick && narrow) {
    if (playlistPanel.parentElement !== playerMainEl) {
      playerMainEl.appendChild(playlistPanel);
    }
    // #region agent log
    {
      const cs = getComputedStyle(playerMainEl);
      const r = playerMainEl.getBoundingClientRect();
      fetch("http://127.0.0.1:7626/ingest/fcca8389-a788-4691-a60a-d529e0a47596", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b5d82f" },
        body: JSON.stringify({
          sessionId: "b5d82f",
          runId: "pre-fix",
          hypothesisId: "H1",
          location: "script.js:syncPickPlaylistPanelSlot",
          message: "after pick+narrow branch",
          data: {
            mode,
            pick,
            narrow,
            panelParentId: playlistPanel.parentElement?.id || null,
            shellPickClass: playerShell.classList.contains("player-shell--pick-mode"),
            aspectRatio: cs.aspectRatio,
            mainW: Math.round(r.width),
            mainH: Math.round(r.height),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
    return;
  }

  if (playlistPanel.parentElement === playerMainEl) {
    header.insertAdjacentElement("afterend", playlistPanel);
  }
  // #region agent log
  {
    const cs = getComputedStyle(playerMainEl);
    const r = playerMainEl.getBoundingClientRect();
    fetch("http://127.0.0.1:7626/ingest/fcca8389-a788-4691-a60a-d529e0a47596", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b5d82f" },
      body: JSON.stringify({
        sessionId: "b5d82f",
        runId: "pre-fix",
        hypothesisId: "H1",
        location: "script.js:syncPickPlaylistPanelSlot",
        message: "after restore / non-pick path",
        data: {
          mode,
          pick,
          narrow,
          panelParentId: playlistPanel.parentElement?.id || null,
          panelInMainWhileListening: mode !== null && playlistPanel.parentElement === playerMainEl,
          shellPickClass: playerShell.classList.contains("player-shell--pick-mode"),
          aspectRatio: cs.aspectRatio,
          mainW: Math.round(r.width),
          mainH: Math.round(r.height),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion
}

if (playerShell && playlistToggle && playlistPanel) {
  playlistToggle.addEventListener("click", () => {
    if (mode === null) return;
    goToPickMode();
  });

  const shellRo = new ResizeObserver(() => syncPlaylistDrawer());
  shellRo.observe(playerShell);
}

// Initial load: fetch dynamic manifests only for views that still need them at runtime.
scheduleFlatManifestRefresh("iteration1");
scheduleStudioTakesManifestRefresh();
applyPickModeShell();
renderPlaylist();
syncPlaylistDrawer();
