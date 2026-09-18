(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = 1280, H = 720;
  const FLOOR = 620;
  const GRAV = 2200, MOVE = 430, MOVE_C = 210, JUMP = 800;
  const DASH_V = 1000, DASH_T = 0.14, DASH_CD = 0.55;
  const COYOTE = 0.1, JBUF = 0.08;
  const STAND = { w: 42, h: 70 }, CROUCH = { w: 52, h: 44 };

  const $ = (id) => document.getElementById(id);
  const memEl = $("mem"), roomEl = $("room-tag"), sayEl = $("say");
  const loading = $("loading"), menu = $("menu"), endcard = $("endcard");
  const touch = $("touch");

  const imgs = {};
  const paths = {
    bg: "assets/bg-city.jpg",
    idle: "assets/hero-idle.png",
    run1: "assets/hero-run1.png",
    run2: "assets/hero-run2.png",
    run3: "assets/hero-run3.png",
    jump: "assets/hero-jump.png",
    crouch: "assets/hero-crouch.png",
    title: "assets/title-splash.jpg",
  };
  let loaded = 0;
  Object.keys(paths).forEach((k) => {
    const i = new Image();
    i.onload = () => { if (++loaded === Object.keys(paths).length) loading.classList.add("hidden"); };
    i.onerror = () => { if (++loaded === Object.keys(paths).length) loading.classList.add("hidden"); };
    i.src = paths[k] + "?v=demo5";
    imgs[k] = i;
  });

  // --- audio ---
  let muted = false, actx = null;
  function beep(a, b, dur, type) {
    if (muted) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "square"; o.connect(g); g.connect(actx.destination);
      o.frequency.setValueAtTime(a, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, b), t + dur);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (_) {}
  }
  const sfx = {
    jump: () => beep(520, 880, 0.08),
    dash: () => beep(180, 60, 0.12, "sawtooth"),
    coin: () => beep(880, 1400, 0.1, "sine"),
    hit: () => beep(200, 80, 0.16, "triangle"),
    clear: () => beep(440, 880, 0.3, "sine"),
    ui: () => beep(330, 330, 0.05, "sine"),
    door: () => beep(400, 600, 0.08, "triangle"),
  };

  // --- input ---
  const keys = Object.create(null);
  const pressed = Object.create(null);
  const touchHold = Object.create(null);
  function want(name) {
    const map = {
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      jump: ["Space", "KeyW", "ArrowUp"],
      crouch: ["KeyS", "ArrowDown"],
      dash: ["ShiftLeft", "ShiftRight", "KeyJ"],
      use: ["KeyE"],
    };
    return (map[name] || []).some((c) => keys[c]) || !!touchHold[name];
  }
  function tap(name) {
    const map = {
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      jump: ["Space", "KeyW", "ArrowUp"],
      crouch: ["KeyS", "ArrowDown"],
      dash: ["ShiftLeft", "ShiftRight", "KeyJ"],
      use: ["KeyE"],
    };
    return (map[name] || []).some((c) => pressed[c]) || !!touchHold[name + "Tap"];
  }

  addEventListener("keydown", (e) => {
    if (!keys[e.code]) pressed[e.code] = true;
    keys[e.code] = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "Escape") togglePause();
    if (e.code === "KeyR" && (G.mode === "play" || G.mode === "pause")) resetRoom();
    if (e.code === "KeyM") muted = !muted;
    if ((e.code === "Enter" || e.code === "Space") && (G.mode === "title" || G.mode === "end")) startDemo();
  });
  addEventListener("keyup", (e) => { keys[e.code] = false; });

  // touch
  const coarse = matchMedia("(pointer:coarse)").matches || Math.min(innerWidth, innerHeight) < 700;
  if (coarse) touch.classList.remove("hidden");
  function bindTouch(btn) {
    const k = btn.dataset.k;
    const on = (ev) => { ev.preventDefault(); touchHold[k] = true; touchHold[k + "Tap"] = true; btn.classList.add("held"); };
    const off = (ev) => { ev.preventDefault(); touchHold[k] = false; btn.classList.remove("held"); };
    btn.addEventListener("pointerdown", on);
    btn.addEventListener("pointerup", off);
    btn.addEventListener("pointercancel", off);
    btn.addEventListener("pointerleave", off);
  }
  touch.querySelectorAll("button").forEach(bindTouch);
  $("btn-pause").onclick = () => togglePause();

  menu.addEventListener("click", (e) => {
    const a = e.target.dataset.act;
    if (a === "resume") { G.mode = "play"; menu.classList.add("hidden"); }
    if (a === "reset") { menu.classList.add("hidden"); resetRoom(); }
    if (a === "hub") { menu.classList.add("hidden"); loadRoom("hub"); G.mode = "play"; }
    if (a === "title") { menu.classList.add("hidden"); goTitle(); }
  });
  endcard.addEventListener("click", (e) => {
    const a = e.target.dataset.act;
    if (a === "replay") { endcard.classList.add("hidden"); startDemo(); }
    if (a === "title2") { endcard.classList.add("hidden"); goTitle(); }
  });
  canvas.addEventListener("pointerdown", () => {
    if (G.mode === "title" || G.mode === "end") startDemo();
  });

  // --- rooms (5-min path) ---
  const ROOMS = {
    hub: {
      tag: "ホテル LOBI",
      w: 2000,
      spawn: { x: 100, y: FLOOR - STAND.h },
      solids: [
        { x: 0, y: FLOOR, w: 2000, h: 120 },
        { x: 0, y: 0, w: 40, h: 720 },
        { x: 1960, y: 0, w: 40, h: 720 },
      ],
      spikes: [],
      shutters: [],
      lasers: [],
      plates: [],
      drones: [],
      doors: [
        { id: "svc", x: 720, y: 460, w: 56, h: 160, label: "SERVİS", to: "wet", locked: false },
        { id: "st", x: 1100, y: 460, w: 56, h: 160, label: "CADDE", locked: true, need: "stamp" },
        { id: "tw", x: 1480, y: 460, w: 56, h: 160, label: "未来", locked: true },
      ],
      exits: [],
      memories: [],
      signs: [
        { x: 160, y: 160, text: "ホテル" },
        { x: 80, y: 90, text: "CHECK-IN: 02:17" },
      ],
      sayOnEnter: "Katları sen üreteceksin. — Nara",
    },
    wet: {
      tag: "SERVİS · ıslak koridor",
      w: 2600,
      spawn: { x: 90, y: FLOOR - STAND.h },
      solids: [
        { x: 0, y: FLOOR, w: 520, h: 120 },
        { x: 620, y: 560, w: 180, h: 40 },
        { x: 880, y: 480, w: 160, h: 40 },
        { x: 1120, y: 560, w: 220, h: 40 },
        { x: 1420, y: FLOOR, w: 1180, h: 120 },
      ],
      spikes: [{ x: 520, y: 600, w: 90, h: 20 }],
      shutters: [{ id: "k1", x: 1680, y: 572, w: 90, h: 48 }],
      lasers: [],
      plates: [],
      drones: [{ id: "d1", x: 980, y: 360, kind: "patrol", range: 90, dir: 1, axis: "x", speed: 70 }],
      doors: [
        { id: "back", x: 40, y: 460, w: 48, h: 160, label: "←", to: "hub" },
        { id: "next", x: 2480, y: 460, w: 56, h: 160, label: "→", to: "dish" },
      ],
      exits: [],
      memories: [],
      signs: [],
      sayOnEnter: "S — kepenk altından.",
    },
    dish: {
      tag: "SERVİS · bulaşık hattı",
      w: 2400,
      spawn: { x: 80, y: FLOOR - STAND.h },
      solids: [
        { x: 0, y: FLOOR, w: 2400, h: 120 },
        { x: 0, y: 0, w: 40, h: 720 },
        { x: 2360, y: 0, w: 40, h: 720 },
      ],
      spikes: [],
      shutters: [],
      lasers: [
        { id: "Lw", x: 420, y: 500, w: 16, h: 120, bypass: "none", mode: "solid", sign: "DASH YETMEZ" },
        { id: "L1", x: 720, y: 576, w: 220, h: 44, bypass: "crouch", mode: "solid" },
        { id: "L2", x: 1100, y: 576, w: 220, h: 44, bypass: "crouch", mode: "blink", on: 1, off: 0.8, phase: 0 },
        { id: "L3", x: 1480, y: 576, w: 220, h: 44, bypass: "crouch", mode: "blink", on: 0.7, off: 0.7, phase: 0.35 },
      ],
      plates: [],
      drones: [],
      doors: [{ id: "next", x: 2200, y: 460, w: 56, h: 160, label: "→", to: "fake" }],
      exits: [],
      memories: [],
      signs: [],
      sayOnEnter: "Bu bir çıkış değil — önce lazer. Eğil.",
    },
    fake: {
      tag: "SERVİS · sahte EXIT",
      w: 2000,
      spawn: { x: 80, y: FLOOR - STAND.h },
      solids: [
        { x: 0, y: FLOOR, w: 720, h: 120 },
        { x: 860, y: 540, w: 160, h: 40 },
        { x: 1120, y: 460, w: 160, h: 40 },
        { x: 1400, y: 520, w: 600, h: 220 },
      ],
      spikes: [{ x: 720, y: 600, w: 140, h: 20 }],
      shutters: [],
      lasers: [],
      plates: [],
      drones: [{ id: "d2", x: 1180, y: 340, kind: "patrol", range: 80, dir: -1, axis: "x", speed: 70 }],
      doors: [{ id: "skip", x: 1900, y: 360, w: 48, h: 160, label: "SERVİS", to: "press" }],
      exits: [{ id: "fake1", x: 1760, y: 420, w: 56, h: 100, kind: "fake", label: "EXIT" }],
      memories: [],
      signs: [],
      sayOnEnter: "EXIT gördün. Sağına da bak.",
    },
    press: {
      tag: "SERVİS · çamaşır presi",
      w: 2200,
      spawn: { x: 80, y: FLOOR - STAND.h },
      solids: [
        { x: 0, y: FLOOR, w: 2200, h: 120 },
        { x: 0, y: 0, w: 40, h: 720 },
        { x: 2160, y: 0, w: 40, h: 720 },
      ],
      spikes: [{ x: 980, y: 600, w: 80, h: 20 }],
      shutters: [],
      lasers: [],
      plates: [
        { id: "A", x: 420, y: 604, w: 70, h: 16 },
        { id: "B", x: 1480, y: 604, w: 70, h: 16 },
      ],
      drones: [],
      doors: [{
        id: "stamp", x: 1880, y: 460, w: 64, h: 160, label: "DAMGA",
        to: "hub", needPlates: true, givesStamp: true,
      }],
      exits: [],
      memories: [{ i: 0, x: 1980, y: 540 }],
      signs: [],
      sayOnEnter: "İki plaka. Biri sen, biri hayaletin.",
    },
  };

  let G = null;
  function freshFlags() {
    return { stamp: false, memories: [false, false, false, false, false, false, false, false], fakeUsed: false };
  }

  function goTitle() {
    G = {
      mode: "title", roomId: "hub", flags: freshFlags(),
      t: 0, camX: 0, flash: 0, sayT: 0, sayText: "",
      player: null, drones: [], ghost: null, deathBuf: [],
      roomSpawn: null, platesOn: {}, fakeClear: 0, endTimer: 0,
    };
    roomEl.textContent = "02:17";
    memEl.textContent = "◆ 0/1";
  }

  function startDemo() {
    G.flags = freshFlags();
    G.mode = "play";
    loadRoom("hub");
    say("CHECK-IN: 02:17 — check-out yok.", 3.2);
    beep(400, 500, 0.05, "sine");
  }

  function togglePause() {
    if (G.mode === "play") { G.mode = "pause"; menu.classList.remove("hidden"); sfx.ui(); }
    else if (G.mode === "pause") { G.mode = "play"; menu.classList.add("hidden"); }
  }

  function resetRoom() {
    G.mode = "play";
    loadRoom(G.roomId, true);
  }

  function loadRoom(id, keepFlags) {
    const def = ROOMS[id];
    if (!def) return;
    G.roomId = id;
    G.room = def;
    G.camX = 0;
    G.platesOn = {};
    G.ghost = null;
    roomEl.textContent = def.tag;
    const sp = def.spawn;
    G.player = makePlayer(sp.x, sp.y);
    G.drones = (def.drones || []).map((d) => ({
      ...d, baseX: d.x, baseY: d.y, sleep: 0, mount: false,
    }));
    if (def.sayOnEnter) say(def.sayOnEnter, 2.4);
    updateMemHud();
  }

  function makePlayer(x, y) {
    return {
      x, y, w: STAND.w, h: STAND.h, vx: 0, vy: 0,
      onGround: true, facing: 1, crouch: false,
      dashT: 0, dashCd: 0, inv: 0, coyote: 0, jbuf: 0,
      anim: 0, frame: "idle", trails: [],
    };
  }

  function say(text, sec) {
    G.sayText = text; G.sayT = sec;
    sayEl.textContent = text;
    sayEl.classList.remove("hidden");
  }

  function updateMemHud() {
    const n = G.flags.memories.filter(Boolean).length;
    memEl.textContent = `◆ ${n}/1` + (G.flags.stamp ? " · DAMGA" : "");
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function shutterBox(s) {
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  }

  function solidsNow() {
    const r = G.room;
    const list = r.solids.map((s) => ({ ...s }));
    for (const sh of r.shutters || []) list.push(shutterBox(sh));
    return list;
  }

  function resolveSolid(p, s) {
    if (!aabb(p, s)) return;
    const ox = Math.min(p.x + p.w - s.x, s.x + s.w - p.x);
    const oy = Math.min(p.y + p.h - s.y, s.y + s.h - p.y);
    if (ox < oy) {
      if (p.x + p.w / 2 < s.x + s.w / 2) p.x = s.x - p.w; else p.x = s.x + s.w;
      p.vx = 0;
    } else if (p.vy >= 0) {
      p.y = s.y - p.h; p.vy = 0; p.onGround = true; p.coyote = COYOTE;
    } else {
      p.y = s.y + s.h; p.vy = 0;
    }
  }

  function laserOn(L, t) {
    if (L.mode !== "blink") return true;
    const cyc = (L.on || 1) + (L.off || 0.7);
    const ph = ((t + (L.phase || 0)) % cyc);
    return ph < (L.on || 1);
  }

  function hurt() {
    const p = G.player;
    if (p.inv > 0 || p.dashT > 0) return;
    sfx.hit();
    G.flash = 0.3;
    // ghost from death buffer
    if (G.deathBuf.length > 10) {
      G.ghost = { frames: G.deathBuf.slice(), t: 0, dur: 6 };
    }
    G.deathBuf = [];
    const sp = G.room.spawn;
    p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
    p.dashT = 0; p.inv = 1.1;
    setStand(p);
  }

  function setStand(p) {
    if (p.crouch) { p.y -= STAND.h - CROUCH.h; }
    p.crouch = false; p.w = STAND.w; p.h = STAND.h;
  }
  function setCrouch(p) {
    if (!p.crouch) { p.y += p.h - CROUCH.h; }
    p.crouch = true; p.w = CROUCH.w; p.h = CROUCH.h;
  }

  function tryJump(p) {
    if (p.crouch) return;
    if (p.onGround || p.coyote > 0) {
      p.vy = -JUMP; p.onGround = false; p.coyote = 0; p.jbuf = 0;
      sfx.jump();
    }
  }

  function canUseDoor(d) {
    if (d.locked) return false;
    if (d.need === "stamp" && !G.flags.stamp) return false;
    if (d.needPlates) {
      const A = plateActive("A"), B = plateActive("B");
      return A && B;
    }
    return true;
  }

  function plateActive(id) {
    const p = G.player;
    const pl = (G.room.plates || []).find((x) => x.id === id);
    if (!pl) return false;
    if (aabb(p, pl)) return true;
    if (G.ghost) {
      const gf = ghostPose();
      if (gf && aabb(gf, pl)) return true;
    }
    return false;
  }

  function ghostPose() {
    if (!G.ghost) return null;
    const fr = G.ghost.frames;
    if (!fr.length) return null;
    const idx = Math.min(fr.length - 1, Math.floor((G.ghost.t / G.ghost.dur) * fr.length));
    const f = fr[idx];
    return { x: f.x, y: f.y, w: f.w, h: f.h };
  }

  function finishDemo() {
    G.mode = "end";
    endcard.classList.remove("hidden");
    $("end-text").textContent = G.flags.fakeUsed
      ? "Sahte EXIT’e girdin — otel seni yeniden kabul etti. Yine de damgayı aldın."
      : "EXIT’i reddettin. Damga sende. Yağmur durmuyor.";
    sfx.clear();
  }

  function solidsFor(p) {
    const list = G.room.solids.map((s) => ({ ...s }));
    for (const sh of G.room.shutters || []) {
      if (p && p.crouch) continue; // crouch slips under
      list.push(shutterBox(sh));
    }
    return list;
  }

  function update2(dt) {
    if (G.mode !== "play") {
      if (G.mode === "title" || G.mode === "end") G.t += dt;
      Object.keys(pressed).forEach((k) => { pressed[k] = false; });
      Object.keys(touchHold).forEach((k) => { if (k.endsWith("Tap")) touchHold[k] = false; });
      return;
    }
    G.t += dt;
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt);
    if (G.sayT > 0) { G.sayT -= dt; if (G.sayT <= 0) sayEl.classList.add("hidden"); }

    const p = G.player;
    G.deathBuf.push({ x: p.x, y: p.y, w: p.w, h: p.h, facing: p.facing, frame: p.frame, crouch: p.crouch });
    if (G.deathBuf.length > 360) G.deathBuf.shift();
    if (G.ghost) { G.ghost.t += dt; if (G.ghost.t >= G.ghost.dur) G.ghost = null; }

    p.dashCd = Math.max(0, p.dashCd - dt);
    p.inv = Math.max(0, p.inv - dt);
    if (!p.onGround) p.coyote = Math.max(0, p.coyote - dt);
    if (tap("jump")) p.jbuf = JBUF; else p.jbuf = Math.max(0, p.jbuf - dt);

    const wantC = want("crouch") && p.onGround && p.dashT <= 0;
    if (wantC && !p.crouch) setCrouch(p);
    else if (!wantC && p.crouch) {
      const test = { x: p.x, y: p.y - (STAND.h - CROUCH.h), w: STAND.w, h: STAND.h };
      if (!solidsFor({ crouch: false }).some((s) => aabb(test, s))) setStand(p);
    }

    // drones
    for (const d of G.drones) {
      if (d.sleep > 0) { d.sleep -= dt; continue; }
      if (d.axis === "x") {
        d.x += d.dir * d.speed * dt;
        if (Math.abs(d.x - d.baseX) > d.range) d.dir *= -1;
      } else {
        d.y += d.dir * d.speed * dt;
        if (Math.abs(d.y - d.baseY) > d.range) d.dir *= -1;
      }
      // backdash sleep
      if (p.dashT > 0) {
        const toward = (d.x - p.x) * p.facing;
        if (toward < 0 && Math.hypot(d.x - p.x, d.y - p.y) < 70) d.sleep = 4;
      }
      if (aabb(p, { x: d.x - 18, y: d.y - 14, w: 36, h: 28 }) && d.sleep <= 0) hurt();
    }

    if (p.dashT > 0) {
      p.dashT -= dt; p.vy = 0; p.vx = p.facing * DASH_V;
      if (Math.random() < 0.55) p.trails.push({ x: p.x, y: p.y, w: p.w, h: p.h, life: 0.15, facing: p.facing, frame: p.frame });
    } else {
      let ax = 0;
      if (want("left")) { ax -= 1; p.facing = -1; }
      if (want("right")) { ax += 1; p.facing = 1; }
      p.vx = ax * (p.crouch ? MOVE_C : MOVE);
      p.vy += GRAV * dt;
      if (!want("jump") && p.vy < -120) p.vy *= 0.55;
      if (p.jbuf > 0) tryJump(p);
      if (tap("dash") && p.dashCd <= 0 && !p.crouch) {
        p.dashT = DASH_T; p.dashCd = DASH_CD; p.inv = Math.max(p.inv, DASH_T + 0.03); sfx.dash();
      }
    }
    p.trails = p.trails.filter((tr) => (tr.life -= dt) > 0);

    p.onGround = false;
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const s of solidsFor(p)) resolveSolid(p, s);
    if (p.x < 0) { p.x = 0; p.vx = 0; }
    if (p.y > H + 100) hurt();

    for (const sp of G.room.spikes || []) if (aabb(p, sp)) hurt();

    // lasers — dash does NOT bypass
    for (const L of G.room.lasers || []) {
      if (!laserOn(L, G.t)) continue;
      const bypass = L.bypass === "crouch" && p.crouch;
      if (!bypass && aabb(p, L)) hurt();
    }

    // memories
    for (const m of G.room.memories || []) {
      if (G.flags.memories[m.i]) continue;
      if (aabb(p, { x: m.x - 14, y: m.y - 14, w: 28, h: 28 })) {
        G.flags.memories[m.i] = true;
        sfx.coin();
        updateMemHud();
        say("Anı #1 — «Adım Nara idi. Tepsiyi 17’ye bırakmadım.»", 3.5);
      }
    }

    // doors / exits / use
    const use = tap("use") || tap("jump") && false;
    const tryEnter = tap("use") || (want("right") || want("left"));
    // auto near door + E or walk into
    for (const d of G.room.doors || []) {
      const near = aabb(p, { x: d.x - 12, y: d.y, w: d.w + 24, h: d.h });
      if (!near) continue;
      if (!tap("use")) continue;
      if (d.needPlates && !(plateActive("A") && plateActive("B"))) {
        say("İki plaka birden. (Hayalet + sen)", 1.8);
        continue;
      }
      if (!canUseDoor(d)) {
        say(d.need === "stamp" ? "Önce servis damgası." : "Kilitli.", 1.4);
        continue;
      }
      if (d.givesStamp) {
        G.flags.stamp = true;
        updateMemHud();
        sfx.door();
        say("Servis damgası. Otel seni işaretledi.", 2.8);
        loadRoom("hub");
        G.endTimer = G.flags.memories[0] ? 2.6 : 0;
        continue;
      }
      sfx.door();
      loadRoom(d.to);
    }
    for (const ex of G.room.exits || []) {
      if (!aabb(p, ex)) continue;
      if (ex.kind === "fake" && (tap("use") || (Math.abs(p.vx) > 40 && aabb(p, ex)))) {
        if (G.fakeClear > 0) continue;
        G.flags.fakeUsed = true;
        sfx.clear();
        G.fakeClear = 1.2;
        say("SECTION CLEAR — …otel seni yeniden kabul etti.", 2.8);
      }
    }
    if (G.fakeClear > 0) {
      G.fakeClear -= dt;
      if (G.fakeClear <= 0) {
        loadRoom("hub");
        say("Bu bir çıkış değil. — Nara", 2.6);
      }
    }
    if (G.endTimer > 0) {
      G.endTimer -= dt;
      if (G.endTimer <= 0) finishDemo();
    }

    // anim
    p.anim += dt;
    if (!p.onGround) p.frame = "jump";
    else if (p.crouch) p.frame = "crouch";
    else if (Math.abs(p.vx) > 20) p.frame = ["run1", "run2", "run3", "run2"][Math.floor(p.anim * 10) % 4];
    else p.frame = "idle";

    const target = p.x - W * 0.35;
    G.camX += (target - G.camX) * Math.min(1, dt * 6);
    G.camX = Math.max(0, Math.min(G.camX, (G.room.w || 2000) - W));

    Object.keys(pressed).forEach((k) => { pressed[k] = false; });
    Object.keys(touchHold).forEach((k) => { if (k.endsWith("Tap")) touchHold[k] = false; });
  }

  function draw() {
    // bg
    const bg = imgs.bg;
    if (bg.complete && bg.naturalWidth) {
      const par = (G.camX || 0) * 0.35;
      const sc = Math.max(W / bg.naturalWidth, H / bg.naturalHeight) * 1.05;
      const dw = bg.naturalWidth * sc, dh = bg.naturalHeight * sc;
      const x = -(((par % dw) + dw) % dw);
      ctx.drawImage(bg, x, H - dh, dw, dh);
      ctx.drawImage(bg, x + dw - 1, H - dh, dw, dh);
      const g = ctx.createLinearGradient(0, H * 0.5, 0, H);
      g.addColorStop(0, "rgba(5,5,18,0)"); g.addColorStop(1, "rgba(5,5,18,0.55)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else { ctx.fillStyle = "#0b1426"; ctx.fillRect(0, 0, W, H); }

    if (G.mode === "title") {
      const t = imgs.title;
      if (t.complete && t.naturalWidth) {
        const sc = Math.max(W / t.naturalWidth, H / t.naturalHeight);
        const dw = t.naturalWidth * sc, dh = t.naturalHeight * sc;
        ctx.drawImage(t, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      ctx.fillStyle = "rgba(5,5,18,0.55)"; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8f7ff"; ctx.font = "bold 56px sans-serif";
      ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 20;
      ctx.fillText("NEON DASH", W / 2, H / 2 - 50);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff2e9f"; ctx.font = "18px sans-serif";
      ctx.fillText("02:17 · 5 dk dilim", W / 2, H / 2);
      ctx.fillStyle = "#00e5ff"; ctx.font = "16px sans-serif";
      ctx.globalAlpha = Math.sin(G.t * 4) > 0 ? 1 : 0.35;
      ctx.fillText("Enter / dokun — başla", W / 2, H / 2 + 50);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#e8f7ff77"; ctx.font = "13px sans-serif";
      ctx.fillText("Mobil: ekran tuşları · Masaüstü: A/D Space S Shift E · Esc menü · R oda", W / 2, H / 2 + 90);
      return;
    }

    ctx.save();
    ctx.translate(-Math.floor(G.camX), 0);
    const room = G.room;

    for (const s of room.solids) {
      ctx.fillStyle = "rgba(20,22,36,0.92)";
      ctx.shadowColor = "#00e5ff66"; ctx.shadowBlur = 12;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#00e5ff"; ctx.fillRect(s.x, s.y, s.w, 3);
      ctx.fillStyle = "#ff2e9f"; ctx.fillRect(s.x, s.y + 3, Math.max(20, s.w * 0.25), 2);
    }
    for (const sh of room.shutters || []) {
      ctx.fillStyle = "#1a2030";
      ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
      ctx.strokeStyle = "#00e5ff"; ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
      ctx.fillStyle = "#e8f7ff88"; ctx.font = "11px sans-serif";
      ctx.fillText("CROUCH", sh.x, sh.y - 6);
    }
    for (const sp of room.spikes || []) {
      ctx.fillStyle = "#ff3b5c";
      const n = Math.max(1, Math.floor(sp.w / 14));
      for (let i = 0; i < n; i++) {
        const sx = sp.x + i * (sp.w / n);
        ctx.beginPath();
        ctx.moveTo(sx, sp.y + sp.h);
        ctx.lineTo(sx + sp.w / n / 2, sp.y);
        ctx.lineTo(sx + sp.w / n, sp.y + sp.h);
        ctx.fill();
      }
    }
    for (const L of room.lasers || []) {
      if (!laserOn(L, G.t)) continue;
      ctx.fillStyle = L.bypass === "none" ? "#ff2e9fcc" : "#00e5ffcc";
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 16;
      ctx.fillRect(L.x, L.y, L.w, L.h);
      ctx.shadowBlur = 0;
      if (L.sign) {
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif";
        ctx.fillText(L.sign, L.x - 20, L.y - 8);
      }
    }
    for (const pl of room.plates || []) {
      const on = plateActive(pl.id);
      ctx.fillStyle = on ? "#00e5ff" : "#5a3a4a";
      ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
    }
    for (const d of G.drones) {
      ctx.save();
      ctx.globalAlpha = d.sleep > 0 ? 0.35 : 1;
      ctx.translate(d.x, d.y);
      ctx.fillStyle = "#0e0e18";
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = d.sleep > 0 ? "#666" : "#00e5ff";
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (const m of room.memories || []) {
      if (G.flags.memories[m.i]) continue;
      const bob = Math.sin(G.t * 4) * 4;
      ctx.save(); ctx.translate(m.x, m.y + bob);
      ctx.fillStyle = "#ff2e9f"; ctx.shadowColor = "#ff2e9f"; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (const d of room.doors || []) {
      const openish = canUseDoor(d);
      ctx.fillStyle = openish ? "#00e5ff33" : "#ff2e9f22";
      ctx.strokeStyle = openish ? "#00e5ff" : "#ff2e9f88";
      ctx.lineWidth = 2;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = "#e8f7ff"; ctx.font = "11px sans-serif";
      ctx.fillText(d.label || "KAPI", d.x - 4, d.y - 8);
    }
    for (const ex of room.exits || []) {
      ctx.save();
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 3;
      ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 20;
      ctx.strokeRect(ex.x, ex.y, ex.w, ex.h);
      ctx.fillStyle = "#e8f7ff"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(ex.label || "EXIT", ex.x + 8, ex.y - 10);
      ctx.restore();
    }
    for (const sg of room.signs || []) {
      ctx.fillStyle = "#ff2e9f"; ctx.font = "bold 28px sans-serif";
      ctx.fillText(sg.text, sg.x, sg.y);
    }

    // ghost
    if (G.ghost) {
      const gp = ghostPose();
      if (gp) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#00e5ff";
        ctx.fillRect(gp.x, gp.y, gp.w, gp.h);
        ctx.globalAlpha = 1;
      }
    }

    const p = G.player;
    for (const tr of p.trails) {
      drawHero(tr.frame, tr.x, tr.y, tr.w, tr.h, tr.facing, Math.max(0, tr.life / 0.15) * 0.35);
    }
    if (!(p.inv > 0 && Math.floor(G.t * 20) % 2 === 0)) {
      drawHero(p.frame, p.x, p.y, p.w, p.h, p.facing, 1);
    }
    ctx.restore();

    // fake clear overlay
    if (G.fakeClear > 0) {
      ctx.fillStyle = "rgba(5,5,18,0.75)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#00e5ff"; ctx.font = "bold 42px sans-serif";
      ctx.fillText("SECTION CLEAR", W / 2, H / 2);
    }

    // hud dash
    if (G.mode === "play") {
      const cd = 1 - p.dashCd / DASH_CD;
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(W - 150, 18, 110, 8);
      ctx.fillStyle = cd >= 1 ? "#00e5ff" : "#ff2e9f";
      ctx.fillRect(W - 150, 18, 110 * Math.max(0, Math.min(1, cd)), 8);
    }
    if (G.flash > 0) {
      ctx.fillStyle = `rgba(255,46,159,${G.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (muted) {
      ctx.textAlign = "right"; ctx.fillStyle = "#e8f7ff66"; ctx.font = "12px sans-serif";
      ctx.fillText("MUTE", W - 20, H - 16);
    }
  }

  function drawHero(frame, x, y, w, h, facing, alpha) {
    const img = imgs[frame] || imgs.idle;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + w / 2, y + h);
    ctx.scale(facing, 1);
    ctx.shadowColor = "#00e5ff"; ctx.shadowBlur = 10;
    if (img.complete && img.naturalWidth) {
      const dh = h + 8;
      const dw = (img.naturalWidth / img.naturalHeight) * dh;
      ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    } else {
      ctx.fillStyle = "#ff2e9f"; ctx.fillRect(-w / 2, -h, w, h);
      ctx.fillStyle = "#00e5ff"; ctx.fillRect(-w / 2, -h, w, 12);
    }
    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update2(dt);
    draw();
    requestAnimationFrame(loop);
  }

  goTitle();
  requestAnimationFrame(loop);
})();
