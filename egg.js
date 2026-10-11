/* EGG — a 3-lane egg catcher.
   Everything (audio, sprites) is pulled from jsDelivr.
   Tweak the CFG block below to change how the game feels. */
(() => {
"use strict";

// ---------- where the files live ----------
// Tip: jsDelivr caches @main for a while. When you push updates, tag a release
// (e.g. @v1.0.1) or use a commit hash here so changes show up immediately.
const BASE = window.EGG_BASE || "https://cdn.jsdelivr.net/gh/gifaccountyeah/egg@main/";

// ---------- settings ----------
const CFG = {
  W: 160, H: 144,            // internal resolution (scaled up with crisp pixels)
  HUD_H: 12,                 // top bar height
  GROUND: 128,               // y of the floor (player's feet)
  EGG: 4,                    // egg is 4x4
  TICK: 0.07,                // seconds between egg "steps" (round 1)
  STEP: 8,                   // pixels an egg drops per step
  MIN_TICK: 0.04,            // fastest the steps ever get (must be below TICK or rounds would slow down!)
  SPEEDUP: 0.92,             // each round multiplies the tick time by this
  RUN_TIME: 0.4,             // seconds the run sprite shows after moving
  PLAYER_H: 36,              // sprite is scaled to this height only if the PNG is huge (>64px tall)
  MAX_HEARTS: 3,
  CATCH: 1000,
  PENALTY: 2000,
  EARLY_ROUNDS: 3,           // rounds that use the short egg count
  EARLY_EGGS: [5, 10],
  LATE_EGGS: [15, 30],
  ROTTEN_FROM_ROUND: 2,
  MAX_SCORE: 999999999,
  GLITCH_DELAY: 1.5          // seconds between the score glitch and the black screen
};

const VERSION = "1.1.0"; // bump this every release
const W = CFG.W, H = CFG.H, EGG = CFG.EGG;
const LANE_X = [W / 6, W / 2, (W * 5) / 6]; // centre x of left / middle / right

// ---------- canvas ----------
const cv = document.getElementById("egg");
const ctx = cv.getContext("2d");
cv.width = W; cv.height = H;
ctx.imageSmoothingEnabled = false;

function fit() {
  let s = Math.min(innerWidth / W, innerHeight / H);
  s = s >= 1 ? Math.floor(s) : s;
  cv.style.width = W * s + "px";
  cv.style.height = H * s + "px";
}
addEventListener("resize", fit);
fit();

// ---------- saved stuff (stays in this browser) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let muted = store.get("egg_muted", false);
let best = store.get("egg_best", { score: 0, round: 0 });
let owned = store.get("egg_badges", {});

// ---------- achievements ----------
const BADGES = [
  { id: "winner", file: "Winner_Badge.png", name: "Winner",
    bio: "Winner Chicken Dinner!!", sub: "Win 3 Rounds of EGG For the first time." },
  { id: "winnerwinner", file: "Winner_Winner_Badge.png", name: "Winner Winner",
    bio: "You're a loser who sits and cry's!", sub: "Win 3 rounds of EGG Without losing a single heart." },
  { id: "battler", file: "Battler_Badge.png", name: "Actually CRACKED At the game?!",
    bio: "The board is Yours?", sub: "Make it to 20 rounds of EGG In one Match." }
];
const TOAST_TIME = 5; // seconds a badge popup stays on screen

// ---------- audio ----------
function mkAudio(file, loop) {
  const a = new Audio(BASE + file);
  a.muted = muted;
  a.loop = loop;
  a.preload = "auto";
  return a;
}
const audio = {
  menu: mkAudio("Incubating.mp3", true),
  play: mkAudio("Cracked-AllInstruments.mp3", true),
  lose: mkAudio("Scrambled.mp3", false)
};
function stopAll() {
  for (const a of Object.values(audio)) {
    a.onended = null;
    a.pause();
    try { a.currentTime = 0; } catch (e) {}
  }
}
function playAudio0(a) { // resume from where it was
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
}

function playAudio(a) {
  try { a.currentTime = 0; } catch (e) {}
  const p = a.play();
  return p && p.then ? p : Promise.resolve();
}

// ---------- jumpscares / punishment ----------
const sfx = {
  hurt: mkAudio("Charles_hurt.mp3", false),
  kill: mkAudio("Charles_kill.mp3", false)
};

function setMuted(v) {
  muted = v;
  store.set("egg_muted", v);
  for (const a of [...Object.values(audio), ...Object.values(sfx)]) a.muted = v;
}

// remembers (across reloads) that the player must sit in the corner
const CHEATER_KEY = "egg_cheater";
function flagCheater() { try { localStorage.setItem(CHEATER_KEY, "1"); } catch (e) {} }
function hasFlag() { try { return localStorage.getItem(CHEATER_KEY) === "1"; } catch (e) { return false; } }
function clearFlag() { try { localStorage.removeItem(CHEATER_KEY); } catch (e) {} }

// once the full 20s CHEATER screen has been sat through, it never shows again
const SEEN_KEY = "egg_seen_cheater";
function hasSeen() { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch (e) { return false; } }
function markSeen() { try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) {} }

// Reads how long one loop of a GIF lasts by summing its frame delays
function gifDuration(b) {
  let cs = 0;
  for (let i = 0; i < b.length - 8; i++) {
    if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 4 && b[i + 7] === 0) {
      const d = b[i + 4] | (b[i + 5] << 8);
      cs += d <= 1 ? 10 : d;
    }
  }
  return cs / 100;
}

