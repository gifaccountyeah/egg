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
  TICK: 0.07,                 // seconds between egg "steps" (round 1)
  STEP: 6,                   // pixels an egg drops per step (was 4, +2 for speed). Raise for faster eggs.
  MIN_TICK: 0.12,            // fastest the steps ever get
  SPEEDUP: 0.92,             // each round multiplies the tick time by this
  RUN_TIME: 0.4,             // seconds the run sprite shows after moving
  PLAYER_H: 36,              // sprite is scaled to this height only if the PNG is huge (>64px tall)
  MAX_HEARTS: 3,
  CATCH: 100,
  PENALTY: 200,
  EARLY_ROUNDS: 3,           // rounds that use the short egg count
  EARLY_EGGS: [5, 10],
  LATE_EGGS: [15, 30],
  ROTTEN_FROM_ROUND: 2,
  MAX_SCORE: 999999999,
  GLITCH_DELAY: 1.5          // seconds between the score glitch and the black screen
};

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

// ---------- audio ----------
function mkAudio(file, loop) {
  const a = new Audio(BASE + file);
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
function playAudio(a) {
  try { a.currentTime = 0; } catch (e) {}
  const p = a.play();
  return p && p.then ? p : Promise.resolve();
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
let target = 0, spawned = 0, spawnGap = 5, sinceSpawn = 0;
let tickTime = CFG.TICK, tickAcc = 0;
let banner = 0, bannerText = "", bannerSub = "";

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
  playAudio(audio.play).catch(() => {});
  score = 0; hearts = CFG.MAX_HEARTS; round = 0;
  lane = 1; runTimer = 0; eggs = []; fx = [];
  nextRound();
  state = "play";
}

function nextRound() {
  round++;
  if (round > 1 && hearts < CFG.MAX_HEARTS) hearts++;
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

function lose() {
  state = "dying";
  stopAll();
  audio.lose.onended = () => { state = "over"; };
  playAudio(audio.lose).catch(() => { state = "over"; });
}

function cheatGlitch() {
  state = "glitch";
  score = CFG.MAX_SCORE;
  stopAll();
  setTimeout(() => {
    state = "black";
    playAudio(audio.lose).catch(() => {});
  }, CFG.GLITCH_DELAY * 1000);
}

// ---------- gameplay ----------
function loseHeart() {
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

function update(dt) {
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
  for (let i = 0; i < CFG.MAX_HEARTS; i++) drawHeart(W - 3 - (CFG.MAX_HEARTS - i) * 7, 3, i < hearts);
  text("R" + round, W / 2 + 10, 2, 8, "#9fc79f", "center");

  if (state === "play" && banner > 0) {
    text(bannerText, W / 2, 50, 12, "#fff", "center");
    if (bannerSub) text(bannerSub, W / 2, 64, 6, "#ffe9a0", "center");
  }
}

function drawMenu() {
  ctx.fillStyle = "#1c261c"; ctx.fillRect(0, 0, W, H);
  text("EGG", W / 2, 22, 34, "#fff", "center");
  text("- placeholder menu -", W / 2, 62, 7, "#7a8f7a", "center");
  if (spriteIdle) ctx.drawImage(spriteIdle.c, Math.round(W / 2 - spriteIdle.w / 2), 78);
  const msg = menuReady ? "PRESS ENTER / TAP" : "PRESS ANY KEY";
  if (Math.floor(performance.now() / 500) % 2 === 0) text(msg, W / 2, 124, 8, "#fff", "center");
  text("< > or A D to move", W / 2, 135, 6, "#7a8f7a", "center");
}

function drawOver() {
  ctx.fillStyle = "#1c261c"; ctx.fillRect(0, 0, W, H);
  text("SCRAMBLED", W / 2, 22, 18, "#ffe9a0", "center");
  text("SCORE", W / 2, 55, 8, "#7a8f7a", "center");
  text(pad9(score), W / 2, 66, 14, "#fff", "center");
  text("ROUNDS", W / 2, 90, 8, "#7a8f7a", "center");
  text(String(round), W / 2, 101, 14, "#fff", "center");
  if (Math.floor(performance.now() / 500) % 2 === 0) text("PRESS ENTER / TAP", W / 2, 128, 8, "#fff", "center");
}

function draw() {
  switch (state) {
    case "loading": ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); text("LOADING...", W / 2, 66, 8, "#fff", "center"); break;
    case "menu": drawMenu(); break;
    case "play": case "dying": case "glitch": drawField(); break;
    case "over": drawOver(); break;
    case "black": ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); break;
  }
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

function confirm() {
  if (unlockMenuMusic()) return;
  if (state === "menu") startGame();
  else if (state === "over") toMenu();
}

addEventListener("keydown", e => {
  if (e.repeat) return;
  const k = e.code;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(k)) e.preventDefault();
  if (k === "ArrowLeft" || k === "KeyA") move(-1);
  else if (k === "ArrowRight" || k === "KeyD") move(1);
  else if (k === "Enter" || k === "Space") confirm();
  else unlockMenuMusic();
});

cv.addEventListener("pointerdown", e => {
  e.preventDefault();
  if (state === "play") {
    const r = cv.getBoundingClientRect();
    move(e.clientX - r.left < r.width / 2 ? -1 : 1);
  } else {
    confirm();
  }
});

// ---------- boot ----------
(async () => {
  requestAnimationFrame(frame);
  const [idle, run] = await Promise.allSettled([loadImg("EGG_CharlesIdle.png"), loadImg("EGG_CharlesRun.png")]);
  if (idle.status === "fulfilled") spriteIdle = buildSprite(idle.value);
  if (run.status === "fulfilled") spriteRun = buildSprite(run.value);
  if (!spriteIdle) spriteIdle = { c: document.createElement("canvas"), w: 16, h: 24, mask: new Uint8Array(16 * 24).fill(1) };
  toMenu(); // tries autoplay; if the browser blocks it, the first key/tap starts the music
})();
})();
