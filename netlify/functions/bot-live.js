/* ============================================================================
   DE — «ПРЯМОЙ ЭФИР» БИРЖИ: крон раз в минуту.

   Функция намеренно крошечная: вся логика лежит в runLive (bots-tick.js),
   здесь только вызов и ответ. Расписание — netlify.toml:
     [functions."bot-live"]
       schedule = "* * * * *"

   Внутри runLive свой замок на 4 секунды и слот выбора в 5 секунд, поэтому
   частые вызовы (крон плюс браузер игрока через /api/bots/live) ничего не
   ломают: лишний вызов просто вернёт { ok: true, skipped: 'lock' }.
   ============================================================================ */

import { runLive } from './bots-tick.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  ...CORS
};

export default async () => {
  try {
    const r = await runLive(Date.now());
    return new Response(JSON.stringify(r), { status: 200, headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, err: String(e && e.message) }), {
      status: 200,
      headers: HEADERS
    });
  }
};
