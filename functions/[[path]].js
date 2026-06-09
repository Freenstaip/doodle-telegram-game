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

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomGate() { return 50 + Math.floor(Math.random() * 101); }
function cleanId(value) { const id = String(value || '').trim(); return /^[0-9]{3,32}$/.test(id) ? id : ''; }
function adminIds(env) { return String(env.ADMIN_IDS || env.ADMIN_ID || '').split(',').map(v => v.trim()).filter(Boolean); }
function isAdmin(env, id) { return adminIds(env).includes(String(id)); }
function getBaseUrl(request, env) { return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, ''); }

function buildOfferUrl(env, tgId) {
  const template = env.OFFER_URL || env.ONEWIN_LINK || 'https://1win.example/?sub1={user_id}';
  if (template.includes('{user_id}')) return template.replaceAll('{user_id}', encodeURIComponent(tgId));
  const url = new URL(template);
  url.searchParams.set(env.OFFER_SUBID_PARAM || 'sub1', tgId);
  return url.toString();
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
  if (!res.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} error`);
  return data;
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
  return { tg_id: row.tg_id, gate_after: row.gate_after, max_score: row.max_score || 0, clicked: Boolean(row.clicked_at), registered, blocked, continue_on_site: registered };
}

async function playerInit(request, env) {
  const url = new URL(request.url);
  const p = await ensurePlayer(env, { tg_id: url.searchParams.get('tg_id'), first_name: url.searchParams.get('first_name'), username: url.searchParams.get('username') });
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
    await env.DB.prepare('UPDATE players SET clicked_at = COALESCE(clicked_at, ?), last_seen_at = ? WHERE tg_id = ?').bind(now, now, tgId).run();
  }
  return Response.redirect(buildOfferUrl(env, tgId || 'unknown'), 302);
}

async function registrationPostback(request, env) {
  const url = new URL(request.url);
  const body = request.method === 'POST' ? await request.text().catch(() => '') : '';
  const params = new URLSearchParams(url.search);
  if (body) {
    try { Object.entries(JSON.parse(body)).forEach(([k, v]) => params.set(k, String(v))); }
    catch { new URLSearchParams(body).forEach((v, k) => params.set(k, v)); }
  }
  if (env.POSTBACK_SECRET && params.get('secret') !== env.POSTBACK_SECRET) return text('forbidden', 403);
  const tgId = cleanId(params.get('tg_id') || params.get('user_id') || params.get('sub1') || params.get('subid') || params.get('click_id'));
  if (!tgId) return text('missing tg_id/subid', 400);
  const now = Date.now();
  const payload = JSON.stringify(Object.fromEntries(params.entries())).slice(0, 4000);
  if (!(await env.DB.prepare('SELECT tg_id FROM players WHERE tg_id = ?').bind(tgId).first())) await ensurePlayer(env, { tg_id: tgId });
  await env.DB.prepare('UPDATE players SET registered_at = COALESCE(registered_at, ?), registration_payload = COALESCE(registration_payload, ?), last_seen_at = ? WHERE tg_id = ?')
    .bind(now, payload, now, tgId).run();
  return text('ok');
}

async function stats(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total_players, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked, SUM(CASE WHEN registered_at IS NOT NULL THEN 1 ELSE 0 END) AS registered, SUM(CASE WHEN blocked_at IS NOT NULL THEN 1 ELSE 0 END) AS blocked FROM players`).bind(Date.now() - DAY_MS).first();
  return { total_players: row.total_players || 0, new_24h: row.new_24h || 0, clicked: row.clicked || 0, registered: row.registered || 0, blocked: row.blocked || 0 };
}

function statsText(s) {
  const cr = s.clicked ? ((s.registered / s.clicked) * 100).toFixed(1) : '0.0';
  return ['📊 Статистика игры', '', `🆕 Новых игроков за 24ч: ${s.new_24h}`, `👥 Всего игроков: ${s.total_players}`, `🔗 Перешли по ссылке: ${s.clicked}`, `✅ Зарегистрировались: ${s.registered}`, `🚧 Дошли до блокировки: ${s.blocked}`, `📈 CR от переходов: ${cr}%`, '', 'Учёт: 1 Telegram ID = 1 игрок.'].join('\n');
}

function adminMenuKeyboard() {
  return { inline_keyboard: [[{ text: '📊 Статистика', callback_data: 'admin_stats' }], [{ text: '📣 Рассылка', callback_data: 'bcast_new' }]] };
}

async function getAdminState(env, adminId) {
  return await env.DB.prepare('SELECT * FROM admin_states WHERE admin_id = ?').bind(String(adminId)).first();
}
async function setAdminState(env, adminId, step, data = {}) {
  await env.DB.prepare('INSERT OR REPLACE INTO admin_states (admin_id, step, data, updated_at) VALUES (?, ?, ?, ?)')
    .bind(String(adminId), step, JSON.stringify(data), Date.now()).run();
}
async function clearAdminState(env, adminId) { await env.DB.prepare('DELETE FROM admin_states WHERE admin_id = ?').bind(String(adminId)).run(); }
function parseState(row) { try { return row ? JSON.parse(row.data || '{}') : {}; } catch { return {}; } }

async function showAdminMenu(env, chatId) {
  await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Админ-панель:', reply_markup: adminMenuKeyboard() });
}

async function startBroadcast(env, chatId, adminId) {
  await setAdminState(env, adminId, 'await_photo', {});
  await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: '📣 Рассылка\n\nШаг 1/4: отправь фото для рассылки.' });
}

