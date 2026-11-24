/* Market 2.6. Monetary values in this module are in KNT unless marked otherwise. */
'use strict';
const MarketPricing = (() => {
  const multipliers = Object.freeze({
    none: 1, common: 1, uncommon: 1.25, rare: 1.75,
    epic: 2.5, legendary: 4, mythic: 6, divine: 8,
    evpumpkin: 0.25, evweb: 0.35, evbat: 0.45, evcandle: 0.55,
    evghost: 0.65, evskull: 0.8, evknot: 1
  });
  const positive = n => Number.isFinite(n) && n > 0;
  const balance = n => Number.isFinite(n) && n >= 0;
  const canSpend = (amount, price) => balance(amount) && positive(price) && amount >= price;
  const canCredit = (amount, price) => balance(amount) && positive(price) && balance(amount + price);
  const round = n => Math.round(n * 1e6) / 1e6;
  const base = model => model.base / 1e6;
  const value = (model, aura) => round(base(model) * multipliers[aura]);
  function propertyQuote(price, rate) {
    if (!positive(price) || !positive(rate)) return null;
    const usdt = Math.round(price * rate * 100) / 100;
    const fee = Math.round(usdt * 3) / 100;
    const total = Math.round((usdt + fee) * 100) / 100;
    return positive(total) && positive(usdt) ? { usdt, fee, total } : null;
  }
  function equivalent(knt, rate) {
    if (!balance(knt) || !positive(rate) || !balance(knt * rate)) return null;
    return knt * rate;
  }
  return Object.freeze({ positive, balance, canSpend, canCredit, round, base, value, multipliers, propertyQuote, equivalent });
})();
