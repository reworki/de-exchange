#!/usr/bin/env node
/* ============================================================================
   DE — локальный помощник по ботам.
   Секретов в коде нет: ключ берётся только из окружения BOTS_KEY.

   Запуск (PowerShell):
     $env:BOTS_KEY = "ключ"          # или $env:DE_NICK / $env:DE_PASS
     node tools/seed-bots.mjs seed
     node tools/seed-bots.mjs tick
     node tools/seed-bots.mjs stats

   Переменные окружения:
     BOTS_KEY          — ключ доступа (как в настройках Netlify)
     DE_NICK + DE_PASS — вход владельцем вместо ключа
     DE_BASE           — адрес сайта, по умолчанию https://de-exchange.netlify.app

   Флаги:
     --force           — seed: пересоздать ботов; tick: обойти замок и слот
     --json            — только тело ответа, без подписи
   ============================================================================ */

const BASE = String(process.env.DE_BASE || 'https://de-exchange.netlify.app').replace(/\/+$/, '');
const KEY = String(process.env.BOTS_KEY || '');
const NICK = String(process.env.DE_NICK || '');
const PASS = String(process.env.DE_PASS || '');

const argv = process.argv.slice(2);
const action = (argv.find(function (a) { return a.charAt(0) !== '-'; }) || 'seed').toLowerCase();
const force = argv.indexOf('--force') >= 0;
const raw = argv.indexOf('--json') >= 0;

const auth = {};
if (KEY) auth.key = KEY;
if (NICK) { auth.nick = NICK; auth.pass = PASS; }

function die(msg) {
  console.error(msg);
  process.exit(2);
}

if (!KEY && !NICK) {
  die('Нет доступа: задай BOTS_KEY (или DE_NICK + DE_PASS) в окружении. Ключ в коде не хранится.');
}

async function call(path, payload) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 4000) }; }
  return { status: res.status, data: data };
}

async function callGet(path, query) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(BASE + path + (qs ? '?' + qs : ''), { method: 'GET' });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 4000) }; }
  return { status: res.status, data: data };
}

function show(label, r) {
  if (!raw) console.log('→ ' + r.status + ' ' + label + '  (' + BASE + ')');
  console.log(JSON.stringify(r.data, null, 2));
  if (!r.data || r.data.ok !== true) process.exitCode = 1;
}

async function main() {
  if (action === 'seed' || action === 'create') {
    const payload = Object.assign({}, auth);
    if (force) payload.force = true;
    show('POST /api/bots/seed', await call('/api/bots/seed', payload));
    return;
  }

  if (action === 'tick' || action === 'run') {
    const payload = Object.assign({}, auth);
    if (force) payload.force = true;
    show('POST /api/bots/tick', await call('/api/bots/tick', payload));
    return;
  }

  if (action === 'stats' || action === 'status') {
    const q = {};
    if (auth.key) q.key = auth.key;
    if (auth.nick) { q.nick = auth.nick; q.pass = auth.pass; }
    show('GET /api/bots/stats', await callGet('/api/bots/stats', q));
    return;
  }

  die('Не знаю команду «' + action + '». Есть: seed, tick, stats.');
}

main().catch(function (e) {
  console.error('Ошибка запроса: ' + String((e && e.message) || e));
  process.exit(1);
});
