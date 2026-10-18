/* Layer 1: background maps and places.

   Basemaps, all saved locally by tools/fetch_tiles.py:
     sat    USGS The National Map orthoimagery (public domain)
     chart  NOAA electronic chart display (public domain)
     dark   the NOAA chart recoloured in the browser for a dark operator look

   The chart can also be laid over the satellite map, either whole and
   see-through, or as "lines only": its flat land and water colours removed and
   its black lines and labels turned light so they read on the imagery. */

// What is on disk, per basemap (see tools/fetch_tiles.py). [west, south, east, north]
window.OpsBoxes = {
  port: [-118.32, 33.68, -118.12, 33.80],
  detail: [-118.29, 33.70, -118.24, 33.77],
  bay: [-118.46, 33.60, -118.05, 33.93],
};

window.OpsBasemaps = (function () {
  const { port: PORT_BOX, detail: DETAIL_BOX, bay: BAY_BOX } = OpsBoxes;
  const CHART_COVERAGE = [{ box: PORT_BOX, z: [11, 16] }, { box: DETAIL_BOX, z: [17, 17] }];
  return {
  // Satellite covers the whole bay to zoom 15 and the port to zoom 16. USGS has
  // no zoom 17 here (its cache stops at 1:9,028), so zoom 17 is zoom 16 scaled up.
  // USGS has no imagery far offshore and returns transparent tiles there (515 of
  // them in the bay box). fill is the open-water colour averaged from the imagery's
  // edge, so the empty sea blends in.
  sat: { name: "Satellite", dir: "sat", ext: "jpg", bounds: BAY_BOX, fill: "#3c484c",
    coverage: [{ box: BAY_BOX, z: [11, 15] }, { box: PORT_BOX, z: [11, 16] }],
    credit: "Imagery: USDA, USGS The National Map: Orthoimagery" },
  dark: { name: "Dark", dir: "chart", ext: "png", bounds: PORT_BOX, coverage: CHART_COVERAGE,
    credit: "Chart: NOAA Office of Coast Survey, recoloured",
    filter: "invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.95) saturate(0.4)" },
  chart: { name: "Chart", dir: "chart", ext: "png", bounds: PORT_BOX, coverage: CHART_COVERAGE,
    credit: "Chart: NOAA Office of Coast Survey. Not for navigation" },
  // Overlay only, not offered as a base. Colours measured from the chart tiles:
  // fills are white, beige land (244,232,193) and light blues (lightness 198-234);
  // lines and soundings are black or grey (lightness 0-162); symbols are magenta.
  chartLines: { name: "Chart lines", dir: "chart", ext: "png", coverage: CHART_COVERAGE, overlayOnly: true,
    pixels(d) {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) >= 100) continue;        // magenta symbols: keep as they are
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        d[i + 3] = Math.max(0, Math.min(255, (185 - lum) / 60 * 255));      // fills vanish, lines stay
        d[i] = 236; d[i + 1] = 243; d[i + 2] = 248;                         // dark ink becomes light
      }
    } },
  };
})();