async function sendBroadcastPreview(env, chatId, adminId, data) {
  await setAdminState(env, adminId, 'confirm', data);
  await sendTelegram(env, 'sendPhoto', {
    chat_id: chatId,
    photo: data.photo_file_id,
    caption: data.text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: data.button_text, url: data.button_url }],
        [{ text: '✅ Отправить всем', callback_data: 'bcast_send' }, { text: '❌ Отмена', callback_data: 'bcast_cancel' }]
      ]
    }
  });
}

async function handleBroadcastInput(env, msg, from, stateRow) {
  const chatId = msg.chat.id;
  const data = parseState(stateRow);
  const step = stateRow.step;

  if (step === 'await_photo') {
    const photos = msg.photo || [];
    if (!photos.length) { await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Нужно отправить именно фото.' }); return true; }
    data.photo_file_id = photos[photos.length - 1].file_id;
    await setAdminState(env, from.id, 'await_text', data);
    await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Шаг 2/4: теперь отправь текст рассылки.' });
    return true;
  }

  const msgText = String(msg.text || '').trim();
  if (step === 'await_text') {
    if (!msgText) { await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Отправь текст одним сообщением.' }); return true; }
    data.text = msgText.slice(0, 1024);
    await setAdminState(env, from.id, 'await_button_text', data);
    await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Шаг 3/4: отправь текст кнопки. Например: Играть' });
    return true;
  }
  if (step === 'await_button_text') {
    if (!msgText) { await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Отправь текст кнопки.' }); return true; }
    data.button_text = msgText.slice(0, 64);
    await setAdminState(env, from.id, 'await_button_url', data);
    await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Шаг 4/4: отправь ссылку для кнопки. Например ссылку на игру или сайт.' });
    return true;
  }
  if (step === 'await_button_url') {
    try { new URL(msgText); } catch { await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Нужна корректная ссылка, начиная с https://'}); return true; }
    data.button_url = msgText;
    await sendBroadcastPreview(env, chatId, from.id, data);
    return true;
  }
  return false;
}

async function runBroadcast(env, chatId, adminId) {
  const state = await getAdminState(env, adminId);
  const data = parseState(state);
  if (!state || state.step !== 'confirm' || !data.photo_file_id || !data.text || !data.button_text || !data.button_url) {
    await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Рассылка не готова. Нажми «Рассылка» и создай её заново.' });
    return;
  }
  await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Начинаю рассылку...' });
  const rows = await env.DB.prepare('SELECT tg_id FROM players ORDER BY created_at DESC LIMIT 5000').all();
  let ok = 0, fail = 0;
  for (const row of rows.results || []) {
    try {
      await sendTelegram(env, 'sendPhoto', {
        chat_id: row.tg_id,
        photo: data.photo_file_id,
        caption: data.text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: data.button_text, url: data.button_url }]] }
      });
      ok++;
      await sleep(35);
    } catch { fail++; }
  }
  await clearAdminState(env, adminId);
  await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: `Готово.\n\n✅ Отправлено: ${ok}\n❌ Ошибок: ${fail}` });
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
  const admin = isAdmin(env, from.id);
  const baseUrl = getBaseUrl(request, env);

  if (update.callback_query) {
    await sendTelegram(env, 'answerCallbackQuery', { callback_query_id: update.callback_query.id });
    const data = update.callback_query.data;
    if (!admin) return text('ok');
    if (data === 'admin_stats') {
      const s = await stats(env);
      await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: statsText(s), reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'admin_stats' }], [{ text: '📣 Рассылка', callback_data: 'bcast_new' }]] } });
    } else if (data === 'bcast_new') {
      await startBroadcast(env, chatId, from.id);
    } else if (data === 'bcast_cancel') {
      await clearAdminState(env, from.id);
      await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Рассылка отменена.', reply_markup: adminMenuKeyboard() });
    } else if (data === 'bcast_send') {
      await runBroadcast(env, chatId, from.id);
    }
    return text('ok');
  }

  const msgText = String(update.message?.text || '').trim();
  if (admin && msgText === '/cancel') { await clearAdminState(env, from.id); await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Действие отменено.' }); return text('ok'); }
  if (msgText.startsWith('/admin')) {
    if (!admin) { await sendTelegram(env, 'sendMessage', { chat_id: chatId, text: 'Нет доступа.' }); return text('ok'); }
    await showAdminMenu(env, chatId);
    return text('ok');
  }
  if (admin) {
    const state = await getAdminState(env, from.id);
    if (state && await handleBroadcastInput(env, update.message, from, state)) return text('ok');
  }

  if (msgText.startsWith('/start')) await ensurePlayer(env, { tg_id: from.id, first_name: from.first_name, username: from.username });
  await sendTelegram(env, 'sendMessage', {
    chat_id: chatId,
    text: 'Launch the game using the button below 👇',
    reply_markup: { inline_keyboard: [[{ text: '🎮 Play', web_app: { url: baseUrl + '/' } }]] }
  });
  return text('ok');
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return json({ ok: true });
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/player/init') return playerInit(request, env);
    if (url.pathname === '/api/player/jump' && request.method === 'POST') return playerJump(request, env);
    if (url.pathname === '/go') return go(request, env);
    if (url.pathname === '/postback' || url.pathname === '/api/1win-postback') return registrationPostback(request, env);
    if (url.pathname.startsWith('/bot/')) return botWebhook(request, env);
    return new Response('Not found', { status: 404 });
  } catch (e) {
    return json({ error: e.message || 'server_error' }, 500);
  }
}