// Real format by looking at the bytes (the file extension can lie, e.g. a .gif that is really WebP)
function sniffType(b) {
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "image/gif";
}

// Total length (seconds) of one loop of an animated WebP
function webpDuration(b) {
  let i = 12, ms = 0;
  while (i < b.length - 8) {
    const tag = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const sz = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
    if (tag === "ANMF") ms += b[i + 20] | (b[i + 21] << 8) | (b[i + 22] << 16);
    i += 8 + sz + (sz & 1);
  }
  return ms / 1000;
}

// Makes an animation play only once (so the last frame stays put instead of looping)
function playOnce(buf, type) {
  const b = new Uint8Array(buf.slice(0));
  if (type === "image/webp") {
    for (let i = 12; i < b.length - 14; i++) {
      if (b[i] === 0x41 && b[i + 1] === 0x4E && b[i + 2] === 0x49 && b[i + 3] === 0x4D && b[i + 4] === 6) { // "ANIM"
        b[i + 12] = 1; b[i + 13] = 0; // loop count = 1
        break;
      }
    }
  } else {
    const tag = "NETSCAPE2.0";
    for (let i = 0; i < b.length - 11; i++) {
      let m = true;
      for (let k = 0; k < 11; k++) if (b[i + k] !== tag.charCodeAt(k)) { m = false; break; }
      if (m) { b[i] = 0x58; break; }
    }
  }
  return b;
}

const gifCache = {};
function loadGif(file) {
  if (!gifCache[file]) {
    gifCache[file] = fetch(BASE + file)
      .then(r => r.arrayBuffer())
      .then(buf => {
        const b = new Uint8Array(buf), type = sniffType(b);
        return { buf, type, dur: type === "image/webp" ? webpDuration(b) : gifDuration(b), src: BASE + file };
      })
      .catch(() => ({ buf: null, type: "image/gif", dur: 0, src: BASE + file }));
  }
  return gifCache[file];
}

