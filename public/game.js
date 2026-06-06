(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready?.();
  tg?.expand?.();

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const start = document.getElementById('start');
  const over = document.getElementById('gameover');
  const finalScore = document.getElementById('finalScore');
  const playBtn = document.getElementById('play');
  const againBtn = document.getElementById('again');
  const gate = document.getElementById('registerGate');
  const gateTitle = document.getElementById('gateTitle');
  const gateText = document.getElementById('gateText');
  const registerBtn = document.getElementById('registerBtn');
  const checkRegisterBtn = document.getElementById('checkRegisterBtn');

  const W = 400, H = 600;
  let dpr = 1, running = false, raf = 0;
  let score = 0, best = Number(localStorage.getItem('notebookJumpBest') || 0);
  let cameraY = 0, inputX = 0, pointerDown = false;
  let player, platforms, ghosts, spawnY, lastGreenY, lastGreenX;
  let tgUser = tg?.initDataUnsafe?.user || null;
  let tgId = tgUser?.id ? String(tgUser.id) : (localStorage.getItem('debugTgId') || '');
  if (!tgId) { tgId = String(Math.floor(100000000 + Math.random() * 900000000)); localStorage.setItem('debugTgId', tgId); }
  let playerState = { gate_after: 999999, blocked: false, registered: false, continue_on_site: false };
  let gateShown = false;
  let gateStep = 1;
  let lastSyncScore = -1;
  const PLAY_LEFT = 72;
  const PLAY_RIGHT = 366;
  const PLAY_TOP = 18;
  const PLAY_BOTTOM = 520;
  const SAFE_MARGIN = 8;
  const PLATFORM_SPACING_MIN = 84;
  const PLATFORM_SPACING_MAX = 114;
  // Must be lower than the real jump limit: green platforms are the only stable path,
  // because brown/wood platforms break and do not bounce the player upward.
  const MAX_SAFE_GREEN_GAP = 108;
  const MAX_SAFE_GREEN_X_GAP = 130;
  const SPAWN_AHEAD = 900;

  const ASSETS = {
    bg: './assets/bg.png',
    wood: './assets/wood.png',
    grass: './assets/grass.png',
    monster: './assets/monster.png',
    score: './assets/score.png'
  };
  const img = {};
  let assetsReady = false;

  function loadAssets() {
    return Promise.all(Object.entries(ASSETS).map(([key, src]) => new Promise(resolve => {
      const image = new Image();
      image.onload = () => { img[key] = image; resolve(); };
      image.onerror = resolve;
      image.src = src;
    }))).then(() => { assetsReady = true; draw(); });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);
  resize();

  const rnd = (a, b) => a + Math.random() * (b - a);

  function apiUrl(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('tg_id', tgId);
    if (tgUser?.first_name) url.searchParams.set('first_name', tgUser.first_name);
    if (tgUser?.username) url.searchParams.set('username', tgUser.username);
    return url.toString();
  }

  async function initPlayer() {
    try {
      const res = await fetch(apiUrl('/api/player/init'));
      if (!res.ok) return;
      playerState = await res.json();
      if (playerState.blocked) showGate(playerState.continue_on_site);
    } catch (e) {}
  }

  async function syncJump() {
    if (score === lastSyncScore) return;
    lastSyncScore = score;
    try {
      const res = await fetch('/api/player/jump', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId, score })
      });
      if (!res.ok) return;
      playerState = await res.json();
      if (playerState.blocked || score >= playerState.gate_after) showGate(playerState.continue_on_site);
    } catch (e) {
      if (score >= playerState.gate_after) showGate(false);
    }
  }

  function showGate(continueOnSite = false) {
  gateShown = true;
  running = false;
  cancelAnimationFrame(raf);
  start.classList.add('hidden');
  over.classList.add('hidden');
  gate.classList.remove('hidden');

  if (continueOnSite) {
    gateTitle.textContent = 'Регистрация найдена';
    gateText.textContent = 'Отлично! Дальше игру нужно продолжить проходить на сайте.';
    registerBtn.textContent = 'Продолжить на сайте';
    checkRegisterBtn.classList.add('hidden');
    gateStep = 2;
    return;
  }

  gateStep = 1;
  gateTitle.textContent = '🏆 Рекорд сохранён';
  gateText.textContent = `Твой результат: ${score}. Ты попал в рейтинг игроков. Нажми продолжить, чтобы открыть бонусный режим.`;
  registerBtn.textContent = 'Продолжить';
  checkRegisterBtn.classList.add('hidden');
}

  function openOffer() {
    const url = `/go?tg_id=${encodeURIComponent(tgId)}`;
    tg?.openLink ? tg.openLink(window.location.origin + url) : window.open(url, '_blank');
  }

  registerBtn.onclick = () => {
  if (playerState.continue_on_site) {
    openOffer();
    return;
  }

  if (gateStep === 1) {
    gateStep = 2;
    gateTitle.textContent = '🎁 Бонусный режим';
    gateText.textContent = 'Чтобы сохранить рекорд, получить дополнительные попытки и продолжить игру, зарегистрируйся на сайте.';
    registerBtn.textContent = 'Зарегистрироваться';
    checkRegisterBtn.classList.remove('hidden');
    return;
  }

  openOffer();
};
  checkRegisterBtn.onclick = async () => {
    await initPlayer();
    if (!playerState.registered) {
      tg?.showAlert?.('Регистрация пока не найдена. Подожди немного и нажми ещё раз.');
      gateText.textContent = 'Регистрация пока не найдена. Подожди немного и нажми «Я зарегистрировался» ещё раз.';
    }
  };


  function difficultyAtScore() {
    // 0 до 30 платформ, потом плавно растёт до 1.
    return Math.max(0, Math.min(1, (score - 30) / 70));
  }

  function difficultyAtY(y) {
    // Приблизительно 1 платформа = 95-105px высоты. После ~30 платформ сложность растёт плавно.
    const estimatedPlatforms = Math.max(score, Math.max(0, -y) / 100);
    return Math.max(0, Math.min(1, (estimatedPlatforms - 30) / 70));
  }

  function movingChanceAt(y) {
    const d = difficultyAtY(y);
    // После 30 платформ движущихся становится заметно больше, но не 100%.
    return Math.max(0, Math.min(0.78, d * 0.68));
  }

  function reset() {
    score = 0;
    cameraY = 0;
    player = { x: W / 2 - 22, y: H - 185, w: 44, h: 74, vx: 0, vy: -11.8, facing: 1 };
    platforms = [{ x: W / 2 - 58, y: H - 120, w: 112, h: 28, kind: 'grass', start: true, scored: true, broken: false }];
    ghosts = [];
    spawnY = H - 220;
    lastGreenY = H - 120;
    lastGreenX = W / 2 - 56;
    while (spawnY > -SPAWN_AHEAD) {
      addPlatform(spawnY);
      spawnY -= nextSpacing(spawnY);
    }
    for (let y = H - 520; y > -2500; y -= rnd(430, 620)) addGhost(y);
  }

  function nextSpacing(y) {
    const d = difficultyAtY(y);
    // Гэп растёт плавно, но остаётся ниже максимального прыжка.
    return rnd(PLATFORM_SPACING_MIN + d * 10, PLATFORM_SPACING_MAX + d * 8);
  }

  function greenChanceAt(y) {
    const d = difficultyAtY(y);
    // Чем выше счёт, тем больше коричневых разрушаемых платформ,
    // но зелёный безопасный маршрут всё равно гарантируется.
    return Math.max(0.42, 0.74 - d * 0.28);
  }

  function safeGreenX(w = 112) {
    const minX = PLAY_LEFT + SAFE_MARGIN;
    const maxX = PLAY_RIGHT - w - SAFE_MARGIN;
    const left = Math.max(minX, lastGreenX - MAX_SAFE_GREEN_X_GAP);
    const right = Math.min(maxX, lastGreenX + MAX_SAFE_GREEN_X_GAP);
    return rnd(left, Math.max(left, right));
  }

  function addPlatform(y) {
    const mustBeGreen = lastGreenY - y >= MAX_SAFE_GREEN_GAP;
    const kind = (mustBeGreen || Math.random() < greenChanceAt(y)) ? 'grass' : 'wood';
    const d = difficultyAtY(y);
    const w = kind === 'grass' ? rnd(96 - d * 12, 122 - d * 14) : rnd(94, 118);
    const x = kind === 'grass' ? safeGreenX(w) : rnd(PLAY_LEFT + SAFE_MARGIN, PLAY_RIGHT - w - SAFE_MARGIN);

    const p = {
      x, y, baseX: x, baseY: y, w, h: kind === 'wood' ? 24 : 30,
      kind, start: false, scored: false, broken: false,
      move: 'none', t: Math.random() * Math.PI * 2, range: 0, speed: 0
    };

    if (kind === 'grass' && !mustBeGreen && Math.random() < movingChanceAt(y)) {
      // Сначала влево-вправо, выше добавляем вверх-вниз.
      p.move = Math.random() < (Math.max(0, -y) > 2800 ? 0.35 : 0.12) ? 'vertical' : 'horizontal';
      p.range = p.move === 'vertical' ? rnd(14, 28 + d * 8) : rnd(28, 56 + d * 34);
      p.speed = rnd(0.016, 0.027 + d * 0.018);
      if (p.move === 'horizontal') {
        p.baseX = Math.max(PLAY_LEFT + SAFE_MARGIN + p.range, Math.min(PLAY_RIGHT - SAFE_MARGIN - p.w - p.range, p.baseX));
        p.x = p.baseX;
      }
    }

    platforms.push(p);

    if (kind === 'grass') {
      // Для гарантии достижимости считаем маршрут по центру движения платформы.
      lastGreenY = y;
      lastGreenX = p.baseX;
    }
  }

  function updatePlatformMotion() {
    const d = difficultyAtScore();
    for (const p of platforms) {
      if (p.move === 'none') continue;
      p.t += p.speed * (1 + d * 0.75);
      if (p.move === 'horizontal') p.x = Math.max(PLAY_LEFT + SAFE_MARGIN, Math.min(PLAY_RIGHT - p.w - SAFE_MARGIN, p.baseX + Math.sin(p.t) * p.range));
      if (p.move === 'vertical') p.y = p.baseY + Math.sin(p.t) * p.range;
    }
  }

  function maybeUpgradeDifficultyPlatforms() {
    if (score < 30) return;
    const d = difficultyAtScore();
    for (const p of platforms) {
      if (p.kind !== 'grass' || p.start || p.move !== 'none' || p.scored) continue;
      if (Math.random() < 0.006 + d * 0.014) {
        p.move = Math.random() < 0.24 + d * 0.16 ? 'vertical' : 'horizontal';
        p.range = p.move === 'vertical' ? rnd(14, 26 + d * 10) : rnd(28, 54 + d * 34);
        p.speed = rnd(0.016, 0.026 + d * 0.018);
        p.baseX = Math.max(PLAY_LEFT + SAFE_MARGIN + p.range, Math.min(PLAY_RIGHT - SAFE_MARGIN - p.w - p.range, p.baseX || p.x));
        p.x = p.baseX;
        p.baseY = p.baseY || p.y;
      }
    }
  }

  function addGhost(y) {
    ghosts.push({ x: rnd(PLAY_LEFT + 10, PLAY_RIGHT - 64), y, w: 54, h: 88, vx: Math.random() < .5 ? -0.55 : 0.55 });
  }

  function startGame() {
    reset();
    running = true;
    start.classList.add('hidden');
    over.classList.add('hidden');
    gate.classList.add('hidden');
    gateShown = false;
    cancelAnimationFrame(raf);
    loop();
  }
  playBtn.onclick = startGame;
  againBtn.onclick = startGame;

  function jump(force = -12.8) {
    if (!running) return;
    player.vy = force;
    tg?.HapticFeedback?.impactOccurred?.('light');
  }

  canvas.addEventListener('pointerdown', e => {
    // Touch/click controls only horizontal movement.
    // Do NOT call jump() here, otherwise fast left/right taps give infinite upward flight.
    pointerDown = true;
    setInput(e);
  });
  canvas.addEventListener('pointermove', e => { if (pointerDown) setInput(e); });
  window.addEventListener('pointerup', () => { pointerDown = false; inputX = 0; });
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') inputX = -1;
    if (e.key === 'ArrowRight' || e.key === 'd') inputX = 1;
    // Space/tap should not create an extra jump. The player jumps only after landing on a platform.
  });
  window.addEventListener('keyup', () => inputX = 0);
  window.addEventListener('deviceorientation', e => {
    if (typeof e.gamma === 'number') inputX = Math.max(-1, Math.min(1, e.gamma / 18));
  });

  function setInput(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * W;
    inputX = x < W / 2 ? -1 : 1;
  }

  function loop() {
    update();
    draw();
    if (running) raf = requestAnimationFrame(loop);
  }

  function update() {
    updatePlatformMotion();
    maybeUpgradeDifficultyPlatforms();

    const d = difficultyAtScore();
    player.vx += inputX * (0.55 - d * 0.06);
    if (inputX < -0.08) player.facing = -1;
    if (inputX > 0.08) player.facing = 1;
    player.vx *= 0.88;
    player.x += player.vx;
    player.vy += 0.42 + d * 0.045;
    player.y += player.vy;

    if (player.x < -player.w) player.x = W;
    if (player.x > W) player.x = -player.w;

    if (player.vy > 0) {
      for (const p of platforms) {
        if (p.broken) continue;
        const feet = player.y + player.h;
        const hit = player.x + player.w * .86 > p.x && player.x + player.w * .14 < p.x + p.w &&
          feet > p.y && feet < p.y + p.h + 16;
        if (hit) {
          // Brown wooden blocks are breakable: after landing on them they disappear
          // and do not give a normal bounce. Green blocks stay safe and bouncy.
          if (p.kind === 'wood') {
            p.broken = true;
            player.vy = Math.max(player.vy, 1.8);
            tg?.HapticFeedback?.impactOccurred?.('medium');
          } else {
            jump(-13.9 + d * 0.55);
          }

          // Score counts blocks that the player actually reached.
          if (!p.scored && !p.start) {
            p.scored = true;
            score += 1;
            syncJump();
          }
          break;
        }
      }
    }

    for (const g of ghosts) {
      g.x += g.vx;
      if (g.x < PLAY_LEFT || g.x + g.w > PLAY_RIGHT) g.vx *= -1;
      const hit = player.x + player.w * .75 > g.x && player.x + player.w * .25 < g.x + g.w &&
        player.y + player.h * .85 > g.y && player.y + player.h * .15 < g.y + g.h;
      // Decorative flying ghost/outline objects should not instantly end the game.
      // The game ends only after the player actually falls below the screen.
      if (hit && player.vy > 0 && player.y + player.h * .15 > g.y + g.h) jump(-14.2);
    }

    const targetCam = player.y - H * 0.42;
    if (targetCam < cameraY) cameraY = targetCam;
    const top = cameraY - SPAWN_AHEAD;
    const bottom = cameraY + H + 150;
    platforms = platforms.filter(p => p.y < bottom && !p.broken);
    ghosts = ghosts.filter(g => g.y < bottom);
    while (spawnY > top) {
      addPlatform(spawnY);
      spawnY -= nextSpacing(spawnY);
    }
    if (Math.random() < .006) addGhost(top - rnd(100, 240));

    if (!gateShown && score >= playerState.gate_after && !playerState.registered) { syncJump(); showGate(false); return; }
    if (player.y - cameraY > H + 180) endGame();
  }

  function endGame() {
    if (!running) return;
    running = false;
    best = Math.max(best, score);
    localStorage.setItem('notebookJumpBest', String(best));
    finalScore.textContent = `Score ${score} · Best ${best}`;
    over.classList.remove('hidden');
  }

  function drawCover(image, x, y, w, h) {
    if (!image) return;
    const ir = image.width / image.height, r = w / h;
    let sx = 0, sy = 0, sw = image.width, sh = image.height;
    if (ir > r) { sw = image.height * r; sx = (image.width - sw) / 2; }
    else { sh = image.width / r; sy = (image.height - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function bg() {
    ctx.clearRect(0, 0, W, H);
    if (assetsReady && img.bg) drawCover(img.bg, 0, 0, W, H);
    else { ctx.fillStyle = '#f8f2dc'; ctx.fillRect(0, 0, W, H); }
  }

  function drawPlatform(p) {
    const y = p.y - cameraY;
    const image = p.kind === 'wood' ? img.wood : img.grass;
    if (assetsReady && image) ctx.drawImage(image, p.x, y - (p.kind === 'grass' ? 4 : 2), p.w, p.h + (p.kind === 'grass' ? 10 : 6));
  }

  function drawPlayer() {
    const x = player.x, y = player.y - cameraY;
    if (assetsReady && img.monster) {
      const dw = player.w + 20, dh = player.h + 24;
      ctx.save();
      if (player.facing < 0) {
        ctx.translate(x - 10 + dw, y - 6);
        ctx.scale(-1, 1);
        ctx.drawImage(img.monster, 0, 0, dw, dh);
      } else {
        ctx.drawImage(img.monster, x - 10, y - 6, dw, dh);
      }
      ctx.restore();
    }
  }

  function drawGhost(g) {
    const y = g.y - cameraY;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#222';
    ctx.setLineDash([10, 7]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(g.x, y, g.w, 23, 7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawScore() {
    if (assetsReady && img.score) ctx.drawImage(img.score, 58, -3, 96, 93);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#52309e';
    ctx.lineWidth = 2;
    ctx.font = '30px "Comic Sans MS", "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(String(score), 105, 55);
    ctx.fillText(String(score), 105, 55);
    ctx.restore();
  }

  function hint() {
    if (!running || score >= 3) return;
    ctx.save();
    ctx.fillStyle = '#222';
    ctx.strokeStyle = '#222';
    ctx.font = '22px "Comic Sans MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAP LEFT / RIGHT', W / 2, H - 105);
    ctx.beginPath();
    ctx.moveTo(W / 2, H - 86);
    ctx.quadraticCurveTo(W / 2 + 22, H - 116, W / 2 + 7, H - 137);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    bg();
    if (!player) return;
    // Не даём платформам и монстрику вылезать за лист тетрадки.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLAY_LEFT - 18, PLAY_TOP, PLAY_RIGHT - PLAY_LEFT + 34, PLAY_BOTTOM - PLAY_TOP);
    ctx.clip();
    ghosts.forEach(drawGhost);
    platforms.forEach(drawPlatform);
    drawPlayer();
    ctx.restore();
    drawScore();
    hint();
  }

  reset();
  initPlayer();
  loadAssets();
})();
