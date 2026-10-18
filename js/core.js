/* Ops console core: the map, the hub on the left, and a registry that layers
   plug into. A layer file calls Ops.register({...}) and never edits this file.

   A layer definition:
     id, no, name         identity; no is the build order (1 = basemap)
     toggle: true|false   whether the layer list shows an on/off switch
     on: true|false       initial state when toggle is true
     draw(ctx, map)       optional, draws on the map every frame it changes
     hub(el, Ops)         optional, fills a hub section the core creates
     click(evt, Ops)      optional, map click; return true if handled

   Everything here is simulated, interface only. The real data feeds come from
   the team's backend repository later. */

window.Ops = (function () {
  const layers = [];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ops." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ops." + k, JSON.stringify(v)); } catch (e) { /* private mode: fine */ } },
  };
  const Ops = { layers, store, map: null, register(def) { layers.push(def); } };

  function start() {
    const q = new URLSearchParams(location.search);
    const basemap = q.get("basemap") || store.get("basemap", "sat");
    Ops.map = OpsMap(document.getElementById("map"), {
      box: [-118.32, 33.68, -118.12, 33.80],
      detailBox: [-118.29, 33.70, -118.24, 33.77],
      tileZooms: [11, 16, 17],          // whole box 11 to 16, detail box 17
      minZoom: 11, maxZoom: 18,
      center: [Number(q.get("lat")) || 33.735, Number(q.get("lon")) || -118.255],
      zoom: Number(q.get("z")) || 13.5,
      basemap,
      basemaps: OpsBasemaps,
      colors: { bg: "#070c12", grid: "#121c26", box: "#2a3a4a" },
    });

    layers.sort((a, b) => a.no - b.no);
    buildLayerList();
    layers.forEach((l) => {
      if (l.toggle && l.on === undefined) l.on = true;
      // ?demo=1 ignores remembered switches, so a recording always starts clean.
      if (l.toggle && !q.has("demo")) l.on = store.get("layer." + l.id, l.on);
      if (l.hub) {
        const sec = document.createElement("section");
        sec.className = "hub-sec"; sec.dataset.layer = l.id;
        document.getElementById("hub-sections").appendChild(sec);
        l.hub(sec, Ops);
      }
      if (l.draw) Ops.map.onDraw((ctx, map) => { if (!l.toggle || l.on) l.draw(ctx, map); });
    });
    buildLayerList();

    Ops.map.on("click", (e) => { [...layers].reverse().some((l) => (!l.toggle || l.on) && l.click && l.click(e, Ops)); });
    wireChrome();
    wireCollapse();
  }

  // Every hub section folds away from its heading. The first <h2> in a section
  // becomes a button with a chevron; the rest of the section hides when folded,
  // and the choice is remembered. Layers render their own sections, so a
  // MutationObserver re-applies this whenever a section is re-rendered.
  const CHEVRON = '<svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function wireCollapse() {
    const hub = document.querySelector(".hub");
    function set(sec, btn, folded) {
      sec.classList.toggle("collapsed", folded);
      btn.setAttribute("aria-expanded", String(!folded));
    }
    function decorate(sec) {
      const h = sec.querySelector(":scope > h2:first-child");
      if (!h || h.querySelector(".sec-toggle")) return;
      const id = sec.dataset.layer || "layers";
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "sec-toggle";
      btn.innerHTML = `<span>${h.innerHTML}</span>${CHEVRON}`;
      h.textContent = ""; h.appendChild(btn);
      set(sec, btn, store.get("hub.collapsed." + id, false));
      btn.addEventListener("click", () => {
        const folded = !sec.classList.contains("collapsed");
        set(sec, btn, folded); store.set("hub.collapsed." + id, folded);
      });
    }
    const all = () => hub.querySelectorAll(".hub-sec").forEach(decorate);
    all();
    new MutationObserver(all).observe(hub, { childList: true, subtree: true });
  }

  // The layer list shows the layers that exist and can be switched. The build
  // roadmap lives in docs/ops-console-plan.md, not in the product.
  function buildLayerList() {
    const el = document.getElementById("layer-list");
    el.innerHTML = layers.filter((l) => l.toggle).map((l) => `<label class="lrow"><span>${l.name}</span>
      <input type="checkbox" data-layer="${l.id}" ${l.on !== false ? "checked" : ""} aria-label="Show ${l.name}"></label>`).join("");
    el.querySelectorAll("input[data-layer]").forEach((cb) => cb.addEventListener("change", () => {
      const l = layers.find((x) => x.id === cb.dataset.layer);
      l.on = cb.checked; store.set("layer." + l.id, l.on); Ops.map.redraw();
    }));
  }

  function wireChrome() {
    const m = Ops.map, $ = (s) => document.querySelector(s);
    const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;
    m.on("cursor", (ll) => { $("#cursor").textContent = ll ? `${fmt(ll[0], "N", "S")}  ${fmt(ll[1], "E", "W")}` : ""; });
    function scale() {
      const mpp = m.metresPerPx(), target = 110 * mpp;
      const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((n) => n >= target * 0.6) || 5000;
      $("#scale-bar").style.width = `${nice / mpp}px`;
      $("#scale-label").textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
      $("#zoom-level").textContent = `Zoom ${m.state.zoom.toFixed(1)}`;
    }
    m.on("move", scale); scale();
    $("#zoom-in").addEventListener("click", () => m.zoomBy(1));
    $("#zoom-out").addEventListener("click", () => m.zoomBy(-1));
    $("#fit").addEventListener("click", () => m.fitBox([-118.32, 33.68, -118.12, 33.80]));
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("input, select, textarea")) return;
      const [w, h] = m.size(), step = 80;
      const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (pan) { e.preventDefault(); const [lat, lon] = m.unproject(w / 2 + pan[0], h / 2 + pan[1]); m.flyTo(lat, lon, null, 150); }
      if (e.key === "+" || e.key === "=") m.zoomBy(0.5);
      if (e.key === "-") m.zoomBy(-0.5);
    });
  }

  document.addEventListener("DOMContentLoaded", start);
  return Ops;
})();
