/**
 * NEON DASH — 02:17
 * Teknik level şeması  (mevcut game.js fizik evrenine birebir)
 *
 * Canvas: 1280 x 720
 * GRAV=2200  MOVE=430  JUMP=800  DASH=1000 / 0.14s
 * Zıplama tavanı ≈ 145px    Havadaki yatay menzil ≈ 310px    Dash menzili ≈ 140px
 * Ayakta hitbox 42 x 70     Eğilince 52 x 44
 * Zemin konvansiyonu: ana floor.y = 620, floor.h = 120  →  üst yüzey 620
 * Spawn ayak hizası: y = floorTop - 70
 *
 * Bu dosya motor değildir. game.js içindeki tek `level` objesini
 * `ROOMS[id]` + `GameState.flags` sistemine bölmek için şemadır.
 */

const PHYS = {
  W: 1280,
  H: 720,
  GRAV: 2200,
  MOVE: 430,
  JUMP: 800,
  DASH_SPEED: 1000,
  DASH_TIME: 0.14,
  DASH_CD: 0.55,
  STAND: { w: 42, h: 70 },
  CROUCH: { w: 52, h: 44 },
  JUMP_H: 145,
  JUMP_AIR_X: 310,
  DASH_X: 140,
  COYOTE: 0.1,
  JUMP_BUFFER: 0.08,
  GHOST_SEC: 6,
  DRONE_SLEEP: 4,
  INVULN_HURT: 1.15,
};

/* ─────────────────────────────────────────────
 * KAYIT / BAYRAKLAR
 * Ölünce DÜŞMEZ: memories, stamps, keys, fakeExitUsed, endings
 * Ölünce DÜŞER : room-local switches, clock alignment, nara phase progress
 * ───────────────────────────────────────────── */
const FLAGS = {
  memories: [false, false, false, false, false, false, false, false], // 8 Anı
  stampService: false,
  key24h: false,
  keyRoom17: false,
  fakeExitUsed: false,
  usedPulseVending: false,
  naraSolved: false,
  naraOrder: [],          // beklenen gizli son: ['jump','crouch','dash']
  ending: null,           // 'A' | 'B' | 'C' | null
  roomsCleared: {},
};

const SAVE_KEYS = [
  "memories", "stampService", "key24h", "keyRoom17",
  "fakeExitUsed", "usedPulseVending", "roomsCleared",
];

/* ─────────────────────────────────────────────
 * VARLIK TİPLERİ
 * her varlık AABB tabanlıdır (x,y,w,h) + type
 * ─────────────────────────────────────────────
 *
 * solid     {x,y,w,h}
 * spike     {x,y,w,h}
 * spawn     {x,y}
 * camera    { minX, maxX }   maxX = worldWidth - W
 *
 * shutter   {x,y,w,hClosed,hOpen,open}          hClosed küçük → crouch şart
 * laser     {x,y,w,h, axis:'h'|'v', mode:'solid'|'blink',
 *            on:1.1, off:0.7, phase:0,
 *            bypass:'crouch' | 'none' }
 *            dash i-frame lazeri DELMEZ (Perde I dersi)
 *
 * door      {id, x,y,w,h, lockedBy: string|string[],
 *            to: {room, spawn} }
 * exit      {id, x,y,w,h, kind:
 *            'fake' | 'section' | 'endingA' | 'endingB' | 'endingC' | 'gallery-true'}
 *
 * plate     {id, x,y,w,h, hold:true, ghostable:true, links:['doorId'|fx]}
 * switch    {id, x,y,w,h, once:true, links:[]}
 *
 * drone     {id, x,y, w:36,h:28, kind:
 *            'patrol' | 'lift' | 'clock' | 'shift',
 *            range, dir, axis:'x'|'y', speed:70,
 *            sleepable:true }
 *            arkadan dash (facing * (drone.x-player.x) > 0 değil,
 *            player.facing drone’a bakMIYOR + dashT>0) → sleep DRONE_SLEEP
 *
 * memory    {i:1..8, x,y}     kalıcı coin
 * pickup    {id, x,y, flag}   damga / anahtar
 *
 * sign      {x,y, text, clue?}
 * clock     {id, x,y,w,h, time:'02:17'|'03:41'|'00:00', breakable}
 * vending   {id, x,y,w,h, cost:'memory'|null, gives, code?}
 * print     {x,y,w,h, visible:'crouch'}     ıslak iz
 * kaide     {i:1..8, x,y,w,h, expect:string}
 * nara      {x,y, phase:0}
 * ledger    {x,y,w,h}         hub defteri, E / eğil ile oku
 * rain      {on:true, volume:0..1}
 *
 * trigger   {x,y,w,h, once, event, data}
 */

const EVENTS = {
  SAY: "say",                 // {text, sec}
  FLAG: "flag",               // {key, value}
  GIVE: "give",               // {flag}
  ROOM: "room",               // {id, spawn}
  FAKE_CLEAR: "fake-clear",   // SECTION CLEAR → lobby
  GHOST_ARM: "ghost-arm",     // son ölümü 6sn replay et
  CLOCK_SET: "clock-set",
  RAIN: "rain",
  END: "end",                 // A B C
};

const DIALOGUE = {
  n1: "Katları sen üreteceksin.",
  n2: "Bu bir çıkış değil.",
  n3: "Yağmur durmayacak.",
  n4: "Bunu önceki sefer sen tasarladın.",
  n5: "Otel cümlenin ikinci yarısını yiyor.",
  n6: "Lobiye in. EXIT’e girme.",
  n7: "Beni götürme. Sen check-out yap.",
  checkin: "CHECK-IN: 02:17    CHECK-OUT: —",
};

