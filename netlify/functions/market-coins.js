/* ============================================================================
   DE Exchange — единый справочник монет рынка.

   Один каталог на всю игру: его читают и сервер, и клиент.
     • social.js    — капитал профиля и рейтинга;
     • api.js       — капитал ботов в /api/bots/stats;
     • bot-brain.js — список торгуемых символов и базовые цены;
     • bots-tick.js — PRICES для ctx (тик) и прямого эфира.

   Поля записи:
     key   — тикер (он же ключ в state.ex.amounts и в картах цен);
     sym   — тот же тикер явно: модулям удобно читать одно поле;
     name  — человеческое название для интерфейса;
     price — цена в USD;
     amt   — стартовое количество у владельца;
     drift — суточный дрейф для клиентского графика (0.0004..0.0012),
             разный у разных монет. Сервер его пока не использует: торговля
             ботов живёт по price, но каталог должен быть полным.

   Файл чистый: ни сети, ни БД, ни импортов — его можно читать откуда угодно.
   DEX — собственный токен биржи: в серверных расчётах это обычная монета,
   а на клиенте игроки платят им комиссии.
   ============================================================================ */

export const MARKET_COINS = [
  /* тикер   название              цена USD       amt            drift   */
  { key: 'BNB', sym: 'BNB', name: 'BNB', price: 583, amt: 1200, drift: 0.0007 },
  { key: 'XRP', sym: 'XRP', name: 'XRP', price: 0.97, amt: 500000, drift: 0.0008 },
  { key: 'DOGE', sym: 'DOGE', name: 'Dogecoin', price: 0.059, amt: 8000000, drift: 0.0011 },
  { key: 'ADA', sym: 'ADA', name: 'Cardano', price: 0.15, amt: 2000000, drift: 0.0009 },
  { key: 'AVAX', sym: 'AVAX', name: 'Avalanche', price: 7.00, amt: 30000, drift: 0.0010 },
  { key: 'LINK', sym: 'LINK', name: 'Chainlink', price: 9.10, amt: 60000, drift: 0.0008 },
  { key: 'TRX', sym: 'TRX', name: 'TRON', price: 0.31, amt: 2000000, drift: 0.0006 },
  { key: 'SUI', sym: 'SUI', name: 'Sui', price: 0.72, amt: 300000, drift: 0.0010 },
  { key: 'XLM', sym: 'XLM', name: 'Stellar', price: 0.137, amt: 1500000, drift: 0.0007 },
  { key: 'BCH', sym: 'BCH', name: 'Bitcoin Cash', price: 208, amt: 900, drift: 0.0009 },
  { key: 'UNI', sym: 'UNI', name: 'Uniswap', price: 4.95, amt: 40000, drift: 0.0009 },
  { key: 'DOT', sym: 'DOT', name: 'Polkadot', price: 0.72, amt: 200000, drift: 0.0008 },
  { key: 'HBAR', sym: 'HBAR', name: 'Hedera', price: 0.055, amt: 6000000, drift: 0.0006 },
  { key: 'NEAR', sym: 'NEAR', name: 'NEAR Protocol', price: 3.27, amt: 150000, drift: 0.0010 },
  { key: 'XMR', sym: 'XMR', name: 'Monero', price: 504, amt: 250, drift: 0.0005 },
  { key: 'ZEC', sym: 'ZEC', name: 'Zcash', price: 915, amt: 100, drift: 0.0011 },
  { key: 'HYPE', sym: 'HYPE', name: 'Hyperliquid', price: 66.90, amt: 1200, drift: 0.0012 },
  { key: 'PEPE', sym: 'PEPE', name: 'Pepe', price: 0.00000373, amt: 5000000000, drift: 0.0012 },
  { key: 'BONK', sym: 'BONK', name: 'Bonk', price: 0.00000235, amt: 10000000000, drift: 0.0011 },
  { key: 'FLOKI', sym: 'FLOKI', name: 'Floki', price: 0.00001779, amt: 2000000000, drift: 0.0010 },
  { key: 'USDC', sym: 'USDC', name: 'USD Coin', price: 1.00, amt: 1000000, drift: 0.0004 },
  { key: 'AAVE', sym: 'AAVE', name: 'Aave', price: 105, amt: 3000, drift: 0.0007 },
  { key: 'DEX', sym: 'DEX', name: 'DE Exchange Token', price: 1.00, amt: 5000000, drift: 0.0005 }
];

/* плоская карта тикер → цена: по ней считают капитал social.js, api.js,
   боты. Собирается из каталога, поэтому цена не может разойтись с ним. */
export const MARKET_PRICES = (function () {
  const out = {};
  for (let i = 0; i < MARKET_COINS.length; i++) {
    const c = MARKET_COINS[i];
    out[c.sym] = c.price;
  }
  return out;
})();

/* безопасная цена: строка → число, неизвестное → 0.
   Нужна там, где тикер приходит из данных игрока и может быть мусором:
   null, «xxx», «» и «__proto__» не должны ничего ломать. Старые монеты
   (KNT, BTC, …) в каталог не входят — их оценивает карта своего модуля. */
export function priceOf(sym) {
  if (sym === null || sym === undefined) return 0;
  const key = String(sym).trim().toUpperCase();
  if (!key) return 0;
  const p = MARKET_PRICES[key];
  return (typeof p === 'number' && isFinite(p) && p > 0) ? p : 0;
}
