/* ============================================================================
   DE — клиентский контент NFT: 3 коллекции по 4 предмета, 3 кейса и арт.
   Зеркало серверного netlify/functions/nft-content.js (без арта).
   Все SVG — плоские, 120×120, без внешних ссылок и шрифтов.
   ============================================================================ */

window.DX_NFT_EXTRA = {
  /* --- обложки новых кейсов: зелёный зверинец, белый люкс, багровая империя --- */
  caseArt: {
    zoo_case: '<svg viewBox="0 0 120 120"><defs><radialGradient id="zoo_case_g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a6ec72" stop-opacity=".5"/><stop offset="1" stop-color="#a6ec72" stop-opacity="0"/></radialGradient><linearGradient id="zoo_case_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f7d33"/><stop offset="1" stop-color="#12301a"/></linearGradient><linearGradient id="zoo_case_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fe062"/><stop offset="1" stop-color="#2f6b2a"/></linearGradient><linearGradient id="zoo_case_g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".55" stop-color="#f0c35a"/><stop offset="1" stop-color="#b8801f"/></linearGradient></defs><circle cx="60" cy="64" r="54" fill="url(#zoo_case_g1)"/><ellipse cx="60" cy="109" rx="46" ry="6" fill="#06120a" opacity=".45"/><rect x="18" y="100" width="14" height="10" rx="4" fill="#8a5a12"/><rect x="88" y="100" width="14" height="10" rx="4" fill="#8a5a12"/><path d="M18 40 Q6 22 21 10 Q35 23 28 42 Z" fill="url(#zoo_case_g3)" stroke="#1f5c17" stroke-width="2"/><path d="M20 38 Q18 25 21 14" fill="none" stroke="#2f6b2a" stroke-width="1.8" opacity=".85"/><path d="M102 40 Q114 22 99 10 Q85 23 92 42 Z" fill="url(#zoo_case_g3)" stroke="#1f5c17" stroke-width="2"/><path d="M100 38 Q102 25 99 14" fill="none" stroke="#2f6b2a" stroke-width="1.8" opacity=".85"/><rect x="12" y="36" width="96" height="68" rx="12" fill="url(#zoo_case_g2)" stroke="#1f5c17" stroke-width="3"/><rect x="12" y="34" width="96" height="22" rx="10" fill="url(#zoo_case_g3)" stroke="#1f5c17" stroke-width="3"/><rect x="12" y="54" width="96" height="4" fill="#0d2412"/><rect x="20" y="58" width="9" height="46" rx="3" fill="url(#zoo_case_g4)" opacity=".9"/><rect x="91" y="58" width="9" height="46" rx="3" fill="url(#zoo_case_g4)" opacity=".9"/><ellipse cx="60" cy="47" rx="8" ry="6" fill="url(#zoo_case_g4)"/><circle cx="50" cy="40" r="3.2" fill="url(#zoo_case_g4)"/><circle cx="57" cy="37.5" r="3.2" fill="url(#zoo_case_g4)"/><circle cx="63" cy="37.5" r="3.2" fill="url(#zoo_case_g4)"/><circle cx="70" cy="40" r="3.2" fill="url(#zoo_case_g4)"/><rect x="44" y="62" width="32" height="28" rx="7" fill="#0f2a16" stroke="url(#zoo_case_g4)" stroke-width="3"/><circle cx="60" cy="73" r="4.5" fill="#ffe9a8"/><rect x="57.5" y="73" width="5" height="9" rx="2" fill="#ffe9a8"/><circle cx="36" cy="87" r="7" fill="url(#zoo_case_g4)" stroke="#8a5a12" stroke-width="1.5"/><circle cx="36" cy="87" r="3.6" fill="none" stroke="#8a5a12" stroke-width="1.2"/><circle cx="84" cy="87" r="7" fill="url(#zoo_case_g4)" stroke="#8a5a12" stroke-width="1.5"/><circle cx="84" cy="87" r="3.6" fill="none" stroke="#8a5a12" stroke-width="1.2"/></svg>',
    luxe_case: '<svg viewBox="0 0 120 120"><defs><radialGradient id="luxe_case_g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient><linearGradient id="luxe_case_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset=".55" stop-color="#eadfcd"/><stop offset="1" stop-color="#cdbb9f"/></linearGradient><linearGradient id="luxe_case_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#efe4d0"/></linearGradient><linearGradient id="luxe_case_g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6d8"/><stop offset=".55" stop-color="#e8c26a"/><stop offset="1" stop-color="#b8862a"/></linearGradient><linearGradient id="luxe_case_g5" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2ffff"/><stop offset=".55" stop-color="#9fe3f2"/><stop offset="1" stop-color="#4aa3c4"/></linearGradient></defs><circle cx="60" cy="64" r="54" fill="url(#luxe_case_g1)"/><ellipse cx="60" cy="109" rx="46" ry="6" fill="#3a2c18" opacity=".3"/><rect x="18" y="100" width="14" height="10" rx="4" fill="url(#luxe_case_g4)"/><rect x="88" y="100" width="14" height="10" rx="4" fill="url(#luxe_case_g4)"/><rect x="12" y="36" width="96" height="68" rx="12" fill="url(#luxe_case_g2)" stroke="#b08a45" stroke-width="4"/><path d="M31 60 Q40 70 34 82 Q30 92 38 100" fill="none" stroke="#c9bca6" stroke-width="2" opacity=".9"/><path d="M84 58 Q78 70 84 82 Q88 92 80 100" fill="none" stroke="#c9bca6" stroke-width="2" opacity=".9"/><rect x="12" y="34" width="96" height="22" rx="10" fill="url(#luxe_case_g3)" stroke="#b08a45" stroke-width="3.5"/><path d="M18 44 Q30 40 42 46 Q50 50 58 45" fill="none" stroke="#d8cbb6" stroke-width="2" opacity=".9"/><rect x="12" y="54" width="96" height="4" fill="#cbb99c"/><rect x="20" y="58" width="9" height="46" rx="3" fill="url(#luxe_case_g4)"/><rect x="91" y="58" width="9" height="46" rx="3" fill="url(#luxe_case_g4)"/><rect x="44" y="62" width="32" height="28" rx="7" fill="url(#luxe_case_g4)" stroke="#a8761a" stroke-width="3"/><path d="M60 66 L68 74 L60 84 L52 74 Z" fill="url(#luxe_case_g5)" stroke="#2f8aa3" stroke-width="2"/><path d="M60 66 L60 84 M52 74 L68 74" fill="none" stroke="#ffffff" stroke-width="1.2" opacity=".8"/><path d="M60 4 L72 20 L60 32 L48 20 Z" fill="url(#luxe_case_g5)" stroke="#2f8aa3" stroke-width="2"/><path d="M60 4 L60 32 M48 20 L72 20" fill="none" stroke="#ffffff" stroke-width="1.4" opacity=".85"/><path d="M32 22 L32 34 M26 28 L38 28" fill="none" stroke="#fff6d8" stroke-width="2.2" stroke-linecap="round" opacity=".9"/><path d="M88 16 L88 28 M82 22 L94 22" fill="none" stroke="#fff6d8" stroke-width="2.2" stroke-linecap="round" opacity=".85"/></svg>',
    empire_case: '<svg viewBox="0 0 120 120"><defs><radialGradient id="empire_case_g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".45"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient><linearGradient id="empire_case_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a3182f"/><stop offset="1" stop-color="#3d0710"/></linearGradient><linearGradient id="empire_case_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c11f3a"/><stop offset="1" stop-color="#6d0a1d"/></linearGradient><linearGradient id="empire_case_g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".55" stop-color="#e8c26a"/><stop offset="1" stop-color="#b8801f"/></linearGradient><linearGradient id="empire_case_g5" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d21f3c"/><stop offset="1" stop-color="#7a0a1e"/></linearGradient></defs><circle cx="60" cy="64" r="54" fill="url(#empire_case_g1)"/><ellipse cx="60" cy="109" rx="46" ry="6" fill="#12030a" opacity=".5"/><rect x="18" y="100" width="14" height="10" rx="4" fill="#8a5a12"/><rect x="88" y="100" width="14" height="10" rx="4" fill="#8a5a12"/><rect x="12" y="36" width="96" height="68" rx="12" fill="url(#empire_case_g2)" stroke="#5c0714" stroke-width="3"/><rect x="12" y="34" width="96" height="22" rx="10" fill="url(#empire_case_g3)" stroke="#5c0714" stroke-width="3"/><rect x="12" y="54" width="96" height="4" fill="#3d0710"/><rect x="20" y="58" width="9" height="46" rx="3" fill="url(#empire_case_g4)"/><rect x="91" y="58" width="9" height="46" rx="3" fill="url(#empire_case_g4)"/><path d="M44 34 L45 17 L53 25 L60 12 L67 25 L75 17 L76 34 Z" fill="url(#empire_case_g4)" stroke="#8a5a12" stroke-width="2" stroke-linejoin="round"/><rect x="43" y="30" width="34" height="6" rx="3" fill="url(#empire_case_g4)" stroke="#8a5a12" stroke-width="1.5"/><circle cx="50" cy="33" r="2.2" fill="url(#empire_case_g5)"/><circle cx="60" cy="33" r="2.2" fill="url(#empire_case_g5)"/><circle cx="70" cy="33" r="2.2" fill="url(#empire_case_g5)"/><rect x="44" y="62" width="32" height="28" rx="7" fill="url(#empire_case_g4)" stroke="#8a5a12" stroke-width="3"/><circle cx="60" cy="76" r="11" fill="url(#empire_case_g5)" stroke="#ffe9a8" stroke-width="2"/><path d="M53 81 L53 71 L57 75 L60 69 L63 75 L67 71 L67 81 Z" fill="url(#empire_case_g4)"/></svg>'
  },

  models: [
    /* --- Крипто-зверинец --- */
    {
      id: 'frog_boss', name: 'Frog Boss', ru: 'Жаба-миллионер',
      base: 7200, rar: 'common', collection: 'crypto_zoo',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="frog_boss_g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6ec72"/><stop offset="1" stop-color="#3f9429"/></linearGradient><linearGradient id="frog_boss_g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#c9922e"/></linearGradient></defs><ellipse cx="60" cy="66" rx="46" ry="41" fill="url(#frog_boss_g1)"/><circle cx="36" cy="34" r="17" fill="url(#frog_boss_g1)"/><circle cx="84" cy="34" r="17" fill="url(#frog_boss_g1)"/><circle cx="36" cy="34" r="9.5" fill="#fbfff0"/><circle cx="84" cy="34" r="9.5" fill="#fbfff0"/><circle cx="37" cy="36" r="4.5" fill="#122b0c"/><circle cx="83" cy="36" r="4.5" fill="#122b0c"/><path d="M25 76 Q60 101 95 76" fill="none" stroke="#1f5c17" stroke-width="6" stroke-linecap="round"/><circle cx="84" cy="34" r="20.5" fill="none" stroke="url(#frog_boss_g2)" stroke-width="4"/><path d="M101 50 Q110 62 106 74" fill="none" stroke="#c9922e" stroke-width="2.5" stroke-linecap="round"/><circle cx="106" cy="79" r="5" fill="url(#frog_boss_g2)" stroke="#8a5a12" stroke-width="1.5"/></svg>'
    },
    {
      id: 'penguin_trader', name: 'Penguin Trader', ru: 'Пингвин-биржевик',
      base: 26000, rar: 'rare', collection: 'crypto_zoo',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="penguin_trader_g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#31496a"/><stop offset="1" stop-color="#0e1726"/></linearGradient><linearGradient id="penguin_trader_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d3e0ee"/></linearGradient></defs><ellipse cx="60" cy="70" rx="35" ry="45" fill="url(#penguin_trader_g1)"/><ellipse cx="60" cy="78" rx="22" ry="31" fill="url(#penguin_trader_g2)"/><circle cx="49" cy="42" r="8.5" fill="#ffffff"/><circle cx="71" cy="42" r="8.5" fill="#ffffff"/><circle cx="50" cy="43" r="3.8" fill="#10141c"/><circle cx="70" cy="43" r="3.8" fill="#10141c"/><path d="M60 50 L51 60 L69 60 Z" fill="#f4a63a"/><path d="M60 70 L50 64 L50 76 L60 70 L70 76 L70 64 Z" fill="#1b2a40"/><path d="M40 98 L48 88 L56 94 L67 78" fill="none" stroke="#4ade80" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M68 77 L60 78 L66 84 Z" fill="#4ade80"/><path d="M26 64 Q17 74 24 88" fill="none" stroke="#243a56" stroke-width="8" stroke-linecap="round"/><path d="M94 64 Q103 74 96 88" fill="none" stroke="#243a56" stroke-width="8" stroke-linecap="round"/></svg>'
    },
    {
      id: 'bull_hodler', name: 'Bull Hodler', ru: 'Бык-ходлер',
      base: 74000, rar: 'epic', collection: 'crypto_zoo',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="bull_hodler_g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".55" stop-color="#f0b93f"/><stop offset="1" stop-color="#c9862a"/></linearGradient><linearGradient id="bull_hodler_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ef0a6"/><stop offset="1" stop-color="#2f9e4f"/></linearGradient><linearGradient id="bull_hodler_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c9"/><stop offset="1" stop-color="#dfb05a"/></linearGradient></defs><path d="M36 43 C22 41 11 32 7 17 C19 27 31 32 41 35 Z" fill="url(#bull_hodler_g3)" stroke="#a8761a" stroke-width="2"/><path d="M84 43 C98 41 109 32 113 17 C101 27 89 32 79 35 Z" fill="url(#bull_hodler_g3)" stroke="#a8761a" stroke-width="2"/><path d="M60 32 C42 32 28 44 28 62 C28 78 38 90 48 94 L72 94 C82 90 92 78 92 62 C92 44 78 32 60 32 Z" fill="url(#bull_hodler_g1)" stroke="#8a5a12" stroke-width="2.5"/><ellipse cx="60" cy="82" rx="24" ry="15" fill="#ffe9b8"/><ellipse cx="51" cy="81" rx="3.6" ry="2.8" fill="#8a5a12"/><ellipse cx="69" cy="81" rx="3.6" ry="2.8" fill="#8a5a12"/><path d="M44 51 L51 58 L44 65 L37 58 Z" fill="url(#bull_hodler_g2)" stroke="#2f9e4f" stroke-width="2"/><path d="M76 51 L83 58 L76 65 L69 58 Z" fill="url(#bull_hodler_g2)" stroke="#2f9e4f" stroke-width="2"/><circle cx="60" cy="93" r="4.5" fill="none" stroke="#c9922e" stroke-width="3.5"/></svg>'
    },
    {
      id: 'whale_tycoon', name: 'Whale Tycoon', ru: 'Кит-олигарх',
      base: 210000, rar: 'legendary', collection: 'crypto_zoo',
      art: '<svg viewBox="0 0 120 120"><defs><radialGradient id="whale_tycoon_g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe08a" stop-opacity=".55"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient><linearGradient id="whale_tycoon_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa3c4"/><stop offset="1" stop-color="#14506b"/></linearGradient><linearGradient id="whale_tycoon_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#d99b25"/></linearGradient></defs><circle cx="60" cy="64" r="54" fill="url(#whale_tycoon_g1)"/><path d="M14 68 Q14 44 42 39 Q74 33 96 51 Q106 59 103 70 Q99 86 72 91 Q38 96 21 84 Q14 78 14 68 Z" fill="url(#whale_tycoon_g2)"/><path d="M99 58 Q114 44 110 28 Q100 36 92 52 Z" fill="#1b5f7c"/><path d="M99 74 Q114 82 110 96 Q98 84 92 78 Z" fill="#1b5f7c"/><path d="M22 84 Q42 92 68 88 Q90 85 100 74 Q98 86 72 91 Q40 95 22 84 Z" fill="#bfeaf5" opacity=".75"/><path d="M22 80 Q30 86 40 84" fill="none" stroke="#0b2e3f" stroke-width="2.5" stroke-linecap="round"/><circle cx="34" cy="64" r="4" fill="#0b2e3f"/><path d="M38 42 Q31 28 35 17" fill="none" stroke="#bfeaf5" stroke-width="5" stroke-linecap="round"/><path d="M46 34 L47 18 L54 25 L60 13 L66 25 L73 18 L74 34 Z" fill="url(#whale_tycoon_g3)" stroke="#a8761a" stroke-width="1.5"/><rect x="46" y="31" width="28" height="6" rx="3" fill="#d99b25"/><circle cx="30" cy="12" r="6" fill="url(#whale_tycoon_g3)" stroke="#a8761a" stroke-width="1.5"/><circle cx="41" cy="6" r="4.5" fill="url(#whale_tycoon_g3)" stroke="#a8761a" stroke-width="1.5"/></svg>'
    },

    /* --- Бытовуха миллиардера --- */
    {
      id: 'gold_mug', name: 'Gold Mug', ru: 'Золотая кружка',
      base: 4800, rar: 'common', collection: 'billionaire_basics',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="gold_mug_g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#f3c65c"/><stop offset="1" stop-color="#bc8324"/></linearGradient><linearGradient id="gold_mug_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9dfc8"/></linearGradient></defs><ellipse cx="60" cy="104" rx="38" ry="7" fill="url(#gold_mug_g2)"/><path d="M82 56 Q104 56 104 72 Q104 88 82 88" fill="none" stroke="url(#gold_mug_g1)" stroke-width="9" stroke-linecap="round"/><rect x="29" y="40" width="52" height="60" rx="12" fill="url(#gold_mug_g1)" stroke="#a8761a" stroke-width="2.5"/><ellipse cx="55" cy="40" rx="26" ry="9" fill="#ffe9b8" stroke="#a8761a" stroke-width="2.5"/><ellipse cx="55" cy="41" rx="18" ry="5.5" fill="#6b3f12"/><path d="M42 30 Q35 21 44 13" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity=".75"/><path d="M58 28 Q51 18 60 9" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity=".6"/><path d="M38 58 L38 88" stroke="#fff6d8" stroke-width="5" stroke-linecap="round" opacity=".45"/><circle cx="76" cy="86" r="4.5" fill="#e8f7ff" stroke="#8fd3e8" stroke-width="1.5"/></svg>'
    },
    {
      id: 'diamond_slippers', name: 'Diamond Slippers', ru: 'Тапки с бриллиантами',
      base: 22000, rar: 'rare', collection: 'billionaire_basics',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="diamond_slippers_g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e7dcc6"/></linearGradient><linearGradient id="diamond_slippers_g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c9"/><stop offset="1" stop-color="#cf9a2c"/></linearGradient></defs><ellipse cx="60" cy="102" rx="42" ry="8" fill="#8a6a3d" opacity=".16"/><path d="M12 90 Q12 74 28 70 L48 64 Q58 62 58 72 L58 90 Q34 97 12 90 Z" fill="url(#diamond_slippers_g1)" stroke="url(#diamond_slippers_g2)" stroke-width="3"/><path d="M62 90 Q62 74 78 70 L98 64 Q108 62 108 72 L108 90 Q84 97 62 90 Z" fill="url(#diamond_slippers_g1)" stroke="url(#diamond_slippers_g2)" stroke-width="3"/><circle cx="28" cy="66" r="9" fill="#ffffff" stroke="#e8dfcb" stroke-width="1.5"/><circle cx="44" cy="62" r="9" fill="#ffffff" stroke="#e8dfcb" stroke-width="1.5"/><circle cx="76" cy="62" r="9" fill="#ffffff" stroke="#e8dfcb" stroke-width="1.5"/><circle cx="92" cy="66" r="9" fill="#ffffff" stroke="#e8dfcb" stroke-width="1.5"/><path d="M20 80 Q34 71 50 80" fill="none" stroke="url(#diamond_slippers_g2)" stroke-width="3.5" stroke-linecap="round"/><path d="M70 80 Q86 71 100 80" fill="none" stroke="url(#diamond_slippers_g2)" stroke-width="3.5" stroke-linecap="round"/><path d="M35 82 L40 87 L35 94 L30 87 Z" fill="#e8f9ff" stroke="#8fd3e8" stroke-width="1.6"/><path d="M85 82 L90 87 L85 94 L80 87 Z" fill="#e8f9ff" stroke="#8fd3e8" stroke-width="1.6"/></svg>'
    },
    {
      id: 'heli_remote', name: 'Heli Remote', ru: 'Пульт от вертолёта',
      base: 66000, rar: 'epic', collection: 'billionaire_basics',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="heli_remote_g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a44"/><stop offset="1" stop-color="#14141a"/></linearGradient><linearGradient id="heli_remote_g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#cf9a2c"/></linearGradient></defs><path d="M60 30 L60 12" stroke="#c9922e" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="9" r="4.5" fill="url(#heli_remote_g2)" stroke="#a8761a" stroke-width="1.5"/><rect x="38" y="28" width="44" height="72" rx="14" fill="url(#heli_remote_g1)" stroke="url(#heli_remote_g2)" stroke-width="3"/><rect x="46" y="38" width="28" height="16" rx="4" fill="#1f3b32" stroke="#4ade80" stroke-width="1.5"/><path d="M50 50 L56 44 L61 47 L67 40" fill="none" stroke="#4ade80" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="51" cy="68" r="5.5" fill="url(#heli_remote_g2)" stroke="#a8761a" stroke-width="1.5"/><circle cx="69" cy="68" r="5.5" fill="#b3122f" stroke="#6d0a1d" stroke-width="1.5"/><circle cx="60" cy="88" r="9" fill="#24242c" stroke="url(#heli_remote_g2)" stroke-width="2.5"/><circle cx="60" cy="88" r="4" fill="url(#heli_remote_g2)"/></svg>'
    },
    {
      id: 'champagne_tub', name: 'Champagne Tub', ru: 'Ванна с шампанским',
      base: 185000, rar: 'legendary', collection: 'billionaire_basics',
      art: '<svg viewBox="0 0 120 120"><defs><radialGradient id="champagne_tub_g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe08a" stop-opacity=".5"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient><linearGradient id="champagne_tub_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c9"/><stop offset=".5" stop-color="#f0c35a"/><stop offset="1" stop-color="#b8801f"/></linearGradient><linearGradient id="champagne_tub_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7a4f"/><stop offset="1" stop-color="#123c25"/></linearGradient></defs><circle cx="60" cy="62" r="54" fill="url(#champagne_tub_g1)"/><rect x="82" y="14" width="14" height="44" rx="6" fill="url(#champagne_tub_g3)"/><rect x="86" y="4" width="6" height="14" rx="3" fill="#dfe8e2"/><rect x="85" y="2" width="8" height="9" rx="3" fill="url(#champagne_tub_g2)"/><path d="M14 58 L106 58 Q104 92 60 98 Q16 92 14 58 Z" fill="url(#champagne_tub_g2)" stroke="#a8761a" stroke-width="2.5"/><rect x="9" y="52" width="102" height="12" rx="6" fill="#fff1c4" stroke="#a8761a" stroke-width="2.5"/><path d="M28 94 Q26 102 32 105" fill="none" stroke="#c9922e" stroke-width="5" stroke-linecap="round"/><path d="M92 94 Q94 102 88 105" fill="none" stroke="#c9922e" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="44" r="7" fill="#ffffff" opacity=".8"/><circle cx="60" cy="33" r="5" fill="#ffffff" opacity=".7"/><circle cx="34" cy="31" r="4" fill="#ffffff" opacity=".55"/></svg>'
    },

    /* --- Реворкия: империя --- */
    {
      id: 'imperial_seal', name: 'Imperial Seal', ru: 'Имперская печать',
      base: 8400, rar: 'common', collection: 'reworkia_empire',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="imperial_seal_g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d21f3c"/><stop offset="1" stop-color="#7a0a1e"/></linearGradient><linearGradient id="imperial_seal_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#c9922e"/></linearGradient></defs><path d="M46 78 L38 110 L52 102 L58 84 Z" fill="#7a0a1e"/><path d="M74 78 L82 110 L68 102 L62 84 Z" fill="#9c1026"/><path d="M60 10 C72 6 82 14 84 24 C94 28 100 40 94 50 C100 62 94 74 82 78 C76 88 62 92 54 84 C42 90 28 82 26 70 C16 64 14 50 22 42 C20 30 32 18 44 20 C48 12 54 10 60 10 Z" fill="url(#imperial_seal_g1)" stroke="#5c0714" stroke-width="2"/><circle cx="60" cy="52" r="25" fill="#9c1026" stroke="url(#imperial_seal_g2)" stroke-width="2.5"/><path d="M46 60 L46 44 L52 51 L60 40 L68 51 L74 44 L74 60 Z" fill="url(#imperial_seal_g2)"/><circle cx="60" cy="64" r="2.5" fill="url(#imperial_seal_g2)"/></svg>'
    },
    {
      id: 'treasury_key', name: 'Treasury Key', ru: 'Ключ от казны',
      base: 33000, rar: 'rare', collection: 'reworkia_empire',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="treasury_key_g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".55" stop-color="#efc258"/><stop offset="1" stop-color="#b8801f"/></linearGradient><linearGradient id="treasury_key_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d21f3c"/><stop offset="1" stop-color="#7a0a1e"/></linearGradient></defs><path d="M28 30 Q60 8 92 30 L92 42 Q60 22 28 42 Z" fill="url(#treasury_key_g2)"/><path d="M42 46 L42 22 L50 31 L60 18 L70 31 L78 22 L78 46 Z" fill="url(#treasury_key_g1)" stroke="#a8761a" stroke-width="2" stroke-linejoin="round"/><circle cx="60" cy="36" r="6" fill="#7a0a1e"/><rect x="56" y="46" width="8" height="50" rx="3" fill="url(#treasury_key_g1)" stroke="#a8761a" stroke-width="1.5"/><rect x="52" y="58" width="16" height="6" rx="3" fill="#c9922e"/><path d="M64 86 L82 86 L82 94 L74 94 L74 102 L64 102 Z" fill="url(#treasury_key_g1)" stroke="#a8761a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="60" cy="28" r="2.5" fill="#ffe9a8"/></svg>'
    },
    {
      id: 'order_of_reworkia', name: 'Order of Reworkia', ru: 'Орден Реворкии',
      base: 81000, rar: 'epic', collection: 'reworkia_empire',
      art: '<svg viewBox="0 0 120 120"><defs><linearGradient id="order_of_reworkia_g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d21f3c"/><stop offset="1" stop-color="#7a0a1e"/></linearGradient><linearGradient id="order_of_reworkia_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#efc258"/><stop offset="1" stop-color="#b8801f"/></linearGradient></defs><path d="M36 8 L60 38 L84 8 L94 16 L60 58 L26 16 Z" fill="url(#order_of_reworkia_g1)" stroke="#5c0714" stroke-width="2" stroke-linejoin="round"/><path d="M60 44 L68.8 65.9 L92.3 67.5 L74.3 82.6 L80 105.5 L60 93 L40 105.5 L45.7 82.6 L27.7 67.5 L51.2 65.9 Z" fill="url(#order_of_reworkia_g2)" stroke="#a8761a" stroke-width="2.5" stroke-linejoin="round"/><circle cx="60" cy="78" r="14" fill="#9c1026" stroke="#a8761a" stroke-width="2.5"/><path d="M51 82 L51 72 L56 77 L60 70 L64 77 L69 72 L69 82 Z" fill="url(#order_of_reworkia_g2)"/><path d="M30 40 L22 34 M30 48 L20 46" stroke="#efc258" stroke-width="3" stroke-linecap="round" opacity=".85"/><path d="M90 40 L98 34 M90 48 L100 46" stroke="#efc258" stroke-width="3" stroke-linecap="round" opacity=".85"/></svg>'
    },
    {
      id: 'reworkia_crown', name: 'Crown of Reworkia', ru: 'Корона Реворкии',
      base: 240000, rar: 'legendary', collection: 'reworkia_empire',
      art: '<svg viewBox="0 0 120 120"><defs><radialGradient id="reworkia_crown_g1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd166" stop-opacity=".6"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient><linearGradient id="reworkia_crown_g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c9"/><stop offset=".5" stop-color="#f0c35a"/><stop offset="1" stop-color="#b8801f"/></linearGradient><linearGradient id="reworkia_crown_g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c81d3a"/><stop offset="1" stop-color="#6d0a1d"/></linearGradient></defs><circle cx="60" cy="66" r="54" fill="url(#reworkia_crown_g1)"/><path d="M30 54 Q37 30 60 26 Q83 30 90 54 Z" fill="url(#reworkia_crown_g3)"/><path d="M22 56 L30 24 L44 42 L60 16 L76 42 L90 24 L98 56 Z" fill="url(#reworkia_crown_g2)" stroke="#a8761a" stroke-width="2.5" stroke-linejoin="round"/><rect x="20" y="54" width="80" height="16" rx="7" fill="url(#reworkia_crown_g2)" stroke="#a8761a" stroke-width="2.5"/><circle cx="34" cy="62" r="4.5" fill="url(#reworkia_crown_g3)" stroke="#ffe9a8" stroke-width="1.5"/><circle cx="60" cy="62" r="4.5" fill="url(#reworkia_crown_g3)" stroke="#ffe9a8" stroke-width="1.5"/><circle cx="86" cy="62" r="4.5" fill="url(#reworkia_crown_g3)" stroke="#ffe9a8" stroke-width="1.5"/><circle cx="30" cy="24" r="5" fill="#fff3c9" stroke="#a8761a" stroke-width="1.5"/><circle cx="60" cy="16" r="5" fill="#fff3c9" stroke="#a8761a" stroke-width="1.5"/><circle cx="90" cy="24" r="5" fill="#fff3c9" stroke="#a8761a" stroke-width="1.5"/></svg>'
    }
  ],

  cases: [
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
  ],

  collections: [
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
  ]
};

