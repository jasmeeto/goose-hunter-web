'use strict';

const GOOSE_WIDTH  = 90;
const GOOSE_HEIGHT = 90;
const WIGGLE_ROOM  = 20;
const LOCAL_WIDTH  = 800;
const LOCAL_HEIGHT = 480;
const MAX_LIVES    = 5;
const SPAWN_MS     = 1000;
const DEAD_MS      = 500;
const ANIM_MS      = 150;

// Speed-up milestones: at these counts, speedX *= 1.5, speedY *= 0.8
const TURNOVERS = { 20: true, 50: true, 100: true };

// Countdown sprite rects within rz-numbers.png  (order: 3, 2, 1)
const NUM_FRAMES = [
  { sx: 376, sy: 19, sw: 117, sh: 155 },
  { sx: 201, sy: 18, sw: 114, sh: 153 },
  { sx:  39, sy: 19, sw:  86, sh: 152 },
];

class Goose {
  constructor(x, y, fromLeft, speedX, speedY) {
    this.x = x; this.y = y;
    this.fromLeft = fromLeft;
    this.velocityX = speedX;
    this.velocityY = speedY;
  }
}

const canvas   = document.getElementById('game');
const ctx      = canvas.getContext('2d');
const wrap     = document.getElementById('canvas-wrap');
const overlay  = document.getElementById('overlay');
const oHead    = document.getElementById('overlay-heading');
const oCount   = document.getElementById('overlay-count');
const oHS      = document.getElementById('overlay-highscore');
const oBtn     = document.getElementById('overlay-btn');
const pauseBtn = document.getElementById('pause-btn');

// ── Responsive sizing ─────────────────────────────────────────────────────────
function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspect = LOCAL_WIDTH / LOCAL_HEIGHT;
  let w, h;
  if (vw / vh > aspect) { h = vh; w = h * aspect; }
  else                   { w = vw; h = w / aspect; }
  wrap.style.width  = w + 'px';
  wrap.style.height = h + 'px';
}
window.addEventListener('resize', resize);
// also fire on orientation change (iOS fires resize late)
window.addEventListener('orientationchange', () => setTimeout(resize, 100));

// ── Assets ────────────────────────────────────────────────────────────────────
const imgs = {};
const sounds = {};

function loadImg(key, src) {
  return new Promise(res => {
    const i = new Image();
    i.src = src;
    i.onload = () => { imgs[key] = i; res(); };
    i.onerror = res;
  });
}

function loadAudio(key, src) {
  return new Promise(res => {
    const a = new Audio(src);
    a.addEventListener('canplaythrough', () => { sounds[key] = a; res(); }, { once: true });
    a.onerror = res;
    a.load();
  });
}

// ── Game state ────────────────────────────────────────────────────────────────
let state = 'MENU';   // MENU | RUNNING | PAUSED | END
let count = 0;
let lives = MAX_LIVES;
let highScore = parseInt(localStorage.getItem('highScore') || '0', 10);

let speedX = 500;
let speedY = 320;
let turnovers = { ...TURNOVERS };

let liveGeese = [];
let deadGeese = [];

let lastSpawnTime  = 0;
let lastDeadTime   = 0;
let hasDeadGeese   = false;

let animFrame = 0;
let lastAnimTime  = 0;

// Red flash
let redAlpha   = 0;
let redFadeDir = 0;   // 1 = fade in, -1 = fade out, 0 = idle

// Pause countdown
let pauseDelayStart = -1;

let lastTimestamp = 0;

// Pending click in canvas coords
let pendingClick = null;

// ── Input ─────────────────────────────────────────────────────────────────────
function canvasCoords(point) {
  const r = canvas.getBoundingClientRect();
  const scaleX = LOCAL_WIDTH  / r.width;
  const scaleY = LOCAL_HEIGHT / r.height;
  return {
    x: (point.clientX - r.left) * scaleX,
    y: LOCAL_HEIGHT - (point.clientY - r.top) * scaleY,
  };
}

canvas.addEventListener('click', e => {
  if (state === 'RUNNING') pendingClick = canvasCoords(e);
});
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (state === 'RUNNING' && e.changedTouches.length > 0)
    pendingClick = canvasCoords(e.changedTouches[0]);
}, { passive: false });

oBtn.addEventListener('click',      () => { if (state === 'MENU') startGame(); if (state === 'PAUSED') resumeGame(); });
oBtn.addEventListener('touchstart', e  => { e.preventDefault(); if (state === 'MENU') startGame(); if (state === 'PAUSED') resumeGame(); }, { passive: false });

