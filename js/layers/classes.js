/* Layer 4: sound classes and their icons.

   Each contact on the picture gets a class from its acoustic signature, using
   the rule step of the team's pipeline (step 7.2):
     cavitation with a low blade rate is a large vessel; strong cavitation at
     low speed is a tug or workboat; a fast blade rate with cavitation is small
     craft; a tonal thruster with no cavitation under 4 kn is a UUV candidate;
     a breathing cadence is a diver; click trains are biological; stationary
     with no signature is debris or an artifact.
   Signatures and class probabilities are simulated: the real classifier lives
   in the backend repository. A contact is classified only while a Layer 2
   sensor hears it; a ship that only AIS reports takes its class from AIS, and
   the hub says so. Where both exist, the acoustic class is checked against
   the AIS ship type, which is how a mislabelled or spoofed AIS shows up.

   The officer assigns each class an icon shape and a colour in the hub. The
   choice is remembered, and the contacts layer draws with it through the
   Ops.classes hooks (iconFor, colourFor, summary). */

(function () {
  // Icons point north (up); the contacts layer rotates them to the heading.
  const ICONS = {
    hull: { name: "Large hull", d: "M0 -11 L4.5 -5 L4.5 9 L-4.5 9 L-4.5 -5 Z" },
    tug: { name: "Tug", d: "M0 -7 L4.5 -3 L4.5 6 L-4.5 6 L-4.5 -3 Z" },
    boat: { name: "Small boat", d: "M0 -8 L5.5 7 L0 3.5 L-5.5 7 Z" },
    fast: { name: "Fast boat", d: "M0 -10 L3.5 8 L0 5 L-3.5 8 Z" },
    uuv: { name: "Underwater vehicle", d: "M-2.5 -8 Q0 -12 2.5 -8 L2.5 6 L5.5 10 L-5.5 10 L-2.5 6 Z" },
    diver: { name: "Diver", d: "M0 -11 A3 3 0 1 1 -0.01 -11 Z M-4.5 -4 L4.5 -4 L3 9 L-3 9 Z" },
    fish: { name: "Marine life", d: "M0 -9 Q7 -1 0 6 Q-7 -1 0 -9 Z M0 6 L-4.5 10.5 L4.5 10.5 Z" },
    diamond: { name: "Diamond", d: "M0 -9 L7 0 L0 9 L-7 0 Z" },
    square: { name: "Square", d: "M-6 -6 L6 -6 L6 6 L-6 6 Z" },
    triangle: { name: "Triangle", d: "M0 -9 L8 7 L-8 7 Z" },
  };
  const COLOURS = [
    [null, "AIS status"], ["#4aa3ff", "Blue"], ["#f2a93b", "Amber"], ["#ff5a4f", "Red"],
    ["#8fd18a", "Green"], ["#c38bff", "Violet"], ["#e8edf2", "White"],
  ];

  const CLASSES = [
    { id: "large", name: "Large vessel", icon: "hull", colour: null, rule: "Cavitation, blade rate under 12 Hz" },
    { id: "tug", name: "Tug or workboat", icon: "tug", colour: null, rule: "Strong cavitation at low speed, blade rate 12 to 20 Hz" },
    { id: "small", name: "Small craft", icon: "boat", colour: null, rule: "Cavitation, blade rate over 25 Hz" },
    { id: "uuv", name: "UUV candidate", icon: "uuv", colour: "#ff5a4f", rule: "Tonal thruster, no cavitation, under 4 kn" },
    { id: "diver", name: "Diver", icon: "diver", colour: "#ff5a4f", rule: "Breathing cadence, no machinery" },
    { id: "bio", name: "Biological", icon: "fish", colour: "#8fd18a", rule: "Click trains" },
    { id: "debris", name: "Debris or artifact", icon: "square", colour: null, rule: "Stationary, no signature" },
  ];
  const AIS_CLASS = { cargo: "large", tanker: "large", bulk: "large", passenger: "large", tug: "tug", pilot: "small", fishing: "small" };
  const AIS_WORD = { cargo: "container ship", tanker: "tanker", bulk: "bulk carrier", passenger: "passenger ferry", tug: "tug", pilot: "pilot boat", fishing: "fishing vessel" };

  // Simulated signatures, one per Layer 3 contact. blade: blade rate (Hz);
  // tonals: steady lines (Hz); cav: cavitation; breath: breaths per minute.
  const SIG = {
    "U-01": { cls: "uuv", tonals: [206, 412, 618], cav: false, probs: { uuv: 0.78, diver: 0.09, small: 0.06, bio: 0.04, debris: 0.03 } },
    "U-02": { cls: "diver", breath: 15, cav: false, probs: { diver: 0.71, bio: 0.14, uuv: 0.09, debris: 0.06 } },
    "V-101": { cls: "large", blade: 8.5, cav: true, probs: { large: 0.93, tug: 0.05, small: 0.02 } },
    // Its AIS says a 45 m passenger ferry; it sounds like a small fast boat.
    // It runs the Main Channel past the fibre, so the mismatch shows in the demo.
    "V-102": { cls: "small", blade: 34, cav: true, probs: { small: 0.77, tug: 0.14, large: 0.09 } },
    "V-103": { cls: "tug", blade: 15, cav: true, probs: { tug: 0.86, large: 0.09, small: 0.05 } },
    "V-104": { cls: "small", blade: 41, cav: true, probs: { small: 0.9, tug: 0.07, large: 0.03 } },
    "V-105": { cls: "large", tonals: [60, 120, 180], cav: false, anchored: true, probs: { large: 0.84, debris: 0.1, tug: 0.06 } },
    "V-106": { cls: "large", blade: 7.5, cav: true, probs: { large: 0.92, tug: 0.06, small: 0.02 } },
    "V-107": { cls: "small", blade: 28, cav: true, probs: { small: 0.82, tug: 0.12, large: 0.06 } },
  };
  const RULE_TEXT = {
    large: (s) => s.anchored ? "Stationary with steady machinery tonals at 60 Hz and harmonics: a large vessel at anchor" : `Cavitation with a blade rate of ${s.blade} Hz`,
    tug: (s) => `Strong cavitation at low speed, blade rate ${s.blade} Hz`,
    small: (s) => `Cavitation with a fast blade rate of ${s.blade} Hz`,
    uuv: (s) => `Tonal thruster at ${s.tonals[0]} Hz with harmonics, no cavitation, under 4 kn`,
    diver: (s) => `Breathing cadence of ${s.breath} a minute, no machinery`,
    bio: () => "Click trains",
    debris: () => "Stationary, no signature",
  };

  // ---------- assignments, remembered ----------
  const saved = Ops.store.get("cls.assign", {});
  CLASSES.forEach((k) => { if (saved[k.id]) Object.assign(k, saved[k.id]); });
  function save() { Ops.store.set("cls.assign", Object.fromEntries(CLASSES.map((k) => [k.id, { icon: k.icon, colour: k.colour }]))); }
  // Factory settings, for the reset button.
  const DEFAULTS = {
    large: ["hull", null], tug: ["tug", null], small: ["boat", null], uuv: ["uuv", "#ff5a4f"],
    diver: ["diver", "#ff5a4f"], bio: ["fish", "#8fd18a"], debris: ["square", null],
  };

  const byId = (id) => CLASSES.find((k) => k.id === id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const pct = (v) => `${Math.round(v * 100)}%`;
  const lower = (name) => name.replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()); // "UUV candidate" stays, "Large vessel" -> "large vessel"
  const svg = (d, col, size = 18) => `<svg class="cl-ic" width="${size}" height="${size}" viewBox="-12 -12 24 24" aria-hidden="true"><path d="${d}" fill="${col}" stroke="rgba(4,8,12,0.9)" stroke-width="1.2"/></svg>`;

  // What class a contact carries right now, and where that came from.
  function classify(c) {
    const P = Ops.contacts, p = P && P.picture(c.id), s = SIG[c.id];
    if (!p || p.status === "none") return null;
    const heard = p.sens.length > 0;
    if ((heard || p.status === "lost") && s) {
      const aisCls = c.ais ? AIS_CLASS[c.kind] : null;
      return { cls: byId(s.cls), from: p.status === "lost" ? "last heard" : "acoustic", sig: s,
        conf: s.probs[s.cls], aisMatch: aisCls ? aisCls === s.cls : null };
    }
    if (c.ais) return { cls: byId(AIS_CLASS[c.kind]), from: "AIS", sig: null, conf: null, aisMatch: null };
    return null;
  }

  Ops.classes = {
    iconFor(c) { const r = classify(c); return r ? ICONS[r.cls.icon].d : null; },
    colourFor(c) { const r = classify(c); return r ? r.cls.colour : null; },
    summary(c) {
      const r = classify(c);
      return r && r.from === "acoustic" ? `Classified as ${lower(r.cls.name)}, ${pct(r.conf)}.` : "Classification pending.";
    },
    classify,
  };

  // ---------- hub ----------
  let editing = null, root = null;
  const swatch = (col) => col || "linear-gradient(135deg, #4aa3ff 50%, #f2a93b 50%)";

  function counts() {
    const n = {};
    (Ops.contacts ? Ops.contacts.list : []).forEach((c) => { const r = classify(c); if (r) n[r.cls.id] = (n[r.cls.id] || 0) + 1; });
    return n;
  }
  // Only the numbers change with the moving picture, so only they are rewritten:
  // rebuilding the rows under the pointer would swallow clicks.
  function paintCounts() {
    const n = counts();
    root.querySelectorAll("#cl-rows tr[data-cls]").forEach((tr) => { tr.querySelector(".cl-n").textContent = n[tr.dataset.cls] || 0; });
  }
  function paintTable() {
    const tb = root.querySelector("#cl-rows");
    const n = counts();
    tb.innerHTML = CLASSES.map((k) => `
      <tr data-cls="${k.id}" class="${editing === k.id ? "on" : ""}">
        <td class="cl-ic-cell"><button type="button" class="cl-edit" data-edit="${k.id}" aria-expanded="${editing === k.id}" aria-label="Change the icon for ${esc(k.name)}">${svg(ICONS[k.icon].d, k.colour || "#4aa3ff", 20)}</button></td>
        <td><span>${esc(k.name)}</span><small>${esc(k.rule)}</small></td>
        <td class="r mono cl-n">${n[k.id] || 0}</td>
      </tr>
      ${editing === k.id ? `<tr class="cl-editor"><td colspan="3">
        <div class="cl-pick" role="group" aria-label="Icon for ${esc(k.name)}">${Object.entries(ICONS).map(([id, ic]) =>
          `<button type="button" data-icon="${id}" aria-pressed="${k.icon === id}" title="${ic.name}" aria-label="${ic.name}">${svg(ic.d, k.colour || "#dbe5ee", 20)}</button>`).join("")}</div>
        <div class="cl-cols" role="group" aria-label="Colour for ${esc(k.name)}">${COLOURS.map(([col, name]) =>
          `<button type="button" data-colour="${col || ""}" aria-pressed="${k.colour === col}" title="${name}" aria-label="${name}"><span style="background:${swatch(col)}"></span></button>`).join("")}</div>
        <p class="note">${k.colour ? "Every contact in this class uses this colour." : "AIS status colours: blue on AIS, amber without AIS, grey when lost."}</p>
      </td></tr>` : ""}`).join("");
  }

  function paintDetail() {
    const el = root.querySelector("#cl-detail");
    const id = Ops.contacts && Ops.contacts.selected();
    const c = id && Ops.contacts.list.find((x) => x.id === id), r = c && classify(c);
    if (!c || !r) { el.hidden = true; el.dataset.for = ""; return; }
    el.hidden = false;
    const name = c.name ? `${c.id} · ${c.name}` : c.id;
    if (r.from === "AIS") {
      el.innerHTML = `<h3>${esc(name)}</h3><p>Not heard by any sensor right now, so the class comes from AIS only: ${esc(lower(r.cls.name))}. It will be checked acoustically when it comes within range of a fibre or hydrophone.</p>`;
      el.dataset.for = ""; return;
    }
    const s = r.sig, top = Object.entries(s.probs).sort((a, b) => b[1] - a[1]);
    const key = `${c.id}|${r.from}|${r.cls.icon}|${r.cls.colour}`;
    if (el.dataset.for === key) return; // nothing changed; keep the canvas
    el.dataset.for = key;
    el.innerHTML = `
      <h3>${esc(name)}</h3>
      <p>${r.from === "lost" ? "Last heard as" : "Sounds like"} <strong>${esc(lower(r.cls.name))}</strong>, ${pct(r.conf)}.</p>
      <canvas class="cl-spec" width="560" height="150" aria-label="Simulated spectrum, 0 to 800 hertz"></canvas>
      <div class="axis"><span>0 Hz</span><span>Simulated spectrum</span><span>800 Hz</span></div>
      <h4>Rule that decided it</h4>
      <p class="cl-rule">${esc(RULE_TEXT[s.cls](s))}</p>
      <h4>Class probabilities</h4>
      <div class="cl-probs">${top.map(([k, v], i) => `<div class="cl-prob${i ? "" : " top"}"><span>${esc(byId(k).name)}</span><span class="bar"><span style="width:${Math.round(v * 100)}%"></span></span><span class="mono">${pct(v)}</span></div>`).join("")}</div>
      <h4>AIS check</h4>
      <p class="cl-ais ${r.aisMatch === false ? "bad" : ""}">${c.ais
        ? r.aisMatch ? `AIS says ${AIS_WORD[c.kind]}. The signature agrees.`
          : `AIS says ${AIS_WORD[c.kind]}, ${c.length} m. The signature says ${lower(r.cls.name)}. Mismatch: check the AIS identity.`
        : "Not on AIS. The acoustic class is the only identity this contact has."}</p>`;
    drawSpectrum(el.querySelector(".cl-spec"), s);
  }

  function drawSpectrum(cv, s) {
    const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, N = 280;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const hz = (i / N) * 800;
      v[i] = 0.12 + 0.05 * rnd();
      if (s.cav) v[i] += 0.28 * Math.min(1, hz / 500);                    // cavitation: broadband rising
      if (s.blade) for (let f = s.blade; f < 300; f += s.blade) v[i] += 0.5 * Math.exp(-((hz - f) ** 2) / 8) * (1 - f / 320);
      if (s.tonals) s.tonals.forEach((f, j) => { v[i] += (0.85 - j * 0.2) * Math.exp(-((hz - f) ** 2) / 6); });
      if (s.breath) v[i] += 0.22 * Math.exp(-((hz - 520) ** 2) / 20000);   // regulator hiss, high band
    }
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(147,165,181,0.25)"; ctx.lineWidth = 1;
    [200, 400, 600].forEach((hz) => { const x = (hz / 800) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i < N; i++) ctx.lineTo((i / (N - 1)) * W, H - Math.min(1, v[i]) * (H - 8));
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = "rgba(63,193,217,0.18)"; ctx.fill();
    ctx.strokeStyle = "#3fc1d9"; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = "20px ui-monospace, Consolas, monospace"; ctx.fillStyle = "#93a5b5";
    if (s.tonals) ctx.fillText(`${s.tonals[0]} Hz`, (s.tonals[0] / 800) * W + 8, 26);
    if (s.blade) ctx.fillText(`blade ${s.blade} Hz`, 12, 26);
    if (s.breath) ctx.fillText(`breathing ${s.breath}/min`, 12, 26);
  }

  Ops.register({
    id: "classes", no: 4, name: "Sound classes",
    hub(el) {
      root = el;
      el.innerHTML = `
        <h2>Sound classes</h2>
        <p class="note">Each contact is classified from its sound while a fibre or hydrophone hears it. Signatures are simulated. Click an icon to choose the icon and colour for that class.</p>
        <table class="eq-status cl-table" aria-label="Sound classes">
          <thead><tr><th><span class="sr">Icon</span></th><th>Class and rule</th><th class="r">Now</th></tr></thead>
          <tbody id="cl-rows"></tbody>
        </table>
        <button type="button" class="cl-reset" id="cl-reset">Reset icons and colours</button>
        <div class="detail" id="cl-detail" hidden></div>`;

      el.addEventListener("click", (e) => {
        const ed = e.target.closest("[data-edit]");
        if (ed) { editing = editing === ed.dataset.edit ? null : ed.dataset.edit; paintTable(); return; }
        const k = editing && byId(editing);
        const ic = e.target.closest("[data-icon]");
        if (ic && k) { k.icon = ic.dataset.icon; save(); paintTable(); paintDetail(); Ops.map.redraw(); return; }
        const co = e.target.closest("[data-colour]");
        if (co && k) { k.colour = co.dataset.colour || null; save(); paintTable(); paintDetail(); Ops.map.redraw(); return; }
        if (e.target.closest("#cl-reset")) {
          CLASSES.forEach((x) => { [x.icon, x.colour] = DEFAULTS[x.id]; });
          save(); paintTable(); paintDetail(); Ops.map.redraw();
        }
      });
      if (Ops.contacts) Ops.contacts.onSelect(() => paintDetail());
      paintTable(); paintDetail();
      // Counts and the detail follow the moving picture.
      setInterval(() => { paintCounts(); paintDetail(); }, 1000);
    },
  });
})();
