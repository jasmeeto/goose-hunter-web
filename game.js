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

// Queue of taps in canvas coords (drained each physics frame).  The queue is a
// fallback for taps that happen while the game loop is between frames; most taps
// are handled immediately in handleCatchInput() for lower latency on phones.
let pendingClicks = [];

// ── Input ─────────────────────────────────────────────────────────────────────
function canvasCoords(point) {
  const r = canvas.getBoundingClientRect();
  const scaleX = LOCAL_WIDTH  / r.width;
  const scaleY = LOCAL_HEIGHT / r.height;
  return {
    x: (point.clientX - r.left) * scaleX,
    // Canvas draw coordinates are top-left based, so input coordinates must be
    // top-left based too.  Inverting this Y value made taps only line up with a
    // goose when it happened to be mirrored around the vertical center.
    y: (point.clientY - r.top) * scaleY,
  };
}

function playHonk() {
  const honk = sounds.honk;
  if (honk) {
    honk.currentTime = 0;
    honk.play().catch(() => {});
  }
}

function catchGooseAt(x, y, now = performance.now()) {
  for (let i = liveGeese.length - 1; i >= 0; i--) {
    const goose = liveGeese[i];
    if (inGooseRegion(x, y, goose)) {
      playHonk();
      deadGeese.push(goose);
      hasDeadGeese = true;
      lastDeadTime = now;
      count++;
      liveGeese.splice(i, 1);
      return true;
    }
  }
  return false;
}

function isResumeCountdownActive() {
  return pauseDelayStart !== -1;
}

function handleCatchInput(point, event) {
  if (event) event.preventDefault();
  if (state !== 'RUNNING' || isResumeCountdownActive()) return;

  const coords = canvasCoords(point);

  // Try to catch immediately instead of waiting up to one animation frame.
  // This makes quick Android taps feel much less laggy.
  if (!catchGooseAt(coords.x, coords.y)) {
    pendingClicks.push(coords);
  }
}

function firstChangedTouch(e) {
  return e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e;
}

function addFastTap(el, handler) {
  let lastDirectActivationTime = 0;

  if (window.PointerEvent) {
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      lastDirectActivationTime = performance.now();
      handler(e, e);
    }, { passive: false });
  } else {
    el.addEventListener('touchstart', e => {
      lastDirectActivationTime = performance.now();
      handler(firstChangedTouch(e), e);
    }, { passive: false });

    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      lastDirectActivationTime = performance.now();
      handler(e, e);
    });
  }

  // Click fallback for browsers/WebViews with incomplete pointer/touch support.
  // Ignore synthetic clicks right after pointer/touch/mouse down to avoid double
  // actions on Android.
  el.addEventListener('click', e => {
    if (performance.now() - lastDirectActivationTime < 700) return;
    handler(e, e);
  });
}

addFastTap(canvas, handleCatchInput);

addFastTap(oBtn, (_point, e) => {
  e.preventDefault();
  if (state === 'MENU') {
    startGame();
  } else if (state === 'PAUSED') {
    resumeGame();
  }
});

// On touch screens the pause overlay itself is also a Resume target. This makes
// unpausing forgiving if the small button misses or the WebView drops a button
// tap, while the main menu still requires pressing Start Game.
addFastTap(overlay, (_point, e) => {
  e.preventDefault();
  if (state === 'PAUSED') resumeGame();
});

addFastTap(pauseBtn, (_point, e) => {
  e.preventDefault();
  if (state === 'RUNNING') pauseGame();
});

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
  pendingClicks.length = 0;
  lastSpawnTime = performance.now();
  spawnGoose();
  state = 'RUNNING';
  hideOverlay();
}

function pauseGame() {
  pendingClicks.length = 0;
  state = 'PAUSED';
  showOverlay('Game Paused ...', 'Resume');
}

function resumeGame() {
  pendingClicks.length = 0;
  pauseDelayStart = performance.now();
  lastTimestamp = pauseDelayStart;
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

  // ── Update physics ───────────────────────────────────────────────────────────
  // Drain tap queue now so taps during countdown are always discarded
  const clicks = pendingClicks.splice(0);

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
      return;
    }
  }

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
    } else {
      for (const click of clicks) {
        if (inGooseRegion(click.x, click.y, g)) {
          // Caught
          const honk = sounds.honk;
          if (honk) { honk.currentTime = 0; honk.play().catch(() => {}); }
          deadGeese.push(g);
          hasDeadGeese = true;
          lastDeadTime = now;
          count++;
          toRemove.push(i);
          break;
        }
      }
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