// GIF fills exactly the game screen (same box as the canvas), smooth, with a sound playing.
// done() fires when the GIF has REALLY finished its last frame; it's cut away instantly (no fade).
// The sound keeps playing until it finishes.
// hold = seconds to sit on frame 1 before the GIF starts animating (sound starts right away).
//
// Playback is driven frame by frame (ImageDecoder) so a heavy GIF that decodes slowly can't be
// cut off early by a timer. Browsers without ImageDecoder use a timer with extra slack instead.
function scare(gifFile, snd, done, hold) {
  const urls = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (hold > 0) playAudio(snd).catch(() => {});

  loadGif(gifFile).then(async g => {
    const fit = el => Object.assign(el.style, {
      width: "100%", height: "100%", objectFit: "cover", display: "block", imageRendering: "auto"
    });
    const r = cv.getBoundingClientRect();
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
      background: "#000", zIndex: "10"
    });
    document.body.appendChild(overlay);

    let dec = null, frames = 0;
    if (g.buf && typeof ImageDecoder !== "undefined") {
      try {
        dec = new ImageDecoder({ data: g.buf.slice(0), type: g.type });
        await dec.tracks.ready;
        frames = dec.tracks.selectedTrack.frameCount;
        if (!(frames > 0)) dec = null;
      } catch (e) { dec = null; }
    }

    if (dec) {
      const c = document.createElement("canvas");
      const cx = c.getContext("2d");
      fit(c);
      overlay.appendChild(c);
      let next = dec.decode({ frameIndex: 0 });
      for (let i = 0; i < frames; i++) {
        const { image } = await next;
        if (i + 1 < frames) next = dec.decode({ frameIndex: i + 1 }); // decode ahead while this one shows
        if (c.width !== image.displayWidth) { c.width = image.displayWidth; c.height = image.displayHeight; }
        cx.drawImage(image, 0, 0);
        let ms = (image.duration || 100000) / 1000;
        if (ms <= 10) ms = 100; // same as browsers do for 0/1cs frames
        image.close();
        if (i === 0) {
          if (hold > 0) await wait(hold * 1000);
          else playAudio(snd).catch(() => {});
        }
        await wait(ms);
      }
      try { dec.close(); } catch (e) {}
    } else {
      // fallback: plain <img>, played once, timer with slack
      const mkUrl = () => {
        if (!g.buf) return g.src;
        const u = URL.createObjectURL(new Blob([playOnce(g.buf, g.type)], { type: g.type }));
        urls.push(u);
        return u;
      };
      if (hold > 0) {
        const im0 = new Image();
        im0.src = mkUrl();
        try { await im0.decode(); } catch (e) {}
        const c = document.createElement("canvas");
        c.width = im0.naturalWidth || 1; c.height = im0.naturalHeight || 1;
        c.getContext("2d").drawImage(im0, 0, 0);
        fit(c);
        overlay.appendChild(c);
        await wait(hold * 1000);
      }
      const im = new Image();
      im.src = mkUrl();
      fit(im);
      try { await im.decode(); } catch (e) {}
      overlay.replaceChildren(im);
      if (!(hold > 0)) playAudio(snd).catch(() => {});
      await wait(((g.dur > 0 ? g.dur : 0.5) * 1.25 + 0.3) * 1000);
    }

    overlay.remove(); // instant cut, no fade
    urls.forEach(u => URL.revokeObjectURL(u));
    done();
  }).catch(() => done());
}

// EGG_CHEATER.png for 20 seconds, no timer. Dark "CHEATER" text lines sit behind it.
function cheaterWait() {
  return new Promise(res => {
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", background: "#000",
      overflow: "hidden", zIndex: "10", color: "#2b2b2b", font: "bold 26px/30px monospace",
      whiteSpace: "pre", userSelect: "none"
    });
    const line = "CHEATER ".repeat(Math.ceil(innerWidth / 120) + 2);
    box.textContent = Array(Math.ceil(innerHeight / 30) + 1).fill(line).join("\n");
    const im = new Image();
    im.src = BASE + "EGG_CHEATER.png";
    Object.assign(im.style, {
      position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
      objectFit: "contain", imageRendering: "auto"
    });
    box.appendChild(im);
    document.body.appendChild(box);
    setTimeout(() => { box.remove(); clearFlag(); markSeen(); res(); }, 20000);
  });
}

// ---------- sprites ----------
function loadImg(file) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous"; // jsDelivr sends CORS headers, needed to read pixels for the hitbox
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = BASE + file;
  });
}

// Turns a PNG into a drawable canvas + a per-pixel hitbox mask
function buildSprite(img) {
  const s = img.naturalHeight > 64 ? CFG.PLAYER_H / img.naturalHeight : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, w, h);
  const mask = new Uint8Array(w * h);
  try {
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
      // solid = visible and not a plain white background
      mask[i] = a > 40 && !(r > 245 && g > 245 && b > 245) ? 1 : 0;
    }
  } catch (e) {
    mask.fill(1); // couldn't read pixels, fall back to a full box
  }
  return { c, w, h, mask };
}

let spriteIdle = null, spriteRun = null;

// ---------- state ----------
let state = "loading"; // loading | menu | play | glitch | dying | over | black
let menuReady = false; // has menu music started (browsers need a click first)

