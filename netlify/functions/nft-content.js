/* ============================================================================
   DE — контент NFT: 3 коллекции по 4 предмета и 3 кейса под них.
   Серверные данные (ESM). Клиентское зеркало с артом:
   assets/nft-content.js → window.DX_NFT_EXTRA.
   ============================================================================ */

export const NFT_MODELS = [
  /* --- Крипто-зверинец: тёплый зелёный с золотом --- */
  {
    id: 'frog_boss', name: 'Frog Boss', ru: 'Жаба-миллионер',
    base: 7200, rar: 'common', collection: 'crypto_zoo'
  },
  {
    id: 'penguin_trader', name: 'Penguin Trader', ru: 'Пингвин-биржевик',
    base: 26000, rar: 'rare', collection: 'crypto_zoo'
  },
  {
    id: 'bull_hodler', name: 'Bull Hodler', ru: 'Бык-ходлер',
    base: 74000, rar: 'epic', collection: 'crypto_zoo'
  },
  {
    id: 'whale_tycoon', name: 'Whale Tycoon', ru: 'Кит-олигарх',
    base: 210000, rar: 'legendary', collection: 'crypto_zoo'
  },

  /* --- Бытовуха миллиардера: белый мрамор и золото --- */
  {
    id: 'gold_mug', name: 'Gold Mug', ru: 'Золотая кружка',
    base: 4800, rar: 'common', collection: 'billionaire_basics'
  },
  {
    id: 'diamond_slippers', name: 'Diamond Slippers', ru: 'Тапки с бриллиантами',
    base: 22000, rar: 'rare', collection: 'billionaire_basics'
  },
  {
    id: 'heli_remote', name: 'Heli Remote', ru: 'Пульт от вертолёта',
    base: 66000, rar: 'epic', collection: 'billionaire_basics'
  },
  {
    id: 'champagne_tub', name: 'Champagne Tub', ru: 'Ванна с шампанским',
    base: 185000, rar: 'legendary', collection: 'billionaire_basics'
  },

  /* --- Реворкия: империя — багровый с золотом --- */
  {
    id: 'imperial_seal', name: 'Imperial Seal', ru: 'Имперская печать',
    base: 8400, rar: 'common', collection: 'reworkia_empire'
  },
  {
    id: 'treasury_key', name: 'Treasury Key', ru: 'Ключ от казны',
    base: 33000, rar: 'rare', collection: 'reworkia_empire'
  },
  {
    id: 'order_of_reworkia', name: 'Order of Reworkia', ru: 'Орден Реворкии',
    base: 81000, rar: 'epic', collection: 'reworkia_empire'
  },
  {
    id: 'reworkia_crown', name: 'Crown of Reworkia', ru: 'Корона Реворкии',
    base: 240000, rar: 'legendary', collection: 'reworkia_empire'
  }
];

export const NFT_CASES = [
  {
    id: 'zoo_case', ru: 'Кейс зверинца', en: 'Zoo Case',
    priceKnt: 0.02, collection: 'crypto_zoo',
    slots: [['common', 50], ['rare', 32], ['epic', 15], ['legendary', 3]]
  },
  {
    id: 'luxe_case', ru: 'Кейс бытовухи', en: 'Luxe Case',
    priceKnt: 0.05, collection: 'billionaire_basics',
    slots: [['common', 28], ['rare', 40], ['epic', 27], ['legendary', 5]]
  },
  {
    id: 'empire_case', ru: 'Имперский кейс', en: 'Imperial Case',
    priceKnt: 0.12, collection: 'reworkia_empire',
    slots: [['common', 15], ['rare', 40], ['epic', 35], ['legendary', 10]]
  }
];

export const COLLECTIONS = [
  {
    id: 'crypto_zoo', ru: 'Крипто-зверинец', en: 'Crypto Zoo', color: '#7ec850',
    story: 'Зверинец, переживший три медвежьих рынка и одного медведя. Каждый маскот здесь стоит дороже, чем его создатель планировал, а жаба по-прежнему держит твой первый депозит.'
  },
  {
    id: 'billionaire_basics', ru: 'Бытовуха миллиардера', en: 'Billionaire Basics', color: '#e8c979',
    story: 'Никакой роскоши — только необходимое: золотая кружка, тапки с бриллиантами и пульт, который поднимает вертолёт. Остальное докупим на выходных.'
  },
  {
    id: 'reworkia_empire', ru: 'Реворкия: империя', en: 'Reworkia: The Empire', color: '#b3122f',
    story: 'Империя начинается с печати, держится на ключе от казны и заканчивается короной. Между этими четырьмя предметами — вся вертикаль власти Реворкии, от сейфа до трона.'
  }
];
