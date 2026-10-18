/* A small slippy-map engine: Web Mercator tiles on a canvas, drag to pan,
   wheel or pinch to zoom, fly-to, and a hook for later layers to draw on top.
   Written here rather than using Leaflet so the console has no dependencies
   and runs offline from a plain folder.

   Tiles are read from tiles/<source>/<z>/<x>/<y>.<ext>, as saved by
   tools/fetch_tiles.py. Each basemap lists the boxes and zooms it has on disk
   (its coverage), so different basemaps can cover different areas.

   To keep the picture seamless: a coarser level is drawn underneath first, so
   there are never holes while sharper tiles load; new tiles fade in rather than
   pop; and tile edges are snapped to whole device pixels so no hairline seams
   show between neighbours. */

window.OpsMap = function (container, cfg) {
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const TILE = 256;
  const BOX = cfg.box, DETAIL = cfg.detailBox;            // [west, south, east, north]
  // overlay: another basemap drawn on top of the base, e.g. chart lines over satellite.
  const state = { lat: cfg.center[0], lon: cfg.center[1], zoom: cfg.zoom, basemap: cfg.basemap, overlay: null, overlayOpacity: 0.7 };
  let W = 0, H = 0, dpr = 1, dirty = true, anim = null;
  const cache = new Map();
  const drawHooks = [], listeners = {};
  const stats = { loaded: 0, missing: 0 };

  // ---------- projection ----------
  const wx = (lon, z) => (lon + 180) / 360 * TILE * 2 ** z;
  const wy = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * TILE * 2 ** z;
  const lonOf = (x, z) => x / (TILE * 2 ** z) * 360 - 180;
  const latOf = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (TILE * 2 ** z)))) * 180 / Math.PI;
  function project(lat, lon) {
    const z = state.zoom;
    return [wx(lon, z) - wx(state.lon, z) + W / 2, wy(lat, z) - wy(state.lat, z) + H / 2];
  }
  function unproject(px, py) {
    const z = state.zoom;
    return [latOf(wy(state.lat, z) + py - H / 2, z), lonOf(wx(state.lon, z) + px - W / 2, z)];
  }
  const metresPerPx = () => 156543.03392 * Math.cos(state.lat * Math.PI / 180) / 2 ** state.zoom;

  // ---------- limits: stay inside the active basemap's downloaded area ----------
  const bounds = () => src().bounds || BOX;
  function minZoom() {
    const BOX = bounds();
    // "Cover", not "contain": the imagery always fills the map, so no empty edge shows.
    const fit = Math.log2(Math.max(W / (wx(BOX[2], 0) - wx(BOX[0], 0)), H / (wy(BOX[1], 0) - wy(BOX[3], 0))));
    return Math.max(cfg.minZoom, Math.min(cfg.maxZoom, fit));
  }
  function clamp() {
    state.zoom = Math.max(minZoom(), Math.min(cfg.maxZoom, state.zoom));
    const z = state.zoom, BOX = bounds();
    const x0 = wx(BOX[0], z), x1 = wx(BOX[2], z), y0 = wy(BOX[3], z), y1 = wy(BOX[1], z);
    let cx = wx(state.lon, z), cy = wy(state.lat, z);
    cx = x1 - x0 <= W ? (x0 + x1) / 2 : Math.max(x0 + W / 2, Math.min(x1 - W / 2, cx));
    cy = y1 - y0 <= H ? (y0 + y1) / 2 : Math.max(y0 + H / 2, Math.min(y1 - H / 2, cy));
    state.lon = lonOf(cx, z); state.lat = latOf(cy, z);
  }

  // ---------- tiles ----------
  const src = () => cfg.basemaps[state.basemap];
  function onDisk(z, x, y, bm) {
    const inBox = (b) => {
      const n = 2 ** z, t = (lon, lat) => [Math.floor(wx(lon, z) / TILE), Math.floor(wy(lat, z) / TILE)];
      const [a0, b0] = t(b[0], b[3]), [a1, b1] = t(b[2], b[1]);
      return x >= a0 && x <= a1 && y >= b0 && y <= b1 && x < n && y < n;
    };
    const cov = cfg.basemaps[bm || state.basemap].coverage;
    if (cov) return cov.some((c) => z >= c.z[0] && z <= c.z[1] && inBox(c.box));
    if (z < cfg.tileZooms[0]) return false;
    if (z <= cfg.tileZooms[1]) return inBox(BOX);
    return z === cfg.tileZooms[2] && inBox(DETAIL);
  }
  function tile(z, x, y, bm) {
    bm = bm || state.basemap;
    const s = cfg.basemaps[bm], key = `${bm}/${z}/${x}/${y}`;
    let t = cache.get(key);
    if (!t) {
      const img = new Image();
      t = { img, ok: false, bad: false };
      img.onload = () => {
        // Recolour once, on load, rather than filtering every tile on every frame.
        if (s.filter || s.pixels) {
          const c = document.createElement("canvas"); c.width = c.height = TILE;
          const g = c.getContext("2d", { willReadFrequently: !!s.pixels });
          if (s.filter) g.filter = s.filter;
          g.drawImage(img, 0, 0);
          if (s.pixels) { const d = g.getImageData(0, 0, TILE, TILE); s.pixels(d.data); g.putImageData(d, 0, 0); }
          t.img = c;
        }
        t.ok = true; t.t0 = performance.now(); stats.loaded++; dirty = true; emit("tiles", stats);
      };
      img.onerror = () => { t.bad = true; stats.missing++; dirty = true; emit("tiles", stats); };
      img.src = `tiles/${s.dir}/${z}/${x}/${y}.${s.ext}`;
      cache.set(key, t);
    }
    return t;
  }
  // Draw tile (z,x,y) into a screen rectangle, from the sharpest level on disk.
  // fallback: true also uses any loaded ancestor (the underlay pass); false
  // draws only the sharpest level, fading it in (the detail pass).
  const FADE_MS = 220;
  let fading = false;
  function drawTile(z, x, y, r, fallback, bm, alpha = 1) {
    let wanted = true;
    for (let up = 0; up <= 5; up++) {
      const pz = z - up, px = x >> up, py = y >> up;
      if (!onDisk(pz, px, py, bm)) continue;
      const t = tile(pz, px, py, bm);
      if (!t.ok) { if (!fallback && wanted) return false; wanted = false; continue; }
      const part = TILE / 2 ** up, ox = (x - (px << up)) * part, oy = (y - (py << up)) * part;
      const f = fallback ? 1 : Math.min(1, (performance.now() - t.t0) / FADE_MS);
      if (f < 1) fading = true;
      const a = f * alpha;
      ctx.globalAlpha = a;
      ctx.drawImage(t.img, ox, oy, part, part, r[0], r[1], r[2], r[3]);
      ctx.globalAlpha = 1;
      return true;
    }
    return false;
  }
  // Draw every tile of level tz that covers the view, with edges on whole device pixels.
  function drawLevel(tz, fallback, bm, alpha) {
    const z = state.zoom, scale = 2 ** (z - tz);
    const cx = wx(state.lon, tz), cy = wy(state.lat, tz);
    const x0 = Math.floor((cx - W / 2 / scale) / TILE), x1 = Math.floor((cx + W / 2 / scale) / TILE);
    const y0 = Math.floor((cy - H / 2 / scale) / TILE), y1 = Math.floor((cy + H / 2 / scale) / TILE);
    const snap = (v) => Math.round(v * dpr) / dpr;
    const sx = (x) => snap((x * TILE - cx) * scale + W / 2), sy = (y) => snap((y * TILE - cy) * scale + H / 2);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const l = sx(x), t = sy(y);
      drawTile(tz, x, y, [l, t, sx(x + 1) - l, sy(y + 1) - t], fallback, bm, alpha);
    }
  }

  // ---------- draw ----------
  function grid() {
    // Shown under the tiles, and on its own when no tiles are on disk yet.
    ctx.fillStyle = cfg.colors.bg; ctx.fillRect(0, 0, W, H);
    const step = state.zoom > 15 ? 0.005 : state.zoom > 13.5 ? 0.01 : 0.02;
    const [latTop, lonLeft] = unproject(0, 0), [latBot, lonRight] = unproject(W, H);
    ctx.strokeStyle = cfg.colors.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (let lon = Math.ceil(lonLeft / step) * step; lon < lonRight; lon += step) { const [x] = project(latTop, lon); ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let lat = Math.ceil(latBot / step) * step; lat < latTop; lat += step) { const [, y] = project(lat, lonLeft); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid();
    const z = state.zoom;
    const tz = Math.max(cfg.tileZooms[0], Math.min(cfg.tileZooms[2], Math.round(z)));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    fading = false;
    // Clip to the basemap's bounds, so imagery ends on a clean straight edge rather
    // than the stair-step of whole tiles.
    const b = bounds(), [bl, bt] = project(b[3], b[0]), [br, bb] = project(b[1], b[2]);
    ctx.save(); ctx.beginPath(); ctx.rect(bl, bt, br - bl, bb - bt); ctx.clip();
    // Where a source has no data (USGS returns transparent tiles offshore), show its
    // own background colour so the gap blends in instead of showing the grid.
    if (src().fill) { ctx.fillStyle = src().fill; ctx.fillRect(bl, bt, br - bl, bb - bt); }
    // Coarse underlay two levels down (always loaded quickly), then the detail level on top.
    drawLevel(Math.max(cfg.tileZooms[0], tz - 2), true);
    drawLevel(tz, false);
    // Overlay in one pass (any loaded level), so its opacity stays even.
    if (state.overlay && state.overlayOpacity > 0) drawLevel(tz, true, state.overlay, state.overlayOpacity);
    ctx.restore();
    if (fading) dirty = true;
    // Each layer draws in isolation: one failing layer must not blank the map.
    drawHooks.forEach((fn) => { ctx.save(); try { fn(ctx, api); } catch (e) { report(e); } ctx.restore(); });
    // Reduced-motion camera move: the old view fades out over the new one.
    if (xfade) {
      const a = 1 - (performance.now() - xfade.t0) / XFADE_MS;
      if (a <= 0) xfade = null;
      else {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a;
        ctx.drawImage(xfade.snap, 0, 0); ctx.restore(); dirty = true;
      }
    }
  }
  function report(e) {
    console.error("[map]", e);
    if (!container.dataset.drawError) container.dataset.drawError = String(e && e.stack || e).slice(0, 400);
  }
  function frame(now) {
    if (anim) {
      const f = Math.min(1, (now - anim.t0) / anim.ms), e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      state.lat = anim.a[0] + (anim.b[0] - anim.a[0]) * e;
      state.lon = anim.a[1] + (anim.b[1] - anim.a[1]) * e;
      state.zoom = anim.a[2] + (anim.b[2] - anim.a[2]) * e;
      if (f >= 1) anim = null;
      clamp(); dirty = true; emit("move", state);
    }
    if (dirty) { dirty = false; try { draw(); } catch (e) { ctx.restore(); report(e); } }
    requestAnimationFrame(frame);
  }

  // ---------- interaction ----------
  const pointers = new Map();
  let pinch = null, moved = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    anim = null; moved = 0;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: state.zoom }; }
  });
  canvas.addEventListener("pointermove", (e) => {
    emit("cursor", unproject(e.offsetX, e.offsetY));
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAround((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.z + Math.log2(d / pinch.d) - state.zoom);
      return;
    }
    const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1];
    moved += Math.abs(dx) + Math.abs(dy);
    const [lat, lon] = unproject(W / 2 - dx, H / 2 - dy);
    state.lat = lat; state.lon = lon; clamp(); dirty = true; emit("move", state);
    canvas.style.cursor = "grabbing";
  });
  const up = (e) => {
    pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
    canvas.style.cursor = "";
    if (e.type === "pointerup" && moved < 4 && pointers.size === 0) emit("click", { px: e.offsetX, py: e.offsetY, latlon: unproject(e.offsetX, e.offsetY) });
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => emit("cursor", null));
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); anim = null;
    const dz = -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025);
    zoomAround(e.offsetX, e.offsetY, Math.max(-0.5, Math.min(0.5, dz)));
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => { const [lat, lon] = unproject(e.offsetX, e.offsetY); flyTo(lat, lon, state.zoom + 1); });

  function zoomAround(px, py, dz) {
    const before = unproject(px, py);
    state.zoom += dz; clamp();
    const after = unproject(px, py);
    state.lat += before[0] - after[0]; state.lon += before[1] - after[1];
    clamp(); dirty = true; emit("move", state);
  }
  // Under reduced motion, camera moves jump to the target and cross-fade from a
  // snapshot of the old view over 200 ms instead of gliding there.
  const reducedMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const XFADE_MS = 200;
  let xfade = null;
  function flyTo(lat, lon, zoom, ms = 700) {
    const b = [lat, lon, zoom == null ? state.zoom : zoom];
    if (reducedMotion()) {
      anim = null;
      if (W && H) {
        const snap = document.createElement("canvas"); snap.width = canvas.width; snap.height = canvas.height;
        snap.getContext("2d").drawImage(canvas, 0, 0);
        xfade = { snap, t0: performance.now() };
      }
      [state.lat, state.lon, state.zoom] = b;
      clamp(); dirty = true; emit("move", state);
      return;
    }
    anim = { t0: performance.now(), ms, a: [state.lat, state.lon, state.zoom], b };
  }
  function fitBox(b, ms) {
    const z = Math.log2(Math.min(W / (wx(b[2], 0) - wx(b[0], 0)), H / (wy(b[1], 0) - wy(b[3], 0)))) - 0.15;
    flyTo((b[1] + b[3]) / 2, (b[0] + b[2]) / 2, z, ms);
  }

  // ---------- plumbing ----------
  function emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); }
  function resize() {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    clamp(); dirty = true; emit("move", state);
  }
  new ResizeObserver(resize).observe(container);

  const api = {
    state, stats, project, unproject, metresPerPx, flyTo, fitBox, zoomBy: (dz) => zoomAround(W / 2, H / 2, dz),
    setOverlay(id, opacity) {
      state.overlay = id || null;
      if (opacity != null) state.overlayOpacity = opacity;
      dirty = true; emit("overlay", state);
    },
    setBasemap(id) { state.basemap = id; clamp(); dirty = true; emit("basemap", id); emit("move", state); },
    onDraw(fn) { drawHooks.push(fn); dirty = true; },
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    redraw() { dirty = true; },
    renderNow() { dirty = false; draw(); },   // synchronous draw, for tests and stills
    size: () => [W, H],
  };
  resize();
  requestAnimationFrame(frame);
  // One immediate draw once the page has finished setting up (layers register
  // after the map is created), so the first picture never waits on a frame.
  setTimeout(() => { if (dirty) { dirty = false; try { draw(); } catch (e) { report(e); } } }, 0);
  return api;
};
