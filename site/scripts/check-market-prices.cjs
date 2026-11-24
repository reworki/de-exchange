const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pricing = fs.readFileSync(path.join(root, 'market-pricing.js'), 'utf8');
function code(pattern) {
  const match = page.match(pattern);
  assert.ok(match, 'Could not find ' + pattern);
  return match[0];
}

const arrays = ['MODEL_LIST','AURA_LIST','CASES','EVENT_AURAS','MK_SELLERS','NUMBER_ITEMS']
  .map(name => code(new RegExp('^var ' + name + ' = \\[[\\s\\S]*?\\];','m')));
const functions = ['weighted','poolFor','rollAura','rollDrop','dxGenLots','dxCraftResult']
  .map(name => code(new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}','m')));
const tuning = ['addModels','addAuras','tuneCases']
  .map(name => code(new RegExp('^\\(function ' + name + '\\(\\) \\{[\\s\\S]*?\\n\\}\\)\\(\\);','m')));
const setup = [
  ...arrays,
  code(/^var AURA_ATTRS = .*;/m),
  code(/^var SLOT_MIN_AURA = .*;/m),
  'var MODEL_BY = {}; MODEL_LIST.forEach(m => MODEL_BY[m.id] = m);',
  'var AURA_BY = {}; AURA_LIST.forEach(a => AURA_BY[a.id] = a);',
  'var uid = () => "";',
  'var dxRnd = (lo,hi) => lo + Math.random() * (hi-lo);',
  'var dxPick = pool => pool[Math.floor(Math.random() * pool.length)];',
  ...functions, ...tuning
].join('\n');
const {MarketPricing, MODELS, AURAS, cases, slots, event, numbers, poolFor, dxGenLots, dxCraftResult, rollDrop} = vm.runInNewContext(
  pricing + '\n' + setup +
  '\n({ MarketPricing, MODELS:MODEL_LIST, AURAS:AURA_LIST, cases:CASES, slots:SLOT_MIN_AURA,' +
  ' event:EVENT_AURAS, numbers:NUMBER_ITEMS, poolFor, dxGenLots, dxCraftResult, rollDrop });'
);

const quote = MarketPricing.propertyQuote(1.2, 325000);
assert.equal(quote.usdt, 390000);
assert.equal(quote.fee, 11700);
assert.equal(quote.total, 401700);
assert.equal(MarketPricing.propertyQuote(140, 325000).total, 46865000);
assert.equal(MarketPricing.propertyQuote(250, 325000).total, 83687500);
assert.equal(MarketPricing.propertyQuote(320, 325000).total, 107120000);
for (const invalid of [NaN, Infinity, -1, 0]) {
  assert.equal(MarketPricing.propertyQuote(1.2, invalid), null);
  assert.equal(MarketPricing.propertyQuote(invalid, 325000), null);
  assert.equal(MarketPricing.canSpend(100, invalid), false);
}
assert.equal(MarketPricing.propertyQuote(Number.MAX_VALUE, 325000), null);

assert.equal(new Set(numbers.map(n => n.num)).size, numbers.length);
const prices = numbers.map(n => n.price / 100000);
assert.equal(Math.min(...prices), 20);
assert.equal(Math.max(...prices), 300);
assert.ok(MODELS.every(model => MarketPricing.positive(MarketPricing.base(model))));
assert.ok(event.every(aura => poolFor('common').every(model =>
  MarketPricing.positive(MarketPricing.value(model, aura.id)) &&
  MarketPricing.value(model, aura.id) <= 0.009
)));

// Exact EV from the configured slot, edition and aura weights, including rollAura's fallback.
const totalAuraWeight = AURAS.reduce((sum, aura) => sum + aura.w, 0);
for (const item of cases) {
  const slotWeight = item.slots.reduce((sum, slot) => sum + slot[1], 0);
  const ev = item.slots.reduce((sum, [slot, weight]) => {
    const pool = poolFor(slot);
    const minTier = slots[slot] || 0;
    const eligible = AURAS.slice(minTier);
    const acceptedWeight = eligible.reduce((n,aura) => n + aura.w, 0);
    const fallbackChance = (1 - acceptedWeight / totalAuraWeight) ** 80;
    const fallback = AURAS[Math.max(minTier, 2)];
    const average = pool.reduce((n,model) => {
      const auraEv = eligible.reduce((value,aura) =>
        value + MarketPricing.value(model, aura.id) * aura.w / acceptedWeight, 0);
      return n + auraEv * (1 - fallbackChance) + MarketPricing.value(model, fallback.id) * fallbackChance;
    }, 0) / pool.length;
    return sum + average * weight / slotWeight;
  }, 0);
  assert.ok(ev / item.price > 0.70 && ev / item.price < 0.77, item.id + ': expected payout outside agreed band');
  const drop = rollDrop(item);
  assert.equal(drop.priceVersion, 2);
  assert.ok(MarketPricing.positive(drop.value));
  console.log(item.id + ': ' + item.price + ' KNT, expected buyback ' + ev.toFixed(6) + ' KNT');
}

const lots = dxGenLots(256);
assert.ok(lots.every(lot => lot.priceVersion === 2 && lot.price > lot.value));
assert.ok(lots.every(lot => lot.price >= MarketPricing.round(lot.value * 1.15) &&
  lot.price <= MarketPricing.round(lot.value * 1.65)));
for (const input of [0.004,0.009,0.07,0.3,1.4]) {
  const crafted = dxCraftResult(input);
  assert.ok(crafted.priceVersion === 2 && MarketPricing.positive(crafted.value) && crafted.value <= input);
}
assert.equal(dxCraftResult(0), null);
console.log('Validated quote, catalogue numbers, case EV, event drops, NPC prices and crafting.');