const MEMORIES = [
  { i: 1, room: "p1_press",    line: "Adım Nara idi. Tepsiyi 17’ye bırakmadım. Tepside anahtar vardı." },
  { i: 2, room: "p2_vending",  line: "Kuryeler yemek yemez. Yemek, kapı şifresidir." },
  { i: 3, room: "p2_vitrine",  line: "Yağmur durursa yansıma da durur. Yağmur durmayacak." },
  { i: 4, room: "p2_chute",    line: "Dash kaçış değil. Yer değiştirme." },
  { i: 5, room: "p2_vault",    line: "Saat bozulmadı. Sabah iptal edildi." },
  { i: 6, room: "p3_room17",   line: "17 check-in yaptı. Valiz yok. Sadece bir isim: RİN." },
  { i: 7, room: "p3_mirror",   line: "Nara yalan söylemiyor. Nara tamamını söyleyemiyor." },
  { i: 8, room: "p3_ledger",   line: "Ben RİN. Nara’yı ben bıraktım. 17 bendim." },
];

const LEDGER_LINES = [
  { need: "stampService", text: "SERVİS — damga alındı. Misafir 17 tepsi istememiş." },
  { need: "memories.1",   text: "CADDE — yemek şifredir." },
  { need: "key24h",        text: "SAAT — 02:17 kilit. Sabah iptal." },
  { need: "memories.5",    text: "ODA — iz içeri gidiyor." },
  { need: "memories.5",    text: "İSİM — RİN." },
  { need: "memories.6",    text: "NARA — cümlenin ikinci yarısı yok." },
  { need: "memories.7",    text: "RİN — kurye ve misafir aynı vücut." },
  { need: "memories.7",    text: "02:17 — check-out henüz yok." },
];

/* Final kaide sırası (Perde IV-B) — defterin ilk kelimeleri */
const KAIDE_ORDER = [
  "SERVİS", "CADDE", "SAAT", "ODA", "İSİM", "NARA", "RİN", "02:17",
];

/* Gizli son şartları */
const ENDING_C_REQUIRES = {
  memories: 8,
  fakeExitUsed: false,          // veya 2. turda deftere "reddedildi"
  naraOrder: ["jump", "crouch", "dash"],
};

/* ═════════════════════════════════════════════
 * ODALAR
 * worldWidth: kameranın maxX = worldWidth - 1280
 * her oda kendi (0,0) köşesinden başlar
 * ═════════════════════════════════════════════ */
