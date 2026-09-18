(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const coinsEl = document.getElementById("coins");

  const W = canvas.width;
  const H = canvas.height;
  const GRAV = 2200;
  const MOVE = 420;
  const JUMP = 780;
  const DASH_SPD = 980;

  const keys = Object.create(null);
  addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyR") hardReset();
    if ((e.code === "Enter" || e.code === "Space") && state.mode !== "play") {
      if (state.mode === "title" || state.mode === "clear") startPlay();
    }
  });
  addEventListener("keyup", (e) => { keys[e.code] = false; });
  canvas.addEventListener("pointerdown", () => {
    if (state.mode !== "play") startPlay();
  });

  const level = {
    spawn: { x: 80, y: 520 },
    checkpoint: { x: 80, y: 520 },
    exit: { x: 2460, y: 470, w: 48, h: 90 },
    solids: [
      { x: 0, y: 620, w: 520, h: 120 },
      { x: 620, y: 560, w: 180, h: 40 },
      { x: 880, y: 480, w: 160, h: 40 },
      { x: 1120, y: 560, w: 220, h: 40 },
      { x: 1420, y: 620, w: 700, h: 120 },
      { x: 1680, y: 460, w: 140, h: 36 },
      { x: 1920, y: 380, w: 140, h: 36 },
      { x: 2180, y: 520, w: 400, h: 200 },
    ],
    spikes: [
      { x: 520, y: 600, w: 90, h: 20 },
      { x: 1340, y: 600, w: 70, h: 20 },
    ],
    coins: [
      { x: 300, y: 540 }, { x: 680, y: 500 }, { x: 940, y: 420 },
      { x: 1200, y: 500 }, { x: 1550, y: 560 }, { x: 1740, y: 400 },
      { x: 1980, y: 320 }, { x: 2300, y: 460 },
    ],
    drones: [
      { x: 980, y: 360, range: 90, dir: 1 },
      { x: 1750, y: 300, range: 110, dir: -1 },
    ],
  };

  let state;

  function makePlayer() {
    return {
      x: level.spawn.x,
      y: level.spawn.y,
      w: 36,
      h: 52,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 1,
      dashT: 0,
      dashCd: 0,
      invuln: 0,
    };
  }

  function hardReset() {
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
    };
    level.checkpoint = { ...level.spawn };
    coinsEl.textContent = "◆ 0";
  }

  function startPlay() {
    state.mode = "play";
    state.playTime = 0;
    state.coins = 0;
    state.coinFlags = level.coins.map(() => true);
    state.drones = level.drones.map((d) => ({ ...d, baseX: d.x }));
    state.player = makePlayer();
    level.checkpoint = { ...level.spawn };
    state.camX = 0;
    state.flash = 0;
    coinsEl.textContent = "◆ 0";
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function resolveSolid(p, s) {
    if (!aabb(p, s)) return;
    const overlapX = Math.min(p.x + p.w - s.x, s.x + s.w - p.x);
    const overlapY = Math.min(p.y + p.h - s.y, s.y + s.h - p.y);
    if (overlapX < overlapY) {
      if (p.x + p.w / 2 < s.x + s.w / 2) p.x = s.x - p.w;
      else p.x = s.x + s.w;
      p.vx = 0;
    } else if (p.vy >= 0) {
      p.y = s.y - p.h;
      p.vy = 0;
      p.onGround = true;
    } else {
      p.y = s.y + s.h;
      p.vy = 0;
    }
  }

  function hurt() {
    const p = state.player;
    if (p.invuln > 0 || p.dashT > 0) return;
    state.flash = 0.28;
    p.x = level.checkpoint.x;
    p.y = level.checkpoint.y;
    p.vx = 0;
    p.vy = 0;
    p.invuln = 1.15;
  }

  function update(dt) {
    state.t += dt;
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);

    if (state.mode !== "play") return;

    state.playTime += dt;
    const p = state.player;
    const left = keys.KeyA || keys.ArrowLeft;
    const right = keys.KeyD || keys.ArrowRight;
    const jump = keys.Space || keys.KeyW || keys.ArrowUp;
    const dash = keys.ShiftLeft || keys.ShiftRight || keys.KeyJ;

    p.dashCd = Math.max(0, p.dashCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vy = 0;
      p.vx = p.facing * DASH_SPD;
    } else {
      let ax = 0;
      if (left) { ax -= 1; p.facing = -1; }
      if (right) { ax += 1; p.facing = 1; }
      p.vx = ax * MOVE;
      p.vy += GRAV * dt;
      if (jump && p.onGround) {
        p.vy = -JUMP;
        p.onGround = false;
        keys.Space = false;
        keys.KeyW = false;
        keys.ArrowUp = false;
      }
      if (dash && p.dashCd <= 0) {
        p.dashT = 0.14;
        p.dashCd = 0.55;
        p.invuln = Math.max(p.invuln, 0.18);
      }
    }

    p.onGround = false;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    for (const s of level.solids) resolveSolid(p, s);

    if (p.y > H + 80) hurt();
    for (const sp of level.spikes) {
      if (aabb(p, sp)) hurt();
    }

    if (p.x > 1420) level.checkpoint = { x: 1460, y: 560 };

    level.coins.forEach((c, i) => {
      if (!state.coinFlags[i]) return;
      if (aabb(p, { x: c.x - 14, y: c.y - 14, w: 28, h: 28 })) {
        state.coinFlags[i] = false;
        state.coins += 1;
        coinsEl.textContent = "◆ " + state.coins;
      }
    });

    for (const d of state.drones) {
      d.x += d.dir * 70 * dt;
      if (Math.abs(d.x - d.baseX) > d.range) d.dir *= -1;
      if (aabb(p, { x: d.x - 18, y: d.y - 14, w: 36, h: 28 })) hurt();
    }

    if (aabb(p, level.exit)) state.mode = "clear";

    const target = p.x - W * 0.35;
    state.camX += (target - state.camX) * Math.min(1, dt * 6);
    state.camX = Math.max(0, Math.min(state.camX, 2700 - W));
  }

  function glowRect(x, y, w, h, fill, glow, blur = 16) {
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = blur;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b1426");
    g.addColorStop(0.55, "#12102a");
    g.addColorStop(1, "#050512");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const par = state.camX * 0.25;
    for (let i = 0; i < 18; i++) {
      const bx = ((i * 140 - par) % (W + 200) + (W + 200)) % (W + 200) - 40;
      const bh = 80 + ((i * 47) % 160);
      ctx.fillStyle = "#1a2a4a";
      ctx.fillRect(bx, H - 180 - bh, 70 + (i % 3) * 20, bh);
      ctx.fillStyle = i % 2 ? "#ff2e9f55" : "#00e5ff44";
      for (let wy = 0; wy < bh - 20; wy += 18) {
        ctx.fillRect(bx + 10, H - 180 - bh + 12 + wy, 8, 8);
        ctx.fillRect(bx + 28, H - 180 - bh + 12 + wy, 8, 8);
      }
    }

    ctx.strokeStyle = "#00e5ff22";
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const rx = ((i * 97 + state.t * 400) % (W + 40)) - 20;
      const ry = ((i * 53 + state.t * 700) % (H + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 4, ry + 16);
      ctx.stroke();
    }
  }

  function drawWorld() {
    ctx.save();
    ctx.translate(-Math.floor(state.camX), 0);

    for (const s of level.solids) {
      glowRect(s.x, s.y, s.w, s.h, "#1c1c28", "#00e5ff66", 12);
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(s.x, s.y, s.w, 3);
      ctx.fillStyle = "#ff2e9f";
      ctx.fillRect(s.x, s.y + 3, Math.max(20, s.w * 0.35), 2);
    }

    for (const sp of level.spikes) {
      ctx.fillStyle = "#ff3b5c";
      ctx.shadowColor = "#ff3b5c";
      ctx.shadowBlur = 12;
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
      ctx.rotate(state.t * 2);
      ctx.shadowColor = "#ff2e9f";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#ff2e9f";
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k;
        const x = Math.cos(a) * 12;
        const y = Math.sin(a) * 12;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    for (const d of state.drones) {
      ctx.save();
      ctx.translate(d.x, d.y + Math.sin(state.t * 3 + d.baseX) * 5);
      ctx.shadowColor = "#ff2e9f";
      ctx.shadowBlur = 16;
      ctx.fillStyle = "#12121c";
      ctx.fillRect(-18, -10, 36, 20);
      ctx.fillStyle = "#ff2e9f";
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(-22, -3, 8, 4);
      ctx.fillRect(14, -3, 8, 4);
      ctx.restore();
    }

    const ex = level.exit;
    const pulse = 0.6 + Math.sin(state.t * 5) * 0.4;
    ctx.save();
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 30 * pulse;
    const eg = ctx.createLinearGradient(ex.x, ex.y, ex.x + ex.w, ex.y);
    eg.addColorStop(0, "#00e5ff");
    eg.addColorStop(0.5, "#ffffff");
    eg.addColorStop(1, "#ff2e9f");
    ctx.fillStyle = eg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(ex.x, ex.y, ex.w, ex.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e8f7ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(ex.x - 4, ex.y - 4, ex.w + 8, ex.h + 8);
    ctx.fillStyle = "#e8f7ff";
    ctx.font = "12px sans-serif";
    ctx.fillText("EXIT", ex.x + 8, ex.y - 10);
    ctx.restore();

    const p = state.player;
    const blink = p.invuln > 0 && Math.floor(state.t * 20) % 2 === 0;
    if (!blink) {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.scale(p.facing, 1);
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = p.dashT > 0 ? 28 : 14;
      ctx.fillStyle = "#ff2e9f";
      ctx.fillRect(-14, -6, 28, 26);
      ctx.fillStyle = "#1c1c28";
      ctx.fillRect(-12, 18, 10, 14);
      ctx.fillRect(2, 18, 10, 14);
      ctx.fillStyle = "#ffc2d4";
      ctx.fillRect(-10, -26, 20, 18);
      ctx.fillStyle = "#00e5ff";
      ctx.fillRect(-9, -20, 18, 8);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.5;
      ctx.fillRect(-7, -19, 6, 3);
      ctx.globalAlpha = 1;
      if (p.dashT > 0) {
        ctx.strokeStyle = "#00e5ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(-40, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function drawOverlay() {
    if (state.mode === "title") {
      ctx.fillStyle = "#050512cc";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#e8f7ff";
      ctx.font = "bold 64px sans-serif";
      ctx.fillText("NEON DASH", W / 2, H / 2 - 40);
      ctx.shadowColor = "#ff2e9f";
      ctx.fillStyle = "#ff2e9f";
      ctx.font = "20px sans-serif";
      ctx.fillText("kısa oynanabilir dilim", W / 2, H / 2 + 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#00e5ff";
      ctx.font = "18px sans-serif";
      ctx.globalAlpha = Math.sin(state.t * 4) > 0 ? 1 : 0.35;
      ctx.fillText("Enter / tıkla — başla", W / 2, H / 2 + 70);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#e8f7ff88";
      ctx.font = "14px sans-serif";
      ctx.fillText("A/D hareket · Space zıpla · Shift dash · R yeniden", W / 2, H / 2 + 110);
    }

    if (state.mode === "clear") {
      ctx.fillStyle = "#050512bb";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.shadowColor = "#00e5ff";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#e8f7ff";
      ctx.font = "bold 48px sans-serif";
      ctx.fillText("SECTION CLEAR", W / 2, H / 2 - 30);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ff2e9f";
      ctx.font = "22px sans-serif";
      ctx.fillText(`◆ ${state.coins} / ${level.coins.length}   ·   ${state.playTime.toFixed(1)}s`, W / 2, H / 2 + 20);
      ctx.fillStyle = "#00e5ff";
      ctx.font = "16px sans-serif";
      ctx.fillText("Enter — tekrar oyna", W / 2, H / 2 + 70);
    }

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,46,159,${state.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    drawBackground();
    drawWorld();
    drawOverlay();
    requestAnimationFrame(frame);
  }

  hardReset();
  requestAnimationFrame(frame);
})();
