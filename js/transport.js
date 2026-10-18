/* Simulation transport on the map: one set of controls for the whole demo.
   Play/pause starts and stops both the array replay (Ops.array) and the
   contact picture (Ops.contacts.clock). Restart rewinds both to the start,
   paused. Back and forward step 10 s of replay time; the contact picture
   steps the same 10 s at its own speed, so the two keep their relationship.
   The scrub bar moves the array replay. Space also plays and pauses. */

(function () {
  const STEP = 10;
  const $ = (s, el = document) => el.querySelector(s);
  const A = () => (window.Ops && Ops.array && Ops.array.ready() ? Ops.array : null);
  const C = () => (window.Ops && Ops.contacts && Ops.contacts.clock) || null;
  const playing = () => !!((A() && A().playing) || (C() && C().playing));

  function setPlaying(on) {
    if (A()) A().play(on);
    if (C()) C().play(on);
    paint();
  }
  function step(dir) {
    const a = A(), c = C();
    if (a) a.seek(a.t + dir * STEP);
    if (c) c.seek(c.t + dir * STEP * c.rate);
    paint();
  }
  function restart() {
    setPlaying(false);
    if (A()) A().seek(0);
    if (C()) C().seek(0);
    paint();
  }

  let bar = null;
  function build() {
    bar = document.createElement("div");
    bar.className = "transport";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Simulation controls");
    bar.innerHTML = `
      <button type="button" class="tr-btn" data-tr="restart" aria-label="Rewind to the start" title="Rewind to the start">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 3v10M13 3.5v9L5.5 8z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" class="tr-btn tr-step" data-tr="back" aria-label="Back 10 seconds" title="Back 10 seconds">−10 s</button>
      <button type="button" class="array-play tr-play" data-tr="play" aria-pressed="false" aria-label="Play the simulation"><span class="ic ic-play" aria-hidden="true">&#x25B6;&#xFE0E;</span><span class="ic ic-pause" aria-hidden="true">&#x275A;&#x275A;</span></button>
      <button type="button" class="tr-btn tr-step" data-tr="fwd" aria-label="Forward 10 seconds" title="Forward 10 seconds">+10 s</button>
      <input type="range" class="tr-scrub" min="0" max="100" step="0.5" value="0" aria-label="Scenario time">
      <span class="tr-info"><span class="mono tr-time">T+00:00</span><span class="tr-ch"></span></span>`;
    $(".mapwrap").appendChild(bar);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tr]");
      if (!b) return;
      ({ play: () => setPlaying(!playing()), restart, back: () => step(-1), fwd: () => step(1) })[b.dataset.tr]();
    });
    $(".tr-scrub", bar).addEventListener("input", (e) => {
      if (!A()) return;
      A().play(false);
      A().seek(Number(e.target.value));
      paint();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== " " || e.target.closest("input, select, textarea, button, [contenteditable]")) return;
      e.preventDefault();
      setPlaying(!playing());
    });
  }

  function paint() {
    if (!bar) return;
    const a = A(), on = playing();
    const play = $(".tr-play", bar);
    play.setAttribute("aria-pressed", String(on));
    play.setAttribute("aria-label", on ? "Pause the simulation" : "Play the simulation");
    if (a) {
      const scrub = $(".tr-scrub", bar);
      scrub.max = a.duration;
      if (document.activeElement !== scrub) scrub.value = a.t;
      $(".tr-time", bar).textContent = `${a.fmt(a.t)} / ${a.fmt(a.duration).slice(2)}`;
      const ch = a.chapter();
      $(".tr-ch", bar).textContent = ch ? `${ch.n} · ${ch.title}` : "";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    build();
    let last = 0;
    (function tick(now) {
      if (now - last > 200) { last = now; paint(); }
      requestAnimationFrame(tick);
    })(0);
  });
})();