/* Довивка после мержа: перерисовать сетку кейсов и убрать хэллоуинский ивент.
   Отдельным файлом, чтобы не трогать index.html: сетку строит buildCasesUI,
   а её после подмешивания новых кейсов надо вызвать заново. */
(function dxNftAfterMerge() {
  function hideEvent() {
    try {
      var ev = document.getElementById('evBanner');
      if (ev) ev.style.display = 'none';
    } catch (e) {}
  }

  function patch() {
    try {
      if (typeof CASES !== 'undefined' && CASES.length > 4 &&
          typeof CASE_ART === 'object' && CASE_ART && typeof buildCasesUI === 'function') {
        /* скины новых кейсов и фолбэк, если арта нет */
        applyCaseArt();
        for (var i = 0; i < CASES.length; i++) {
          var id = CASES[i] && CASES[i].id;
          if (id && !CASE_ART[id]) CASE_ART[id] = CASE_ART.base;
        }
        buildCasesUI();
      }
      hideEvent();
    } catch (e) {}
  }

  /* скины кейсов: если контент дал caseArt — берём его, иначе обложку-фолбэк */
  function applyCaseArt() {
    try {
      var extra = (window.DX_NFT_EXTRA && window.DX_NFT_EXTRA.caseArt) || {};
      if (typeof CASE_ART !== 'object' || !CASE_ART) return;
      for (var k in extra) {
        if (extra[k] && typeof extra[k] === 'string') CASE_ART[k] = extra[k];
      }
    } catch (e) {}
  }
  applyCaseArt();

  function schedule() {
    setTimeout(patch, 250);
    setTimeout(patch, 1200);
    setTimeout(patch, 3000);
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.dataset && t.dataset.view === 'cases') { setTimeout(patch, 80); return; }
        t = t.parentNode;
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();