const ROOMS = {


  /* ───────────────────────────────────────────
   * HUB — HOTEL LOBİ
   * 4 kapı, defter, yağmur, CHECK-IN yazısı
   * ─────────────────────────────────────────── */
  hub_lobby: {
    act: 0,
    worldWidth: 2560,
    rain: { on: true, volume: 0.8 },
    music: "lobby",
    spawn: { x: 90, y: 550 },
    checkpoint: { x: 90, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 2560, h: 120 },          // uzun ıslak zemin
      { x: 0,    y: 0,   w: 40,   h: 720 },          // sol duvar
      { x: 2520, y: 0,   w: 40,   h: 720 },
    ],
    spikes: [],
    drones: [],
    memories: [],
    signs: [
      { x: 180, y: 180, text: "ホテル" },
      { x: 80,  y: 80,  text: "CHECK-IN: 02:17" },
    ],
    ledger: { x: 420, y: 540, w: 70, h: 80 },
    doors: [
      {
        id: "to_service", x: 700, y: 460, w: 56, h: 160,
        lockedBy: [],
        to: { room: "p1_wet", spawn: "default" },
        label: "SERVİS",
      },
      {
        id: "to_street", x: 1100, y: 460, w: 56, h: 160,
        lockedBy: ["stampService", "memories:1"],   // 3 anı + damga
        to: { room: "p2_spine", spawn: "default" },
        label: "CADDE",
      },
      {
        id: "to_tower", x: 1500, y: 460, w: 56, h: 160,
        lockedBy: ["key24h"],
        to: { room: "p3_seq", spawn: "default" },
        label: "未来",
      },
      {
        id: "to_checkout", x: 2000, y: 460, w: 56, h: 160,
        lockedBy: ["memories:8", "keyRoom17"],
        to: { room: "p4_empty", spawn: "default" },
        label: "CHECK-OUT",
      },
    ],
    triggers: [
      { x: 80, y: 400, w: 200, h: 220, once: true, event: "say", data: { text: DIALOGUE.checkin, sec: 3.2 } },
      { x: 600, y: 400, w: 80, h: 220, once: true, event: "say", data: { text: DIALOGUE.n1, sec: 2.4 } },
    ],
  },


  /* ═══════════════════════════════════════════
   * PERDE I — SERVİS KATI
   * ═══════════════════════════════════════════ */

  /* I-1  Yaş Koridor  (mevcut dilimin evrimi + kepenk) */
  p1_wet: {
    act: 1,
    worldWidth: 2600,
    rain: { on: true, volume: 0.7 },
    music: "service",
    spawn: { x: 90, y: 550 },
    checkpoint: { x: 90, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 520,  h: 120 },
      { x: 620,  y: 560, w: 180,  h: 40  },
      { x: 880,  y: 480, w: 160,  h: 40  },
      { x: 1120, y: 560, w: 220,  h: 40  },
      { x: 1420, y: 620, w: 1180, h: 120 },
    ],
    spikes: [
      { x: 520, y: 600, w: 90, h: 20 },
    ],
    shutters: [
      /* üst yüzey 620, açık yükseklik 48 → sadece crouch (44) geçer */
      { id: "k1", x: 1680, y: 572, w: 90, hClosed: 48, hOpen: 160, open: false },
    ],
    drones: [
      { id: "d1", x: 980, y: 360, kind: "patrol", range: 90, dir: 1, axis: "x", speed: 70, sleepable: true },
    ],
    memories: [],
    doors: [
      { id: "p1w_back", x: 40, y: 460, w: 48, h: 160, lockedBy: [], to: { room: "hub_lobby", spawn: "from_service" } },
      { id: "p1w_next", x: 2480, y: 460, w: 56, h: 160, lockedBy: [], to: { room: "p1_dish", spawn: "default" } },
    ],
    triggers: [
      { x: 1600, y: 500, w: 60, h: 120, once: true, event: "say", data: { text: "S — kepenk altından.", sec: 2.0 } },
    ],
    scripts: {
      onEnter: [{ event: "checkpoint-set", data: { x: 90, y: 550 } }],
    },
  },

  /* I-2  Bulaşık Hattı — alçak lazerler, dash YETMEZ */
  p1_dish: {
    act: 1,
    worldWidth: 2400,
    rain: { on: false, volume: 0.2 },
    music: "service",
    spawn: { x: 80, y: 550 },
    checkpoint: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 2400, h: 120 },
      { x: 0,    y: 0,   w: 40,   h: 720 },
      { x: 2360, y: 0,   w: 40,   h: 720 },
    ],
    lasers: [
      /* ilk lazer yüksek: dash i-frame ile de ölürsün — ders */
      { id: "Lwarn", x: 420, y: 500, w: 16, h: 120, axis: "v", mode: "solid", bypass: "none",
        sign: "DASH YETMEZ" },
      /* alçak tünel: ayakta 70 ölür, crouch 44 geçer  (lazer y=576, h=44 → alt 620) */
      { id: "L1", x: 720,  y: 576, w: 220, h: 44, axis: "h", mode: "solid", bypass: "crouch" },
      { id: "L2", x: 1100, y: 576, w: 220, h: 44, axis: "h", mode: "blink", on: 1.0, off: 0.8, phase: 0, bypass: "crouch" },
      { id: "L3", x: 1480, y: 576, w: 220, h: 44, axis: "h", mode: "blink", on: 0.7, off: 0.7, phase: 0.35, bypass: "crouch" },
    ],
    spikes: [],
    drones: [],
    memories: [],
    doors: [
      { id: "p1d_next", x: 2200, y: 460, w: 56, h: 160, lockedBy: [], to: { room: "p1_lift", spawn: "default" } },
    ],
  },

  /* I-3  Drone Asansörü — drone = hareketli platform */
  p1_lift: {
    act: 1,
    worldWidth: 1800,
    rain: { on: false, volume: 0.15 },
    music: "service",
    spawn: { x: 80, y: 550 },
    checkpoint: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 360, h: 120 },
      { x: 1440, y: 260, w: 360, h: 40  },   // üst vana platformu
      { x: 1440, y: 0,   w: 40,  h: 260 },
      { x: 1760, y: 0,   w: 40,  h: 720 },
      { x: 0,    y: 0,   w: 40,  h: 720 },
    ],
    spikes: [
      { x: 360, y: 700, w: 1080, h: 20 },    // çukur tabanı
    ],
    drones: [
      {
        id: "lift1", x: 500, y: 560, kind: "lift",
        axis: "y", range: 280, dir: -1, speed: 55,
        sleepable: true, mountable: true,     // üzerine basılır
        wakePath: { x: 500, y1: 560, y2: 280 },
      },
    ],
    /* üst vana: drone uyurken + oyuncu üst platformdaysa açılır */
    doors: [
      {
        id: "valve", x: 1580, y: 100, w: 56, h: 160,
        lockedBy: ["script:lift-mounted"],
        to: { room: "p1_fake", spawn: "default" },
        label: "VANA",
      },
    ],
    scripts: {
      /* drone uyuyorsa durur; oyuncu üstündeyse onu taşır (p.y = drone.y - p.h) */
      onDashBack: { target: "lift1", effect: "sleep" },
    },
  },

  /* I-4  Sahte EXIT */
  p1_fake: {
    act: 1,
    worldWidth: 2000,
    rain: { on: true, volume: 0.5 },
    music: "service",
    spawn: { x: 80, y: 550 },
    checkpoint: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 720,  h: 120 },
      { x: 860,  y: 540, w: 160,  h: 40  },
      { x: 1120, y: 460, w: 160,  h: 40  },
      { x: 1400, y: 520, w: 600,  h: 220 },
    ],
    spikes: [
      { x: 720, y: 600, w: 140, h: 20 },
    ],
    drones: [
      { id: "d2", x: 1180, y: 340, kind: "patrol", range: 80, dir: -1, axis: "x", speed: 70, sleepable: true },
    ],
    exits: [
      {
        id: "fake1", x: 1760, y: 420, w: 56, h: 100,
        kind: "fake",
        label: "EXIT",
        onEnter: [
          { event: "flag", data: { key: "fakeExitUsed", value: true } },
          { event: "fake-clear" },          // SECTION CLEAR → 1.1s → hub_lobby
          { event: "say", data: { text: DIALOGUE.n2, sec: 2.6 } },
        ],
      },
    ],
    /* sahte EXIT’i YOK SAYIP sağ duvardaki servis kapısından devam */
    doors: [
      {
        id: "skip_fake", x: 1900, y: 360, w: 48, h: 160,
        lockedBy: [],
        to: { room: "p1_press", spawn: "default" },
        label: "SERVİS",
        hint: "EXIT’in sağı — yağmur yansıması olan kapı",
      },
    ],
  },

  /* I-5  Çamaşır Presi — hayalet plaka */
  p1_press: {
    act: 1,
    worldWidth: 2200,
    rain: { on: false, volume: 0.1 },
    music: "service",
    spawn: { x: 80, y: 550 },
    checkpoint: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 2200, h: 120 },
      { x: 0,    y: 0,   w: 40,   h: 720 },
      { x: 2160, y: 0,   w: 40,   h: 720 },
    ],
    spikes: [
      { x: 980, y: 600, w: 80, h: 20 },     // bilinçli ölüm noktası
    ],
    plates: [
      { id: "A", x: 420,  y: 604, w: 70, h: 16, hold: true, ghostable: true, links: ["pressDoor"] },
      { id: "B", x: 1480, y: 604, w: 70, h: 16, hold: true, ghostable: true, links: ["pressDoor"] },
    ],
    doors: [
      {
        id: "pressDoor", x: 1880, y: 460, w: 64, h: 160,
        lockedBy: ["plate:A", "plate:B"],   // aynı anda (biri hayalet olabilir)
        to: { room: "hub_lobby", spawn: "from_service" },
        label: "DAMGA",
        onOpen: [
          { event: "give", data: { flag: "stampService" } },
        ],
      },
    ],
    memories: [
      { i: 1, x: 1980, y: 540 },
    ],
    pickups: [
      { id: "stamp", x: 1940, y: 580, flag: "stampService", hiddenUntil: "pressDoor.open" },
    ],
    scripts: {
      onHurt: { event: "ghost-arm" },       // her hasarda 6sn hayalet bırak
      onBothPlates: { event: "door-open", data: { id: "pressDoor" } },
    },
  },


  /* ═══════════════════════════════════════════
   * PERDE II — 24 SAAT CADDESİ
   * omurga + 4 yan sokak
   * ═══════════════════════════════════════════ */

  /* II omurga — Işık Sırası  C-M-C-C-M   (未来 harf ipucu) */
  p2_spine: {
    act: 2,
    worldWidth: 4200,
    rain: { on: true, volume: 0.9 },
    music: "street",
    spawn: { x: 90, y: 550 },
    checkpoint: { x: 90, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 4200, h: 120 },
      { x: 0,    y: 0,   w: 40,   h: 720 },
    ],
    signs: [
      { x: 2400, y: 160, text: "未来", clue: "C-M-C-C-M" },
      { x: 800,  y: 200, text: "24時間営業" },
    ],
    tiles: [
      /* dash yalnızca cyan taşta BAŞLARSA sıra ilerler; yanlış = reset */
      { id: "t1", x: 500,  y: 604, w: 80, h: 16, color: "cyan"    },
      { id: "t2", x: 900,  y: 604, w: 80, h: 16, color: "magenta" },
      { id: "t3", x: 1300, y: 604, w: 80, h: 16, color: "cyan"    },
      { id: "t4", x: 1700, y: 604, w: 80, h: 16, color: "cyan"    },
      { id: "t5", x: 2100, y: 604, w: 80, h: 16, color: "magenta" },
    ],
    tileSequence: ["cyan", "magenta", "cyan", "cyan", "magenta"],
    doors: [
      {
        id: "spineGate", x: 2500, y: 460, w: 64, h: 160,
        lockedBy: ["script:tile-ok"],
        to: { room: "p2_spine", spawn: "after_gate" },
        label: "SIRA",
      },
      /* yan sokak girişleri — kapı değil, merdiven/koridor AABB */
      { id: "to_vend",    x: 2800, y: 460, w: 48, h: 160, lockedBy: ["script:tile-ok"], to: { room: "p2_vending", spawn: "default" }, label: "OTOMAT" },
      { id: "to_vitrine", x: 3100, y: 460, w: 48, h: 160, lockedBy: ["script:tile-ok"], to: { room: "p2_vitrine", spawn: "default" }, label: "VİTRİN" },
      { id: "to_chute",   x: 3400, y: 460, w: 48, h: 160, lockedBy: ["script:tile-ok"], to: { room: "p2_chute",   spawn: "default" }, label: "ŞUT" },
      { id: "to_vault",   x: 3700, y: 460, w: 48, h: 160, lockedBy: ["script:tile-ok"], to: { room: "p2_vault",   spawn: "default" }, label: "KASA" },
      { id: "to_shift",   x: 4000, y: 460, w: 56, h: 160, lockedBy: ["key24h"],         to: { room: "p2_shift",   spawn: "default" }, label: "VARDİYA" },
      { id: "to_hub",     x: 60,   y: 460, w: 48, h: 160, lockedBy: [],                to: { room: "hub_lobby",  spawn: "from_street" }, label: "ホテル" },
    ],
    extraSpawns: {
      after_gate: { x: 2580, y: 550 },
    },
    scripts: {
      onDashStartOnTile: "advance-or-reset-sequence",
    },
  },

  /* II-A Otomat — kod: kiraz / tuz / siyah   (hub defteri 02:17 menü) */
  p2_vending: {
    act: 2,
    worldWidth: 1600,
    rain: { on: true, volume: 0.4 },
    music: "street",
    spawn: { x: 80, y: 550 },
    solids: [{ x: 0, y: 620, w: 1600, h: 120 }, { x: 0, y: 0, w: 40, h: 720 }, { x: 1560, y: 0, w: 40, h: 720 }],
    vendings: [
      { id: "v1", x: 400, y: 500, w: 70, h: 120, glyph: "kiraz" },
      { id: "v2", x: 560, y: 500, w: 70, h: 120, glyph: "tuz" },
      { id: "v3", x: 720, y: 500, w: 70, h: 120, glyph: "siyah" },
      { id: "vWrong", x: 980, y: 500, w: 70, h: 120, glyph: "süt", punish: "spawn-drone" },
    ],
    code: ["kiraz", "tuz", "siyah"],
    drones: [],
    memories: [{ i: 2, x: 1280, y: 540, require: "script:code-ok" }],
    doors: [
      { id: "back", x: 80, y: 460, w: 48, h: 160, lockedBy: [], to: { room: "p2_spine", spawn: "after_gate" } },
    ],
    scripts: {
      onWrongCode: { event: "spawn", data: { drone: { x: 200, y: 360, kind: "patrol", range: 400, speed: 110 } } },
    },
  },

  /* II-B Vitrin — eğilince yansıma platformu GERÇEK olur */
  p2_vitrine: {
    act: 2,
    worldWidth: 2000,
    rain: { on: true, volume: 0.85 },
    music: "street",
    spawn: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 480,  h: 120 },
      { x: 1520, y: 620, w: 480,  h: 120 },
      { x: 0,    y: 0,   w: 40,   h: 720 },
      { x: 1960, y: 0,   w: 40,   h: 720 },
    ],
    spikes: [
      { x: 480, y: 700, w: 1040, h: 20 },
    ],
    mirrors: [
      {
        id: "vitrine",
        x: 700, y: 200, w: 600, h: 360,          // cam
        ghostPlatforms: [
          { x: 780,  y: 500, w: 140, h: 24 },
          { x: 1020, y: 430, w: 140, h: 24 },
          { x: 1260, y: 500, w: 140, h: 24 },
        ],
        visibleWhen: "crouch",                   // eğilirken solids’e eklenir
      },
    ],
    memories: [{ i: 3, x: 1700, y: 540 }],
    doors: [
      { id: "back", x: 80, y: 460, w: 48, h: 160, lockedBy: [], to: { room: "p2_spine", spawn: "after_gate" } },
    ],
    triggers: [
      { x: 200, y: 400, w: 80, h: 220, once: true, event: "say", data: { text: DIALOGUE.n3, sec: 2.2 } },
    ],
  },

  /* II-C Teslimat Şutu — dikey kuyu, dash = 0.14sn duvar tutunması */
  p2_chute: {
    act: 2,
    worldWidth: 1280,            // dikey oda, kamera Y de açılır
    cameraAxis: "y",
    worldHeight: 2200,
    rain: { on: false, volume: 0.2 },
    music: "street",
    spawn: { x: 200, y: 2050 },   // alt
    solids: [
      { x: 0,    y: 2120, w: 1280, h: 80 },      // taban
      { x: 0,    y: 0,    w: 80,   h: 2200 },    // sol kuyu duvarı
      { x: 1200, y: 0,    w: 80,   h: 2200 },    // sağ
      { x: 80,   y: 1700, w: 160,  h: 24 },
      { x: 1040, y: 1400, w: 160,  h: 24 },
      { x: 80,   y: 1100, w: 160,  h: 24 },
      { x: 1040, y: 800,  w: 160,  h: 24 },
      { x: 480,  y: 420,  w: 320,  h: 40 },      // tepe
    ],
    shutters: [
      { id: "top_hatch", x: 560, y: 376, w: 160, hClosed: 48, hOpen: 48, open: false },
    ],
    stickWalls: [
      { x: 80,   y: 800,  w: 16, h: 900, side: "left" },
      { x: 1184, y: 500,  w: 16, h: 900, side: "right" },
    ],
    /* dash duvara değerse dashT süresince vy=0, yapış */
    memories: [{ i: 4, x: 640, y: 360 }],
    doors: [
      { id: "back", x: 200, y: 1960, w: 48, h: 160, lockedBy: [], to: { room: "p2_spine", spawn: "after_gate" } },
      { id: "top",  x: 600, y: 260,  w: 48, h: 120, lockedBy: [], to: { room: "p2_spine", spawn: "after_gate" } },
    ],
    scripts: {
      onDashHitStickWall: "wall-cling-for-dashT",
    },
  },

  /* II-D 24H Kasa — üç saat, 02:17 korunacak */
  p2_vault: {
    act: 2,
    worldWidth: 2400,
    rain: { on: true, volume: 0.5 },
    music: "street",
    spawn: { x: 80, y: 550 },
    checkpoint: { x: 80, y: 550 },
    solids: [
      { x: 0, y: 620, w: 2400, h: 120 },
      { x: 0, y: 0, w: 40, h: 720 },
      { x: 2360, y: 0, w: 40, h: 720 },
      { x: 360, y: 420, w: 120, h: 24 },
      { x: 1080, y: 420, w: 120, h: 24 },
      { x: 1800, y: 420, w: 120, h: 24 },
    ],
    clocks: [
      { id: "c341", x: 380,  y: 300, w: 80, h: 80, time: "03:41", breakable: true,  target: "break" },
      { id: "c217", x: 1100, y: 300, w: 80, h: 80, time: "02:17", breakable: false, target: "hold" },
      { id: "c000", x: 1820, y: 300, w: 80, h: 80, time: "00:00", breakable: true,  target: "break" },
    ],
    drones: [
      /* saatlerin üstünden geçince o saati +1 dk ileri alır */
      { id: "clk1", x: 400,  y: 240, kind: "clock", range: 90, dir: 1, axis: "x", speed: 50, sleepable: true, links: "c341" },
      { id: "clk2", x: 1120, y: 240, kind: "clock", range: 90, dir: -1, axis: "x", speed: 50, sleepable: true, links: "c217" },
      { id: "clk3", x: 1840, y: 240, kind: "clock", range: 90, dir: 1, axis: "x", speed: 50, sleepable: true, links: "c000" },
    ],
    pickups: [
      { id: "key24h", x: 1180, y: 540, flag: "key24h", require: "script:vault-ok" },
    ],
    memories: [{ i: 5, x: 1260, y: 540, require: "script:vault-ok" }],
    doors: [
      { id: "back", x: 80, y: 460, w: 48, h: 160, lockedBy: [], to: { room: "p2_spine", spawn: "after_gate" } },
    ],
    scripts: {
      vaultOk: "c217.time==='02:17' && c341.broken && c000.broken",
      onClockDroneOverlap: "clock.time += 1min",
      onDashIntoBreakableClock: "clock.broken = true",
    },
  },

  /* II son — vardiya değişimi, 2 drone + kepenk 2.5sn */
  p2_shift: {
    act: 2,
    worldWidth: 2000,
    rain: { on: true, volume: 0.7 },
    music: "street",
    spawn: { x: 80, y: 550 },
    solids: [{ x: 0, y: 620, w: 2000, h: 120 }, { x: 0, y: 0, w: 40, h: 720 }, { x: 1960, y: 0, w: 40, h: 720 }],
    shutters: [
      { id: "shift_gate", x: 1680, y: 460, w: 80, hClosed: 160, hOpen: 160, open: false, pulseOpen: 2.5 },
    ],
    drones: [
      { id: "s1", x: 600,  y: 500, kind: "shift", range: 220, dir: 1,  axis: "x", speed: 80, sleepable: true, beam: true },
      { id: "s2", x: 1200, y: 500, kind: "shift", range: 220, dir: -1, axis: "x", speed: 80, sleepable: true, beam: true },
    ],
    doors: [
      { id: "to_hub", x: 1800, y: 460, w: 56, h: 160, lockedBy: ["script:shutter-held"], to: { room: "hub_lobby", spawn: "from_street" } },
    ],
    triggers: [
      { x: 1600, y: 400, w: 80, h: 220, once: true, event: "say", data: { text: DIALOGUE.n4, sec: 2.4 } },
    ],
    scripts: {
      /* uyuyan drone yön değiştirir; iki drone AABB çarpışırsa shutter 2.5sn değil KALICI açık */
      onDroneCollision: { event: "shutter-open", data: { id: "shift_gate", permanent: true } },
    },
  },


  /* ═══════════════════════════════════════════
   * PERDE III — KULE 未来
   * 6 kat, her kat ayrı oda (dikey bağ)
   * ═══════════════════════════════════════════ */

  /* Kat 1 — sıra 1-4-2-3 */
  p3_seq: {
    act: 3,
    worldWidth: 2600,
    rain: { on: true, volume: 0.35 },
    music: "tower",
    spawn: { x: 80, y: 550 },
    checkpoint: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 2600, h: 120 },
      { x: 400,  y: 500, w: 120,  h: 24 },
      { x: 800,  y: 500, w: 120,  h: 24 },
      { x: 1200, y: 500, w: 120,  h: 24 },
      { x: 1600, y: 500, w: 120,  h: 24 },
    ],
    pads: [
      { id: "n1", x: 420,  y: 476, w: 80, h: 24, num: 1 },
      { id: "n2", x: 820,  y: 476, w: 80, h: 24, num: 4 },
      { id: "n3", x: 1220, y: 476, w: 80, h: 24, num: 2 },
      { id: "n4", x: 1620, y: 476, w: 80, h: 24, num: 3 },
    ],
    sequence: [1, 4, 2, 3],
    inputMode: "dash-on-pad",          // dash pad’in üstünde başlarsa sayılır
    doors: [
      { id: "up", x: 2200, y: 460, w: 56, h: 160, lockedBy: ["script:seq-ok"], to: { room: "p3_pulse", spawn: "default" } },
      { id: "hub", x: 40, y: 460, w: 48, h: 160, lockedBy: [], to: { room: "hub_lobby", spawn: "from_tower" } },
    ],
    scripts: {
      onWrong: "room-reset-keep-memories",
    },
  },

  /* Kat 2 — 3 nabız HUD açılır; otomat Anı SİLER */
  p3_pulse: {
    act: 3,
    worldWidth: 2200,
    rain: { on: true, volume: 0.3 },
    music: "tower",
    spawn: { x: 80, y: 550 },
    solids: [
      { x: 0, y: 620, w: 2200, h: 120 },
      { x: 700, y: 500, w: 160, h: 24 },
      { x: 1100, y: 420, w: 160, h: 24 },
      { x: 1500, y: 500, w: 160, h: 24 },
    ],
    spikes: [
      { x: 400, y: 600, w: 180, h: 20 },
      { x: 900, y: 600, w: 160, h: 20 },
    ],
    vendings: [
      {
        id: "heal", x: 1120, y: 300, w: 70, h: 120,
        gives: "hp+1",
        cost: "last-memory-lost",
        flagOnUse: "usedPulseVending",
      },
    ],
    doors: [
      { id: "up", x: 1900, y: 460, w: 56, h: 160, lockedBy: [], to: { room: "p3_room17", spawn: "default" } },
    ],
    scripts: {
      onEnter: { event: "hud-hearts-on", data: { hp: 3 } },
    },
    note: "Otomat atlanabilir. Spike’lar 1 nabız yer. Zorunlu heal yok.",
  },

  /* Kat 3 — Oda 17 koridoru, ıslak iz yalnızca crouch’ta */
  p3_room17: {
    act: 3,
    worldWidth: 2800,
    rain: { on: true, volume: 0.25 },
    music: "tower",
    spawn: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 2800, h: 120 },
      { x: 2200, y: 460, w: 24,   h: 160 },   // oda kapısı çerçevesi
    ],
    prints: [
      /* dışarıdan İÇERİ — x azalan yönde bakılırsa yanlış */
      { x: 600,  y: 612, w: 36, h: 8, dir: 1, visible: "crouch" },
      { x: 880,  y: 612, w: 36, h: 8, dir: 1, visible: "crouch" },
      { x: 1160, y: 612, w: 36, h: 8, dir: 1, visible: "crouch" },
      { x: 1480, y: 612, w: 36, h: 8, dir: 1, visible: "crouch" },
      { x: 1800, y: 612, w: 36, h: 8, dir: 1, visible: "crouch" },
      { x: 2100, y: 612, w: 36, h: 8, dir: 1, visible: "crouch" },
    ],
    mirrors: [
      { id: "card_neg", x: 2400, y: 480, w: 80, h: 50, visibleWhen: "crouch", gives: "cardNegative" },
    ],
    memories: [{ i: 6, x: 2480, y: 540, require: "script:followed-prints" }],
    doors: [
      { id: "up", x: 2600, y: 460, w: 56, h: 160, lockedBy: ["memories:6"], to: { room: "p3_mirror", spawn: "default" } },
    ],
    scripts: {
      followedPrints: "player crouched over prints 1..6 in ascending x",
    },
  },

  /* Kat 4 — Ayna asansör, sağ oda 0.4sn gecikmeli */
  p3_mirror: {
    act: 3,
    worldWidth: 2560,
    splitX: 1280,                 // sol = oyuncu, sağ = echo
    echoDelay: 0.4,
    rain: { on: false, volume: 0.1 },
    music: "tower",
    spawn: { x: 80, y: 550 },
    solids: [
      /* sol oda */
      { x: 0,    y: 620, w: 1280, h: 120 },
      { x: 200,  y: 480, w: 120,  h: 24 },
      { x: 520,  y: 380, w: 120,  h: 24 },
      { x: 900,  y: 480, w: 140,  h: 24 },
      /* sağ oda (x+1280) birebir */
      { x: 1280, y: 620, w: 1280, h: 120 },
      { x: 1480, y: 480, w: 120,  h: 24 },
      { x: 1800, y: 380, w: 120,  h: 24 },
      { x: 2180, y: 480, w: 140,  h: 24 },
    ],
    plates: [
      { id: "leftNeed",  x: 940,  y: 456, w: 60, h: 16, hold: true, ghostable: false },
      { id: "rightNeed", x: 2220, y: 456, w: 60, h: 16, hold: true, ghostable: false, pressedBy: "echo" },
    ],
    doors: [
      { id: "up", x: 1100, y: 300, w: 56, h: 160, lockedBy: ["plate:leftNeed", "plate:rightNeed"], to: { room: "p3_gallery", spawn: "default" } },
    ],
    memories: [{ i: 7, x: 1160, y: 260, require: "up.open" }],
    scripts: {
      echo: "replay player input with +0.4s in right room, same vy/vx scaled to x+1280",
      dashResetsEcho: true,          // 1 kez, dash gecikmeyi sıfırlar
    },
    triggers: [
      { x: 80, y: 400, w: 80, h: 220, once: true, event: "say", data: { text: DIALOGUE.n5, sec: 2.6 } },
    ],
  },

  /* Kat 5 — 4 EXIT, gerçeğin yağmur yansıması var */
  p3_gallery: {
    act: 3,
    worldWidth: 2400,
    rain: { on: true, volume: 0.55 },
    music: "tower",
    spawn: { x: 80, y: 550 },
    solids: [
      { x: 0,    y: 620, w: 2400, h: 120 },
      { x: 280,  y: 520, w: 160,  h: 24 },
      { x: 720,  y: 520, w: 160,  h: 24 },
      { x: 1160, y: 520, w: 160,  h: 24 },
      { x: 1600, y: 520, w: 160,  h: 24 },
    ],
    exits: [
      { id: "g1", x: 332,  y: 420, w: 56, h: 100, kind: "fake", reflect: false },
      { id: "g2", x: 772,  y: 420, w: 56, h: 100, kind: "fake", reflect: false },
      { id: "g3", x: 1212, y: 420, w: 56, h: 100, kind: "gallery-true", reflect: true,
        to: { room: "p3_ledger", spawn: "default" } },
      { id: "g4", x: 1652, y: 420, w: 56, h: 100, kind: "fake", reflect: false },
    ],
    note: "Sahte EXIT lobiye atar, fakeExitUsed = true. Gerçek EXIT zeminde yansıma çizer.",
  },

  /* Kat 6 — Defter / Anı 8 / Oda 17 kartı */
  p3_ledger: {
    act: 3,
    worldWidth: 2000,
    rain: { on: true, volume: 0.2 },
    music: "tower",
    spawn: { x: 80, y: 550 },
    solids: [{ x: 0, y: 620, w: 2000, h: 120 }],
    signs: [
      { x: 700, y: 240, text: "Kurye 0–184. Hepsi check-out istedi. Hepsi kabul edildi." },
      { x: 700, y: 280, text: "Kurye 185 (RİN) — bekliyor." },
    ],
    memories: [{ i: 8, x: 1000, y: 540 }],
    pickups: [
      { id: "keyRoom17", x: 1120, y: 540, flag: "keyRoom17", require: "memories:8" },
    ],
    doors: [
      { id: "down", x: 80, y: 460, w: 56, h: 160, lockedBy: [], to: { room: "hub_lobby", spawn: "from_tower" } },
    ],
    triggers: [
      { x: 1080, y: 400, w: 120, h: 220, once: true, event: "say", data: { text: DIALOGUE.n6, sec: 2.6 } },
    ],
  },


  /* ═══════════════════════════════════════════
   * PERDE IV — CHECK-OUT
   * 4 faz, 4 oda
   * ═══════════════════════════════════════════ */

  /* A — boş lobi, 10sn sonra ölüm platformları */
  p4_empty: {
    act: 4,
    worldWidth: 2000,
    rain: { on: false, volume: 0 },         // yağmur KESİLİR
    music: "silence",
    spawn: { x: 80, y: 550 },
    solids: [
      { x: 0, y: 620, w: 2000, h: 120 },    // ilk 10sn sadece bu
    ],
    delayedSolids: [
      /* t>10 sonra önceki ölümlerden 6 platform üretilir.
         yoksa varsayılan: */
      { after: 10, x: 360,  y: 520, w: 140, h: 24 },
      { after: 10, x: 620,  y: 440, w: 140, h: 24 },
      { after: 10, x: 900,  y: 360, w: 140, h: 24 },
      { after: 10, x: 1180, y: 440, w: 140, h: 24 },
      { after: 10, x: 1460, y: 520, w: 140, h: 24 },
    ],
    doors: [
      { id: "to_kaide", x: 1800, y: 460, w: 56, h: 160, lockedBy: ["script:t>10"], to: { room: "p4_kaide", spawn: "default" } },
    ],
  },

  /* B — 8 kaide, sıra = KAIDE_ORDER */
  p4_kaide: {
    act: 4,
    worldWidth: 2560,
    rain: { on: false, volume: 0 },
    music: "checkout",
    spawn: { x: 80, y: 550 },
    solids: [{ x: 0, y: 620, w: 2560, h: 120 }],
    kaides: KAIDE_ORDER.map((word, i) => ({
      i: i + 1,
      x: 200 + i * 270,
      y: 560,
      w: 70,
      h: 60,
      expect: word,
    })),
    doors: [
      { id: "to_nara", x: 2300, y: 460, w: 56, h: 160, lockedBy: ["script:kaide-ok"], to: { room: "p4_nara", spawn: "default" } },
    ],
    note: "Oyuncu kaideye dash ile ‘yerleştirir’. Yanlış sıra kaideleri söndürür, anılar silinmez.",
  },

  /* C — Nara protokolü */
  p4_nara: {
    act: 4,
    worldWidth: 1800,
    rain: { on: false, volume: 0 },
    music: "nara",
    spawn: { x: 80, y: 550 },
    solids: [{ x: 0, y: 620, w: 1800, h: 120 }],
    nara: { x: 900, y: 550, w: 42, h: 70, tint: "cyan" },
    protocolOfficial: ["crouch", "idle", "dash"],   // o zıplar→sen eğil; o dash→sen dur; o eğil→sen dash
    protocolSecret:   ["jump", "crouch", "dash"],   // Ending C
    doors: [
      { id: "to_three", x: 1600, y: 460, w: 56, h: 160, lockedBy: ["naraSolved"], to: { room: "p4_doors", spawn: "default" } },
    ],
    triggers: [
      { x: 200, y: 400, w: 80, h: 220, once: true, event: "say", data: { text: DIALOGUE.n7, sec: 2.6 } },
    ],
    scripts: {
      onPhaseCorrect: "advance",
      onPhaseWrong: "nara-reset",
      onOfficialDone: { event: "flag", data: { key: "naraSolved", value: true } },
      onSecretDone:   { event: "flag", data: { key: "naraOrder", value: ["jump", "crouch", "dash"] } },
    },
  },

  /* D — üç kapı */
  p4_doors: {
    act: 4,
    worldWidth: 2200,
    rain: { on: false, volume: 0 },
    music: "ending",
    spawn: { x: 200, y: 550 },
    solids: [{ x: 0, y: 620, w: 2200, h: 120 }],
    exits: [
      {
        id: "endA", x: 500, y: 460, w: 56, h: 160, kind: "endingA", label: "EXIT",
        onEnter: [{ event: "end", data: { which: "A", text: "Kurye 186 hazır.", clock: "02:17" } }],
      },
      {
        id: "endB", x: 1000, y: 460, w: 56, h: 160, kind: "endingB", label: "ODA 17",
        lockedBy: ["keyRoom17"],
        onEnter: [{ event: "end", data: { which: "B", text: "Bir dakika çaldık. Yeter.", clock: "02:18" } }],
      },
      {
        id: "endC", x: 1500, y: 572, w: 90, h: 48, kind: "endingC", label: "KEPEK",
        lockedBy: ["memories:8", "fakeExitUsed===false", "naraOrder===secret"],
        requiresCrouch: true,
        onEnter: [
          { event: "rain", data: { on: false } },
          { event: "end", data: { which: "C", text: "CHECK-OUT: 06:03", clock: "06:03", palette: "amber" } },
        ],
      },
    ],
  },
};