let lane = 1, runTimer = 0;
let eggs = [], fx = [];
let score = 0, hearts = CFG.MAX_HEARTS, round = 0;
let heartsMax = CFG.MAX_HEARTS; // drops by 1 after every jumpscare, until reload
let lossCount = 0;
let scareCount = 0;           // 1st and 2nd are 'hurt'; the 3rd is the kill
let scareBg = "black";        // what's under the scare overlay
let target = 0, spawned = 0, spawnGap = 5, sinceSpawn = 0;
let tickTime = CFG.TICK, tickAcc = 0;
let banner = 0, bannerText = "", bannerSub = "";
let menuSel = 0, lostThisMatch = 0, newBest = false;
let toast = null, toastQueue = [];
let countdown = 0;            // head-start seconds left after un-pausing
let logoImg = null;
const MENU_ITEMS = 3, MENU_Y = 58, MENU_GAP = 13;

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function curSprite() { return runTimer > 0 && spriteRun ? spriteRun : spriteIdle; }

// ---------- flow ----------
function toMenu() {
  stopAll();
  state = "menu";
  playAudio(audio.menu).then(() => { menuReady = true; }).catch(() => { menuReady = false; });
}

function startGame() {
  stopAll();
  if (heartsMax <= 0) { // no hearts to start with...
    killScare();
    return;
  }
  playAudio(audio.play).catch(() => {});
  score = 0; hearts = heartsMax; round = 0; lostThisMatch = 0;
  lane = 1; runTimer = 0; eggs = []; fx = [];
  nextRound();
  state = "play";
}

function award(id) {
  if (owned[id]) return;
  owned[id] = true;
  store.set("egg_badges", owned);
  toastQueue.push(BADGES.find(b => b.id === id));
}

function nextRound() {
  if (round === 3) { // just finished round 3 = "won"
    award("winner");
    if (lostThisMatch === 0) award("winnerwinner");
  }
  round++;
  if (round === 20) award("battler");
  if (round > 1 && hearts < heartsMax) hearts++;
  const r = round <= CFG.EARLY_ROUNDS ? CFG.EARLY_EGGS : CFG.LATE_EGGS;
  target = rand(r[0], r[1]);
  spawned = 0;
  tickTime = Math.max(CFG.MIN_TICK, CFG.TICK * Math.pow(CFG.SPEEDUP, round - 1));
  tickAcc = 0;
  spawnGap = Math.max(2, 6 - Math.floor(round / 2));
  sinceSpawn = spawnGap; // first egg drops right away
  banner = 1.6;
  bannerText = "ROUND " + round;
  bannerSub = round === CFG.ROTTEN_FROM_ROUND ? "ROTTEN EGGS! LET THEM FALL" : "";
}

function saveBest() {
  newBest = score > best.score;
  if (newBest) best.score = score;
  if (round > best.round) best.round = round;
  store.set("egg_best", best);
}

function lose() {
  state = "dying";
  stopAll();
  lossCount++;
  saveBest(); // (the cheat glitch never saves, so no fake 999999999 best)
  let fired = false;
  const after = () => { if (!fired) { fired = true; afterScrambled(); } };
  audio.lose.onended = after;
  playAudio(audio.lose).catch(after);
}

function killScare() {
  state = "scare";
  scareBg = "black";
  flagCheater();
  scare("Charles_jumoscare2.gif", sfx.kill, () => { state = "black"; }, 0.8); // hold 0.8s on frame 1
}

// Scrambled finished. From the 2nd loss onward: jumpscare + one less heart for good.
function afterScrambled() {
  if (lossCount < 2) { state = "over"; return; }
  scareCount++;
  if (scareCount >= 3) { killScare(); return; } // third jumpscare = the kill one
  heartsMax = Math.max(0, heartsMax - 1);
  state = "scare";
  scareBg = "over";
  scare("Charles_jumoscare1.gif", sfx.hurt, () => { state = "over"; });
}

function cheatGlitch() {
  state = "glitch";
  flagCheater();
  score = CFG.MAX_SCORE;
  stopAll();
  setTimeout(() => {
    state = "black";
    playAudio(audio.lose).catch(() => {});
  }, CFG.GLITCH_DELAY * 1000);
}

// ---------- gameplay ----------
function loseHeart() {
  lostThisMatch++;
  hearts--;
  if (hearts <= 0) { hearts = 0; lose(); }
}

