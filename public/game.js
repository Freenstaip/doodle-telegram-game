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

  if (!tgId) {
    tgId = String(Math.floor(100000000 + Math.random() * 900000000));
    localStorage.setItem('debugTgId', tgId);
  }

  let playerState = {
    gate_after: 999999,
    blocked: false,
    registered: false,
    continue_on_site: false,
    whitelisted: false,
    losses: 0,
    loss_gate_after: 0
  };

  let gateShown = false;
  let gateStep = 1;
  let lossSyncedForRun = false;
  let lastSyncScore = -1;

  const PLAY_LEFT = 72;
  const PLAY_RIGHT = 366;
  const PLAY_TOP = 18;
  const PLAY_BOTTOM = 520;
  const SAFE_MARGIN = 8;
  const PLATFORM_SPACING_MIN = 84;
  const PLATFORM_SPACING_MAX = 114;
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
      image.onload = () => {
        img[key] = image;
        draw();
        resolve();
      };
      image.onerror = resolve;
      image.src = src;
    }))).then(() => {
      assetsReady = true;
      draw();
    });
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

      if (playerState.blocked && !playerState.whitelisted) {
        showGate(playerState.continue_on_site);
      }
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

      // Ð¢Ð¾Ð»ÑÐºÐ¾ ÑÐ¸Ð½ÑÑÐ¾Ð½Ð¸Ð·Ð¸ÑÑÐµÐ¼ ÑÐµÐºÐ¾ÑÐ´.
      // ÐÐºÐ½Ð¾ ÑÐµÐ³Ð¸ÑÑÑÐ°ÑÐ¸Ð¸ ÑÐµÐ¿ÐµÑÑ Ð¿Ð¾ÐºÐ°Ð·ÑÐ²Ð°ÐµÑÑÑ Ð¿Ð¾ÑÐ»Ðµ Ð¿Ð¾ÑÐ°Ð¶ÐµÐ½Ð¸Ð¹ ÑÐµÑÐµÐ· syncLoss().
      if (playerState.whitelisted) return;
    } catch (e) {
      // ÐÑÐ¸Ð±ÐºÐ° ÑÐ¸Ð½ÑÑÐ¾Ð½Ð¸Ð·Ð°ÑÐ¸Ð¸ ÑÑÑÑÐ° Ð½Ðµ Ð´Ð¾Ð»Ð¶Ð½Ð° Ð·Ð°Ð²ÐµÑÑÐ°ÑÑ Ð¸Ð³ÑÑ.
    }
  }

  async function syncLoss() {
    if (lossSyncedForRun) return;
    lossSyncedForRun = true;

    try {
      const res = await fetch('/api/player/loss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tg_id: tgId, score })
      });

      if (!res.ok) return;

      playerState = await res.json();

      if (playerState.blocked && !playerState.registered && !playerState.whitelisted) {
        showGate(playerState.continue_on_site);
      }
    } catch (e) {}
  }

  function showGate(continueOnSite = false) {
    if (playerState.whitelisted) return;

    gateShown = true;
    running = false;
    cancelAnimationFrame(raf);

    start.classList.add('hidden');
    over.classList.add('hidden');
    gate.classList.remove('hidden');

    if (continueOnSite) {
      gateTitle.textContent = 'Ð ÐµÐ³Ð¸ÑÑÑÐ°ÑÐ¸Ñ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°';
      gateText.textContent = 'ÐÑÐ»Ð¸ÑÐ½Ð¾! ÐÐ°Ð»ÑÑÐµ Ð¸Ð³ÑÑ Ð½ÑÐ¶Ð½Ð¾ Ð¿ÑÐ¾Ð´Ð¾Ð»Ð¶Ð¸ÑÑ Ð¿ÑÐ¾ÑÐ¾Ð´Ð¸ÑÑ Ð½Ð° ÑÐ°Ð¹ÑÐµ.';
      registerBtn.textContent = 'ÐÑÐ¾Ð´Ð¾Ð»Ð¶Ð¸ÑÑ Ð½Ð° ÑÐ°Ð¹ÑÐµ';
      checkRegisterBtn.classList.add('hidden');
      gateStep = 2;
      return;
    }

    gateStep = 1;
    gateTitle.textContent = 'ð Ð ÐµÐºÐ¾ÑÐ´ ÑÐ¾ÑÑÐ°Ð½ÑÐ½';
    gateText.textContent = `Ð¢Ð²Ð¾Ð¹ ÑÐµÐ·ÑÐ»ÑÑÐ°Ñ: ${score}. Ð¢Ñ Ð¿Ð¾Ð¿Ð°Ð» Ð² ÑÐµÐ¹ÑÐ¸Ð½Ð³ Ð¸Ð³ÑÐ¾ÐºÐ¾Ð². ÐÐ°Ð¶Ð¼Ð¸ Ð¿ÑÐ¾Ð´Ð¾Ð»Ð¶Ð¸ÑÑ, ÑÑÐ¾Ð±Ñ Ð¾ÑÐºÑÑÑÑ Ð±Ð¾Ð½ÑÑÐ½ÑÐ¹ ÑÐµÐ¶Ð¸Ð¼.`;
    registerBtn.textContent = 'ÐÑÐ¾Ð´Ð¾Ð»Ð¶Ð¸ÑÑ';
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
      gateTitle.textContent = 'ð ÐÐ¾Ð½ÑÑÐ½ÑÐ¹ ÑÐµÐ¶Ð¸Ð¼';
      gateText.textContent = 'Ð§ÑÐ¾Ð±Ñ ÑÐ¾ÑÑÐ°Ð½Ð¸ÑÑ ÑÐµÐºÐ¾ÑÐ´, Ð¿Ð¾Ð»ÑÑÐ¸ÑÑ Ð´Ð¾Ð¿Ð¾Ð»Ð½Ð¸ÑÐµÐ»ÑÐ½ÑÐµ Ð¿Ð¾Ð¿ÑÑÐºÐ¸ Ð¸ Ð¿ÑÐ¾Ð´Ð¾Ð»Ð¶Ð¸ÑÑ Ð¸Ð³ÑÑ, Ð·Ð°ÑÐµÐ³Ð¸ÑÑÑÐ¸ÑÑÐ¹ÑÑ Ð½Ð° ÑÐ°Ð¹ÑÐµ.';
      registerBtn.textContent = 'ÐÐ°ÑÐµÐ³Ð¸ÑÑÑÐ¸ÑÐ¾Ð²Ð°ÑÑÑÑ';
      checkRegisterBtn.classList.remove('hidden');
      return;
    }

    openOffer();
  };

  checkRegisterBtn.onclick = async () => {
    await initPlayer();

    if (!playerState.registered) {
      tg?.showAlert?.('Ð ÐµÐ³Ð¸ÑÑÑÐ°ÑÐ¸Ñ Ð¿Ð¾ÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°. ÐÐ¾Ð´Ð¾Ð¶Ð´Ð¸ Ð½ÐµÐ¼Ð½Ð¾Ð³Ð¾ Ð¸ Ð½Ð°Ð¶Ð¼Ð¸ ÐµÑÑ ÑÐ°Ð·.');
      gateText.textContent = 'Ð ÐµÐ³Ð¸ÑÑÑÐ°ÑÐ¸Ñ Ð¿Ð¾ÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°. ÐÐ¾Ð´Ð¾Ð¶Ð´Ð¸ Ð½ÐµÐ¼Ð½Ð¾Ð³Ð¾ Ð¸ Ð½Ð°Ð¶Ð¼Ð¸ Â«Ð¯ Ð·Ð°ÑÐµÐ³Ð¸ÑÑÑÐ¸ÑÐ¾Ð²Ð°Ð»ÑÑÂ» ÐµÑÑ ÑÐ°Ð·.';
    }
  };

  function difficultyAtScore() {
    return Math.max(0, Math.min(1, (score - 30) / 70));
  }

  function difficultyAtY(y) {
    const estimatedPlatforms = Math.max(score, Math.max(0, -y) / 100);
    return Math.max(0, Math.min(1, (estimatedPlatforms - 30) / 70));
  }

  function movingChanceAt(y) {
    const d = difficultyAtY(y);
    return Math.max(0, Math.min(0.78, d * 0.68));
  }

  function reset() {
    score = 0;
    cameraY = 0;
    lossSyncedForRun = false;
    lastSyncScore = -1;

    player = {
      x: W / 2 - 22,
      y: H - 185,
      w: 44,
      h: 74,
      vx: 0,
      vy: -11.8,
      facing: 1
    };

    platforms = [
      {
        x: W / 2 - 58,
        y: H - 120,
        w: 112,
        h: 28,
        kind: 'grass',
        start: true,
        scored: true,
        broken: false
      }
    ];

    ghosts = [];
    spawnY = H - 220;
    lastGreenY = H - 120;
    lastGreenX = W / 2 - 56;

    while (spawnY > -SPAWN_AHEAD) {
      addPlatform(spawnY);
      spawnY -= nextSpacing(spawnY);
    }

    for (let y = H - 520; y > -2500; y -= rnd(430, 620)) {
      addGhost(y);
    }
  }

  function nextSpacing(y) {
    const d = difficultyAtY(y);
    return rnd(PLATFORM_SPACING_MIN + d * 10, PLATFORM_SPACING_MAX + d * 8);
  }

  function greenChanceAt(y) {
    const d = difficultyAtY(y);
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
      x,
      y,
      baseX: x,
      baseY: y,
      w,
      h: kind === 'wood' ? 24 : 30,
      kind,
      start: false,
      scored: false,
      broken: false,
      move: 'none',
      t: Math.random() * Math.PI * 2,
      range: 0,
      speed: 0
    };

    if (kind === 'grass' && !mustBeGreen && Math.random() < movingChanceAt(y)) {
      p.move = Math.random() < (Math.max(0, -y) > 2800 ? 0.35 : 0.12) ? 'vertical' : 'horizontal';
      p.range = p.move === 'vertical' ? rnd(14, 28 + d * 8) : rnd(28, 56 + d * 34);
      p.speed = rnd(0.016, 0.027 + d * 0.018);

      if (p.move === 'horizontal') {
        p.baseX = Math.max(
          PLAY_LEFT + SAFE_MARGIN + p.range,
          Math.min(PLAY_RIGHT - SAFE_MARGIN - p.w - p.range, p.baseX)
        );
        p.x = p.baseX;
      }
    }

    platforms.push(p);

    if (kind === 'grass') {
      lastGreenY = y;
      lastGreenX = p.baseX;
    }
  }

  function updatePlatformMotion() {
    const d = difficultyAtScore();

    for (const p of platforms) {
      if (p.move === 'none') continue;

      p.t += p.speed * (1 + d * 0.75);

      if (p.move === 'horizontal') {
        p.x = Math.max(
          PLAY_LEFT + SAFE_MARGIN,
          Math.min(PLAY_RIGHT - p.w - SAFE_MARGIN, p.baseX + Math.sin(p.t) * p.range)
        );
      }

      if (p.move === 'vertical') {
        p.y = p.baseY + Math.sin(p.t) * p.range;
      }
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
        p.baseX = Math.max(
          PLAY_LEFT + SAFE_MARGIN + p.range,
          Math.min(PLAY_RIGHT - SAFE_MARGIN - p.w - p.range, p.baseX || p.x)
        );
        p.x = p.baseX;
        p.baseY = p.baseY || p.y;
      }
    }
  }

  function addGhost(y) {
    ghosts.push({
      x: rnd(PLAY_LEFT + 10, PLAY_RIGHT - 64),
      y,
      w: 54,
      h: 88,
      vx: Math.random() < 0.5 ? -0.55 : 0.55
    });
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
    pointerDown = true;
    setInput(e);
  });

  canvas.addEventListener('pointermove', e => {
    if (pointerDown) setInput(e);
  });

  window.addEventListener('pointerup', () => {
    pointerDown = false;
    inputX = 0;
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') inputX = -1;
    if (e.key === 'ArrowRight' || e.key === 'd') inputX = 1;
  });

  window.addEventListener('keyup', () => inputX = 0);

  // ÐÑÐºÐ»ÑÑÐµÐ½Ð¾: Ð½Ð° Android Telegram WebView ÑÐ°ÑÑÐ¾ Ð´Ð°ÑÑ Ð¿Ð¾ÑÑÐ¾ÑÐ½Ð½ÑÐ¹ Ð½Ð°ÐºÐ»Ð¾Ð½,
  // Ð¸Ð·-Ð·Ð° ÑÐµÐ³Ð¾ Ð¼Ð¾Ð½ÑÑÑÐ¸ÐºÐ° ÑÑÐ½ÐµÑ Ð²Ð»ÐµÐ²Ð¾/Ð²Ð¿ÑÐ°Ð²Ð¾ Ð±ÐµÐ· ÐºÐ°ÑÐ°Ð½Ð¸Ñ ÑÐºÑÐ°Ð½Ð°.
  // Ð£Ð¿ÑÐ°Ð²Ð»ÐµÐ½Ð¸Ðµ Ð¾ÑÑÐ°ÑÑÑÑ ÑÐµÑÐµÐ· ÑÐ°Ð¿/ÑÐ²Ð°Ð¹Ð¿ Ð²Ð»ÐµÐ²Ð¾-Ð²Ð¿ÑÐ°Ð²Ð¾.
  /*
  window.addEventListener('deviceorientation', e => {
    if (typeof e.gamma === 'number') inputX = Math.max(-1, Math.min(1, e.gamma / 18));
  });
  */

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

    const prevY = player.y;

    player.vx += inputX * (0.55 - d * 0.06);

    if (inputX < -0.08) player.facing = -1;
    if (inputX > 0.08) player.facing = 1;

    player.vx *= 0.88;
    player.x += player.vx;
    player.vy += 0.42 + d * 0.045;
    player.y += player.vy;

    if (player.x < -player.w) player.x = W;
    if (player.x > W) player.x = -player.w;

    // ÐÑÐ»Ð¸ Ð¼Ð¾Ð½ÑÑÑÐ¸Ðº Ð¿Ð°Ð´Ð°ÐµÑ Ð½Ð¸Ð¶Ðµ Ð²Ð¸Ð´Ð¸Ð¼Ð¾Ð³Ð¾ Ð¸Ð³ÑÐ¾Ð²Ð¾Ð³Ð¾ Ð»Ð¸ÑÑÐ°/ÑÑÐ°Ð²Ñ â ÑÑÐ¾ Ð¿ÑÐ¾Ð¸Ð³ÑÑÑ.
    // ÐÐµ Ð´Ð°ÑÐ¼ ÐµÐ¼Ñ ÑÑÐ¿ÐµÑÑ ÑÑÐ¾Ð»ÐºÐ½ÑÑÑÑÑ ÑÐ¾ ÑÐºÑÑÑÐ¾Ð¹ Ð½Ð¸Ð¶Ð½ÐµÐ¹ Ð¿Ð»Ð°ÑÑÐ¾ÑÐ¼Ð¾Ð¹.
    const playerScreenBottom = player.y + player.h - cameraY;
    if (player.vy > 0 && playerScreenBottom > PLAY_BOTTOM + 18) {
      endGame();
      return;
    }

    if (player.vy > 0) {
      for (const p of platforms) {
        if (p.broken) continue;

        const platformScreenY = p.y - cameraY;

        // Ð¡ÑÐ°ÑÑÐ¾Ð²Ð°Ñ Ð½Ð¸Ð¶Ð½ÑÑ Ð¿Ð»Ð°ÑÑÐ¾ÑÐ¼Ð° Ð½ÑÐ¶Ð½Ð° ÑÐ¾Ð»ÑÐºÐ¾ Ð² Ð½Ð°ÑÐ°Ð»Ðµ.
        // ÐÐ¾ÑÐ»Ðµ Ð¿ÐµÑÐ²Ð¾Ð³Ð¾ Ð¾ÑÐºÐ° Ð¾Ð½Ð° Ð±Ð¾Ð»ÑÑÐµ Ð½Ðµ Ð´Ð¾Ð»Ð¶Ð½Ð° Ð¿Ð¾Ð´Ð±ÑÐ°ÑÑÐ²Ð°ÑÑ.
        if (p.start && score > 0) continue;

        // ÐÑÐ±Ð°Ñ Ð¿Ð»Ð°ÑÑÐ¾ÑÐ¼Ð°, ÐºÐ¾ÑÐ¾ÑÐ°Ñ ÑÐ¶Ðµ Ð½Ð¸Ð¶Ðµ Ð²Ð¸Ð´Ð¸Ð¼Ð¾Ð³Ð¾ Ð»Ð¸ÑÑÐ°/ÑÑÐ°Ð²Ñ,
        // ÑÑÐ¸ÑÐ°ÐµÑÑÑ Ð½ÐµÐ°ÐºÑÐ¸Ð²Ð½Ð¾Ð¹ Ð¸ Ð½Ðµ Ð¼Ð¾Ð¶ÐµÑ Ð´Ð°ÑÑ Ð¿ÑÑÐ¶Ð¾Ðº.
        if (platformScreenY > PLAY_BOTTOM - 12) continue;

        const feet = player.y + player.h;
        const prevFeet = prevY + player.h;

        const hit =
          player.x + player.w * 0.75 > p.x + 6 &&
          player.x + player.w * 0.25 < p.x + p.w - 6 &&
          prevFeet <= p.y + 2 &&
          feet >= p.y &&
          feet <= p.y + 8;

        if (hit) {
          if (p.kind === 'wood') {
            p.broken = true;
            player.vy = Math.max(player.vy, 1.8);
            tg?.HapticFeedback?.impactOccurred?.('medium');
          } else {
            jump(-13.9 + d * 0.55);
          }

          if (!p.scored && !p.start) {
            p.scored = true;
            score += 1;

            if (
              score % 3 === 0 ||
              score >= playerState.gate_after - 2
            ) {
              syncJump();
            }
          }

          break;
        }
      }
    }

    for (const g of ghosts) {
      g.x += g.vx;
      if (g.x < PLAY_LEFT || g.x + g.w > PLAY_RIGHT) g.vx *= -1;

      const hit =
        player.x + player.w * 0.75 > g.x &&
        player.x + player.w * 0.25 < g.x + g.w &&
        player.y + player.h * 0.85 > g.y &&
        player.y + player.h * 0.15 < g.y + g.h;

      if (hit && player.vy > 0 && player.y + player.h * 0.15 > g.y + g.h) {
        jump(-14.2);
      }
    }

    const targetCam = player.y - H * 0.42;
    if (targetCam < cameraY) cameraY = targetCam;

    const top = cameraY - SPAWN_AHEAD;
    const bottom = cameraY + H + 150;

    platforms = platforms.filter(p => {
      if (p.broken) return false;
      if (p.start && score > 0) return false;
      return p.y < bottom;
    });
    ghosts = ghosts.filter(g => g.y < bottom);

    while (spawnY > top) {
      addPlatform(spawnY);
      spawnY -= nextSpacing(spawnY);
    }

    if (Math.random() < 0.006) addGhost(top - rnd(100, 240));

    // ÐÐ»Ð¾ÐºÐ¸ÑÐ¾Ð²ÐºÐ° Ð¿Ð¾ ÑÑÑÑÑ Ð¾ÑÐºÐ»ÑÑÐµÐ½Ð°.
    // Ð ÐµÐ³Ð¸ÑÑÑÐ°ÑÐ¸Ñ Ð¿Ð¾ÐºÐ°Ð·ÑÐ²Ð°ÐµÑÑÑ ÑÐ¾Ð»ÑÐºÐ¾ Ð¿Ð¾ÑÐ»Ðµ Ð¿Ð¾ÑÐ°Ð¶ÐµÐ½Ð¸Ñ ÑÐµÑÐµÐ· syncLoss().

    if (player.y - cameraY > H + 180) endGame();
  }

  function endGame() {
    if (!running) return;

    running = false;
    best = Math.max(best, score);
    localStorage.setItem('notebookJumpBest', String(best));

    syncLoss();

    if (!gateShown) {
      finalScore.textContent = `Score ${score} Â· Best ${best}`;
      over.classList.remove('hidden');
    }
  }

  function drawCover(image, x, y, w, h) {
    if (!image) return;

    const ir = image.width / image.height;
    const r = w / h;
    let sx = 0, sy = 0, sw = image.width, sh = image.height;

    if (ir > r) {
      sw = image.height * r;
      sx = (image.width - sw) / 2;
    } else {
      sh = image.width / r;
      sy = (image.height - sh) / 2;
    }

    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function bg() {
    ctx.clearRect(0, 0, W, H);

    if (assetsReady && img.bg) drawCover(img.bg, 0, 0, W, H);
    else {
      ctx.fillStyle = '#f8f2dc';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPlatform(p) {
    const y = p.y - cameraY;
    const image = p.kind === 'wood' ? img.wood : img.grass;

    if (image) {
      ctx.drawImage(
        image,
        p.x,
        y - (p.kind === 'grass' ? 4 : 2),
        p.w,
        p.h + (p.kind === 'grass' ? 10 : 6)
      );
      return;
    }

    // Fallback Ð´Ð»Ñ Android/Ð¼ÐµÐ´Ð»ÐµÐ½Ð½Ð¾Ð¹ Ð·Ð°Ð³ÑÑÐ·ÐºÐ¸ ÐºÐ°ÑÑÐ¸Ð½Ð¾Ðº:
    // Ð¿Ð»Ð°ÑÑÐ¾ÑÐ¼Ð° Ð²Ð¸Ð´Ð½Ð° ÑÑÐ°Ð·Ñ, Ð´Ð°Ð¶Ðµ ÐµÑÐ»Ð¸ Ð°ÑÑÐµÑÑ ÐµÑÑ Ð³ÑÑÐ·ÑÑÑÑ.
    ctx.save();
    ctx.fillStyle = p.kind === 'wood' ? '#9b6a2f' : '#6fbf3d';
    ctx.strokeStyle = p.kind === 'wood' ? '#5a3718' : '#2f7d22';
    ctx.lineWidth = 2;

    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(p.x, y, p.w, p.h, 10);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(p.x, y, p.w, p.h);
      ctx.strokeRect(p.x, y, p.w, p.h);
    }

    ctx.restore();
  }

  function drawPlayer() {
    const x = player.x;
    const y = player.y - cameraY;

    if (img.monster) {
      const dw = player.w + 20;
      const dh = player.h + 24;

      ctx.save();

      if (player.facing < 0) {
        ctx.translate(x - 10 + dw, y - 6);
        ctx.scale(-1, 1);
        ctx.drawImage(img.monster, 0, 0, dw, dh);
      } else {
        ctx.drawImage(img.monster, x - 10, y - 6, dw, dh);
      }

      ctx.restore();
      return;
    }

    // Fallback Ð´Ð»Ñ Android/Ð¼ÐµÐ´Ð»ÐµÐ½Ð½Ð¾Ð¹ Ð·Ð°Ð³ÑÑÐ·ÐºÐ¸ monster.png.
    ctx.save();
    ctx.fillStyle = '#7b4bd6';
    ctx.strokeStyle = '#2d1b5f';
    ctx.lineWidth = 3;

    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, player.w, player.h, 10);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, y, player.w, player.h);
      ctx.strokeRect(x, y, player.w, player.h);
    }

    ctx.fillStyle = '#fff176';
    ctx.strokeStyle = '#2d1b5f';
    ctx.beginPath();
    ctx.arc(x + player.w * 0.55, y + player.h * 0.32, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x + player.w * 0.55, y + player.h * 0.32, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
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
