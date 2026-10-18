/* Layer 2: fibre ducts, DAS coverage, hydrophones.

   Fibre ducts are the three horizontal directional drills in Port of Los Angeles
   Spec 2737 (board report, 23 June 2011). The report names the ends by berth and
   gives a drill length, not survey coordinates. So each line is placed by rule,
   checked against the downloaded NOAA chart with tools/water_check.py:
     the spec length; both ends ashore; one continuous water crossing of the
     named channel; as close as possible to the berths the spec names.
   Result (land / water / land along the drill, from the first end):
     Main Channel          Berth 82 → Berths 235–236     20 / 370 / 350 m, 732 m
     Consolidated Channel  Berth 199 → Wilmington Marina 140 / 210 /  20 m, 366 m
     Cerritos Channel      Wilmington Marina → Berth 206 200 / 200 /  30 m, 427 m
   The lines are approximate: right length, right banks, not a survey.

   Everything else is simulated so the interface has something to show before the
   backend is connected: interrogator huts, land fibre runs, channel health, the
   hydrophone clusters, and both detection ranges, which the officer can change. */

(function () {
  const DUCTS = [
    { id: "main", name: "Main Channel", from: "Berth 82, Ports O'Call", to: "Berths 235–236, Terminal Island",
      length: 732, feet: 2400, interrogator: "A",
      a: [33.74476, -118.27631], b: [33.74534, -118.26843], wet: [20, 390],
      dead: [[0, 6], [402, 409], [726, 732]] },
    { id: "consolidated", name: "Consolidated Channel", from: "Berth 199, Wallenius Wilhelmsen", to: "Wilmington Marina",
      length: 366, feet: 1200, interrogator: "B",
      a: [33.76877, -118.25412], b: [33.76688, -118.25088], wet: [140, 350],
      dead: [[0, 4], [361, 366]] },
    { id: "cerritos", name: "Cerritos Channel", from: "Wilmington Marina", to: "Berth 206, Pasha",
      length: 427, feet: 1400, interrogator: "B",
      a: [33.76626, -118.24965], b: [33.76294, -118.24735], wet: [200, 400],
      dead: [[0, 5], [188, 199], [421, 427]] },
  ];

  // Huts sit ashore at a duct end; B feeds two ducts, so it has a land fibre run
  // to the Cerritos drill. Channel counts are simulated health, not live data.
  const INTERROGATORS = [
    { id: "A", lat: 33.74476, lon: -118.27631, ducts: ["main"], land: [], channels: [724, 732] },
    { id: "B", lat: 33.76688, lon: -118.25088, ducts: ["consolidated", "cerritos"],
      land: [[[33.76688, -118.25088], [33.76626, -118.24965]]], channels: [772, 793] },
  ];

  // Invented for the demo; each one checked to be in the water.
  const HYDROPHONES = [
    { id: "H-A", lat: 33.7472, lon: -118.2710, units: 4, online: 4, note: "Main Channel, north of the duct" },
    { id: "H-B", lat: 33.7390, lon: -118.2762, units: 2, online: 2, note: "Main Channel, south of the duct" },
    { id: "H-C", lat: 33.7580, lon: -118.2605, units: 2, online: 2, note: "East Basin" },
    { id: "H-D", lat: 33.7636, lon: -118.2469, units: 2, online: 1, note: "Cerritos Channel, east of the duct" },
  ];

  const show = {
    ducts: Ops.store.get("eq.ducts", true),
    das: Ops.store.get("eq.das", true),
    hydro: Ops.store.get("eq.hydro", true),
  };
  // Detection ranges are assumptions, not specs: the officer sets them.
  const range = { das: Ops.store.get("eq.dasRange", 300), hydro: Ops.store.get("eq.hydroRange", 600) };
  let selected = null; // "duct:main", "int:A", "hyd:H-A"
  // Shared with Layer 3, which needs to know what the sensors can hear. range is
  // the live object the sliders change.
  Ops.sensors = { ducts: DUCTS, hydrophones: HYDROPHONES, range, along: (d, m) => along(d, m) };

  const C = { fibre: "#3fc1d9", sel: "#f2a93b", dead: "#ff5a4f", hyd: "#8fd18a", halo: "rgba(4,8,12,0.85)" };
  const byId = (list, id) => list.find((x) => x.id === id);
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const along = (d, m) => lerp(d.a, d.b, m / d.length);

  function metres(a, b) {
    const lat = ((a[0] + b[0]) / 2) * Math.PI / 180;
    return Math.hypot((b[1] - a[1]) * 111320 * Math.cos(lat), (b[0] - a[0]) * 111320);
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function haloText(ctx, text, x, y, fill) {
    ctx.lineWidth = 3; ctx.strokeStyle = C.halo; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  function line(ctx, map, p, q) {
    const [x1, y1] = map.project(p[0], p[1]), [x2, y2] = map.project(q[0], q[1]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    return [x1, y1, x2, y2];
  }

  Ops.register({
    id: "equipment", no: 2, name: "Equipment", toggle: true, on: true,

    hub(el, Ops) {
      const pickRow = (kind, id, title, sub) =>
        `<button type="button" data-pick="${kind}:${id}"><span>${title}</span><small>${sub}</small></button>`;
      el.innerHTML = `
        <h2>Equipment</h2>
        <p class="note">Ducts follow Port of LA Spec 2737, placed approximately. Interrogators, hydrophones, health and ranges are simulated.</p>
        <table class="eq-status" aria-label="Equipment status">
          <thead><tr><th>Asset</th><th>Status</th><th class="r">Online</th></tr></thead>
          <tbody>
            ${INTERROGATORS.map((g) => statusRow("int", g.id, `Interrogator ${g.id}`, g.channels[0], g.channels[1], "ch")).join("")}
            ${HYDROPHONES.map((h) => statusRow("hyd", h.id, `Hydrophone ${h.id}`, h.online, h.units, "units")).join("")}
          </tbody>
        </table>
        <div class="checks">
          <label><input type="checkbox" data-show="ducts" ${show.ducts ? "checked" : ""}> Fibre and interrogators</label>
          <label><input type="checkbox" data-show="das" ${show.das ? "checked" : ""}> DAS coverage</label>
          <label><input type="checkbox" data-show="hydro" ${show.hydro ? "checked" : ""}> Hydrophone coverage</label>
        </div>
        <div class="eq-ranges">
          <label class="ov-row" for="rng-das"><span class="rl">DAS range</span><input id="rng-das" type="range" min="100" max="1000" step="50" value="${range.das}"><span class="mono rv" id="rv-das">${range.das} m</span></label>
          <label class="ov-row" for="rng-hyd"><span class="rl">Hydrophone range</span><input id="rng-hyd" type="range" min="100" max="1500" step="50" value="${range.hydro}"><span class="mono rv" id="rv-hyd">${range.hydro} m</span></label>
          <p class="note">Assumed detection ranges for a small, quiet target. Change them to see how coverage moves.</p>
        </div>
        <div class="detail" id="eq-detail" hidden></div>
        <h2 class="gap">Fibre ducts</h2>
        <div class="eq-list">${DUCTS.map((d) => pickRow("duct", d.id, d.name, `${d.length} m drill · interrogator ${d.interrogator}`)).join("")}</div>`;

      function statusRow(kind, id, name, on, total, unit) {
        const st = on === total ? "ok" : on / total > 0.9 ? "warn" : "bad";
        const word = { ok: "Online", warn: "Degraded", bad: "Fault" }[st];
        return `<tr data-pick="${kind}:${id}" tabindex="0"><td>${name}</td><td><span class="dot ${st}"></span>${word}</td><td class="r mono">${on} / ${total} ${unit}</td></tr>`;
      }

      el.querySelectorAll("[data-show]").forEach((cb) => cb.addEventListener("change", () => {
        show[cb.dataset.show] = cb.checked;
        Ops.store.set("eq." + cb.dataset.show, cb.checked);
        Ops.map.redraw();
      }));
      [["das", "#rng-das", "#rv-das", "eq.dasRange"], ["hydro", "#rng-hyd", "#rv-hyd", "eq.hydroRange"]].forEach(([k, inp, out, key]) => {
        const i = el.querySelector(inp);
        i.addEventListener("input", () => {
          range[k] = Number(i.value); el.querySelector(out).textContent = `${range[k]} m`;
          Ops.store.set(key, range[k]); Ops.map.redraw(); paintDetail();
        });
      });
      el.querySelectorAll("[data-pick]").forEach((b) => {
        b.addEventListener("click", () => pick(b.dataset.pick, Ops, true));
        b.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(b.dataset.pick, Ops, true); });
      });
      paintDetail();
    },

    draw(ctx, map) {
      const mpp = map.metresPerPx(), zoom = map.state.zoom;
      ctx.lineJoin = "round"; ctx.textBaseline = "middle";

      // DAS coverage: a band of the chosen range around the underwater stretch only.
      if (show.das) {
        ctx.lineCap = "round";
        DUCTS.forEach((d) => {
          ctx.strokeStyle = selected === "duct:" + d.id || selected === "int:" + d.interrogator ? "rgba(63,193,217,0.26)" : "rgba(63,193,217,0.14)";
          ctx.lineWidth = (2 * range.das) / mpp;
          line(ctx, map, along(d, d.wet[0]), along(d, d.wet[1]));
        });
        ctx.lineCap = "butt";
      }

      if (show.hydro) {
        HYDROPHONES.forEach((h) => {
          const [x, y] = map.project(h.lat, h.lon), on = selected === "hyd:" + h.id;
          ctx.beginPath(); ctx.arc(x, y, range.hydro / mpp, 0, Math.PI * 2);
          ctx.fillStyle = on ? "rgba(143,209,138,0.16)" : "rgba(143,209,138,0.06)"; ctx.fill();
          ctx.strokeStyle = on ? C.hyd : "rgba(143,209,138,0.45)"; ctx.lineWidth = on ? 1.5 : 1;
          ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        });
      }

      if (show.ducts) {
        // Land fibre from a hut to a duct it feeds.
        INTERROGATORS.forEach((g) => g.land.forEach(([p, q]) => {
          ctx.strokeStyle = C.fibre; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
          line(ctx, map, p, q); ctx.setLineDash([]);
        }));

        DUCTS.forEach((d) => {
          const on = selected === "duct:" + d.id, col = on ? C.sel : C.fibre;
          // Buried on land: thin. Under the channel: the sensing stretch, thick.
          ctx.strokeStyle = col; ctx.lineWidth = 1.5;
          const [x1, y1, x2, y2] = line(ctx, map, d.a, d.b);
          ctx.lineWidth = on ? 4 : 3;
          line(ctx, map, along(d, d.wet[0]), along(d, d.wet[1]));
          // Dead or decoupled channels (simulated), in red.
          ctx.strokeStyle = C.dead; ctx.lineWidth = on ? 5 : 4;
          d.dead.forEach(([s, e]) => line(ctx, map, along(d, s), along(d, Math.max(e, s + 3 * mpp))));
          // Channel ticks every 100 m once zoomed in.
          const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
          if (zoom >= 15) {
            ctx.strokeStyle = col; ctx.lineWidth = 1;
            for (let m = 100; m < d.length; m += 100) {
              const [tx, ty] = map.project(...along(d, m));
              ctx.beginPath(); ctx.moveTo(tx - nx * 4, ty - ny * 4); ctx.lineTo(tx + nx * 4, ty + ny * 4); ctx.stroke();
            }
            ctx.font = "10px ui-monospace, Consolas, monospace";
            haloText(ctx, "ch 0", x1 - nx * 14 - 10, y1 - ny * 14, "#93a5b5");
            haloText(ctx, `ch ${d.length}`, x2 - nx * 14 - 14, y2 - ny * 14, "#93a5b5");
          }
          if (zoom >= 14.5 || on) {
            const lx = (x1 + x2) / 2 + nx * 16, ly = (y1 + y2) / 2 + ny * 16;
            ctx.font = "600 11px system-ui, Segoe UI, sans-serif";
            haloText(ctx, d.name.toUpperCase(), lx, ly, on ? C.sel : "#dbe5ee");
            ctx.font = "11px system-ui, Segoe UI, sans-serif";
            haloText(ctx, `${d.length} m drill · approximate`, lx, ly + 13, "#93a5b5");
          }
        });

        INTERROGATORS.forEach((g) => {
          const [x, y] = map.project(g.lat, g.lon), on = selected === "int:" + g.id;
          ctx.fillStyle = on ? C.sel : "#071016"; ctx.strokeStyle = on ? C.sel : C.fibre; ctx.lineWidth = 1.5;
          ctx.fillRect(x - 8, y - 8, 16, 16); ctx.strokeRect(x - 8, y - 8, 16, 16);
          ctx.fillStyle = on ? "#071016" : C.fibre; ctx.font = "700 10px ui-monospace, Consolas, monospace";
          ctx.textAlign = "center"; ctx.fillText(g.id, x, y + 0.5); ctx.textAlign = "left";
          ctx.font = "600 11px system-ui, Segoe UI, sans-serif";
          if (zoom >= 14.5 || on) { ctx.textAlign = "right"; haloText(ctx, `INTERROGATOR ${g.id}`, x - 13, y, on ? C.sel : C.fibre); ctx.textAlign = "left"; }
        });
      }

      if (show.hydro) {
        HYDROPHONES.forEach((h) => {
          const [x, y] = map.project(h.lat, h.lon), on = selected === "hyd:" + h.id;
          ctx.fillStyle = on ? C.sel : h.online < h.units ? "#f2a93b" : C.hyd;
          ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.fill();
          ctx.font = "600 11px system-ui, Segoe UI, sans-serif";
          if (zoom >= 13.5 || on) haloText(ctx, h.id, x + 10, y, on ? C.sel : C.hyd);
        });
      }
    },

    click(e, Ops) {
      const hits = [], { px, py } = e, P = (lat, lon) => Ops.map.project(lat, lon);
      if (show.hydro) HYDROPHONES.forEach((h) => { const [x, y] = P(h.lat, h.lon); const d = Math.hypot(px - x, py - y); if (d < 12) hits.push(["hyd:" + h.id, d]); });
      if (show.ducts) INTERROGATORS.forEach((g) => { const [x, y] = P(g.lat, g.lon); const d = Math.hypot(px - x, py - y); if (d < 12) hits.push(["int:" + g.id, d]); });
      if (show.ducts) DUCTS.forEach((d) => {
        const [x1, y1] = P(...d.a), [x2, y2] = P(...d.b), dist = segDist(px, py, x1, y1, x2, y2);
        if (dist < 8) hits.push(["duct:" + d.id, dist + 2]); // markers win over the line they sit on
      });
      if (!hits.length) { if (selected) pick(null, Ops, false); return false; }
      hits.sort((a, b) => a[1] - b[1]);
      pick(hits[0][0], Ops, false);
      return true;
    },
  });

  function pick(key, Ops, fly) {
    selected = key;
    document.querySelectorAll("[data-pick]").forEach((b) => {
      if (b.tagName === "TR") b.classList.toggle("on", b.dataset.pick === key);
      else b.setAttribute("aria-pressed", String(b.dataset.pick === key));
    });
    paintDetail(); Ops.map.redraw();
    if (!fly || !key) return;
    const [kind, id] = key.split(":");
    if (kind === "duct") {
      const d = byId(DUCTS, id), pad = 0.004;
      Ops.map.fitBox([Math.min(d.a[1], d.b[1]) - pad, Math.min(d.a[0], d.b[0]) - pad, Math.max(d.a[1], d.b[1]) + pad, Math.max(d.a[0], d.b[0]) + pad]);
    } else {
      const p = kind === "int" ? byId(INTERROGATORS, id) : byId(HYDROPHONES, id);
      Ops.map.flyTo(p.lat, p.lon, 15.5);
    }
  }

  function paintDetail() {
    const el = document.getElementById("eq-detail");
    if (!el) return;
    if (!selected) { el.hidden = true; el.innerHTML = ""; return; }
    const [kind, id] = selected.split(":");
    const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join("")}</div>`;
    let html = "";
    if (kind === "duct") {
      const d = byId(DUCTS, id), deadN = d.dead.reduce((n, [s, e]) => n + e - s, 0);
      html = `<h3>${d.name} duct</h3><p>${d.from} to ${d.to}.</p>` + kv([
        ["Drill length", `${d.length} m (${d.feet.toLocaleString()} ft), Spec 2737`],
        ["Drawn length", `${Math.round(metres(d.a, d.b))} m, approximate`],
        ["Under water", `${d.wet[1] - d.wet[0]} m, ch ${d.wet[0]} to ${d.wet[1]}`],
        ["Channels", `${d.length} at 1 m, ${deadN} dead (simulated)`],
        ["Interrogator", d.interrogator],
        ["Coverage", `${range.das} m either side of the underwater stretch (assumed)`],
      ]);
    } else if (kind === "int") {
      const g = byId(INTERROGATORS, id);
      html = `<h3>Interrogator ${g.id}</h3><p>Simulated hut ashore at the end of the ${g.ducts.map((x) => byId(DUCTS, x).name).join(" and ")} drill${g.ducts.length > 1 ? "s" : ""}.</p>` + kv([
        ["Fibre", g.ducts.map((x) => `${byId(DUCTS, x).name}, ${byId(DUCTS, x).length} m`).join("<br>")],
        ["Channels online", `${g.channels[0]} of ${g.channels[1]}`],
        ["Land fibre", g.land.length ? `${Math.round(metres(...g.land[0]))} m to the Cerritos drill` : "None, hut at the drill end"],
        ["Mode", "Passive, listens only"],
      ]);
    } else {
      const h = byId(HYDROPHONES, id);
      html = `<h3>Hydrophone ${h.id}</h3><p>Simulated cluster. ${h.note}.</p>` + kv([
        ["Units online", `${h.online} of ${h.units}`],
        ["Position", `${h.lat.toFixed(4)}° N, ${Math.abs(h.lon).toFixed(4)}° W`],
        ["Range", `${range.hydro} m (assumed)`],
        ["Mode", "Passive, listens only"],
      ]);
    }
    el.hidden = false; el.innerHTML = html;
    el.scrollIntoView({ block: "nearest" });
  }
})();
