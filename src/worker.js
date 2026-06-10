const DAY_MS = 24 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

function text(data, status = 200) {
  return new Response(data, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}

function randomGate() {
  const r = Math.random();

  if (r < 0.5) {
    return 15 + Math.floor(Math.random() * 6); // 15–20
  }

  if (r < 0.8) {
    return 21 + Math.floor(Math.random() * 10); // 21–30
  }

  return 31 + Math.floor(Math.random() * 20); // 31–50
}

function randomLossGate() {
  return 1 + Math.floor(Math.random() * 3); // 1–3 поражения
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[0-9]{3,32}$/.test(id) ? id : '';
}

function adminIds(env) {
  return String(env.ADMIN_IDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function getBaseUrl(request, env) {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
}

function buildOfferUrl(env, tgId) {
  const base = env.OFFER_URL || 'https://1win.example/';
  const url = new URL(base);
  const subParam = env.OFFER_SUBID_PARAM || 'sub1';
  url.searchParams.set(subParam, tgId);
  return url.toString();
}

async function ensurePlayer(env, data) {
  const now = Date.now();
  const tgId = cleanId(data.tg_id);

  if (!tgId) throw new Error('bad_tg_id');

  const existing = await env.DB
    .prepare('SELECT * FROM players WHERE tg_id = ?')
    .bind(tgId)
    .first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE players
      SET first_name = COALESCE(?, first_name),
          username = COALESCE(?, username),
          last_seen_at = ?,
          loss_gate_after = CASE
            WHEN loss_gate_after IS NULL OR loss_gate_after = 0 THEN ?
            ELSE loss_gate_after
          END
      WHERE tg_id = ?
    `)
      .bind(data.first_name || null, data.username || null, now, randomLossGate(), tgId)
      .run();

    return {
      ...existing,
      first_name: data.first_name || existing.first_name,
      username: data.username || existing.username,
      last_seen_at: now,
      loss_gate_after: existing.loss_gate_after || randomLossGate()
    };
  }

  const gateAfter = randomGate();
  const lossGateAfter = randomLossGate();

  await env.DB.prepare(`
    INSERT INTO players (
      tg_id,
      first_name,
      username,
      created_at,
      last_seen_at,
      gate_after,
      loss_gate_after,
      losses,
      whitelist
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
  `)
    .bind(
      tgId,
      data.first_name || null,
      data.username || null,
      now,
      now,
      gateAfter,
      lossGateAfter
    )
    .run();

  return {
    tg_id: tgId,
    first_name: data.first_name || null,
    username: data.username || null,
    created_at: now,
    last_seen_at: now,
    gate_after: gateAfter,
    loss_gate_after: lossGateAfter,
    losses: 0,
    whitelist: 0,
    max_score: 0,
    blocked_at: null,
    clicked_at: null,
    registered_at: null
  };
}

function publicPlayer(row) {
  const whitelisted = Boolean(row.whitelist);
  const registered = Boolean(row.registered_at);
  const blocked = !whitelisted && (registered || Boolean(row.blocked_at));

  return {
    tg_id: row.tg_id,
    gate_after: row.gate_after,
    max_score: row.max_score || 0,
    clicked: Boolean(row.clicked_at),
    registered,
    blocked,
    continue_on_site: registered,
    whitelisted,
    losses: row.losses || 0,
    loss_gate_after: row.loss_gate_after || 0
  };
}

async function playerInit(request, env) {
  const url = new URL(request.url);

  const p = await ensurePlayer(env, {
    tg_id: url.searchParams.get('tg_id'),
    first_name: url.searchParams.get('first_name'),
    username: url.searchParams.get('username')
  });

  return json(publicPlayer(p));
}

async function playerJump(request, env) {
  const body = await request.json().catch(() => ({}));
  const tgId = cleanId(body.tg_id);
  const score = Math.max(0, Math.floor(Number(body.score || 0)));

  if (!tgId) return json({ error: 'bad_tg_id' }, 400);

  let p = await env.DB
    .prepare('SELECT * FROM players WHERE tg_id = ?')
    .bind(tgId)
    .first();

  if (!p) p = await ensurePlayer(env, { tg_id: tgId });

  const now = Date.now();

  // Блокировка по счёту отключена.
  // Здесь только сохраняем рекорд.
  // Окно регистрации появляется только после поражений через /api/player/loss.
  await env.DB.prepare(`
    UPDATE players
    SET max_score = MAX(max_score, ?),
        last_seen_at = ?
    WHERE tg_id = ?
  `)
    .bind(score, now, tgId)
    .run();

  p = await env.DB
    .prepare('SELECT * FROM players WHERE tg_id = ?')
    .bind(tgId)
    .first();

  return json(publicPlayer(p));
}

async function playerLoss(request, env) {
  const body = await request.json().catch(() => ({}));
  const tgId = cleanId(body.tg_id);

  if (!tgId) return json({ error: 'bad_tg_id' }, 400);

  let p = await env.DB
    .prepare('SELECT * FROM players WHERE tg_id = ?')
    .bind(tgId)
    .first();

  if (!p) p = await ensurePlayer(env, { tg_id: tgId });

  const now = Date.now();
  const nextLosses = (p.losses || 0) + 1;
  const lossGateAfter = p.loss_gate_after || randomLossGate();

  const shouldBlock =
    !p.whitelist &&
    !p.registered_at &&
    nextLosses >= lossGateAfter;

  await env.DB.prepare(`
    UPDATE players
    SET losses = ?,
        loss_gate_after = CASE
          WHEN loss_gate_after IS NULL OR loss_gate_after = 0 THEN ?
          ELSE loss_gate_after
        END,
        last_seen_at = ?,
        blocked_at = CASE
          WHEN ? THEN COALESCE(blocked_at, ?)
          ELSE blocked_at
        END
    WHERE tg_id = ?
  `)
    .bind(nextLosses, lossGateAfter, now, shouldBlock ? 1 : 0, now, tgId)
    .run();

  p = await env.DB
    .prepare('SELECT * FROM players WHERE tg_id = ?')
    .bind(tgId)
    .first();

  return json(publicPlayer(p));
}

async function go(request, env) {
  const url = new URL(request.url);
  const tgId = cleanId(url.searchParams.get('tg_id') || url.searchParams.get('sub1'));

  if (tgId) {
    const now = Date.now();

    await env.DB.prepare(`
      UPDATE players
      SET clicked_at = COALESCE(clicked_at, ?),
          last_seen_at = ?
      WHERE tg_id = ?
    `)
      .bind(now, now, tgId)
      .run();
  }

  return Response.redirect(buildOfferUrl(env, tgId || 'unknown'), 302);
}

async function registrationPostback(request, env) {
  const url = new URL(request.url);
  const body = request.method === 'POST'
    ? await request.text().catch(() => '')
    : '';

  const params = new URLSearchParams(url.search);

  if (body) {
    try {
      const obj = JSON.parse(body);
      for (const [k, v] of Object.entries(obj)) {
        params.set(k, String(v));
      }
    } catch {
      new URLSearchParams(body).forEach((v, k) => params.set(k, v));
    }
  }

  const secret = params.get('secret');

  if (env.POSTBACK_SECRET && secret !== env.POSTBACK_SECRET) {
    return text('forbidden', 403);
  }

  const tgId = cleanId(
    params.get('tg_id') ||
    params.get('user_id') ||
    params.get('sub1') ||
    params.get('subid') ||
    params.get('click_id')
  );

  if (!tgId) return text('missing tg_id/subid', 400);

  const now = Date.now();
  const payload = JSON.stringify(Object.fromEntries(params.entries())).slice(0, 4000);

  let p = await env.DB
    .prepare('SELECT tg_id FROM players WHERE tg_id = ?')
    .bind(tgId)
    .first();

  if (!p) await ensurePlayer(env, { tg_id: tgId });

  await env.DB.prepare(`
    UPDATE players
    SET registered_at = COALESCE(registered_at, ?),
        registration_payload = COALESCE(registration_payload, ?),
        last_seen_at = ?
    WHERE tg_id = ?
  `)
    .bind(now, payload, now, tgId)
    .run();

  return text('ok');
}

async function stats(env) {
  const now = Date.now();

  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total_players,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
      SUM(CASE WHEN registered_at IS NOT NULL THEN 1 ELSE 0 END) AS registered,
      SUM(CASE WHEN blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN whitelist = 1 THEN 1 ELSE 0 END) AS whitelist_count
    FROM players
  `)
    .bind(now - DAY_MS)
    .first();

  return {
    total_players: row.total_players || 0,
    new_24h: row.new_24h || 0,
    clicked: row.clicked || 0,
    registered: row.registered || 0,
    blocked: row.blocked || 0,
    whitelist_count: row.whitelist_count || 0
  };
}

async function sendTelegram(env, method, payload) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;

  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram error: ${method}`);
  }

  return data;
}

function percent(part, total) {
  if (!total) return '0.0%';
  return ((part / total) * 100).toFixed(1) + '%';
}

function statsText(s) {
  return [
    '📊 Статистика игры',
    '',
    `🆕 Новых игроков за 24ч: ${s.new_24h}`,
    `👥 Всего игроков: ${s.total_players}`,
    `🟢 Без ограничений: ${s.whitelist_count}`,
    '',
    `🚧 Дошли до блокировки: ${s.blocked}`,
    `🔗 Перешли по ссылке: ${s.clicked}`,
    `✅ Зарегистрировались: ${s.registered}`,
    '',
    `📈 Блокировка → клик: ${percent(s.clicked, s.blocked)}`,
    `📈 Клик → регистрация: ${percent(s.registered, s.clicked)}`,
    `📈 Общий CR: ${percent(s.registered, s.total_players)}`,
    '',
    'Учёт: 1 Telegram ID = 1 игрок.'
  ].join('\n');
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'admin_stats' }],
      [{ text: '👥 Игроки', callback_data: 'admin_players' }],
      [{ text: '🏆 ТОП игроков', callback_data: 'players_top' }],
      [{ text: '📊 Воронка', callback_data: 'admin_funnel' }],
      [{ text: '📈 Сегменты', callback_data: 'admin_segments' }],
      [{ text: '🔔 Дожим', callback_data: 'admin_push_unregistered' }]
    ]
  };
}

function playersKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '👥 Последние 20', callback_data: 'players_last20' }],
      [{ text: '📄 Последние 100', callback_data: 'players_last100' }],
      [{ text: '🔗 Перешедшие', callback_data: 'players_clicked' }],
      [{ text: '✅ Зарегистрированные', callback_data: 'players_registered' }],
      [{ text: '🟢 Без ограничений', callback_data: 'players_whitelist' }],
      [{ text: '⬅️ Назад', callback_data: 'admin_stats' }]
    ]
  };
}

function playerLine(p, index) {
  const username = p.username ? `@${p.username}` : 'без username';
  const score = p.max_score || 0;
  const clicked = p.clicked_at ? '🔗' : '';
  const registered = p.registered_at ? '✅' : '';
  const free = p.whitelist ? '🟢' : '';
  return `${index}. ${p.tg_id} | ${username} | score: ${score} ${clicked}${registered}${free}`;
}

async function playersListText(env, type, limit = 20) {
  let title = '👥 Игроки';
  let where = '';
  let order = 'created_at DESC';

  if (type === 'clicked') {
    title = '🔗 Перешедшие по ссылке';
    where = 'WHERE clicked_at IS NOT NULL';
    order = 'clicked_at DESC';
  }

  if (type === 'registered') {
    title = '✅ Зарегистрированные';
    where = 'WHERE registered_at IS NOT NULL';
    order = 'registered_at DESC';
  }

  if (type === 'whitelist') {
    title = '🟢 Игроки без ограничений';
    where = 'WHERE whitelist = 1';
    order = 'created_at DESC';
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const rows = await env.DB.prepare(`
    SELECT tg_id, username, first_name, created_at, max_score, clicked_at, registered_at, whitelist
    FROM players
    ${where}
    ORDER BY ${order}
    LIMIT ${safeLimit}
  `).all();

  const list = rows.results || [];

  if (!list.length) {
    return `${title}\n\nПока пусто.`;
  }

  return [
    title,
    '',
    ...list.map((p, i) => playerLine(p, i + 1)),
    '',
    'Команды:',
    '/find TELEGRAM_ID',
    '/free TELEGRAM_ID',
    '/unfree TELEGRAM_ID',
    '/reset TELEGRAM_ID'
  ].join('\n');
}

async function topPlayersText(env) {
  const rows = await env.DB.prepare(`
    SELECT tg_id, username, max_score, clicked_at, registered_at, whitelist
    FROM players
    ORDER BY max_score DESC
    LIMIT 20
  `).all();

  const list = rows.results || [];

  if (!list.length) {
    return '🏆 ТОП игроков\n\nПока пусто.';
  }

  return [
    '🏆 ТОП игроков',
    '',
    ...list.map((p, i) => playerLine(p, i + 1))
  ].join('\n');
}

async function funnelText(env) {
  const s = await stats(env);

  return [
    '📊 Воронка',
    '',
    `👥 Всего игроков: ${s.total_players}`,
    `🚧 Дошли до блокировки: ${s.blocked}`,
    `🔗 Перешли по ссылке: ${s.clicked}`,
    `✅ Зарегистрировались: ${s.registered}`,
    '',
    `📈 Игрок → блокировка: ${percent(s.blocked, s.total_players)}`,
    `📈 Блокировка → клик: ${percent(s.clicked, s.blocked)}`,
    `📈 Клик → регистрация: ${percent(s.registered, s.clicked)}`,
    `📈 Игрок → регистрация: ${percent(s.registered, s.total_players)}`
  ].join('\n');
}

async function segmentsText(env) {
  const rows = await env.DB.prepare(`
    SELECT
      CASE
        WHEN gate_after BETWEEN 15 AND 20 THEN '15–20'
        WHEN gate_after BETWEEN 21 AND 30 THEN '21–30'
        WHEN gate_after BETWEEN 31 AND 50 THEN '31–50'
        ELSE 'другое'
      END AS segment,
      COUNT(*) AS players,
      SUM(CASE WHEN blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
      SUM(CASE WHEN registered_at IS NOT NULL THEN 1 ELSE 0 END) AS registered
    FROM players
    GROUP BY segment
    ORDER BY segment
  `).all();

  const list = rows.results || [];

  if (!list.length) {
    return '📈 Сегменты\n\nПока нет данных.';
  }

  return [
    '📈 Сегменты по моменту блокировки',
    '',
    ...list.map(r => [
      `🎯 ${r.segment}`,
      `Игроков: ${r.players || 0}`,
      `Блок: ${r.blocked || 0}`,
      `Клик: ${r.clicked || 0}`,
      `Рега: ${r.registered || 0}`,
      `CR: ${percent(r.registered || 0, r.players || 0)}`
    ].join('\n'))
  ].join('\n\n');
}

async function findPlayerText(env, tgId) {
  const id = cleanId(tgId);

  if (!id) return 'Неверный Telegram ID. Пример:\n/find 123456789';

  const p = await env.DB.prepare(`
    SELECT *
    FROM players
    WHERE tg_id = ?
  `)
    .bind(id)
    .first();

  if (!p) return `Игрок ${id} не найден.`;

  const username = p.username ? `@${p.username}` : 'нет';
  const firstName = p.first_name || 'нет';

  return [
    '👤 Игрок',
    '',
    `ID: ${p.tg_id}`,
    `Username: ${username}`,
    `Имя: ${firstName}`,
    '',
    `Рекорд: ${p.max_score || 0}`,
    `Блокировка по счёту после: ${p.gate_after || '-'}`,
    `Блокировка после поражений: ${p.loss_gate_after || '-'}`,
    `Поражений: ${p.losses || 0}`,
    '',
    `Без ограничений: ${p.whitelist ? 'Да' : 'Нет'}`,
    `Дошёл до блокировки: ${p.blocked_at ? 'Да' : 'Нет'}`,
    `Перешёл по ссылке: ${p.clicked_at ? 'Да' : 'Нет'}`,
    `Зарегистрировался: ${p.registered_at ? 'Да' : 'Нет'}`
  ].join('\n');
}

async function pushUnregistered(env, chatId, baseUrl) {
  const rows = await env.DB.prepare(`
    SELECT tg_id, max_score
    FROM players
    WHERE blocked_at IS NOT NULL
      AND registered_at IS NULL
      AND (whitelist IS NULL OR whitelist = 0)
    ORDER BY blocked_at DESC
    LIMIT 1000
  `).all();

  const players = rows.results || [];
  let ok = 0;
  let fail = 0;

  await sendTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: `🔔 Начинаю дожим.\n\nИгроков к отправке: ${players.length}`
  });

  for (const p of players) {
    try {
      await sendTelegram(env, 'sendMessage', {
        chat_id: p.tg_id,
        text: [
          '🔥 Your record is saved!',
          '',
          `Your result: ${p.max_score || 0}`,
          '',
          'You were close to the top. Keep playing and get your bonus 👇'
        ].join('\n'),
        reply_markup: {
          inline_keyboard: [[
            { text: '🎮 Continue game', web_app: { url: baseUrl + '/' } }
          ]]
        }
      });

      ok++;
      await new Promise(resolve => setTimeout(resolve, 40));
    } catch {
      fail++;
    }
  }

  await sendTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: `✅ Дожим завершён.\n\nОтправлено: ${ok}\nОшибок: ${fail}`
  });
}

async function botWebhook(request, env) {
  const url = new URL(request.url);
  const secret = url.pathname.split('/').pop();

  if (env.BOT_WEBHOOK_SECRET && secret !== env.BOT_WEBHOOK_SECRET) {
    return text('forbidden', 403);
  }

  const update = await request.json().catch(() => ({}));
  const msg = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from;

  if (!msg || !from) return text('ok');

  const chatId = msg.chat.id;
  const isAdmin = adminIds(env).includes(String(from.id));
  const baseUrl = getBaseUrl(request, env);

  if (update.callback_query) {
    await sendTelegram(env, 'answerCallbackQuery', {
      callback_query_id: update.callback_query.id
    });

    if (!isAdmin) return text('ok');

    const data = update.callback_query.data;

    if (data === 'admin_push_unregistered') {
      await pushUnregistered(env, chatId, baseUrl);
      return text('ok');
    }

    if (data === 'admin_stats') {
      const s = await stats(env);
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: statsText(s),
        reply_markup: adminKeyboard()
      });
      return text('ok');
    }

    if (data === 'admin_players') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: '👥 Раздел игроков',
        reply_markup: playersKeyboard()
      });
      return text('ok');
    }

    if (data === 'players_last20') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await playersListText(env, 'last', 20),
        reply_markup: playersKeyboard()
      });
      return text('ok');
    }

    if (data === 'players_last100') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await playersListText(env, 'last', 100),
        reply_markup: playersKeyboard()
      });
      return text('ok');
    }

    if (data === 'players_clicked') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await playersListText(env, 'clicked', 100),
        reply_markup: playersKeyboard()
      });
      return text('ok');
    }

    if (data === 'players_registered') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await playersListText(env, 'registered', 100),
        reply_markup: playersKeyboard()
      });
      return text('ok');
    }

    if (data === 'players_whitelist') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await playersListText(env, 'whitelist', 100),
        reply_markup: playersKeyboard()
      });
      return text('ok');
    }

    if (data === 'players_top') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await topPlayersText(env),
        reply_markup: adminKeyboard()
      });
      return text('ok');
    }

    if (data === 'admin_funnel') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await funnelText(env),
        reply_markup: adminKeyboard()
      });
      return text('ok');
    }

    if (data === 'admin_segments') {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: await segmentsText(env),
        reply_markup: adminKeyboard()
      });
      return text('ok');
    }

    return text('ok');
  }

  const textMsg = String(update.message?.text || '').trim();

  if (textMsg.startsWith('/admin')) {
    if (!isAdmin) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Нет доступа.'
      });
      return text('ok');
    }

    const s = await stats(env);
    await sendTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: statsText(s),
      reply_markup: adminKeyboard()
    });
    return text('ok');
  }

  if (textMsg.startsWith('/find')) {
    if (!isAdmin) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Нет доступа.'
      });
      return text('ok');
    }

    const id = textMsg.split(/\s+/)[1];
    await sendTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: await findPlayerText(env, id)
    });
    return text('ok');
  }

  if (textMsg.startsWith('/free')) {
    if (!isAdmin) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Нет доступа.'
      });
      return text('ok');
    }

    const id = cleanId(textMsg.split(/\s+/)[1]);

    if (!id) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Пример: /free 123456789'
      });
      return text('ok');
    }

    const existing = await env.DB.prepare('SELECT tg_id FROM players WHERE tg_id = ?')
      .bind(id)
      .first();

    if (!existing) {
      await ensurePlayer(env, { tg_id: id });
    }

    await env.DB.prepare(`
      UPDATE players
      SET whitelist = 1,
          blocked_at = NULL,
          last_seen_at = ?
      WHERE tg_id = ?
    `)
      .bind(Date.now(), id)
      .run();

    await sendTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Игрок ${id} добавлен в белый список. Теперь окно регистрации не будет появляться.`
    });
    return text('ok');
  }

  if (textMsg.startsWith('/unfree')) {
    if (!isAdmin) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Нет доступа.'
      });
      return text('ok');
    }

    const id = cleanId(textMsg.split(/\s+/)[1]);

    if (!id) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Пример: /unfree 123456789'
      });
      return text('ok');
    }

    await env.DB.prepare(`
      UPDATE players
      SET whitelist = 0,
          last_seen_at = ?
      WHERE tg_id = ?
    `)
      .bind(Date.now(), id)
      .run();

    await sendTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Игрок ${id} убран из белого списка.`
    });
    return text('ok');
  }


  if (textMsg.startsWith('/reset')) {
    if (!isAdmin) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Нет доступа.'
      });
      return text('ok');
    }

    const id = cleanId(textMsg.split(/\s+/)[1]);

    if (!id) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Пример: /reset 123456789'
      });
      return text('ok');
    }

    const existing = await env.DB.prepare(`
      SELECT tg_id
      FROM players
      WHERE tg_id = ?
    `)
      .bind(id)
      .first();

    if (!existing) {
      await sendTelegram(env, 'sendMessage', {
        chat_id: chatId,
        text: `Игрок ${id} не найден.`
      });
      return text('ok');
    }

    const gateAfter = randomGate();
    const lossGateAfter = randomLossGate();

    await env.DB.prepare(`
      UPDATE players
      SET blocked_at = NULL,
          losses = 0,
          gate_after = ?,
          loss_gate_after = ?,
          last_seen_at = ?
      WHERE tg_id = ?
    `)
      .bind(gateAfter, lossGateAfter, Date.now(), id)
      .run();

    await sendTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: [
        '♻️ Игрок сброшен',
        '',
        `ID: ${id}`,
        `Новая блокировка по счёту отключена`,
        `Новая блокировка после поражений: ${lossGateAfter}`,
        '',
        'Игрок сможет снова сыграть до окна регистрации.'
      ].join('\n')
    });

    return text('ok');
  }

  if (textMsg.startsWith('/start')) {
    await ensurePlayer(env, {
      tg_id: from.id,
      first_name: from.first_name,
      username: from.username
    });
  }

  await sendTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: 'Launch the game using the button below 👇',
    reply_markup: {
      inline_keyboard: [[
        { text: '🎮 Play', web_app: { url: baseUrl + '/' } }
      ]]
    }
  });

  return text('ok');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/player/init') return playerInit(request, env);
      if (url.pathname === '/api/player/jump' && request.method === 'POST') return playerJump(request, env);
      if (url.pathname === '/api/player/loss' && request.method === 'POST') return playerLoss(request, env);
      if (url.pathname === '/go') return go(request, env);
      if (url.pathname === '/api/1win-postback' || url.pathname === '/postback') return registrationPostback(request, env);
      if (url.pathname.startsWith('/bot/')) return botWebhook(request, env);

      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: e.message || 'server_error' }, 500);
    }
  }
};
