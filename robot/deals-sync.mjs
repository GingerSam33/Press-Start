// Press Start · robot « Bons plans » : Dealabs + presse + Reddit + jeux gratuits + consoles d'émulation → Supabase
// Secrets : SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY. Variable facultative : DRY_RUN=1
import {readFileSync} from 'node:fs';
const env = process.env;
const SB = (env.SUPABASE_URL || '').replace(/\/+$/, ''), SBK = env.SUPABASE_SECRET_KEY, AK = env.ANTHROPIC_API_KEY;
const DRY = env.DRY_RUN === '1';
for (const [k, v] of Object.entries({SUPABASE_URL: SB, SUPABASE_SECRET_KEY: SBK})) if (!v) { console.error(`Secret manquant : ${k}`); process.exit(1); }
const SB_AUTH = String(SBK).startsWith('sb_') ? {apikey: SBK} : {apikey: SBK, Authorization: `Bearer ${SBK}`};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const UA = {'User-Agent': 'Mozilla/5.0 (compatible; PressStartBot/1.0; +https://gingersam33.github.io/Press-Start/)', Accept: 'application/rss+xml, application/xml, text/xml, application/json, */*'};
async function sb(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {...opts, headers: {...SB_AUTH, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates', ...(opts.headers || {})}});
  if (!r.ok) throw new Error(`Supabase ${r.status} : ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function upsert(rows) { if (DRY || !rows.length) return; await sb('docs?on_conflict=col,id', {method: 'POST', body: JSON.stringify(rows.map(r => ({...r, updated_at: new Date().toISOString()})))}); }
async function readDoc(col, id) { const r = await sb(`docs?select=data&col=eq.${encodeURIComponent(col)}&id=eq.${encodeURIComponent(id)}`); return r && r[0] ? r[0].data : null; }
async function get(url, json) {
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, {headers: UA, signal: AbortSignal.timeout(20000)}); if (r.status >= 500 || r.status === 429) { await sleep(3000 * (a + 1)); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); return json ? r.json() : r.text(); }
    catch (e) { if (a === 2) throw e; await sleep(2500 * (a + 1)); }
  }
}
/* ---------- RSS ---------- */
const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = s => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    let link = strip(tag(b, 'link')); if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const date = Date.parse(strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')));
    const raw = tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    let img = (b.match(/<media:content[^>]*url="([^"]+)"/i) || b.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) || b.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i) || decode(raw).match(/<img[^>]+src="([^"]+)"/i) || [])[1] || '';
    img = decode(img); if (!/^https:\/\//.test(img)) img = '';
    const full = strip(raw);
    items.push({title: strip(tag(b, 'title')), url: link, date: isNaN(date) ? null : date, summary: full.slice(0, 260), excerpt: full.slice(0, 900), img});
  }
  return items.filter(i => i.title && i.url);
}

/* ---------- Sources ---------- */
const SOURCES = JSON.parse(readFileSync(new URL('./deals-sources.json', import.meta.url)));
const DEAL_WORDS = /(bon plan|bons plans|promo|promotion|r[ée]duction|soldes|prix|baisse|moins cher|offre|deal|black friday|french days|prime day|cyber monday|€|\$|% de r|sale|discount|price drop|precommande|pr[ée]commande|collector|[ée]dition limit[ée]e)/i;
function pepperInfo(block) {
  const tagM = block.match(/<pepper:merchant[^>]*>/i); if (!tagM) return {};
  const name = (tagM[0].match(/name="([^"]*)"/i) || [])[1] || '', price = (tagM[0].match(/price="([^"]*)"/i) || [])[1] || '';
  return {merchant: decode(name), price: decode(price)};
}
async function readRss(src) {
  const xml = await get(src.url);
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = blocks.map(b => { const it = parseFeed('<rss>' + b + '</rss>')[0]; return it ? {...it, ...pepperInfo(b), source: src.name, kind: src.kind || 'deal', hint: src.hint || ''} : null; }).filter(Boolean);
  return src.filter ? items.filter(it => DEAL_WORDS.test(it.title + ' ' + it.summary) && (!src.gaming || /(jeu|jeux|game|switch|ps5|ps4|playstation|xbox|nintendo|steam|console|manette|controller|zelda|mario|pok[ée]mon|collector|gaming|retro|anbernic|retroid|ayn|miyoo)/i.test(it.title + ' ' + it.summary))) : items;
}
/* boutiques Shopify des éditeurs d'éditions limitées (Limited Run, Strictly Limited, Super Rare…) */
async function readShopify(src) {
  const base = src.url.replace(/\/+$/, '');
  const data = await get(`${base}/products.json?limit=60`, true);
  const now = Date.now(), maxAge = (src.maxDays || 21) * 86400000;
  return (data?.products || []).map(p => {
    const date = Date.parse(p.published_at || p.created_at || '') || 0;
    const v = (p.variants || [])[0] || {}, img = (p.images || [])[0]?.src || '';
    return {title: p.title, url: `${base}/products/${p.handle}`, date, summary: strip(p.body_html || '').slice(0, 260), excerpt: strip(p.body_html || '').slice(0, 600), img: img.startsWith('//') ? 'https:' + img : img, price: v.price ? `${v.price} ${src.currency || '$'}` : '', merchant: src.name.replace(/ ·.*$/, ''), source: src.name, kind: 'deal', hint: src.hint || 'éditions limitées, collectors et précommandes'};
  }).filter(it => it.title && (!it.date || now - it.date < maxAge));
}
async function freeGames() {
  const out = [];
  try {
    const gp = await get('https://www.gamerpower.com/api/giveaways?type=game&sort-by=date', true);
    for (const g of (Array.isArray(gp) ? gp : []).slice(0, 40)) out.push({title: String(g.title || '').replace(/\s*\((Steam|Epic Games Store|GOG|Prime Gaming|Itch\.io)[^)]*\)\s*Giveaway$/i, '').replace(/\s*Giveaway$/i, ''), store: String(g.platforms || '').split(',')[0].trim(), platforms: String(g.platforms || ''), worth: g.worth && g.worth !== 'N/A' ? g.worth : '', end: g.end_date && g.end_date !== 'N/A' ? new Date(g.end_date.replace(' ', 'T') + 'Z').toISOString() : '', img: g.thumbnail || g.image || '', url: g.open_giveaway_url || g.gamerpower_url || '', source: 'GamerPower'});
    log(`GamerPower : ${out.length} jeux gratuits`);
  } catch (e) { log('⚠ GamerPower : ' + e.message); }
  try {
    const ep = await get('https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr&country=FR&allowCountries=FR', true);
    const els = ep?.data?.Catalog?.searchStore?.elements || []; let n = 0;
    for (const e of els) {
      const cur = e.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0]; if (!cur || e.price?.totalPrice?.discountPrice !== 0) continue;
      const slug = e.productSlug || e.catalogNs?.mappings?.[0]?.pageSlug || e.urlSlug || '';
      const img = (e.keyImages || []).find(k => /Tall|Thumbnail/i.test(k.type))?.url || (e.keyImages || [])[0]?.url || '';
      if (!out.some(o => norm(o.title) === norm(e.title))) out.unshift({title: e.title, store: 'Epic Games Store', platforms: 'PC', worth: e.price?.totalPrice?.fmtPrice?.originalPrice || '', end: cur.endDate || '', img, url: slug ? `https://store.epicgames.com/fr/p/${slug}` : 'https://store.epicgames.com/fr/free-games', source: 'Epic Games'}); n++;
    }
    log(`Epic Games : ${n} jeux offerts`);
  } catch (e) { log('⚠ Epic Games : ' + e.message); }
  return out.slice(0, 30);
}
/* ---------- Claude : tri, classement, recoupement ---------- */
async function claude(prompt) {
  for (let a = 0; a < 6; a++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'x-api-key': AK, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify({model: env.ANTHROPIC_MODEL_FAST || 'claude-haiku-5-5', max_tokens: 8000, messages: [{role: 'user', content: prompt}]})});
      const d = await r.json(); if (!r.ok) throw new Error((d && d.error && d.error.message) || 'HTTP ' + r.status);
      const t = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    } catch (e) { log(`⚠ Claude (essai ${a + 1}) : ${e.message}`); await sleep(/overload|rate|429|529/i.test(e.message) ? 15000 * (a + 1) : 4000 * (a + 1)); }
  }
  return null;
}
const PROMPT = (plats, batch) => `Tu tries des bons plans jeu vidéo pour un collectionneur français. Ses plateformes : ${plats}. Pour chaque élément, réponds :
- keep : true si c'est une offre, une promo, une précommande, une sortie de coffret collector, une sortie/annonce de console (y compris consoles portables d'émulation : Anbernic, Retroid, AYN, Miyoo, Powkiddy…) ou un article de sélection de promos ; false sinon (actualité sans offre, hors jeu vidéo, high-tech sans rapport).
- type : "physique" (jeu en boîte), "accessoire" (manette, coffret, goodies, pochette, figurine, carte mémoire, casque gaming…), "demat" (jeu dématérialisé, clé, abonnement), "collector" (édition collector/limitée), "console", "selection" (article listant plusieurs promos), "annonce" (sortie à venir d'un collector ou d'une console, sans prix réduit).
- title : titre court et clair en français, sans le prix ni le marchand.
- product : nom du produit seul, normalisé pour reconnaître la même offre sur plusieurs sites (ex. « metroid prime 4 beyond switch 2 »).
- platforms : liste parmi ${plats}, PC, Émulation, Multi (vide si inconnu).
- price, oldPrice : nombres en euros (null si inconnus) ; discount : pourcentage entier (null si inconnu).
- merchant : marchand (Amazon, Fnac, Leclerc…) ou "" ; expires : date ISO si la fin de l'offre est indiquée, sinon "".
- releaseDate : pour "annonce", "collector" ou "console" : date de sortie ISO si connue, sinon "".
Réponds uniquement en JSON : {"items":[{"i":0,"keep":true,"type":"physique","title":"…","product":"…","platforms":["Switch 2"],"price":39.99,"oldPrice":69.99,"discount":43,"merchant":"Amazon","expires":"","releaseDate":""}]}

${JSON.stringify(batch.map(([i, it]) => ({i, title: it.title, text: String(it.summary || '').slice(0, 280), source: it.source, merchant: it.merchant || '', price: it.price || '', hint: it.hint})))}`;
(async () => {
  const t0 = Date.now(), report = [];
  const now = Date.now(), maxAge = 7 * 86400000;
  let raw = [];
  for (const s of SOURCES) {
    try { const items = (s.type === 'shopify' ? await readShopify(s) : await readRss(s)).filter(it => !it.date || now - it.date < (s.maxDays || 7) * 86400000); raw = raw.concat(items); report.push({name: s.name, count: items.length, ok: true}); log(`${s.name} : ${items.length}`); }
    catch (e) { report.push({name: s.name, count: 0, ok: false, err: e.message}); log(`⚠ ${s.name} : ${e.message}`); }
  }
  const seen = new Set(); raw = raw.filter(it => { const k = it.url.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; });
  log(`${raw.length} éléments collectés`);
  const prev = await readDoc('deals', 'current').catch(() => null) || {};
  const prevBy = new Map((prev.deals || []).flatMap(d => (d.links || []).map(l => [l.url, d])));
  const consoles = await sb('docs?select=data&col=eq.consoles').catch(() => []) || [];
  const plats = [...new Set(consoles.map(c => c.data && (c.data.short || c.data.name)).filter(Boolean))].join(', ') || 'Switch 2, Switch, PS5, PS4, Xbox Series X|S, PC';
  const classified = [];
  if (AK) {
    const idx = raw.map((it, i) => [i, it]);
    for (let k = 0; k < idx.length; k += 20) {
      const batch = idx.slice(k, k + 20); const r = await claude(PROMPT(plats, batch));
      for (const x of (r && r.items) || []) { const it = raw[x.i]; if (it && x.keep) classified.push({...it, ...x, titleSrc: it.title}); }
      if (k) await sleep(1200);
    }
  } else log('⚠ ANTHROPIC_API_KEY absent : classement par mots-clés seulement');
  /* recoupement par produit */
  const groups = new Map();
  for (const c of classified) {
    const gk = norm(c.product || c.title).replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (c.type === 'selection' ? c.url : '');
    const g = groups.get(gk) || {id: '', type: c.type, title: c.title, product: c.product || '', platforms: [], price: null, oldPrice: null, discount: null, merchant: '', expires: '', releaseDate: '', img: '', date: 0, links: [], heat: 0};
    g.links.push({source: c.source, url: c.url, title: c.titleSrc, merchant: c.merchant || '', price: c.price ?? null});
    for (const p of c.platforms || []) if (!g.platforms.includes(p)) g.platforms.push(p);
    if (c.price != null && (g.price == null || c.price < g.price)) { g.price = c.price; g.oldPrice = c.oldPrice ?? g.oldPrice; g.discount = c.discount ?? g.discount; g.merchant = c.merchant || g.merchant; }
    if (!g.oldPrice && c.oldPrice) g.oldPrice = c.oldPrice; if (!g.discount && c.discount) g.discount = c.discount;
    if (!g.merchant && c.merchant) g.merchant = c.merchant; if (!g.expires && c.expires) g.expires = c.expires; if (!g.releaseDate && c.releaseDate) g.releaseDate = c.releaseDate;
    if (!g.img && c.img) g.img = c.img; g.date = Math.max(g.date, c.date || 0);
    groups.set(gk, g);
  }
  const all = [...groups.values()].map(g => { const p = prevBy.get(g.links[0].url); g.first = p && p.first ? p.first : Date.now(); g.id = 'd' + Math.abs([...g.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36); g.score = g.links.length * 100 + (g.discount || 0); if (!g.discount && g.price && g.oldPrice && g.oldPrice > g.price) g.discount = Math.round((1 - g.price / g.oldPrice) * 100); return g; });
  const deals = all.filter(g => !['selection', 'annonce'].includes(g.type)).sort((a, b) => b.date - a.date).slice(0, 300);
  const selections = all.filter(g => g.type === 'selection').sort((a, b) => b.date - a.date).slice(0, 30);
  const upcoming = all.filter(g => g.type === 'annonce' || ((g.type === 'collector' || g.type === 'console') && g.releaseDate && Date.parse(g.releaseDate) > now)).sort((a, b) => (Date.parse(a.releaseDate) || 9e15) - (Date.parse(b.releaseDate) || 9e15)).slice(0, 40);
  const free = await freeGames();
  const doc = {updatedAt: Date.now(), deals, selections, upcoming, free, sources: report};
  log(`${deals.length} bons plans · ${selections.length} sélections · ${upcoming.length} à venir · ${free.length} gratuits`);
  await upsert([{col: 'deals', id: 'current', data: doc}]);
  log(`Terminé en ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch(e => { console.error(e); process.exit(1); });