function resolve(e, caught) {
  e.dead = true;
  if (!e.rotten) {
    if (caught) {
      score = Math.min(CFG.MAX_SCORE, score + CFG.CATCH);
    } else {
      score = Math.max(0, score - CFG.PENALTY);
      loseHeart();
    }
  } else {
    if (caught) {
      if (score < CFG.PENALTY) { cheatGlitch(); return; } // not enough points to lose -> underflow!
      score -= CFG.PENALTY;
      loseHeart();
    } else {
      score = Math.min(CFG.MAX_SCORE, score + CFG.CATCH);
    }
  }
}

function overlapsPlayer(e) {
  const sp = curSprite();
  if (!sp) return false;
  const px = Math.round(LANE_X[lane] - sp.w / 2);
  const py = CFG.GROUND - sp.h;
  const ex = Math.round(LANE_X[e.lane] - EGG / 2);
  const y0 = Math.max(Math.floor(e.prevY), py);
  const y1 = Math.min(Math.floor(e.y) + EGG, py + sp.h);
  const x0 = Math.max(ex, px);
  const x1 = Math.min(ex + EGG, px + sp.w);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (sp.mask[(y - py) * sp.w + (x - px)]) return true;
  return false;
}

function checkEggs() {
  for (const e of eggs) {
    if (e.dead) continue;
    if (overlapsPlayer(e)) {
      resolve(e, true);
    } else if (e.y + EGG >= CFG.GROUND) {
      e.y = CFG.GROUND - EGG;
      fx.push({ x: LANE_X[e.lane], t: 0.3, rotten: e.rotten });
      resolve(e, false);
    }
    if (state !== "play") return;
  }
  eggs = eggs.filter(e => !e.dead);
  if (spawned >= target && eggs.length === 0) nextRound();
}

function trySpawn() {
  const free = [0, 1, 2].filter(l => !eggs.some(e => e.lane === l && e.y < CFG.HUD_H + 14));
  if (!free.length) return;
  const chance = round === 2 ? 0.25 : round === 3 ? 0.3 : 0.35;
  const rotten = round >= CFG.ROTTEN_FROM_ROUND && Math.random() < chance;
  const y = CFG.HUD_H;
  eggs.push({ lane: free[rand(0, free.length - 1)], y, prevY: y, rotten, dead: false });
  spawned++;
  sinceSpawn = 0;
  spawnGap = Math.max(2, 6 - Math.floor(round / 2)) + rand(0, 2);
}

function doTick() {
  sinceSpawn++;
  if (spawned < target && sinceSpawn >= spawnGap) trySpawn();
  for (const e of eggs) { e.prevY = e.y; e.y += CFG.STEP; }
  checkEggs();
}

function move(dir) {
  if (state !== "play") return;
  const nl = Math.max(0, Math.min(2, lane + dir));
  if (nl === lane) return;
  lane = nl;
  runTimer = CFG.RUN_TIME;
  checkEggs();
}

function pauseGame() {
  if (state !== "play" && state !== "countdown") return;
  state = "paused";
  audio.play.pause();
}

function resumeGame() {
  if (state !== "paused") return;
  state = "countdown"; // 3s head start: eggs AND player frozen
  countdown = 3;
}

function update(dt) {
  if (state === "countdown") {
    countdown -= dt;
    if (countdown <= 0) {
      state = "play";
      playAudio0(audio.play);
    }
  }
  if (!toast && toastQueue.length) toast = { b: toastQueue.shift(), t: 0 };
  if (toast && (state === "play" || state === "dying" || state === "over")) {
    toast.t += dt;
    if (toast.t >= TOAST_TIME) toast = null;
  }
  if (state === "play") {
    if (runTimer > 0) runTimer = Math.max(0, runTimer - dt);
    if (banner > 0) banner -= dt;
    tickAcc += dt;
    while (tickAcc >= tickTime && state === "play") {
      tickAcc -= tickTime;
      doTick();
    }
    if (state === "play") checkEggs();
  }
  for (const f of fx) f.t -= dt;
  fx = fx.filter(f => f.t > 0);
}

// ---------- drawing ----------
const HEART = ["01010", "11111", "11111", "01110", "00100"];
function drawHeart(x, y, full) {
  ctx.fillStyle = full ? "#e03030" : "#2a3a2a";
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++)
      if (HEART[r][c] === "1") ctx.fillRect(x + c, y + r, 1, 1);
}

function text(str, x, y, size, color, align) {
  ctx.font = "bold " + size + "px monospace";
  ctx.textAlign = align || "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = color || "#fff";
  ctx.fillText(str, x, y);
}

