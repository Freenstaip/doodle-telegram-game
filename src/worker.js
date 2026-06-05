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
  return new Response(data, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function randomGate() {
  return 50 + Math.floor(Math.random() * 101); // 50..150 inclusive
}

function cleanId(value) {
  const id = String(value || '').trim();
  return /^[0-9]{3,32}$/.test(id) ? id : '';
}

function adminIds(env) {
  return String(env.ADMIN_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
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

  const existing = await env.DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(tgId).first();
  if (existing) {
    await env.DB.prepare(`UPDATE players SET first_name = COALESCE(?, first_name), username = COALESCE(?, username), last_seen_at = ? WHERE tg_id = ?`)
      .bind(data.first_name || null, data.username || null, now, tgId).run();
    return { ...existing, first_name: data.first_name || existing.first_name, username: data.username || existing.username, last_seen_at: now };
  }

  const gateAfter = randomGate();
  await env.DB.prepare(`INSERT INTO players (tg_id, first_name, username, created_at, last_seen_at, gate_after) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(tgId, data.first_name || null, data.username || null, now, now, gateAfter).run();
  return { tg_id: tgId, first_name: data.first_name || null, username: data.username || null, created_at: now, last_seen_at: now, gate_after: gateAfter, max_score: 0, blocked_at: null, clicked_at: null, registered_at: null };
}

function publicPlayer(row) {
  const registered = Boolean(row.registered_at);
  const blocked = registered || Boolean(row.blocked_at);
  return {
    tg_id: row.tg_id,
    gate_after: row.gate_after,
    max_score: row.max_score || 0,
    clicked: Boolean(row.clicked_at),
    registered,
    blocked,
    continue_on_site: registered
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

  let p = await env.DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(tgId).first();
  if (!p) p = await ensurePlayer(env, { tg_id: tgId });

  const now = Date.now();
  const shouldBlock = score >= p.gate_after && !p.registered_at;
  await env.DB.prepare(`UPDATE players SET max_score = MAX(max_score, ?), last_seen_at = ?, blocked_at = CASE WHEN ? THEN COALESCE(blocked_at, ?) ELSE blocked_at END WHERE tg_id = ?`)
    .bind(score, now, shouldBlock ? 1 : 0, now, tgId).run();

  p = await env.DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(tgId).first();
  return json(publicPlayer(p));
}

async function go(request, env) {
  const url = new URL(request.url);
  const tgId = cleanId(url.searchParams.get('tg_id') || url.searchParams.get('sub1'));
  if (tgId) {
    const now = Date.now();
    await env.DB.prepare('UPDATE players SET clicked_at = COALESCE(clicked_at, ?), last_seen_at = ? WHERE tg_id = ?')
      .bind(now, now, tgId).run();
  }
  return Response.redirect(buildOfferUrl(env, tgId || 'unknown'), 302);
}

async function registrationPostback(request, env) {
  const url = new URL(request.url);
  const body = request.method === 'POST' ? await request.text().catch(() => '') : '';
  const params = new URLSearchParams(url.search);
  if (body) {
    try {
      const obj = JSON.parse(body);
      for (const [k, v] of Object.entries(obj)) params.set(k, String(v));
    } catch {
      new URLSearchParams(body).forEach((v, k) => params.set(k, v));
    }
  }

  const secret = params.get('secret');
  if (env.POSTBACK_SECRET && secret !== env.POSTBACK_SECRET) return text('forbidden', 403);

  const tgId = cleanId(params.get('tg_id') || params.get('user_id') || params.get('sub1') || params.get('subid') || params.get('click_id'));
  if (!tgId) return text('missing tg_id/subid', 400);

  const now = Date.now();
  const payload = JSON.stringify(Object.fromEntries(params.entries())).slice(0, 4000);
  let p = await env.DB.prepare('SELECT tg_id FROM players WHERE tg_id = ?').bind(tgId).first();
  if (!p) await ensurePlayer(env, { tg_id: tgId });
  await env.DB.prepare('UPDATE players SET registered_at = COALESCE(registered_at, ?), registration_payload = COALESCE(registration_payload, ?), last_seen_at = ? WHERE tg_id = ?')
    .bind(now, payload, now, tgId).run();
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
      SUM(CASE WHEN blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS blocked
    FROM players
  `).bind(now - DAY_MS).first();
  return {
    total_players: row.total_players || 0,
    new_24h: row.new_24h || 0,
    clicked: row.clicked || 0,
    registered: row.registered || 0,
    blocked: row.blocked || 0
  };
}

async function sendTelegram(env, method, payload) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function statsText(s) {
  const cr = s.clicked ? ((s.registered / s.clicked) * 100).toFixed(1) : '0.0';
  return [
    '📊 Статистика игры',
    '',
    `Новых игроков за 24ч: ${s.new_24h}`,
    `Всего игроков: ${s.total_players}`,
    `Перешли по ссылке: ${s.clicked}`,
    `Зарегистрировались: ${s.registered}`,
    `Дошли до блокировки: ${s.blocked}`,
    `CR регистраций от переходов: ${cr}%`,
    '',
    'Учёт: 1 Telegram ID = 1 игрок.'
  ].join('\n');
}

async function botWebhook(request, env) {
  const url = new URL(request.url);
  const secret = url.pathname.split('/').pop();
  if (env.BOT_WEBHOOK_SECRET && secret !== env.BOT_WEBHOOK_SECRET) return text('forbidden', 403);

  const update = await request.json().catch(() => ({}));
  const msg = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from;
  if (!msg || !from) return text('ok');

  const chatId = msg.chat.id;
  const isAdmin = adminIds(env).includes(String(from.id));
  const baseUrl = getBaseUrl(request, env);

  if (update.callback_query) {
    await sendTelegram(env, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
    if (update.callback_query.data === 'admin_stats' && isAdmin) {
      const s = await stats(env);
      await sendTelegram(env, 'editMessageText', {
        chat_id: chatId,
        message_id: msg.message_id,
        text: statsText(s),
        reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'admin_stats' }]] }
      });
    }
    return text('ok');
  }

  const textMsg = String(update.message?.text || '');
  if (textMsg.startsWith('/admin')) {
    if (!isAdmin) {
      await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Нет доступа.' });
      return text('ok');
    }
    const s = await stats(env);
    await sendTelegram(env, 'sendMessage', {
      chat_id: chatId,
      text: statsText(s),
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'admin_stats' }]] }
    });
    return text('ok');
  }

  await sendTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: 'Запусти игру кнопкой ниже 👇',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: baseUrl + '/' } }]] }
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
      if (url.pathname === '/go') return go(request, env);
      if (url.pathname === '/api/1win-postback') return registrationPostback(request, env);
      if (url.pathname.startsWith('/bot/')) return botWebhook(request, env);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: e.message || 'server_error' }, 500);
    }
  }
};
