/* Chart key: NOAA chart features drawn from vector data, each kind with its own
   switch. Data is saved by tools/fetch_enc.py into data/enc.js (window.OpsENC),
   so it works offline. Depths are metres, as NOAA stores them.

   Colours follow nautical-chart convention where it helps reading: magenta for
   cables and restricted areas, red and green for lateral marks, yellow for
   lights. Not for navigation. */

(function () {
  const ENC = window.OpsENC;
  if (!ENC) return;   // data not downloaded: the layer simply does not appear

  // How each category looks, in the key and on the map.
  const STYLE = {
    cables:     { color: "#e05aa8", kind: "line", width: 2, areaDash: [6, 4], areaFill: 0.08 },
    pipelines:  { color: "#c792ea", kind: "area", dash: [2, 3], fill: 0.06 },
    contours:   { color: "#7fb2d9", kind: "line", width: 1, alpha: 0.75 },
    soundings:  { color: "#a9c4d8", kind: "text", minZoom: 15 },
    navaids:    { color: "#f5d76e", kind: "point" },
    anchorages: { color: "#8fb3ff", kind: "area", dash: [8, 4], fill: 0.05 },
    restricted: { color: "#e05aa8", kind: "area", dash: [10, 3, 2, 3], fill: 0.04 },
    hazards:    { color: "#ffffff", kind: "point" },
    routes:     { color: "#cfd8e0", kind: "area", dash: [3, 5], fill: 0, width: 1 },
  };
  const DEFAULT_ON = { cables: true, pipelines: true, navaids: true, hazards: true, routes: true,
    contours: false, soundings: false, anchorages: false, restricted: false };
  // S-57 colour codes for marks: 1 white, 3 red, 4 green, 6 yellow.
  const MARK = { 1: "#f1f4f7", 3: "#ff6b6b", 4: "#4cc38a", 6: "#f5d76e" };

  // Bounding box per feature, so offscreen features are skipped cheaply.
  function bbox(g) {
    let w = 180, s = 90, e = -180, n = -90;
    const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
    if (g) walk(g.coordinates);
    return [w, s, e, n];
  }
  const cats = Object.entries(ENC.categories).map(([key, c]) => ({
    key, label: c.label, style: STYLE[key] || { color: "#fff", kind: "line" },
    feats: c.features.filter((f) => f.geometry).map((f) => ({ ...f, bb: bbox(f.geometry) })),
  }));

  let on = null;
  const layer = {
    id: "chartkey", no: 1.5, name: "Chart features", toggle: true, on: false,   // off by default: thousands of chart symbols bury the contacts
    hub(el, Ops) {
      on = Object.fromEntries(cats.map((c) => [c.key, Ops.store.get(`chartkey.${c.key}`, DEFAULT_ON[c.key] !== false)]));
      el.innerHTML = `
        <h2>Chart key</h2>
        <div class="key-list" data-keep-folded>${cats.map((c) => `
          <label class="key-row">
            <span class="sw sw-${c.style.kind}" style="--sw:${c.style.color}"></span>
            <span class="key-name">${c.label}${c.style.minZoom ? `<small>Shown from zoom ${c.style.minZoom}</small>` : ""}</span>
            <span class="key-n mono">${c.feats.length}</span>
            <input type="checkbox" data-key="${c.key}" ${on[c.key] ? "checked" : ""} aria-label="Show ${c.label}">
          </label>`).join("")}
        </div>
        <div class="key-actions"><button type="button" data-all="1">Show all</button><button type="button" data-all="0">Hide all</button></div>
        <p class="note">NOAA chart data, ${ENC.fetched}. Depths in metres. Not for navigation.</p>`;
      const sync = () => el.querySelectorAll("[data-key]").forEach((cb) => { cb.checked = on[cb.dataset.key]; });
      el.addEventListener("change", (e) => {
        const cb = e.target.closest("[data-key]"); if (!cb) return;
        on[cb.dataset.key] = cb.checked; Ops.store.set(`chartkey.${cb.dataset.key}`, cb.checked); Ops.map.redraw();
      });
      el.querySelectorAll("[data-all]").forEach((b) => b.addEventListener("click", () => {
        cats.forEach((c) => { on[c.key] = b.dataset.all === "1"; Ops.store.set(`chartkey.${c.key}`, on[c.key]); });
        sync(); Ops.map.redraw();
      }));
    },
    draw(ctx, map) {
      if (!on) return;
      const [w, h] = map.size(), [n, wl] = map.unproject(0, 0), [s, el] = map.unproject(w, h);
      const z = map.state.zoom;
      const visible = (bb) => bb[2] >= wl && bb[0] <= el && bb[3] >= s && bb[1] <= n;
      const path = (coords) => coords.forEach((p, i) => { const [x, y] = map.project(p[1], p[0]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (const c of cats) {
        if (!on[c.key]) continue;
        const st = c.style;
        if (st.minZoom && z < st.minZoom) continue;
        for (const f of c.feats) {
          if (!visible(f.bb)) continue;
          const g = f.geometry;
          if (g.type === "LineString" || g.type === "MultiLineString") {
            ctx.beginPath(); (g.type === "LineString" ? [g.coordinates] : g.coordinates).forEach(path);
            ctx.strokeStyle = st.color; ctx.globalAlpha = st.alpha || 1; ctx.lineWidth = st.width || 1.5; ctx.setLineDash(st.dash || []);
            ctx.stroke();
          } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
            ctx.beginPath(); (g.type === "Polygon" ? [g.coordinates] : g.coordinates).forEach((poly) => poly.forEach((ring) => { path(ring); ctx.closePath(); }));
            const fill = st.areaFill != null ? st.areaFill : st.fill;
            if (fill) { ctx.globalAlpha = fill; ctx.fillStyle = st.color; ctx.fill("evenodd"); }
            ctx.globalAlpha = 0.95; ctx.strokeStyle = st.color; ctx.lineWidth = st.width || 1.2; ctx.setLineDash(st.areaDash || st.dash || []);
            ctx.stroke();
          } else if (g.type === "Point") {
            const [x, y] = map.project(g.coordinates[1], g.coordinates[0]);
            ctx.setLineDash([]); ctx.globalAlpha = 1;
            if (c.key === "soundings") {
              const d = g.coordinates[2];
              if (d == null) continue;
              ctx.font = "500 10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
              const t = d < 10 ? d.toFixed(1) : Math.round(d);
              ctx.lineWidth = 3; ctx.strokeStyle = "rgba(4,8,12,0.75)"; ctx.strokeText(t, x, y);
              ctx.fillStyle = st.color; ctx.fillText(t, x, y);
            } else if (c.key === "navaids") drawNavaid(ctx, f, x, y);
            else if (c.key === "hazards") drawHazard(ctx, f, x, y);
          }
        }
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.textAlign = "left";
      // Contour values, once per contour, when there is room to read them.
      if (on.contours && z >= 15) {
        ctx.font = "500 10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const f of cats.find((c) => c.key === "contours").feats) {
          if (!visible(f.bb) || f.properties.VALDCO == null) continue;
          const cs = f.geometry.coordinates, p = cs[Math.floor(cs.length / 2)], [x, y] = map.project(p[1], p[0]);
          const t = `${f.properties.VALDCO} m`;
          ctx.lineWidth = 3; ctx.strokeStyle = "rgba(4,8,12,0.8)"; ctx.strokeText(t, x, y);
          ctx.fillStyle = STYLE.contours.color; ctx.fillText(t, x, y);
        }
        ctx.textAlign = "left";
      }
    },
  };

  function drawNavaid(ctx, f, x, y) {
    const p = f.properties, col = MARK[String(p.COLOUR || "").split(",")[0]] || "#f1f4f7";
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(4,8,12,0.9)";
    if (p.layer === 11) {                       // light: a dot with a short flare, as on the chart
      ctx.fillStyle = "#f5d76e"; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#f5d76e"; ctx.beginPath(); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x + 9, y - 9); ctx.stroke();
    } else if (p.layer === 1) {                 // beacon: triangle
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4.5, y + 3.5); ctx.lineTo(x - 4.5, y + 3.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {                                    // buoy: diamond
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  function drawHazard(ctx, f, x, y) {
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(4,8,12,0.85)";
    const mark = () => {
      if (f.properties.layer === 36) { ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x - 2, y - 3); ctx.lineTo(x - 2, y + 3); ctx.moveTo(x + 2, y - 3); ctx.lineTo(x + 2, y + 3); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke(); }
    };
    mark(); ctx.lineWidth = 1.2; ctx.strokeStyle = "#ffffff"; mark();   // wreck: hull-and-masts mark; obstruction: ring
  }

  Ops.register(layer);
})();
