(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const coinsEl = document.getElementById("coins");
  const hintEl = document.getElementById("hint");
  const W = canvas.width;
  const H = canvas.height;

  const GRAV = 2400;
  const MOVE = 440;
  const MOVE_CROUCH = 220;
  const JUMP = 820;
  const DASH_SPD = 1050;
  const DASH_DUR = 0.14;
  const DASH_CD = 0.7;
  const COYOTE = 0.1;
  const JUMP_BUF = 0.09;
  const MAX_ORBS = 8;
  const STAND_H = 70;
  const CROUCH_H = 44;

  const keys = Object.create(null);
  const justPressed = Object.create(null);

  addEventListener("keydown", (e) => {
    if (!keys[e.code]) justPressed[e.code] = true;
    keys[e.code] = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();

    if (e.code === "Escape") {
      if (state.mode === "play") { state.mode = "pause"; sfx("ui"); }
      else if (state.mode === "pause") state.mode = "play";
      else if (state.mode === "clear") goTitle();
      updateHint();
      return;
    }
    if (e.code === "KeyR") {
      if (state.mode === "play" || state.mode === "pause" || state.mode === "clear") startPlay();
      return;
    }
    if (e.code === "KeyM") { muted = !muted; return; }
    if ((e.code === "Enter" || e.code === "Space") && (state.mode === "title" || state.mode === "clear")) {
      startPlay();
    }
  });
  addEventListener("keyup", (e) => { keys[e.code] = false; });
  canvas.addEventListener("pointerdown", () => {
    if (state.mode === "title" || state.mode === "clear") startPlay();
    else if (state.mode === "pause") { state.mode = "play"; updateHint(); }
  });

  const VQ = "v=feel2";
  const imgs = {
    bg: load(`assets/bg-city.jpg?${VQ}`),
    idle: load(`assets/hero-idle.png?${VQ}`),
    run1: load(`assets/hero-run1.png?${VQ}`),
    run2: load(`assets/hero-run2.png?${VQ}`),
    run3: load(`assets/hero-run3.png?${VQ}`),
    jump: load(`assets/hero-jump.png?${VQ}`),
    crouch: load(`assets/hero-crouch.png?${VQ}`),
    titleSplash: load(`assets/title-splash.jpg?${VQ}`),
  };
  function load(src) {
    const i = new Image();
    i.src = src;
    return i;
  }

  const assetList = Object.values(imgs);
  let assetsReady = false;
  function checkAssets() {
    assetsReady = assetList.every((im) => im.complete && im.naturalWidth > 0);
    const el = document.getElementById("loading");
    if (assetsReady && el) el.classList.add("hidden");
    return assetsReady;
  }
  assetList.forEach((im) => {
    if (im.complete) checkAssets();
    else {
      im.onload = checkAssets;
      im.onerror = () => console.error("asset fail", im.src);
    }
  });

  let muted = false;
  let actx = null;
  function ensureAudio() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
  }
  function sfx(kind) {
    if (muted) return;
    try {
      ensureAudio();
      const t0 = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.connect(g);
      g.connect(actx.destination);
      const table = {
        jump: [520, 880, 0.08, "square"],
        dash: [180, 60, 0.12, "sawtooth"],
        coin: [880, 1400, 0.1, "sine"],
        hit: [200, 80, 0.18, "triangle"],
        clear: [440, 880, 0.35, "sine"],
        ui: [330, 330, 0.05, "sine"],
        cp: [600, 900, 0.15, "sine"],
      };
      const [a, b, dur, type] = table[kind] || table.ui;
      o.type = type;
      o.frequency.setValueAtTime(a, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, b), t0 + dur);
      g.gain.setValueAtTime(0.08, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (_) {}
  }

  // Spawn feet on first floor y=620 → y = 620 - 70 = 550
  const level = {
    spawn: { x: 90, y: 550 },
    exit: { x: 2460, y: 420, w: 64, h: 100 },
    checkpointPos: { x: 1480, y: 520 },
    solids: [
      { x: 0, y: 620, w: 520, h: 120 },
      { x: 620, y: 560, w: 180, h: 40 },
      { x: 880, y: 480, w: 160, h: 40 },
      { x: 1080, y: 560, w: 260, h: 40 },
      { x: 1120, y: 430, w: 200, h: 28 }, // low ceiling — crouch
      { x: 1420, y: 620, w: 760, h: 120 },
      { x: 1680, y: 460, w: 140, h: 36 },
      { x: 1920, y: 380, w: 140, h: 36 },
      { x: 2180, y: 520, w: 420, h: 220 },
      { x: -40, y: 0, w: 40, h: 800 },
    ],
    spikes: [
      { x: 520, y: 600, w: 90, h: 20 },
      { x: 1340, y: 600, w: 70, h: 20 },
    ],
    coins: [
      { x: 300, y: 540 }, { x: 680, y: 500 }, { x: 940, y: 420 },
      { x: 1220, y: 500 },
      { x: 1550, y: 560 }, { x: 1740, y: 400 },
      { x: 1980, y: 320 }, { x: 2300, y: 460 },
    ],
    drones: [
      { x: 980, y: 360, range: 90, dir: 1 },
      { x: 1780, y: 300, range: 110, dir: -1 },
    ],
  };

  let state;

  function makePlayer() {
    return {
      x: level.spawn.x,
      y: level.spawn.y,
      w: 42,
      h: STAND_H,
      vx: 0,
      vy: 0,
      onGround: true,
      facing: 1,
      dashT: 0,
      dashCd: 0,
      invuln: 0,
      crouching: false,
      anim: 0,
      animFrame: "idle",
      coyote: 0,
      jumpBuf: 0,
      trails: [],
    };
  }

  function loadBest() {
    try { return JSON.parse(localStorage.getItem("neon-dash-best") || "null"); }
    catch { return null; }
  }
  function saveBest(rec) {
    try { localStorage.setItem("neon-dash-best", JSON.stringify(rec)); } catch {}
  }

  function updateHint() {
    if (!hintEl) return;
    if (state.mode === "title") {
      hintEl.textContent = "Enter başla · M sessiz";
      hintEl.style.opacity = "1";
    } else if (state.mode === "pause") {
      hintEl.textContent = "PAUSE — Esc devam · R yeniden";
      hintEl.style.opacity = "1";
    } else if (state.mode === "play") {
      hintEl.textContent = "A/D · Space · S eğil-yürü · Shift dash · R yeniden · Esc";
      hintEl.style.opacity = state.hintTimer > 0 ? String(Math.min(1, state.hintTimer)) : "0";
    } else {
      hintEl.style.opacity = "0";
    }
  }

  function goTitle() {
    state.mode = "title";
    state.hintTimer = 999;
    updateHint();
  }

  function hardResetToTitle() {
    state = {
      mode: "title",
      t: 0,
      playTime: 0,
      coins: 0,
      coinFlags: level.coins.map(() => true),
      drones: level.drones.map((d) => ({ ...d, baseX: d.x })),
      player: makePlayer(),
      camX: 0,
      flash: 0,
      checkpoint: { ...level.spawn },
      checkpointArmed: false,
      lives: 1,
      deaths: 0,
      hintTimer: 999,
      best: loadBest(),
      rank: "C",
    };
    coinsEl.textContent = "◆ 0 / " + MAX_ORBS;
    updateHint();
  }

  function startPlay() {
    if (!checkAssets()) return;
    ensureAudio();
    state.mode = "play";
    state.playTime = 0;
    state.coins = 0;
    state.coinFlags = level.coins.map(() => true);
    state.drones = level.drones.map((d) => ({ ...d, baseX: d.x }));
    state.player = makePlayer();
    state.checkpoint = { ...level.spawn };
    state.checkpointArmed = false;
    state.lives = 1;
    state.deaths = 0;
    state.camX = 0;
    state.flash = 0;
    state.hintTimer = 3.5;
    coinsEl.textContent = "◆ 0 / " + MAX_ORBS;
    updateHint();
    sfx("ui");
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function resolveSolid(p, s) {
    if (!aabb(p, s)) return;
    const ox = Math.min(p.x + p.w - s.x, s.x + s.w - p.x);
    const oy = Math.min(p.y + p.h - s.y, s.y + s.h - p.y);
    if (ox < oy) {
      if (p.x + p.w / 2 < s.x + s.w / 2) p.x = s.x - p.w;
      else p.x = s.x + s.w;
      p.vx = 0;
    } else if (p.vy >= 0) {
      p.y = s.y - p.h;
      p.vy = 0;
      p.onGround = true;
      p.coyote = COYOTE;
    } else {
      p.y = s.y + s.h;
      p.vy = 0;
    }
  }

  function canStand(p) {
    const test = { x: p.x + (p.w - 42) / 2, y: p.y - (STAND_H - p.h), w: 42, h: STAND_H };
    return !level.solids.some((s) => aabb(test, s));
  }

  function hurt() {
    const p = state.player;
    if (p.invuln > 0 || p.dashT > 0) return;
    sfx("hit");
    state.flash = 0.35;
    state.lives -= 1;
    state.deaths += 1;
    if (state.lives < 0) state.lives = 0;
    p.x = state.checkpoint.x;
    p.y = state.checkpoint.y;
    p.vx = 0;
    p.vy = 0;
    p.dashT = 0;
    p.invuln = 1.2;
    p.h = STAND_H;
    p.w = 42;
    p.crouching = false;
  }

  function tryJump(p) {
    if (p.crouching) return false;
    if (p.onGround || p.coyote > 0) {
      p.vy = -JUMP;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      sfx("jump");
      return true;
    }
    return false;
  }

  function rankFor(time, coins, deaths) {
    if (coins >= MAX_ORBS && time < 35 && deaths === 0) return "S";
    if (coins >= MAX_ORBS && time < 45) return "A";
    if (coins >= 6 && time < 55) return "B";
    return "C";
  }

  function update(dt) {
    state.t += dt;
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
    if (state.hintTimer > 0) {
      state.hintTimer -= dt;
      updateHint();
    }

    if (state.mode !== "play") {
      Object.keys(justPressed).forEach((k) => { justPressed[k] = false; });
      return;
    }

    state.playTime += dt;
    const p = state.player;
    const left = keys.KeyA || keys.ArrowLeft;
    const right = keys.KeyD || keys.ArrowRight;
    const jumpDown = justPressed.Space || justPressed.KeyW || justPressed.ArrowUp;
    const jumpHeld = keys.Space || keys.KeyW || keys.ArrowUp;
    const crouch = keys.KeyS || keys.ArrowDown;
    const dash = justPressed.ShiftLeft || justPressed.ShiftRight || justPressed.KeyJ;

    p.dashCd = Math.max(0, p.dashCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (!p.onGround) p.coyote = Math.max(0, p.coyote - dt);
    if (jumpDown) p.jumpBuf = JUMP_BUF;
    else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

    const wantCrouch = !!(crouch && p.onGround && p.dashT <= 0);
    if (wantCrouch && !p.crouching) {
      p.crouching = true;
      p.y += p.h - CROUCH_H;
      p.h = CROUCH_H;
      p.w = 52;
    } else if (!wantCrouch && p.crouching) {
      if (canStand(p)) {
        p.y -= STAND_H - p.h;
        p.h = STAND_H;
        p.w = 42;
        p.crouching = false;
      }
    }

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vy = 0;
      p.vx = p.facing * DASH_SPD;
      if (Math.random() < 0.65) {
        p.trails.push({
          x: p.x, y: p.y, w: p.w, h: p.h,
          life: 0.18, facing: p.facing, frame: p.animFrame,
        });
      }
    } else {
      let ax = 0;
      if (left) { ax -= 1; p.facing = -1; }
      if (right) { ax += 1; p.facing = 1; }
      p.vx = ax * (p.crouching ? MOVE_CROUCH : MOVE);
      p.vy += GRAV * dt;
      if (!jumpHeld && p.vy < -120) p.vy *= 0.55;
      if (p.jumpBuf > 0) tryJump(p);
      if (dash && p.dashCd <= 0 && !p.crouching) {
        p.dashT = DASH_DUR;
        p.dashCd = DASH_CD;
        p.invuln = Math.max(p.invuln, DASH_DUR + 0.04);
        sfx("dash");
      }
    }

    p.trails = p.trails.filter((tr) => (tr.life -= dt) > 0);

    const wasGround = p.onGround;
    p.onGround = false;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    for (const s of level.solids) resolveSolid(p, s);
    if (p.onGround && !wasGround) p.coyote = COYOTE;

    if (p.x < 0) { p.x = 0; p.vx = 0; }
    if (p.y > H + 80) hurt();
    for (const sp of level.spikes) if (aabb(p, sp)) hurt();

    if (!state.checkpointArmed && p.x > level.checkpointPos.x - 40) {
      state.checkpointArmed = true;
      state.checkpoint = { x: level.checkpointPos.x, y: 550 };
      sfx("cp");
    }

    level.coins.forEach((c, i) => {
      if (!state.coinFlags[i]) return;
      if (aabb(p, { x: c.x - 14, y: c.y - 14, w: 28, h: 28 })) {
        state.coinFlags[i] = false;
        state.coins++;
        coinsEl.textContent = "◆ " + state.coins + " / " + MAX_ORBS;
        sfx("coin");
      }
    });

    for (const d of state.drones) {
      d.x += d.dir * 70 * dt;
      if (Math.abs(d.x - d.baseX) > d.range) d.dir *= -1;
      if (aabb(p, { x: d.x - 18, y: d.y - 14, w: 36, h: 28 })) hurt();
    }

    if (aabb(p, level.exit) && state.coins >= MAX_ORBS) {
      state.mode = "clear";
      state.rank = rankFor(state.playTime, state.coins, state.deaths);
      const rec = { time: state.playTime, coins: state.coins, rank: state.rank };
      if (!state.best || state.playTime < state.best.time || state.coins > (state.best.coins || 0)) {
        state.best = rec;
        saveBest(rec);
      }
      sfx("clear");
      updateHint();
    }

    p.anim += dt;
    if (!p.onGround) p.animFrame = "jump";
    else if (p.crouching) p.animFrame = "crouch";
    else if (Math.abs(p.vx) > 20) {
      p.animFrame = ["run1", "run2", "run3", "run2"][Math.floor(p.anim * 10) % 4];
    } else p.animFrame = "idle";

    const target = p.x - W * 0.35;
    state.camX += (target - state.camX) * Math.min(1, dt * 6);
    state.camX = Math.max(0, Math.min(state.camX, 2700 - W));

    Object.keys(justPressed).forEach((k) => { justPressed[k] = false; });
  }

  function drawBackground() {
    const bg = imgs.bg;
    if (bg.complete && bg.naturalWidth) {
      const parallax = state.camX * 0.35;
      const scale = Math.max(W / bg.naturalWidth, H / bg.naturalHeight) * 1.05;
      const dw = bg.naturalWidth * scale;
      const dh = bg.naturalHeight * scale;
      const x = -((parallax % dw) + dw) % dw;
      ctx.drawImage(bg, x, H - dh, dw, dh);
      ctx.drawImage(bg, x + dw - 1, H - dh, dw, dh);
      const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
      g.addColorStop(0, "rgba(5,5,18,0)");
      g.addColorStop(1, "rgba(5,5,18,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#0b1426";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.strokeStyle = "rgba(0,229,255,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 50; i++) {
      const rx = ((i * 97 + state.t * 420) % (W + 40)) - 20;
      const ry = ((i * 53 + state.t * 720) % (H + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 3, ry + 14);
      ctx.stroke();
    }
  }

  function glowRect(x, y, w, h, fill, glow) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function drawHeroFrame(frame, x, y, w, h, facing, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + w / 2, y + h);
    ctx.scale(facing, 1);
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 10;
    if (frame && frame.complete && frame.naturalWidth) {
      const drawH = h + 8;
      const drawW = (frame.naturalWidth / frame.naturalHeight) * drawH;
      ctx.drawImage(frame, -drawW / 2, -drawH, drawW, drawH);
    } else {
      ctx.fillStyle = "#ff2e9f";
      ctx.fillRect(-w / 2, -h, w, h);
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(-w / 2, -h, w, 14);
    }
    ctx.restore();
  }

  function drawWorld() {
    ctx.save();
    ctx.translate(-Math.floor(state.camX), 0);

    for (const s of level.solids) {
      if (s.x < 0) continue;
      glowRect(s.x, s.y, s.w, s.h, "rgba(20,22,36,0.92)", "#00e5ff66");
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(s.x, s.y, s.w, 3);
      ctx.fillStyle = "#ff2e9f";
      ctx.fillRect(s.x, s.y + 3, Math.max(24, s.w * 0.3), 2);
      ctx.fillStyle = "rgba(0,229,255,0.15)";
      ctx.fillRect(s.x, s.y + 4, s.w, 2);
    }

    const cp = level.checkpointPos;
    const on = state.checkpointArmed;
    ctx.save();
    ctx.shadowColor = on ? "#00e5ff" : "#ff2e9f";
    ctx.shadowBlur = on ? 24 : 10;
    ctx.fillStyle = on ? "#00e5ff" : "#5a2a4a";
    ctx.fillRect(cp.x, cp.y, 14, 100);
    ctx.beginPath();
    ctx.arc(cp.x + 7, cp.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8f7ff";
    ctx.font = "11px sans-serif";
    ctx.fillText(on ? "SAVE" : "CP", cp.x - 4, cp.y - 22);
    ctx.restore();

    for (const sp of level.spikes) {
      ctx.fillStyle = "#ff3b5c";
      ctx.shadowColor = "#ff3b5c";
      ctx.shadowBlur = 10;
      const n = Math.max(1, Math.floor(sp.w / 14));
      for (let i = 0; i < n; i++) {
        const sx = sp.x + i * (sp.w / n);
        ctx.beginPath();
        ctx.moveTo(sx, sp.y + sp.h);
        ctx.lineTo(sx + sp.w / n / 2, sp.y);
        ctx.lineTo(sx + sp.w / n, sp.y + sp.h);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    level.coins.forEach((c, i) => {
      if (!state.coinFlags[i]) return;
      const bob = Math.sin(state.t * 4 + i) * 4;
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.shadowColor = "#ff2e9f";
      ctx.shadowBlur = 22;
      const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, 14);
      grd.addColorStop(0, "#fff");
      grd.addColorStop(0.4, "#ff2e9f");
      grd.addColorStop(1, "rgba(255,46,159,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    for (const d of state.drones) {
      ctx.save();
      ctx.translate(d.x, d.y + Math.sin(state.t * 3 + d.baseX) * 5);
      ctx.shadowColor = "#ff2e9f";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#0e0e18";
      ctx.beginPath();
      ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#00e5ff";
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff2e9f";
      ctx.fillRect(-8, 10, 5, 8);
      ctx.fillRect(3, 10, 5, 8);
      ctx.restore();
    }

    const ex = level.exit;
    const locked = state.coins < MAX_ORBS;
    const pulse = 0.55 + Math.sin(state.t * 5) * 0.45;
    ctx.save();
    ctx.shadowColor = locked ? "#ff2e9f" : "#00e5ff";
    ctx.shadowBlur = 28 * pulse;
    ctx.strokeStyle = locked ? "#ff2e9f" : "#00e5ff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(ex.x + ex.w / 2, ex.y + ex.h / 2, ex.w / 2, ex.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(ex.x + ex.w / 2, ex.y + ex.h / 2, ex.w / 2 - 8, ex.h / 2 - 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    const sy = ex.y + ((state.t * 60) % ex.h);
    ctx.fillStyle = locked ? "rgba(255,46,159,0.25)" : "rgba(0,229,255,0.25)";
    ctx.fillRect(ex.x + 8, sy, ex.w - 16, 3);
    ctx.fillStyle = "#e8f7ff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(locked ? `EXIT ${state.coins}/${MAX_ORBS}` : "EXIT", ex.x, ex.y - 12);
    ctx.restore();

    const p = state.player;
    for (const tr of p.trails) {
      const fr = imgs[tr.frame] || imgs.idle;
      drawHeroFrame(fr, tr.x, tr.y, tr.w, tr.h, tr.facing, Math.max(0, tr.life / 0.18) * 0.35);
    }
    const blink = p.invuln > 0 && Math.floor(state.t * 20) % 2 === 0;
    if (!blink) {
      const frame = imgs[p.animFrame] || imgs.idle;
      drawHeroFrame(frame, p.x, p.y, p.w, p.h, p.facing, 1);
    }

    ctx.restore();
  }

  function drawHudPlay() {
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8f7ff";
    ctx.font = "16px sans-serif";
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 8;
    ctx.fillText(state.playTime.toFixed(1) + "s", 24, 56);
    ctx.fillText("♥ " + Math.max(0, state.lives), 24, 78);
    const p = state.player;
    const cd = 1 - p.dashCd / DASH_CD;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(W - 160, 20, 120, 10);
    ctx.fillStyle = cd >= 1 ? "#00e5ff" : "#ff2e9f";
    ctx.fillRect(W - 160, 20, 120 * Math.max(0, Math.min(1, cd)), 10);
    ctx.fillStyle = "#e8f7ff99";
    ctx.font = "11px sans-serif";
    ctx.fillText("DASH", W - 160, 16);
  }

  function drawOverlay() {
    if (state.mode === "title") {
      const splash = imgs.titleSplash;
      if (splash && splash.complete && splash.naturalWidth) {
        const scale = Math.max(W / splash.naturalWidth, H / splash.naturalHeight);
        const dw = splash.naturalWidth * scale;
        const dh = splash.naturalHeight * scale;
        ctx.drawImage(splash, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      ctx.fillStyle = "rgba(5,5,18,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#e8f7ff";
      ctx.font = "bold 64px sans-serif";
      ctx.fillText("NEON DASH", W / 2, H / 2 - 40);
      ctx.shadowColor = "#ff2e9f";
      ctx.fillStyle = "#ff2e9f";
      ctx.font = "18px sans-serif";
      ctx.fillText("8 orb topla → EXIT  ·  eğilerek alçak geçit", W / 2, H / 2 + 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#00e5ff";
      ctx.font = "18px sans-serif";
      ctx.globalAlpha = Math.sin(state.t * 4) > 0 ? 1 : 0.35;
      ctx.fillText("Enter / tıkla — başla", W / 2, H / 2 + 70);
      ctx.globalAlpha = 1;
      if (state.best) {
        ctx.fillStyle = "#e8f7ff88";
        ctx.font = "14px sans-serif";
        ctx.fillText(
          `Rekor: ${state.best.rank} · ${state.best.time.toFixed(1)}s · ◆${state.best.coins}`,
          W / 2,
          H / 2 + 110
        );
      }
    }

    if (state.mode === "pause") {
      ctx.fillStyle = "rgba(5,5,18,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8f7ff";
      ctx.font = "bold 48px sans-serif";
      ctx.fillText("PAUSE", W / 2, H / 2);
      ctx.font = "16px sans-serif";
      ctx.fillStyle = "#00e5ff";
      ctx.fillText("Esc devam · R yeniden", W / 2, H / 2 + 40);
    }

    if (state.mode === "clear") {
      ctx.fillStyle = "rgba(5,5,18,0.78)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#e8f7ff";
      ctx.font = "bold 48px sans-serif";
      ctx.fillText("SECTION CLEAR", W / 2, H / 2 - 50);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff2e9f";
      ctx.font = "bold 64px sans-serif";
      ctx.fillText("RANK " + state.rank, W / 2, H / 2 + 20);
      ctx.fillStyle = "#e8f7ff";
      ctx.font = "20px sans-serif";
      ctx.fillText(`◆ ${state.coins}/${MAX_ORBS}   ·   ${state.playTime.toFixed(1)}s`, W / 2, H / 2 + 60);
      ctx.fillStyle = "#00e5ff";
      ctx.font = "16px sans-serif";
      ctx.fillText("R / Enter — tekrar   ·   Esc — title", W / 2, H / 2 + 100);
    }

    if (state.mode === "play") drawHudPlay();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,46,159,${state.flash})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (muted) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#e8f7ff66";
      ctx.font = "12px sans-serif";
      ctx.fillText("MUTE", W - 24, H - 20);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    checkAssets();
    update(dt);
    drawBackground();
    if (state.mode !== "title") drawWorld();
    drawOverlay();
    requestAnimationFrame(frame);
  }

  hardResetToTitle();
  requestAnimationFrame(frame);
})();
