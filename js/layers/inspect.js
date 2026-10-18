/* Contact card: click any ship or contact on the map and a card opens beside
   it, so the answer is where the officer is looking instead of down the hub.
   Hovering a contact shows a pointer and its name.

   Reads everything through the hooks Layer 3 and Layer 4 publish
   (Ops.contacts, Ops.classes); it holds no contact data of its own. */

(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const deg = (v) => `${String(Math.round(v) % 360).padStart(3, "0")}°`;
  const HIT = 16; // px, same radius the contacts layer uses for clicks

  let card = null, tip = null, shownFor = null, hoverId = null;

  function contactAt(px, py) {
    const P = Ops.contacts;
    if (!P) return null;
    const layer = Ops.layers.find((l) => l.id === "contacts");
    if (layer && layer.on === false) return null;
    let best = null, bd = HIT;
    P.list.forEach((c) => {
      const p = P.picture(c.id);
      if (!p || p.status === "none") return;
      const [x, y] = Ops.map.project(p.s.lat, p.s.lon), d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }

  function title(c) { return c.name ? `${c.id} · ${c.name}` : c.id; }

  function fill(c) {
    const P = Ops.contacts, p = P.picture(c.id), r = Ops.classes && Ops.classes.classify(c);
    const kind = P.kinds[c.kind] ? P.kinds[c.kind].label : "Unknown";
    const s = p.s, moving = s.kn > 0, lost = p.status === "lost";
    const cls = r ? `${r.cls.name}${r.conf != null ? ` · ${Math.round(r.conf * 100)}%` : ""}` : "Unclassified";
    const clsFrom = r ? (r.from === "AIS" ? "from AIS, not yet heard" : r.from === "last heard" ? "last heard" : "from its sound") : "";
    const held = c.ais ? ["AIS", ...p.sens.map((x) => x.type === "DAS" ? `DAS ${x.name}` : `Hydrophone ${x.id}`)] : p.sens.map((x) => x.type === "DAS" ? `DAS ${x.name}` : `Hydrophone ${x.id}`);
    let flag = "";
    if (!c.ais) flag = `<span class="ic-flag warn">No AIS</span>`;
    if (r && r.aisMatch === false) flag = `<span class="ic-flag bad">AIS mismatch</span>`;
    if (lost) flag = `<span class="ic-flag">Lost ${Math.round(p.ago / 60) || "<1"} min</span>`;
    const html = `
      <div class="ic-head">
        <strong>${esc(title(c))}</strong>
        <button type="button" class="ic-x" aria-label="Close">×</button>
      </div>
      ${flag ? `<div class="ic-flags">${flag}</div>` : ""}
      <dl>
        <dt>Type</dt><dd>${esc(c.ais ? kind : "Unknown, not on AIS")}</dd>
        <dt>Class</dt><dd>${esc(cls)}${clsFrom ? `<small>${esc(clsFrom)}</small>` : ""}</dd>
        <dt>${lost ? "Last speed" : "Speed"}</dt><dd class="mono">${moving ? `${s.kn.toFixed(1)} kn, ${deg(s.hdg)}` : "Stationary"}</dd>
        <dt>${lost ? "Last held by" : "Held by"}</dt><dd>${esc(held.join(", ") || "None")}</dd>
      </dl>
      <div class="ic-actions">
        <button type="button" data-ic="centre">Centre</button>
        <button type="button" data-ic="details">Full details</button>
      </div>`;
    // Rebuild only when something changed, so a click is never lost to a refresh.
    if (html === card._html) return;
    card._html = html; card.innerHTML = html;
    card.querySelector(".ic-x").addEventListener("click", () => P.select(null));
    card.querySelector('[data-ic="centre"]').addEventListener("click", () => Ops.map.flyTo(s.lat, s.lon, Math.max(Ops.map.state.zoom, 15)));
    card.querySelector('[data-ic="details"]').addEventListener("click", () => showDetails());
  }

  // Open the hub section that holds the full contact and class detail.
  function showDetails() {
    ["contacts", "classes"].forEach((id) => {
      const sec = document.querySelector(`.hub-sec[data-layer="${id}"]`);
      if (sec && sec.classList.contains("collapsed")) { const b = sec.querySelector(".sec-toggle"); if (b) b.click(); }
    });
    const d = document.getElementById("ct-detail");
    if (d && !d.hidden) {
      d.scrollIntoView({ block: "start", behavior: "smooth" });
      d.classList.remove("ic-flash"); void d.offsetWidth; d.classList.add("ic-flash");
    }
  }

  // Keep the card beside its contact as it moves; flip sides near the edges.
  function place() {
    const P = Ops.contacts, id = P && P.selected();
    if (!id) { card.hidden = true; shownFor = null; return; }
    const c = P.list.find((x) => x.id === id), p = P.picture(id);
    if (!c || !p || p.status === "none") { card.hidden = true; return; }
    if (shownFor !== id || Date.now() - (card._t || 0) > 1000) { fill(c); shownFor = id; card._t = Date.now(); }
    card.hidden = false;
    const [w, h] = Ops.map.size(), [x, y] = Ops.map.project(p.s.lat, p.s.lon);
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 26;
    let left = x + gap, top = y - ch / 2;
    if (left + cw > w - 8) left = x - gap - cw;
    left = Math.max(8, Math.min(w - cw - 8, left));
    top = Math.max(8, Math.min(h - ch - 8, top));
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hover(e) {
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const c = contactAt(px, py), canvas = e.currentTarget;
    if (!c) {
      if (hoverId) { hoverId = null; tip.hidden = true; if (!canvas.style.cursor || canvas.style.cursor === "pointer") canvas.style.cursor = ""; }
      return;
    }
    if (canvas.style.cursor !== "grabbing") canvas.style.cursor = "pointer";
    hoverId = c.id;
    tip.textContent = c.name ? `${c.id} · ${c.name}` : `${c.id} · unknown`;
    tip.hidden = false;
    tip.style.transform = `translate(${Math.round(px + 14)}px, ${Math.round(py - 28)}px)`;
  }

  function start() {
    const wrap = document.querySelector(".mapwrap"), canvas = document.querySelector("#map canvas");
    if (!wrap || !canvas || !Ops.contacts) return;
    card = document.createElement("div");
    card.className = "ic-card"; card.hidden = true; card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Contact");
    tip = document.createElement("div");
    tip.className = "ic-tip"; tip.hidden = true;
    wrap.append(card, tip);
    canvas.addEventListener("pointermove", hover);
    canvas.addEventListener("pointerleave", () => { tip.hidden = true; hoverId = null; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && Ops.contacts.selected()) Ops.contacts.select(null); });
    // Update at once on selection rather than on the next frame, which a
    // background tab can delay by seconds.
    Ops.contacts.onSelect(() => { shownFor = null; setTimeout(place, 0); });
    (function loop() { place(); requestAnimationFrame(loop); })();
  }
  // After core.js has built the map (it starts on DOMContentLoaded too).
  document.addEventListener("DOMContentLoaded", () => setTimeout(start, 0));
})();