(function () {
  // Places read off the NOAA chart and USGS imagery of the harbour, not typed
  // from memory. Accurate to roughly 50 m, which is enough to fly the map there.
  const PLACES = [
    { name: "Whole port", box: OpsBoxes.port },
    { name: "Whole bay (satellite)", box: OpsBoxes.bay, basemap: "sat" },
    { name: "Main Channel, San Pedro", lat: 33.7366, lon: -118.2744, z: 15.5 },
    { name: "Terminal Island", lat: 33.7459, lon: -118.2661, z: 15 },
    { name: "East Basin", lat: 33.7563, lon: -118.2656, z: 15.5 },
    { name: "West Channel marinas", lat: 33.7216, lon: -118.2773, z: 15.5 },
    { name: "Outer Harbor turning basin", lat: 33.7117, lon: -118.2690, z: 15 },
    { name: "Pier 400", lat: 33.7286, lon: -118.2436, z: 15 },
    { name: "Angels Gate light", lat: 33.7099, lon: -118.2519, z: 16 },
    // Long Beach side: names as the NOAA chart labels them.
    { name: "San Pedro Bay", lat: 33.7307, lon: -118.2213, z: 14 },
    { name: "Cerritos Channel", lat: 33.7693, lon: -118.2271, z: 15 },
    { name: "Middle Harbor, Long Beach", lat: 33.7473, lon: -118.2332, z: 15 },
    { name: "Long Beach Channel", lat: 33.7293, lon: -118.1848, z: 15 },
    { name: "Long Beach Light", lat: 33.7233, lon: -118.1867, z: 16 },
    { name: "Island Grissom", lat: 33.7571, lon: -118.1767, z: 15.5 },
  ];

  Ops.register({
    id: "basemap", no: 1, name: "Basemap",
    hub(el, Ops) {
      const m = Ops.map;
      el.innerHTML = `
        <h2>Basemap</h2>
        <div class="seg" role="group" aria-label="Basemap">${Object.entries(OpsBasemaps).filter(([, b]) => !b.overlayOnly).map(([id, b]) =>
          `<button data-basemap="${id}" aria-pressed="${m.state.basemap === id}">${b.name}</button>`).join("")}</div>
        <div class="overlay-ctl" id="overlay-ctl">
          <label class="ov-row"><input type="checkbox" id="ov-on"> Chart over satellite</label>
          <div class="ov-detail" id="ov-detail">
            <div class="seg small" role="group" aria-label="Chart overlay style">
              <button data-ov-style="chartLines" aria-pressed="true">Lines only</button>
              <button data-ov-style="chart" aria-pressed="false">Full chart</button>
            </div>
            <label class="ov-row">Opacity <input type="range" id="ov-opacity" min="0" max="100" step="5" aria-label="Chart overlay opacity"><span id="ov-val" class="mono"></span></label>
          </div>
          <p class="note" id="ov-note"></p>
        </div>
        <p class="note" id="tile-status" hidden></p>`;
      el.querySelectorAll("[data-basemap]").forEach((b) => b.addEventListener("click", () => {
        m.setBasemap(b.dataset.basemap); Ops.store.set("basemap", b.dataset.basemap);
        el.querySelectorAll("[data-basemap]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        applyOverlay();
      }));

      // Chart overlay: only meaningful over satellite. Settings are remembered.
      const q = new URLSearchParams(location.search);
      const ov = {
        on: q.has("overlay") ? q.get("overlay") !== "0" : Ops.store.get("overlay.on", false),
        style: ["chartLines", "chart"].includes(q.get("overlay")) ? q.get("overlay") : Ops.store.get("overlay.style", "chartLines"),
        opacity: q.has("opacity") ? Number(q.get("opacity")) : Ops.store.get("overlay.opacity", 80),
      };
      const onBox = el.querySelector("#ov-on"), slider = el.querySelector("#ov-opacity");
      function applyOverlay() {
        const sat = m.state.basemap === "sat";
        onBox.checked = ov.on; onBox.disabled = !sat; slider.value = ov.opacity; slider.disabled = !sat || !ov.on;
        el.querySelector("#ov-val").textContent = `${ov.opacity}%`;
        el.querySelectorAll("[data-ov-style]").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.ovStyle === ov.style)); b.disabled = !sat || !ov.on; });
        el.querySelector("#ov-detail").hidden = !(sat && ov.on);   // style and opacity only matter while it is on
        el.querySelector("#ov-note").textContent = sat ? (ov.on ? "The chart covers the port area only." : "") : "Switch to Satellite to lay the chart over it.";
        el.querySelector("#ov-note").hidden = !el.querySelector("#ov-note").textContent;
        m.setOverlay(sat && ov.on ? ov.style : null, ov.opacity / 100);
        const base = OpsBasemaps[m.state.basemap].credit;
        document.getElementById("credit").textContent = sat && ov.on ? `${base}. Chart: NOAA Office of Coast Survey. Not for navigation` : base;
        Ops.store.set("overlay.on", ov.on); Ops.store.set("overlay.style", ov.style); Ops.store.set("overlay.opacity", ov.opacity);
      }
      onBox.addEventListener("change", () => { ov.on = onBox.checked; applyOverlay(); });
      slider.addEventListener("input", () => { ov.opacity = Number(slider.value); applyOverlay(); });
      el.querySelectorAll("[data-ov-style]").forEach((b) => b.addEventListener("click", () => { ov.style = b.dataset.ovStyle; applyOverlay(); }));
      applyOverlay();
      // Say plainly when the tiles have not been downloaded yet.
      m.on("tiles", (s) => {
        const none = s.loaded === 0 && s.missing > 0;
        document.getElementById("no-tiles").hidden = !none;
        const status = document.getElementById("tile-status");
        status.textContent = none ? "No tiles on disk yet" : "";
        status.hidden = !none;
      });
    },
  });

  Ops.register({
    id: "places", parent: "basemap", no: 1.1, name: "Place names", toggle: true, on: true,
    hub(el, Ops) {
      const layer = Ops.layers.find((l) => l.id === "places");
      el.innerHTML = `
        <h2>Places</h2>
        <div class="checks"><label><input type="checkbox" id="places-all"> Show all places</label></div>
        <div class="places" id="place-list">${PLACES.map((p, i) => `<button type="button" data-place="${i}">${p.name}</button>`).join("")}</div>`;
      const list = el.querySelector("#place-list");
      const box = el.querySelector("#places-all");
      // One switch for the list and the map marks, kept in step with the layer checkbox.
      function setOn(on) {
        layer.on = on;
        Ops.store.set("layer.places", on);
        box.checked = on;
        list.hidden = !on;
        const row = document.querySelector('#layer-list input[data-layer="places"]');
        if (row) row.checked = on;
        Ops.map.redraw();
      }
      box.addEventListener("change", () => setOn(box.checked));
      document.getElementById("layer-list").addEventListener("change", (e) => {
        if (e.target.dataset.layer === "places") setOn(e.target.checked);
      });
      list.addEventListener("click", (e) => {
        const b = e.target.closest("[data-place]");
        if (!b) return;
        const p = PLACES[b.dataset.place];
        if (p.basemap && Ops.map.state.basemap !== p.basemap) document.querySelector(`[data-basemap="${p.basemap}"]`).click();
        if (p.box) Ops.map.fitBox(p.box); else Ops.map.flyTo(p.lat, p.lon, p.z);
      });
      setOn(layer.on !== false);
    },
    draw(ctx, map) {
      ctx.font = "500 11px system-ui, Segoe UI, sans-serif";
      ctx.textBaseline = "middle";
      PLACES.forEach((p) => {
        if (p.box) return;
        const [x, y] = map.project(p.lat, p.lon);
        ctx.fillStyle = "#3fc1d9"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(4,8,12,0.85)"; ctx.strokeText(p.name, x + 7, y);
        ctx.fillStyle = "#dbe5ee"; ctx.fillText(p.name, x + 7, y);
      });
    },
  });
})();