pauseBtn.addEventListener('click',      () => pauseGame());
pauseBtn.addEventListener('touchstart', e  => { e.preventDefault(); pauseGame(); }, { passive: false });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state === 'RUNNING') pauseGame();
});

// ── Screen management ─────────────────────────────────────────────────────────
function showOverlay(heading, btnText) {
  oHead.textContent  = heading;
  oCount.textContent = 'Count: ' + count;
  oHS.textContent    = 'High Score: ' + highScore;
  oBtn.textContent   = btnText;
  overlay.classList.remove('hidden');
  pauseBtn.classList.remove('visible');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  pauseBtn.classList.add('visible');
}

function startGame() {
  count  = 0;
  lives  = MAX_LIVES;
  speedX = 500;
  speedY = 320;
  turnovers = { ...TURNOVERS };
  liveGeese = [];
  deadGeese = [];
  hasDeadGeese = false;
  redAlpha = 0; redFadeDir = 0;
  pauseDelayStart = -1;
  animFrame = 0;
  lastAnimTime = 0;
  lastSpawnTime = performance.now();
  spawnGoose();
  state = 'RUNNING';
  hideOverlay();
}

function pauseGame() {
  state = 'PAUSED';
  showOverlay('Game Paused ...', 'Resume');
}

function resumeGame() {
  pauseDelayStart = performance.now();
  state = 'RUNNING';
  hideOverlay();
}

function endGame() {
  if (count > highScore) {
    highScore = count;
    localStorage.setItem('highScore', highScore);
  }
  state = 'MENU';
  showOverlay('Main Menu', 'Start Game');
}

// ── Gameplay helpers ──────────────────────────────────────────────────────────
function spawnGoose() {
  const fromLeft = Math.random() < 0.5;
  const x = fromLeft ? 0 : LOCAL_WIDTH;
  const minY = LOCAL_HEIGHT / 3;
  const maxY = LOCAL_HEIGHT - LOCAL_HEIGHT / 4 - GOOSE_HEIGHT;
  const y = minY + Math.random() * (maxY - minY);
  liveGeese.push(new Goose(x, y, fromLeft, speedX, speedY));
  lastSpawnTime = performance.now();
}