const pad9 = n => String(n).padStart(9, "0");

function drawPlayer() {
  const sp = curSprite();
  if (!sp) return;
  ctx.drawImage(sp.c, Math.round(LANE_X[lane] - sp.w / 2), CFG.GROUND - sp.h);
}

function drawField() {
  ctx.fillStyle = "#7a8f7a"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#3b4a3b"; ctx.fillRect(0, CFG.GROUND, W, H - CFG.GROUND);
  ctx.fillStyle = "#2a362a"; ctx.fillRect(0, CFG.GROUND, W, 1);
  // faint lane dividers
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(Math.round(W / 3), CFG.HUD_H, 1, CFG.GROUND - CFG.HUD_H);
  ctx.fillRect(Math.round((W * 2) / 3), CFG.HUD_H, 1, CFG.GROUND - CFG.HUD_H);

  for (const f of fx) {
    ctx.fillStyle = f.rotten ? "#111" : "#fff";
    ctx.fillRect(Math.round(f.x - 4), CFG.GROUND - 2, 8, 2);
  }
  for (const e of eggs) {
    const x = Math.round(LANE_X[e.lane] - EGG / 2);
    ctx.fillStyle = e.rotten ? "#111" : "#fff";
    ctx.fillRect(x, Math.round(e.y), EGG, EGG);
  }
  drawPlayer();

  // HUD
  ctx.fillStyle = "#1c261c"; ctx.fillRect(0, 0, W, CFG.HUD_H);
  text(pad9(score), 3, 2, 8, "#fff");
  for (let i = 0; i < heartsMax; i++) drawHeart(W - 3 - (heartsMax - i) * 7, 3, i < hearts);
  text("R" + round, W / 2 + 10, 2, 8, "#9fc79f", "center");

  if (state === "play" && banner > 0) {
    text(bannerText, W / 2, 50, 12, "#fff", "center");
    if (bannerSub) text(bannerSub, W / 2, 64, 6, "#ffe9a0", "center");
  }
}