/* ─────────────────────────────────────────────
 * GEÇİŞ / SPAWN ALIAS (hub kapı dönüş noktaları)
 * ───────────────────────────────────────────── */
const HUB_SPAWNS = {
  default:      { x: 90,   y: 550 },
  from_service: { x: 760,  y: 550 },
  from_street:  { x: 1160, y: 550 },
  from_tower:   { x: 1560, y: 550 },
  from_checkout:{ x: 2060, y: 550 },
};


/* ─────────────────────────────────────────────
 * MOTORUN ŞEMADAN OKUYACAĞI TEK DÖNGÜ
 * ─────────────────────────────────────────────
 *
 * state = {
 *   room: 'hub_lobby',
 *   flags: structuredClone(FLAGS),
 *   hp: 3,
 *   heartsVisible: false,
 *   ghost: null | { frames: InputFrame[], t: 0 },
 *   lastDeathInput: InputFrame[],   // 6sn ring buffer
 *   tileStep: 0,
 *   seqStep: 0,
 *   naraStep: 0,
 * }
 *
 * loadRoom(id, spawnKey):
 *   solids = room.solids
 *            + open shutters skipped
 *            + mirrors.ghostPlatforms if crouching
 *            + delayedSolids if t > after
 *   hazards = spikes + lasers (if active & not bypassed)
 *   interact = doors + plates + exits + vendings + ledger + clocks + kaides
 *
 * door.open if every lockedBy token true:
 *   'stampService'            → flags.stampService
 *   'memories:N'              → flags.memories.filter(Boolean).length >= N
 *                              veya memories[N-1] === true  (bağlama göre)
 *   'plate:X'                 → plate pressed | ghost standing
 *   'script:…'                → room.scripts predicate
 *
 * fake-clear:
 *   overlay 'SECTION CLEAR' 1.1s → loadRoom('hub_lobby')
 *
 * hurt:
 *   hp-- (if heartsVisible else instant room-respawn)
 *   push lastDeathInput into ghost (GHOST_SEC)
 *   if hp<=0: loadRoom(hub) keep flags
 */

const ROOM_ORDER = [
  "hub_lobby",
  "p1_wet", "p1_dish", "p1_lift", "p1_fake", "p1_press",
  "p2_spine", "p2_vending", "p2_vitrine", "p2_chute", "p2_vault", "p2_shift",
  "p3_seq", "p3_pulse", "p3_room17", "p3_mirror", "p3_gallery", "p3_ledger",
  "p4_empty", "p4_kaide", "p4_nara", "p4_doors",
];

const ACT_LOCKS = {
  1: [],
  2: ["stampService", "memories:1"],
  3: ["key24h"],
  4: ["memories:8", "keyRoom17"],
};

window.NeonSchema = {
  PHYS, FLAGS, SAVE_KEYS, EVENTS, DIALOGUE, MEMORIES, LEDGER_LINES,
  KAIDE_ORDER, ENDING_C_REQUIRES, ROOMS, HUB_SPAWNS, ROOM_ORDER, ACT_LOCKS
};
