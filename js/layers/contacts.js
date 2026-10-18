/* Layer 3: contacts, the objects in the water right now.

   Every contact is simulated. Ships that carry AIS report themselves, so they
   are always on the picture. A contact without AIS is only on the picture while
   a sensor from Layer 2 hears it: within the DAS range of a fibre's underwater
   stretch (and not on a dead channel), or within a hydrophone's range. Change
   the ranges in Equipment and the unknown contacts appear, drop to "lost" or
   vanish. Ship names are invented; there are no real MMSI numbers.

   Routes were checked against the downloaded NOAA chart with
   tools/water_check.py, sampled every 10 m: every sample is water except a few
   that sit on magenta chart symbols (buoys, lights). Routes in and out of the
   harbour pass through Angels Gate: the gap was read off the chart tiles and
   confirmed on the satellite imagery, where the inbound route crosses the gap
   about 250 m from its east end and 370 m from its west end.

   Movement is a pure function of picture time, so a contact's position, trail
   and last-held point can be worked out for any moment without stored history.

   For Layer 4: Ops.contacts exposes the list, the icon paths and select(id),
   so a class can later be given its own icon without editing this file. */

(function () {
  const KN = 0.514444; // metres per second in one knot

  // Main Channel, from outside Angels Gate up to the Main Channel duct and the
  // water just north of it.
  const MAIN_CHANNEL = [[33.6990, -118.2430], [33.7104, -118.2476], [33.7140, -118.2540], [33.7180, -118.2650],
    [33.7232, -118.2706], [33.7302, -118.2718], [33.7337, -118.2742], [33.7372, -118.2766], [33.7411, -118.2760],
    [33.7451, -118.2736], [33.7481, -118.2730], [33.7498, -118.2728]];

  // Icons point north (up) and are rotated to the heading. Path strings serve
  // both the map (Path2D) and the hub table (inline SVG).
  const ICONS = {
    ship: "M0 -11 L4.5 -5 L4.5 9 L-4.5 9 L-4.5 -5 Z",
    tug: "M0 -7 L4.5 -3 L4.5 6 L-4.5 6 L-4.5 -3 Z",
    small: "M0 -8 L5.5 7 L0 3.5 L-5.5 7 Z",
  };
  const KINDS = {
    cargo: { label: "Container ship", icon: "ship" },
    tanker: { label: "Tanker", icon: "ship" },
    bulk: { label: "Bulk carrier", icon: "ship" },
    passenger: { label: "Passenger ferry", icon: "ship" },
    tug: { label: "Tug", icon: "tug" },
    pilot: { label: "Pilot boat", icon: "small" },
    fishing: { label: "Fishing vessel", icon: "small" },
    unknown: { label: "Unknown", icon: "small" },
  };
  const C = { known: "#4aa3ff", unknown: "#f2a93b", lost: "#93a5b5", sel: "#ffffff", halo: "rgba(4,8,12,0.85)" };

  // mode: "loop" runs the route round and round, "pingpong" runs it out and back.
  // phase is where along the route (0 to 1 of the round trip) the contact starts.
  const CONTACTS = [
    { id: "U-01", kind: "unknown", ais: false, kn: 3, mode: "pingpong", phase: 0.1,
      route: [[33.7400, -118.2762], [33.7425, -118.2755], [33.7448, -118.2740], [33.7465, -118.2732], [33.7480, -118.2728]],
      note: "Small and slow, moving up and down the Main Channel over the fibre duct. Not on AIS." },
    { id: "U-02", kind: "unknown", ais: false, kn: 1.5, mode: "pingpong", phase: 0.6,
      route: [[33.7646, -118.2560], [33.7641, -118.2510], [33.7636, -118.2470]],
      note: "Very slow, along the Cerritos Channel near the drill. Not on AIS." },
    { id: "V-101", name: "Harbour Meridian", kind: "cargo", ais: true, kn: 8, mode: "pingpong", phase: 0.18,
      route: MAIN_CHANNEL, length: 300 },
    { id: "V-102", name: "Island Runner", kind: "passenger", ais: true, kn: 12, mode: "pingpong", phase: 0.62,
      route: MAIN_CHANNEL, length: 45 },
    { id: "V-103", name: "Kestrel Bay", kind: "tug", ais: true, kn: 6, mode: "loop", phase: 0.3,
      route: [[33.7170, -118.2440], [33.7240, -118.2400], [33.7270, -118.2250], [33.7240, -118.2160], [33.7200, -118.2300], [33.7170, -118.2440]], length: 30 },
    { id: "V-104", name: "Pilot 3", kind: "pilot", ais: true, kn: 14, mode: "pingpong", phase: 0.4,
      route: [[33.7150, -118.2500], [33.7104, -118.2476], [33.7040, -118.2440], [33.7000, -118.2250]], length: 16 },
    { id: "V-105", name: "Northern Sable", kind: "tanker", ais: true, kn: 0, mode: "anchored", hdg: 245,
      route: [[33.6990, -118.2150]], length: 250 },
    { id: "V-106", name: "Ocean Laurel", kind: "bulk", ais: true, kn: 7, mode: "pingpong", phase: 0.05,
      route: [[33.6960, -118.1850], [33.7000, -118.2300]], length: 225 },
    { id: "V-107", name: "Sea Wren", kind: "fishing", ais: true, kn: 4, mode: "loop", phase: 0.5,
      route: [[33.7125, -118.2740], [33.7150, -118.2680], [33.7130, -118.2600], [33.7115, -118.2690], [33.7125, -118.2740]], length: 20 },
  ];

  // ---------- geometry ----------
  const LAT0 = 33.735, MX = 111320 * Math.cos(LAT0 * Math.PI / 180), MY = 111320;
  const xy = (p) => [p[1] * MX, p[0] * MY];                    // local metres, east and north
  const ll = (x, y) => [y / MY, x / MX];
  const dist = (a, b) => Math.hypot((b[1] - a[1]) * MX, (b[0] - a[0]) * MY);

  CONTACTS.forEach((c) => {
    c.cum = [0];
    for (let i = 1; i < c.route.length; i++) c.cum.push(c.cum[i - 1] + dist(c.route[i - 1], c.route[i]));
    c.len = c.cum[c.cum.length - 1];
  });

  // Position, heading (degrees true) and speed at picture time t (seconds).
  function stateAt(c, t) {
    if (c.mode === "anchored" || !c.len) return { lat: c.route[0][0], lon: c.route[0][1], hdg: c.hdg || 0, kn: 0, dir: 0 };
    const v = c.kn * KN, period = c.mode === "loop" ? c.len : 2 * c.len;
    let u = ((c.phase * period + v * t) % period + period) % period, dir = 1;
    if (c.mode === "pingpong" && u > c.len) { u = 2 * c.len - u; dir = -1; }
    let i = 1;
    while (i < c.cum.length - 1 && c.cum[i] < u) i++;
    const a = c.route[i - 1], b = c.route[i], f = (u - c.cum[i - 1]) / (c.cum[i] - c.cum[i - 1] || 1);
    let hdg = Math.atan2((b[1] - a[1]) * MX, (b[0] - a[0]) * MY) * 180 / Math.PI;
    if (dir < 0) hdg += 180;
    return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, hdg: (hdg + 360) % 360, kn: c.kn, dir };
  }

  // Which Layer 2 sensors hear a point. Reads the live ranges from Equipment.
  function sensorsAt(lat, lon) {
    const S = Ops.sensors, out = [];
    if (!S) return out;
    const [px, py] = xy([lat, lon]);
    S.ducts.forEach((d) => {
      const [ax, ay] = xy(d.a), [bx, by] = xy(d.b), dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      // Along the drill in its own metres (spec length), clamped to the underwater stretch.
      const m = Math.max(d.wet[0], Math.min(d.wet[1], ((px - ax) * dx + (py - ay) * dy) / (L * L) * d.length));
      const [qx, qy] = xy(S.along(d, m)), r = Math.hypot(px - qx, py - qy);
      if (r > S.range.das) return;
      const ch = Math.round(m);
      if (d.dead.some(([s, e]) => ch >= s && ch <= e)) return;
      out.push({ type: "DAS", id: d.id, name: d.name, ch, r });
    });
    S.hydrophones.forEach((h) => {
      const r = dist([lat, lon], [h.lat, h.lon]);
      if (r <= S.range.hydro && h.online > 0) out.push({ type: "Hydrophone", id: h.id, r });
    });
    return out;
  }

  // What the picture shows for a contact at time t:
  //   live: on the picture now; lost: was held in the last 10 minutes; none: not shown.
  const LOST_WINDOW = 600;
  function picture(c, t) {
    const s = stateAt(c, t), sens = sensorsAt(s.lat, s.lon);
    if (c.ais) return { status: "live", s, sens, src: ["AIS", ...sens.map(label)] };
    if (sens.length) return { status: "live", s, sens, src: sens.map(label) };
    for (let back = 5; back <= LOST_WINDOW; back += 5) {
      const p = stateAt(c, t - back), ps = sensorsAt(p.lat, p.lon);
      if (ps.length) return { status: "lost", s: p, sens: ps, ago: back, src: [] };
    }
    return { status: "none", s, sens: [], src: [] };
  }
  const label = (x) => x.type === "DAS" ? `DAS ${x.name} ch ${x.ch}` : `Hydrophone ${x.id}`;
  const statusColour = (c, p) => p.status === "lost" ? C.lost : c.ais ? C.known : C.unknown;
  // Layer 4 (classes.js) may assign each sound class its own icon and colour.
  const iconPath = (c) => (Ops.classes && Ops.classes.iconFor(c)) || ICONS[KINDS[c.kind].icon];
  const colour = (c, p) => (Ops.classes && p.status !== "lost" && Ops.classes.colourFor(c)) || statusColour(c, p);

  // ---------- picture clock ----------
  const t0Wall = Date.now();
  const clock = { t: 0, playing: Ops.store.get("ct.playing", true), rate: Ops.store.get("ct.rate", 5) };
  const show = { trails: Ops.store.get("ct.trails", true), leaders: Ops.store.get("ct.leaders", true), labels: Ops.store.get("ct.labels", true) };
  let selected = null, follow = false, layer = null, syncPlayHub = () => {};
  const selectHooks = [];
  const pics = new Map(); // id -> picture, refreshed with the clock

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const wall = (t) => new Date(t0Wall + t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const deg = (v) => `${String(Math.round(v) % 360).padStart(3, "0")}°`;
  const pos = (s) => `${s.lat.toFixed(4)}° N, ${Math.abs(s.lon).toFixed(4)}° W`;
  const svgIcon = (c, col) => `<svg class="ct-ic" viewBox="-12 -12 24 24" aria-hidden="true"><path d="${iconPath(c)}" fill="${col}" stroke="rgba(4,8,12,0.9)" stroke-width="1.2"/></svg>`;

  function refresh() { CONTACTS.forEach((c) => pics.set(c.id, picture(c, clock.t))); }

  // ---------- hub ----------
  function paintHub() {
    const tb = $("#ct-rows");
    if (!tb) return;
    $("#ct-time").textContent = wall(clock.t);
    let shown = 0, unknown = 0;
    CONTACTS.forEach((c) => {
      const p = pics.get(c.id), row = tb.querySelector(`[data-ct="${c.id}"]`);
      row.hidden = p.status === "none";
      if (row.hidden) { if (selected === c.id) pick(null, false); return; }
      shown++; if (!c.ais) unknown++;
      row.classList.toggle("lost", p.status === "lost");
      row.querySelector(".ct-ic-cell").innerHTML = svgIcon(c, colour(c, p));
      row.querySelector(".ct-spd").textContent = p.status === "lost" ? "—" : `${p.s.kn.toFixed(1)} kn`;
      row.querySelector(".ct-src").textContent = p.status === "lost" ? `Lost ${Math.round(p.ago / 60) || "<1"} min` : shortSrc(c, p);
    });
    $("#ct-count").textContent = `${shown} on the picture, ${unknown} without AIS`;
    paintDetail();
  }
  function shortSrc(c, p) {
    const n = p.sens.length;
    if (c.ais) return n ? `AIS + ${n} sensor${n > 1 ? "s" : ""}` : "AIS";
    return p.sens.map((x) => x.type === "DAS" ? "DAS" : x.id).filter((v, i, a) => a.indexOf(v) === i).join(" + ");
  }

  function paintDetail() {
    const el = $("#ct-detail");
    if (!el) return;
    if (!selected) { el.hidden = true; return; }
    const c = CONTACTS.find((x) => x.id === selected), p = pics.get(c.id), k = KINDS[c.kind];
    if (el.dataset.for !== c.id) {
      el.dataset.for = c.id;
      el.innerHTML = `
        <h3>${svgIcon(c, colour(c, p))} ${esc(c.id)}${c.name ? ` · ${esc(c.name)}` : ""}</h3>
        <p data-k="summary"></p>
        <div class="kv" data-k="kv"></div>
        <div class="ct-actions">
          <button type="button" data-act="centre">Centre on map</button>
          <button type="button" data-act="follow" aria-pressed="false">Follow</button>
        </div>`;
      el.querySelector('[data-act="centre"]').addEventListener("click", () => centre(c));
      el.querySelector('[data-act="follow"]').addEventListener("click", () => { follow = !follow; if (follow) centre(c); paintDetail(); });
    }
    el.hidden = false;
    el.querySelector("h3 svg").outerHTML = svgIcon(c, colour(c, p));
    const s = p.s, moving = s.kn > 0;
    el.querySelector('[data-k="summary"]').textContent = c.ais
      ? `${k.label}, reporting on AIS (simulated). ${moving ? `${s.dir > 0 ? "Outbound leg" : "Return leg"} of its route.` : "At anchor."}`
      : p.status === "lost"
        ? `No sensor has heard it for ${Math.round(p.ago)} s. Shown at the last held position. ${c.note}`
        : `${c.note} Held by ${p.sens.length} sensor${p.sens.length > 1 ? "s" : ""}. ${Ops.classes ? Ops.classes.summary(c, p) : "Classification pending."}`;
    const rows = [
      ["Type", c.ais ? k.label : "Unknown"],
      [p.status === "lost" ? "Last held" : "Position", pos(s)],
      [p.status === "lost" ? "Last course" : "Course", moving ? deg(s.hdg) : "—"],
      [p.status === "lost" ? "Last speed" : "Speed", moving ? `${s.kn.toFixed(1)} kn` : "Stationary"],
    ];
    if (c.ais) rows.push(["Length", `${c.length} m (AIS, simulated)`], ["AIS", "Simulated, no MMSI"]);
    const heard = p.sens.map((x) => `${label(x)}, ${Math.round(x.r)} m away`);
    if (c.ais) heard.unshift("AIS");
    rows.push([p.status === "lost" ? "Last held by" : "Held by", heard.join("<br>")]);
    el.querySelector('[data-k="kv"]').innerHTML = rows.map(([a, b]) => `<span class="k">${a}</span><span class="v">${b}</span>`).join("");
    const fb = el.querySelector('[data-act="follow"]');
    fb.setAttribute("aria-pressed", String(follow));
    fb.textContent = follow ? "Following" : "Follow";
  }

  function centre(c) {
    const p = pics.get(c.id);
    Ops.map.flyTo(p.s.lat, p.s.lon, Math.max(Ops.map.state.zoom, 15));
  }

  function pick(id, fly) {
    if (id !== selected) follow = false;
    selected = id;
    selectHooks.forEach((fn) => fn(id));
    document.querySelectorAll("#ct-rows [data-ct]").forEach((r) => r.classList.toggle("on", r.dataset.ct === id));
    const el = $("#ct-detail");
    if (el) delete el.dataset.for;
    paintDetail();
    if (id && fly) centre(CONTACTS.find((x) => x.id === id));
    if (id && el) el.scrollIntoView({ block: "nearest" });
    Ops.map.redraw();
  }

  // ---------- map ----------
  function drawIcon(ctx, c, x, y, hdg, col, on) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hdg * Math.PI / 180);
    const path = new Path2D(iconPath(c));
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.halo; ctx.stroke(path);
    ctx.fillStyle = col; ctx.fill(path);
    if (on) { ctx.lineWidth = 1.2; ctx.strokeStyle = C.sel; ctx.stroke(path); }
    ctx.restore();
  }
  function haloText(ctx, text, x, y, fill) {
    ctx.lineWidth = 3; ctx.strokeStyle = C.halo; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  layer = {
    id: "contacts", no: 3, name: "Contacts", toggle: true, on: true,

    hub(el) {
      el.innerHTML = `
        <h2>Contacts</h2>
        <p class="note">Simulated picture. Ships on AIS are always shown. A contact without AIS shows only while a DAS fibre or hydrophone hears it, using the ranges set in Equipment.</p>
        <div class="ct-clock">
          <button type="button" class="array-play" id="ct-play" aria-label="Pause the contact picture" aria-pressed="true"><span class="ic ic-play" aria-hidden="true">&#x25B6;&#xFE0E;</span><span class="ic ic-pause" aria-hidden="true">&#x275A;&#x275A;</span></button>
          <span class="mono ct-time" id="ct-time"></span>
          <div class="seg small" role="group" aria-label="Picture speed">
            ${[1, 5, 20].map((r) => `<button type="button" data-rate="${r}" aria-pressed="${clock.rate === r}">${r}×</button>`).join("")}
          </div>
        </div>
        <p class="note" id="ct-count"></p>
        <table class="eq-status ct-table" aria-label="Contacts">
          <thead><tr><th><span class="sr">Icon</span></th><th>Contact</th><th class="r">Speed</th><th>Held by</th></tr></thead>
          <tbody id="ct-rows">
            ${CONTACTS.slice().sort((a, b) => a.ais - b.ais).map((c) => `
              <tr data-ct="${c.id}" tabindex="0">
                <td class="ct-ic-cell"></td>
                <td><span class="mono">${esc(c.id)}</span><small>${esc(c.ais ? `${c.name}, ${KINDS[c.kind].label.toLowerCase()}` : "Unknown, no AIS")}</small></td>
                <td class="r mono ct-spd"></td>
                <td class="ct-src"></td>
              </tr>`).join("")}
          </tbody>
        </table>
        <div class="checks">
          <label><input type="checkbox" data-ct-show="trails" ${show.trails ? "checked" : ""}> Trails, last 3 minutes</label>
          <label><input type="checkbox" data-ct-show="leaders" ${show.leaders ? "checked" : ""}> Course leaders, next minute</label>
          <label><input type="checkbox" data-ct-show="labels" ${show.labels ? "checked" : ""}> Labels</label>
        </div>
        <div class="detail" id="ct-detail" hidden></div>`;

      const play = el.querySelector("#ct-play");
      const syncPlay = () => {
        play.setAttribute("aria-pressed", String(clock.playing));
        play.setAttribute("aria-label", clock.playing ? "Pause the contact picture" : "Play the contact picture");
      };
      syncPlay();
      syncPlayHub = syncPlay;
      play.addEventListener("click", () => { clock.playing = !clock.playing; Ops.store.set("ct.playing", clock.playing); syncPlay(); });
      el.querySelectorAll("[data-rate]").forEach((b) => b.addEventListener("click", () => {
        clock.rate = Number(b.dataset.rate); Ops.store.set("ct.rate", clock.rate);
        el.querySelectorAll("[data-rate]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }));
      el.querySelectorAll("[data-ct-show]").forEach((cb) => cb.addEventListener("change", () => {
        show[cb.dataset.ctShow] = cb.checked; Ops.store.set("ct." + cb.dataset.ctShow, cb.checked); Ops.map.redraw();
      }));
      el.querySelectorAll("[data-ct]").forEach((r) => {
        r.addEventListener("click", () => pick(r.dataset.ct, true));
        r.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(r.dataset.ct, true); } });
      });
      // Dragging the map ends Follow, so the officer is never fighting the camera.
      document.getElementById("map").addEventListener("pointerdown", () => { if (follow) { follow = false; paintDetail(); } });
      refresh(); paintHub();
    },

    draw(ctx, map) {
      refresh(); // fresh for this frame, so a range change shows at once even when paused
      const mpp = map.metresPerPx(), zoom = map.state.zoom;
      ctx.textBaseline = "middle";
      CONTACTS.forEach((c) => {
        const p = pics.get(c.id);
        if (!p || p.status === "none") return;
        const col = colour(c, p), on = selected === c.id, [x, y] = map.project(p.s.lat, p.s.lon);

        // Trail: where it was over the last 3 minutes. Contacts without AIS only
        // leave a trail where a sensor actually heard them.
        if (show.trails && p.s.kn > 0) {
          for (let k = 18; k >= 1; k--) {
            const tb = clock.t - (p.status === "lost" ? p.ago : 0) - k * 10, q = stateAt(c, tb);
            if (!c.ais && !sensorsAt(q.lat, q.lon).length) continue;
            const [tx, ty] = map.project(q.lat, q.lon);
            ctx.globalAlpha = 0.15 + 0.6 * (1 - k / 18);
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(tx, ty, 1.8, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Course leader: the distance it covers in the next minute.
        if (show.leaders && p.status === "live" && p.s.kn > 0) {
          const len = (p.s.kn * KN * 60) / mpp, r = p.s.hdg * Math.PI / 180;
          ctx.strokeStyle = col; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(r) * len, y - Math.cos(r) * len); ctx.stroke();
        }

        // Unknowns get a dashed ring so they stand out from the traffic.
        if (!c.ais) {
          ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        if (on) {
          ctx.strokeStyle = C.sel; ctx.lineWidth = 1.5;
          const r = 17, b = 6;
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
            ctx.beginPath(); ctx.moveTo(x + sx * r, y + sy * (r - b)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - b), y + sy * r); ctx.stroke();
          });
        }
        ctx.globalAlpha = p.status === "lost" ? 0.7 : 1;
        drawIcon(ctx, c, x, y, p.s.hdg, col, on);
        ctx.globalAlpha = 1;

        if ((show.labels && zoom >= 13.5) || on) {
          ctx.font = "700 11px ui-monospace, Consolas, monospace"; ctx.textAlign = "left";
          haloText(ctx, c.id, x + 16, y - 6, on ? C.sel : col);
          ctx.font = "11px system-ui, Segoe UI, sans-serif";
          const sub = p.status === "lost" ? "lost" : c.ais ? (zoom >= 15 || on ? c.name : "") : "no AIS";
          if (sub) haloText(ctx, sub, x + 16, y + 7, "#93a5b5");
        }
      });
    },

    click(e, Ops) {
      let best = null, bd = 16;
      CONTACTS.forEach((c) => {
        const p = pics.get(c.id);
        if (!p || p.status === "none") return;
        const [x, y] = Ops.map.project(p.s.lat, p.s.lon), d = Math.hypot(e.px - x, e.py - y);
        if (d < bd) { bd = d; best = c.id; }
      });
      if (best) { pick(best, false); return true; }
      if (selected) pick(null, false);
      return false;
    },
  };
  Ops.register(layer);

  Ops.contacts = {
    list: CONTACTS, kinds: KINDS, icons: ICONS,
    picture: (id) => pics.get(id),
    select: (id) => pick(id, true),
    selected: () => selected,
    onSelect: (fn) => selectHooks.push(fn),
    stateAt, sensorsAt,
    // For the map transport (transport.js). Positions are a pure function of
    // t, so seeking backwards is safe.
    clock: {
      get t() { return clock.t; },
      get rate() { return clock.rate; },
      get playing() { return clock.playing; },
      seek(t) { clock.t = Math.max(0, t); refresh(); paintHub(); Ops.map.redraw(); },
      play(on) { clock.playing = on; Ops.store.set("ct.playing", on); syncPlayHub(); },
    },
  };

  // The picture clock runs while the layer is on. The map redraws every frame
  // while the picture plays; the hub text refreshes twice a second.
  // dt is capped at 1 s so a tab coming back from the background does not jump.
  // Follow keeps the contact centred every frame; under reduced motion each
  // camera move is a cross-fade, so it recentres in steps instead.
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let last = performance.now(), lastHub = 0, lastFollow = 0, followSince = 0;
  function frame(now) {
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    if (layer.on !== false && Ops.map) {
      if (clock.playing) { clock.t += dt * clock.rate; Ops.map.redraw(); }
      if (now - lastHub > 500) { lastHub = now; refresh(); paintHub(); }
      if (follow && selected) {
        if (!followSince) followSince = now;
        const p = picture(CONTACTS.find((c) => c.id === selected), clock.t), [x, y] = Ops.map.project(p.s.lat, p.s.lon), [w, h] = Ops.map.size();
        const off = Math.hypot(x - w / 2, y - h / 2);
        if (reduced()) {
          if (off > 40 && now - lastFollow > 1000) { lastFollow = now; Ops.map.flyTo(p.s.lat, p.s.lon); }
        } else if (now - followSince > 750 && off > 0.5) {
          // After the first glide, lock on by moving the live centre. Not
          // flyTo(…, 1): map.js times animations from the frame timestamp, which
          // can be earlier than flyTo's start, and a 1 ms ease then overshoots.
          Ops.map.state.lat = p.s.lat; Ops.map.state.lon = p.s.lon; Ops.map.redraw();
        }
      } else followSince = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