function wrapLines(str, maxW, size, bold) {
  ctx.font = (bold ? "bold " : "") + size + "px monospace";
  const lines = [];
  let cur = "";
  for (const w of str.split(" ")) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// draws an image scaled to fit a box (smooth only when shrinking a lot, crisp otherwise)
function drawFit(img, x, y, w, h) {
  if (!img) return;
  const sc = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = Math.max(1, Math.round(img.naturalWidth * sc)), dh = Math.max(1, Math.round(img.naturalHeight * sc));
  ctx.imageSmoothingEnabled = sc < 0.5;
  ctx.drawImage(img, x + Math.round((w - dw) / 2), y + Math.round((h - dh) / 2), dw, dh);
  ctx.imageSmoothingEnabled = false;
}

function drawMenu() {
  ctx.fillStyle = "#1c261c"; ctx.fillRect(0, 0, W, H);
  if (logoImg) drawFit(logoImg, 16, 4, 128, 46);
  else text("EGG", W / 2, 14, 34, "#fff", "center");

  const labels = ["PLAY", "ACHIEVEMENTS", "SOUND: " + (muted ? "OFF" : "ON")];
  for (let i = 0; i < MENU_ITEMS; i++) {
    const y = MENU_Y + i * MENU_GAP, on = i === menuSel;
    if (on) text(">", 34, y, 8, "#ffe9a0");
    text(labels[i], 44, y, 8, on ? "#fff" : "#7a8f7a");
  }
  if (!menuReady && Math.floor(performance.now() / 500) % 2 === 0) text("PRESS ANY KEY", W / 2, 98, 7, "#ffe9a0", "center");

  const got = BADGES.filter(b => owned[b.id]).length;
  text(best.score > 0 ? "BEST " + pad9(best.score) + "  R" + best.round : "NO SCORE YET", W / 2, 110, 6, "#9fc79f", "center");
  text("BADGES " + got + "/" + BADGES.length, W / 2, 119, 6, "#9fc79f", "center");
  text("ARROWS+ENTER  M MUTE  P PAUSE", W / 2, 135, 6, "#7a8f7a", "center");
  text("v" + VERSION, W - 3, 135, 6, "#7a8f7a", "right");
}

function drawAchievements() {
  ctx.fillStyle = "#1c261c"; ctx.fillRect(0, 0, W, H);
  text("ACHIEVEMENTS", W / 2, 3, 8, "#ffe9a0", "center");
  BADGES.forEach((b, i) => {
    const y = 14 + i * 38, has = !!owned[b.id];
    ctx.fillStyle = has ? "#2e4a2e" : "#263226"; ctx.fillRect(4, y, 152, 36);
    ctx.globalAlpha = has ? 1 : 0.28;
    drawFit(b.img, 8, y + 3, 24, 24);
    ctx.globalAlpha = 1;
    text(has ? "OWNED" : "LOCKED", 20, y + 29, 5, has ? "#ffe9a0" : "#7a8f7a", "center");
    const name = wrapLines(b.name, 112, 7, true), sub = wrapLines(b.sub, 112, 6, false);
    let ty = y + 2;
    name.forEach(l => { text(l, 38, ty, 7, has ? "#ffe9a0" : "#bcd0bc"); ty += 8; });
    sub.forEach(l => { text(l, 38, ty, 6, "#9fb59f"); ty += 7; });
  });
  text("ENTER / ESC / TAP: BACK", W / 2, 130, 6, "#7a8f7a", "center");
}

// badge popup: icon, name, bio, sub-bio
function drawToast() {
  if (!toast) return;
  const b = toast.b, mw = 112;
  const l1 = wrapLines(b.name, mw, 7, true), l2 = wrapLines(b.bio, mw, 6, false), l3 = wrapLines(b.sub, mw, 6, false);
  const ph = 5 + 7 + l1.length * 8 + l2.length * 7 + l3.length * 7 + 3;
  const IN = 0.25, OUT = 0.25;
  let k = 1;
  if (toast.t < IN) k = toast.t / IN;
  else if (toast.t > TOAST_TIME - OUT) k = (TOAST_TIME - toast.t) / OUT;
  const py = Math.round(CFG.HUD_H + 2 - (1 - k) * (ph + CFG.HUD_H + 4));
  ctx.fillStyle = "rgba(20,30,20,0.96)"; ctx.fillRect(4, py, 152, ph);
  ctx.strokeStyle = "#ffe9a0"; ctx.lineWidth = 1; ctx.strokeRect(4.5, py + 0.5, 151, ph - 1);
  drawFit(b.img, 8, py + Math.round((ph - 28) / 2), 28, 28);
  let ty = py + 4;
  text("BADGE UNLOCKED", 40, ty, 5, "#ffe9a0"); ty += 7;
  l1.forEach(l => { text(l, 40, ty, 7, "#fff"); ty += 8; });
  l2.forEach(l => { text(l, 40, ty, 6, "#d8e8d8"); ty += 7; });
  l3.forEach(l => { text(l, 40, ty, 6, "#9fb59f"); ty += 7; });
}

function drawOver() {
  ctx.fillStyle = "#1c261c"; ctx.fillRect(0, 0, W, H);
  text("SCRAMBLED", W / 2, 12, 18, "#ffe9a0", "center");
  text("SCORE", W / 2, 38, 8, "#7a8f7a", "center");
  text(pad9(score), W / 2, 49, 14, "#fff", "center");
  text("ROUNDS", W / 2, 70, 8, "#7a8f7a", "center");
  text(String(round), W / 2, 81, 14, "#fff", "center");
  if (newBest) {
    if (Math.floor(performance.now() / 300) % 2 === 0) text("NEW BEST!", W / 2, 100, 8, "#ffe9a0", "center");
  } else {
    text("BEST " + pad9(best.score), W / 2, 101, 6, "#7a8f7a", "center");
  }
  text("ENTER / TAP: PLAY AGAIN", W / 2, 113, 7, "#fff", "center");
  text("ESC / TAP HERE: MENU", W / 2, 128, 6, "#7a8f7a", "center");
}

function dim() { ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, W, H); }