function inGooseRegion(cx, cy, goose) {
  return (
    cx <= goose.x + GOOSE_WIDTH  + WIGGLE_ROOM && cx >= goose.x - WIGGLE_ROOM &&
    cy <= goose.y + GOOSE_HEIGHT + WIGGLE_ROOM && cy >= goose.y - WIGGLE_ROOM
  );
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderRunning(now, delta) {
  // Speed milestones
  if (turnovers[count]) {
    speedX *= 1.5;
    speedY *= 0.8;
    turnovers[count] = false;
  }

  // Animate goose sprite
  if (now - lastAnimTime >= ANIM_MS) {
    animFrame = 1 - animFrame;
    lastAnimTime = now;
  }
  const gooseImg = animFrame === 0 ? imgs.flyUp : imgs.flyDown;

  // Crop to the top-left 800x480 region of the 1024x1024 source image (matches LibGDX TextureRegion behavior)
  ctx.drawImage(imgs.back, 0, 0, LOCAL_WIDTH, LOCAL_HEIGHT, 0, 0, LOCAL_WIDTH, LOCAL_HEIGHT);

  // Draw live geese
  for (const g of liveGeese) {
    ctx.save();
    if (!g.fromLeft) {
      ctx.translate(g.x + GOOSE_WIDTH, g.y);
      ctx.scale(-1, 1);
      ctx.drawImage(gooseImg, 0, 0, GOOSE_WIDTH, GOOSE_HEIGHT);
    } else {
      ctx.drawImage(gooseImg, g.x, g.y, GOOSE_WIDTH, GOOSE_HEIGHT);
    }
    ctx.restore();
  }

  // Draw dead geese (blackout)
  for (const g of deadGeese) {
    ctx.save();
    if (!g.fromLeft) {
      ctx.translate(g.x + GOOSE_WIDTH, g.y);
      ctx.scale(-1, 1);
      ctx.drawImage(imgs.blackout, 0, 0, GOOSE_WIDTH, GOOSE_HEIGHT);
    } else {
      ctx.drawImage(imgs.blackout, g.x, g.y, GOOSE_WIDTH, GOOSE_HEIGHT);
    }
    ctx.restore();
  }

  // HUD
  ctx.fillStyle = '#000';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('Lives: ' + lives,     5,              LOCAL_HEIGHT - 8);
  ctx.fillText('Count: ' + count,     LOCAL_WIDTH/2 - 50, LOCAL_HEIGHT - 8);
  ctx.fillText('High Score: ' + highScore, LOCAL_WIDTH - 180, LOCAL_HEIGHT - 8);

  // Red flash overlay
  if (redFadeDir !== 0) {
    if (redFadeDir === 1) {
      redAlpha = Math.min(1, redAlpha + delta / 0.1);
      if (redAlpha >= 1) redFadeDir = -1;
    } else {
      redAlpha = Math.max(0, redAlpha - delta / 0.3);
      if (redAlpha <= 0) redFadeDir = 0;
    }
  }
  if (redAlpha > 0) {
    ctx.globalAlpha = redAlpha;
    ctx.drawImage(imgs.redFrame, 0, 0, LOCAL_WIDTH, LOCAL_HEIGHT, 0, 0, LOCAL_WIDTH, LOCAL_HEIGHT);
    ctx.globalAlpha = 1;
  }

  // Pause countdown (3-2-1 overlay)
  if (pauseDelayStart !== -1) {
    const elapsed = (now - pauseDelayStart) / 1000;
    if (elapsed >= 3) {
      pauseDelayStart = -1;
    } else {
      const frameIdx = Math.floor(elapsed);  // 0→"3", 1→"2", 2→"1"
      const f = NUM_FRAMES[frameIdx];
      ctx.drawImage(imgs.numbers, f.sx, f.sy, f.sw, f.sh,
                    LOCAL_WIDTH/2 - 50, LOCAL_HEIGHT/2 - 30, f.sw, f.sh);
      return; // don't update physics while counting down
    }
  }

  // ── Update physics ───────────────────────────────────────────────────────────
  const click = pendingClick;
  pendingClick = null;

  // Expire dead geese
  if (hasDeadGeese && now - lastDeadTime > DEAD_MS) {
    deadGeese = [];
    hasDeadGeese = false;
  }

  // Spawn new goose
  if (now - lastSpawnTime > SPAWN_MS) spawnGoose();

  const toRemove = [];
  for (let i = 0; i < liveGeese.length; i++) {
    const g = liveGeese[i];

    // Gravity (frame-rate dependent, matches original: += -7.3 each frame)
    g.velocityY += -7.3;

    if (g.fromLeft) {
      g.x += g.velocityX * delta;
    } else {
      g.x -= g.velocityX * delta;
    }
    g.y += g.velocityY * delta;

    if (g.x > LOCAL_WIDTH || g.x < 0) {
      // Escaped
      toRemove.push(i);
      redFadeDir = 1;
      redAlpha = 0;
      lives--;
      if (lives <= 0) { state = 'END'; }
    } else if (click && inGooseRegion(click.x, click.y, g)) {
      // Caught
      const honk = sounds.honk;
      if (honk) { honk.currentTime = 0; honk.play().catch(() => {}); }
      deadGeese.push(g);
      hasDeadGeese = true;
      lastDeadTime = now;
      count++;
      toRemove.push(i);
      click && (pendingClick = null); // consume the click
    }
  }

  // Remove in reverse order to preserve indices
  for (let i = toRemove.length - 1; i >= 0; i--) {
    liveGeese.splice(toRemove[i], 1);
  }

  if (state === 'END') endGame();
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function loop(now) {
  const delta = Math.min((now - lastTimestamp) / 1000, 0.1); // cap at 100ms
  lastTimestamp = now;

  if (state === 'RUNNING') {
    renderRunning(now, delta);
  }

  requestAnimationFrame(loop);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
Promise.all([
  loadImg('back',     'assets/back-fixed.png'),
  loadImg('flyUp',    'assets/rz-g-fly.png'),
  loadImg('flyDown',  'assets/rz-g-fly-2.png'),
  loadImg('blackout', 'assets/rz-g-blackout.png'),
  loadImg('numbers',  'assets/rz-numbers.png'),
  loadImg('redFrame', 'assets/red-highlight-trans.png'),
  loadAudio('honk',   'assets/goose-honk.wav'),
]).then(() => {
  resize();
  showOverlay('Main Menu', 'Start Game');
  requestAnimationFrame(ts => { lastTimestamp = ts; loop(ts); });
});
