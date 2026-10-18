/* Layer 5: the 9m_Test acoustic array, drawn on the ops map.

   The run itself is the Nemo Array scenario (output/isotropic_2D), loaded
   from data/array-scenario.json. Positions in that file are metres from the
   array. This layer places the array on Terminal Island, just inland of the
   Main Channel duct's landward end, and plays the same replay: detect,
   bearing, track, classify, then an officer decision. Nothing is transmitted
   and nothing is cued. */

(function () {
  // Landward of the Main Channel duct (Berths 235–236). Simulated site.
  const SITE = { lat: 33.7476, lon: -118.2689, name: "Terminal Island array" };

  const SPEEDS = [1, 2, 4, 8];
  const readSpeed = (v) => (SPEEDS.includes(Number(v)) ? Number(v) : 1);
  const q = new URLSearchParams(location.search);
  const app = {
    t: 0, playing: false, decision: null, lastK: -1, flew: false,
    speed: readSpeed(q.get("speed")),
    loop: q.get("loop") === "1",
  };
  let scenario = null;
  let layer = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function at(keys, t) {
    if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i], u = (t - a[0]) / (b[0] - a[0]);
        return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u };
      }
    }
    const z = keys[keys.length - 1];
    return { x: z[1], y: z[2] };
  }
  const detected = (t) => {
    const c = scenario.contact;
    if (t < c.firstHeard) return false;
    const d = c.dropout || [];
    return !(t >= d[0] && t < d[1]);
  };
  function report(t) {
    const c = scenario.contact, p = at(c.keys, t);
    const range = Math.hypot(p.x, p.y);
    const brg = (Math.atan2(p.x, p.y) * 180 / Math.PI + 360) % 360;
    const lock = t >= c.bearingLock;
    const err = lock ? Math.max(0.6, 9 * Math.exp(-(t - c.bearingLock) / 12)) : 9 + 3 * Math.sin(t * 0.9);
    const reportedBrg = (brg + err * Math.sin(t * 1.3) + 360) % 360;
    const haveRange = t >= c.rangeFrom && detected(t);
    const reportedRange = haveRange ? range * (1 + 0.05 * Math.sin(t * 0.8)) : null;
    const rad = reportedBrg * Math.PI / 180;
    return {
      reportedBrg, reportedRange, err, on: detected(t),
      fix: reportedRange == null ? null : { x: Math.sin(rad) * reportedRange, y: Math.cos(rad) * reportedRange },
      sigma: lock ? Math.max(2.2, 14 * Math.exp(-(t - c.bearingLock) / 14)) : 16,
    };
  }
  function toLl(east, north) {
    const lat = SITE.lat + north / 111320;
    const lon = SITE.lon + east / (111320 * Math.cos(SITE.lat * Math.PI / 180));
    return [lat, lon];
  }
  function fmt(t) {
    const s = Math.max(0, Math.round(t));
    return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  function chapter(t) {
    let cur = scenario.chapters[0];
    for (const c of scenario.chapters) if (t >= c.t) cur = c;
    return cur;
  }
  function narration(t) {
    const lines = scenario.modes.site.narration;
    let text = lines[0][1];
    for (const [ts, line] of lines) if (t >= ts) text = line;
    return text;
  }
  function tier(t) {
    const c = scenario.contact;
    if (t >= scenario.decisionAt) return 4;
    if (t >= c.trackFrom) return 3;
    if (t >= c.firstHeard) return 2;
    return 1;
  }

  function paint() {
    if (!scenario || !$("#array-readout")) return;
    const t = app.t, rep = report(t), c = scenario.contact, ch = chapter(t);
    const sum = scenario.summary;
    $("#array-time").textContent = fmt(t) + (app.speed > 1 ? ` · ${app.speed}×` : "") + (app.loop ? " · loop" : "");
    const speedEl = $("#array-speed");
    if (speedEl && speedEl.value !== String(app.speed)) speedEl.value = String(app.speed);
    const loopEl = $("#array-loop");
    if (loopEl) loopEl.checked = app.loop;
    $("#array-scrub").value = t;
    const play = $("#array-play");
    play.setAttribute("aria-pressed", String(app.playing));
    play.setAttribute("aria-label", app.playing ? "Pause the array replay" : "Play the array replay");
    document.querySelectorAll(".array-ch button").forEach((b) => {
      if (Number(b.dataset.t) === ch.t) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    const cls = t >= c.classFrom ? "small craft, 19%" : "unclassified";   // matches the run's narration at classFrom
    const range = rep.fix ? where(rep.fix, rep) : "position not yet";   // a map position, not the test rig's few-metre range
    $("#array-readout").innerHTML = t < c.firstHeard
      ? `<h3>${esc(SITE.name)}</h3><p>Listening. ${esc(scenario.place)}. Gate closed.</p><p>${esc(sum.nReceivers)} microphones, ${esc(sum.domain)} domain, ${esc(sum.signal)} source.</p>`
      : `<h3>TRK-01 · tier ${tier(t)}</h3>
         <p>${rep.on ? "Above the RMS gate." : "Dropped one window. Track held."} Bearing ${rep.reportedBrg.toFixed(0)}°, ${range}.</p>
         <p>${t >= c.trackFrom ? "Track confirmed. " : "Track tentative. "}${esc(cls)}. Published detection ${Math.round(sum.detectionRate * 100)}%, mean bearing error ${Number(sum.meanBearingErrorDeg).toFixed(1)}°.</p>`;
    const decide = $("#array-decide");
    if (t >= scenario.decisionAt && !app.decision) {
      decide.hidden = false;
      if (!decide.dataset.built) {
        decide.dataset.built = "1";
        decide.innerHTML = `<p>The console proposes. Only you choose.</p><div class="array-choices">${
          scenario.modes.site.decisions.map((d) => `<button type="button" data-decide="${d.key}"><strong>${esc(d.label)}</strong><small>${esc(d.note)}</small></button>`).join("")
        }</div>`;
      }
    } else if (app.decision) {
      decide.hidden = false;
      decide.innerHTML = `<p><strong>${esc(app.decision.label)}</strong> at ${fmt(app.decision.t)}. Logged against TRK-01. The system takes no action on its own.</p>`;
      delete decide.dataset.built;
    } else {
      decide.hidden = true;
    }
    const cap = $("#array-cap");
    if (cap) {
      cap.hidden = layer && layer.on === false;
      cap.classList.toggle("alert", tier(t) >= 4);
      cap.innerHTML = `<span class="ch">${ch.n} · ${esc(ch.title)}</span>${esc(narration(t))}`;
    }
    paintAlert(t, rep);
  }

  // Alert level on the map, driven by the replay tier: GREEN while the array is
  // quiet, AMBER while TRK-01 is heard or tracked, RED once it is unexplained in
  // the sector. At RED the card lists the recommended crisis actions. They are
  // recommendations only; the officer's choice is made in the hub.
  // After the officer decides, the card moves to an outcome. For hold and
  // notify, the response steps complete one by one as the replay runs on (at
  // `at` seconds after the decision). All simulated.
  const LEVELS = {
    green: { level: "green", name: "GREEN", why: "Harbour normal. Array listening." },
    amber2: { level: "amber", name: "AMBER", why: "Contact detected. Not yet tracked." },
    amber3: { level: "amber", name: "AMBER", why: "TRK-01 tracked. Unidentified." },
    red: { level: "red", name: "RED", why: "TRK-01 unexplained inside the array sector." },
    "out-hold": { level: "amber", name: "AMBER", why: "Western approach held. Response under way.", response: true },
    "out-notify": { level: "amber", name: "AMBER", why: "Site security notified. Response under way.", response: true },
    "out-known": { level: "green", name: "GREEN", why: "TRK-01 logged as explained. Recommendations withdrawn." },
    "out-monitor": { level: "red", name: "RED", why: "TRK-01 still unexplained. The console asks again in 2 min." },
  };
  const RESPONSE = [
    { at: 0, text: "Main Channel closed to inbound and outbound traffic" },
    { at: 3, text: "Mine-countermeasures team dispatched to TRK-01's last position" },
    { at: 6, text: "Captain of the Port and Port Police notified" },
    { at: 10, text: "Mine-countermeasures team on scene, searching" },
  ];
  // A map position reads better in a harbour than the test rig's few-metre range.
  function where(fix, rep) {
    if (!fix) return `bearing ${rep.reportedBrg.toFixed(0)}°`;
    const [lat, lon] = toLl(fix.x, fix.y);
    return `${lat.toFixed(4)}° N, ${Math.abs(lon).toFixed(4)}° W`;
  }
  function paintAlert(t, rep) {
    const card = $("#alert-card");
    if (!card) return;
    card.hidden = layer && layer.on === false;
    const tr = tier(t);
    const key = app.decision ? "out-" + app.decision.key
      : tr >= 4 ? "red" : tr === 3 ? "amber3" : tr === 2 ? "amber2" : "green";
    const L = LEVELS[key] || LEVELS.red;
    const recs = card.querySelector(".alert-recs");
    if (card.dataset.key !== key) {
      const changed = !!card.dataset.key;
      card.dataset.key = key;
      card.dataset.level = L.level;
      card.querySelector(".lvl").textContent = L.name;
      card.querySelector(".why").textContent = L.why;
      recs.hidden = !(key === "red" || L.response);
      recs.querySelector("h3").textContent = L.response ? "Response" : "Recommended actions";
      recs.querySelector("ol").innerHTML = L.response
        ? RESPONSE.map((s) => `<li data-at="${s.at}"><span class="st" aria-hidden="true"></span>${esc(s.text)}<span class="when mono"></span></li>`).join("")
        : `<li>Close the Main Channel to inbound and outbound traffic.</li>
           <li>Dispatch the mine-countermeasures team to TRK-01's last position, <span class="rec-fix mono"></span>.</li>
           <li>Notify the Captain of the Port and Port Police.</li>`;
      recs.querySelector("ol").classList.toggle("steps", !!L.response);
      if (changed) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    }
    if (key === "red") {
      recs.querySelector(".rec-fix").textContent = where(rep.fix, rep);
      card.querySelector(".alert-foot").textContent = "Recommended. The officer decides in the hub.";
    } else if (L.response) {
      const dt = t - app.decision.t;
      recs.querySelectorAll("li").forEach((li) => {
        const done = dt >= Number(li.dataset.at);
        li.classList.toggle("done", done);
        li.querySelector(".when").textContent = done ? ` ${fmt(app.decision.t + Number(li.dataset.at))}` : " pending";
      });
      card.querySelector(".alert-foot").textContent = `Officer chose: ${app.decision.label}, ${fmt(app.decision.t)}. Search area ${where(app.decision.fix, rep)}.`;
    }
  }

  // Map marks for the response: the Main Channel closure and the search area.
  const CHANNEL = { lat: 33.7366, lon: -118.2744 };   // "Main Channel, San Pedro" place
  function drawResponse(ctx, map) {
    if (!app.decision || !LEVELS["out-" + app.decision.key]?.response) return;
    const dt = app.t - app.decision.t;
    const chip = (x, y, text, col) => {
      ctx.font = "700 11px ui-monospace, Consolas, monospace";
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = "rgba(6,9,13,0.9)"; ctx.fillRect(x - w / 2, y - 10, w, 20);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y - 9.5, w - 1, 19);
      ctx.fillStyle = col; ctx.textAlign = "center"; ctx.fillText(text, x, y + 1); ctx.textAlign = "left";
    };
    if (dt >= 0) {
      const [x, y] = map.project(CHANNEL.lat, CHANNEL.lon);
      chip(x, y - 22, "MAIN CHANNEL CLOSED", "#ff5a4f");
    }
    if (dt >= 3 && app.decision.fix) {
      const [lat, lon] = toLl(app.decision.fix.x, app.decision.fix.y);
      const [x, y] = map.project(lat, lon);
      const r = Math.max(18, 25 / map.metresPerPx());
      ctx.strokeStyle = "#3fc1d9"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      chip(x, y + r + 14, dt >= 10 ? "MCM SEARCHING" : "MCM EN ROUTE", "#3fc1d9");
    }
  }

  function seek(t) {
    app.t = Math.max(0, Math.min(scenario.duration, t));
    if (app.decision && app.t <= app.decision.t) app.decision = null;   // jumping back to Decide asks again
    app.lastK = -1;
    paint();
    if (window.Ops.map) Ops.map.redraw();
  }

  function showArray() {
    Ops.map.flyTo(SITE.lat, SITE.lon, 17);
    app.flew = true;
  }

  layer = {
    id: "array", no: 5, name: "Acoustic array", toggle: true, on: true,
    hub(el) {
      el.innerHTML = `
        <h2>Acoustic array</h2>
        <p class="note">The 9m_Test replay, placed on Terminal Island. Passive microphones. The officer decides; this screen does not cue anything.</p>
        <div class="array-transport">
          <button type="button" class="array-play" id="array-play" aria-label="Play the array replay" aria-pressed="false"><span class="ic ic-play" aria-hidden="true">&#x25B6;&#xFE0E;</span><span class="ic ic-pause" aria-hidden="true">&#x275A;&#x275A;</span></button>
          <input type="range" id="array-scrub" min="0" max="100" step="0.5" value="0" aria-label="Array replay time">
          <span class="array-time" id="array-time">T+00:00</span>
        </div>
        <div class="array-rate">
          <label>Speed
            <select id="array-speed">${SPEEDS.map((n) => `<option value="${n}"${n === app.speed ? " selected" : ""}>${n}×</option>`).join("")}</select>
          </label>
          <label><input type="checkbox" id="array-loop"${app.loop ? " checked" : ""}> Loop</label>
        </div>
        <div class="array-ch" id="array-ch"></div>
        <p><button type="button" id="array-show">Show the array</button></p>
        <div class="detail" id="array-readout">Loading the published run…</div>
        <div id="array-decide" hidden></div>`;
      $("#array-play").addEventListener("click", () => {
        if (!scenario) return;
        app.playing = !app.playing;
        if (app.playing && app.t >= scenario.duration - 0.05) seek(0);
        if (app.playing && !app.flew) showArray();
        paint();
      });
      $("#array-speed").addEventListener("change", (e) => { app.speed = readSpeed(e.target.value); paint(); });
      $("#array-loop").addEventListener("change", (e) => { app.loop = e.target.checked; paint(); });
      $("#array-scrub").addEventListener("input", (e) => { app.playing = false; seek(Number(e.target.value)); });
      $("#array-show").addEventListener("click", showArray);
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-decide]");
        if (!b || app.decision || !scenario || app.t < scenario.decisionAt) return;
        const d = scenario.modes.site.decisions.find((x) => x.key === b.dataset.decide);
        app.decision = { key: d.key, label: d.label, t: app.t, fix: report(app.t).fix };
        app.playing = true;
        paint();
      });
    },
    draw(ctx, map) {
      if (!scenario) return;
      drawResponse(ctx, map);
      const zoom = map.state.zoom;
      const [ax, ay] = map.project(SITE.lat, SITE.lon);
      const rep = report(app.t);
      const col = tier(app.t) >= 4 ? "#ff5a4f" : rep.on ? "#f2a93b" : "#3fc1d9";

      if (zoom >= 16) {
        ctx.strokeStyle = "rgba(63,193,217,0.35)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.arc(ax, ay, scenario.array.sectorM / map.metresPerPx(), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        scenario.array.mics.forEach((m) => {
          const [lat, lon] = toLl(m[0], m[1]);
          const [x, y] = map.project(lat, lon);
          ctx.fillStyle = "#3fc1d9";
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      ctx.strokeStyle = "#3fc1d9";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ax, ay, zoom >= 16 ? 7 : 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "600 11px system-ui, Segoe UI, sans-serif";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(4,8,12,0.85)";
      ctx.strokeText("ARRAY", ax + 10, ay);
      ctx.fillStyle = "#3fc1d9";
      ctx.fillText("ARRAY", ax + 10, ay);

      if (rep.on) {
        const rad = rep.reportedBrg * Math.PI / 180;
        const len = 450 / map.metresPerPx();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.sin(rad) * len, ay - Math.cos(rad) * len);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (rep.fix && zoom >= 15.5) {
        const [lat, lon] = toLl(rep.fix.x, rep.fix.y);
        const [x, y] = map.project(lat, lon);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(8, rep.sigma / map.metresPerPx()), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(4,8,12,0.85)";
        ctx.font = "700 13px ui-monospace, Consolas, monospace";
        ctx.strokeText("TRK-01", x + 12, y - 12);
        ctx.fillStyle = col;
        ctx.fillText("TRK-01", x + 12, y - 12);
        ctx.font = "600 11px system-ui, Segoe UI, sans-serif";
      }
    },
    click(e, Ops) {
      if (!scenario) return false;
      const [x, y] = Ops.map.project(SITE.lat, SITE.lon);
      if (Math.hypot(e.px - x, e.py - y) < 14) { showArray(); return true; }
      const rep = report(app.t);
      if (rep.fix) {
        const [lat, lon] = toLl(rep.fix.x, rep.fix.y);
        const [cx, cy] = Ops.map.project(lat, lon);
        if (Math.hypot(e.px - cx, e.py - cy) < 14) { showArray(); return true; }
      }
      return false;
    },
  };
  Ops.register(layer);

  // For the map transport (transport.js): the same play, pause and seek as the
  // hub controls.
  Ops.array = {
    ready: () => !!scenario,
    get t() { return app.t; },
    get duration() { return scenario ? scenario.duration : 0; },
    get playing() { return app.playing; },
    chapter: () => (scenario ? chapter(app.t) : null),
    fmt,
    seek,
    play(on) {
      if (!scenario) return;
      app.playing = on;
      if (on && app.t >= scenario.duration - 0.05) seek(0);
      if (on && !app.flew) showArray();
      paint();
    },
  };

  function arm() {
    const ch = $("#array-ch");
    if (!ch || ch.childElementCount) return;
    $("#array-scrub").max = scenario.duration;
    ch.innerHTML = scenario.chapters.map((c) => `<button type="button" data-t="${c.t}"><span class="n">${c.n}</span>${esc(c.title)}</button>`).join("");
    ch.addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]");
      if (!b) return;
      app.playing = false;
      seek(Number(b.dataset.t));
    });
    const cap = document.createElement("div");
    cap.id = "array-cap";
    cap.className = "array-cap";
    document.querySelector(".mapwrap").appendChild(cap);
    const card = document.createElement("div");
    card.id = "alert-card";
    card.className = "alert-card";
    card.innerHTML = `
      <div class="alert-level" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="lbl">Alert</span><span class="lvl"></span></div>
      <p class="why"></p>
      <div class="alert-recs" hidden>
        <h3>Recommended actions</h3>
        <ol>
          <li>Close the Main Channel to inbound and outbound traffic.</li>
          <li>Dispatch the mine-countermeasures team to TRK-01's last fix, <span class="rec-fix mono"></span>.</li>
          <li>Notify the Captain of the Port and Port Police.</li>
        </ol>
        <p class="alert-foot"></p>
      </div>`;
    document.querySelector(".mapwrap").appendChild(card);
    paint();
    Ops.map.redraw();
  }

  fetch("data/array-scenario.json")
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((data) => {
      scenario = data;
      // The exported run labels this choice for a drone; in the harbour story it is a vessel.
      const known = scenario.modes.site.decisions.find((d) => d.key === "known");
      if (known) known.label = "Log as authorized traffic";
      if (document.getElementById("array-readout")) arm();
    })
    .catch(() => {
      const el = document.getElementById("array-readout");
      if (el) el.textContent = "The array scenario did not load. Run examples/export_nemo_scenario.py in 9m_Test.";
    });

  document.addEventListener("DOMContentLoaded", () => { if (scenario) arm(); });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const cap = document.getElementById("array-cap");
    if (cap) cap.hidden = !scenario || layer.on === false;
    const card = document.getElementById("alert-card");
    if (card) card.hidden = !scenario || layer.on === false;
    if (scenario && app.playing && layer.on !== false) {
      let t = app.t + dt * app.speed;
      const gate = scenario.decisionAt;
      if (!app.decision && t >= gate && app.t < gate + 1e-6) {
        t = gate;
        app.lastK = -1; // the hold shares a 0.5 s bucket with the moment before it
      }
      if (t >= scenario.duration) {
        if (app.loop) {
          t = (t - scenario.duration) % scenario.duration;
          app.decision = null;
        } else {
          t = scenario.duration;
          app.playing = false;
        }
        app.lastK = -1;
      }
      app.t = t;
      const k = Math.round(t * 2) / 2;
      if (k !== app.lastK) { app.lastK = k; paint(); }
      if (window.Ops.map) Ops.map.redraw();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