function draw() {
  switch (state) {
    case "loading": ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); text("LOADING...", W / 2, 66, 8, "#fff", "center"); break;
    case "menu": drawMenu(); break;
    case "achievements": drawAchievements(); break;
    case "play": case "dying": case "glitch": drawField(); break;
    case "paused":
      drawField(); dim();
      text("PAUSED", W / 2, 52, 14, "#fff", "center");
      text("CLICK TO RESUME", W / 2, 74, 7, "#ffe9a0", "center");
      break;
    case "countdown":
      drawField(); dim();
      text(String(Math.max(1, Math.ceil(countdown))), W / 2, 48, 30, "#fff", "center");
      text("GET READY", W / 2, 84, 7, "#ffe9a0", "center");
      break;
    case "over": drawOver(); break;
    case "scare": if (scareBg === "over") { drawOver(); break; } // fall through to black
    case "black": ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); break;
  }
  if (state === "play" || state === "paused" || state === "countdown" || state === "dying" || state === "over") drawToast();
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- input ----------
function unlockMenuMusic() {
  if (state === "menu" && !menuReady) {
    playAudio(audio.menu).then(() => { menuReady = true; }).catch(() => {});
    return true;
  }
  return false;
}

function menuActivate(i) {
  if (i === 0) startGame();
  else if (i === 1) state = "achievements";
  else setMuted(!muted);
}

function confirm() { // Enter / Space / tap
  if (state === "menu") { if (!unlockMenuMusic()) menuActivate(menuSel); }
  else if (state === "over") startGame();
  else if (state === "achievements") state = "menu";
  else if (state === "paused") resumeGame();
}

function togglePause() {
  if (state === "play" || state === "countdown") pauseGame();
  else if (state === "paused") resumeGame();
}

addEventListener("keydown", e => {
  if (e.repeat) return;
  const k = e.code;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(k)) e.preventDefault();
  if (k === "KeyM") { setMuted(!muted); return; }
  if (state === "menu" && unlockMenuMusic()) return;
  if (k === "ArrowLeft" || k === "KeyA") move(-1);
  else if (k === "ArrowRight" || k === "KeyD") move(1);
  else if (k === "ArrowUp" || k === "KeyW") { if (state === "menu") menuSel = (menuSel + MENU_ITEMS - 1) % MENU_ITEMS; }
  else if (k === "ArrowDown" || k === "KeyS") { if (state === "menu") menuSel = (menuSel + 1) % MENU_ITEMS; }
  else if (k === "Enter" || k === "Space") confirm();
  else if (k === "KeyP") togglePause();
  else if (k === "Escape") {
    if (state === "over") toMenu();
    else if (state === "achievements") state = "menu";
    else togglePause();
  }
  else if (k === "Backspace" && state === "achievements") state = "menu";
});

cv.addEventListener("pointerdown", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const gx = ((e.clientX - r.left) / r.width) * W, gy = ((e.clientY - r.top) / r.height) * H;
  if (state === "play") move(gx < W / 2 ? -1 : 1);
  else if (state === "menu") {
    if (unlockMenuMusic()) return;
    for (let i = 0; i < MENU_ITEMS; i++) {
      const y = MENU_Y + i * MENU_GAP;
      if (gy >= y - 2 && gy < y + MENU_GAP - 2) { menuSel = i; menuActivate(i); break; }
    }
  } else if (state === "over") {
    if (gy > 122) toMenu(); else startGame();
  } else confirm();
});

// Tabbing out / switching windows pauses; click the screen to resume (then a 3s head start)
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });
addEventListener("blur", pauseGame);

// ---------- boot ----------
(async () => {
  console.log("EGG v" + VERSION);
  requestAnimationFrame(frame);
  loadGif("Charles_jumoscare1.gif"); loadGif("Charles_jumoscare2.gif"); // preload
  if (hasFlag()) { if (hasSeen()) clearFlag(); else await cheaterWait(); }
  const [idle, run, logo, ...badgeImgs] = await Promise.allSettled([
    loadImg("EGG_CharlesIdle.png"), loadImg("EGG_CharlesRun.png"), loadImg("JornalEGGDrive.png"),
    ...BADGES.map(b => loadImg(b.file))
  ]);
  if (idle.status === "fulfilled") spriteIdle = buildSprite(idle.value);
  if (run.status === "fulfilled") spriteRun = buildSprite(run.value);
  if (logo.status === "fulfilled") logoImg = logo.value;
  badgeImgs.forEach((r, i) => { if (r.status === "fulfilled") BADGES[i].img = r.value; });
  if (!spriteIdle) spriteIdle = { c: document.createElement("canvas"), w: 16, h: 24, mask: new Uint8Array(16 * 24).fill(1) };
  toMenu(); // tries autoplay; if the browser blocks it, the first key/tap starts the music
})();
})();
