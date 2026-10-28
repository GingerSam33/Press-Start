// Press Start · robot « Actus du jour » : flux RSS + IGDB (sorties, conférences) → Supabase
// Secrets : SUPABASE_URL, SUPABASE_SECRET_KEY, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET. Variable facultative : DRY_RUN=1
import {readFileSync} from 'node:fs';
const env = process.env;
const SB = (env.SUPABASE_URL || '').replace(/\/+$/, ''), SBK = env.SUPABASE_SECRET_KEY, TW_ID = env.TWITCH_CLIENT_ID, TW_SECRET = env.TWITCH_CLIENT_SECRET;
const DRY = env.DRY_RUN === '1';
for (const [k, v] of Object.entries({SUPABASE_URL: SB, SUPABASE_SECRET_KEY: SBK, TWITCH_CLIENT_ID: TW_ID, TWITCH_CLIENT_SECRET: TW_SECRET})) if (!v) { console.error(`Secret manquant : ${k}`); process.exit(1); }
if (String(SBK).startsWith('sb_publishable_')) { console.error('SUPABASE_SECRET_KEY contient la clé publishable : il faut la Secret key (sb_secret_…).'); process.exit(1); }
const SB_AUTH = String(SBK).startsWith('sb_') ? {apikey: SBK} : {apikey: SBK, Authorization: `Bearer ${SBK}`};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const key = s => norm(s).replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

async function sb(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {...opts, headers: {...SB_AUTH, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates', ...(opts.headers || {})}});
  if (!r.ok) throw new Error(`Supabase ${r.status} : ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function readCol(col) { return sb(`docs?select=id,data&col=eq.${encodeURIComponent(col)}`, {headers: {Range: '0-999'}}); }
async function upsert(rows) { if (DRY || !rows.length) return; await sb('docs?on_conflict=col,id', {method: 'POST', body: JSON.stringify(rows.map(r => ({...r, updated_at: new Date().toISOString()})))}); }

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
    items.push({title: strip(tag(b, 'title')), url: link, date: isNaN(date) ? null : date, summary: strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 260)});
  }
  return items.filter(i => i.title && i.url);
}
const STOP = new Set('the a an of and or to in on for with at by from is are be le la les un une des de du et ou en au aux pour par sur avec dans est sont son ses sa new nouveau nouvelle jeu game games jeux video trailer bande annonce'.split(' '));
const words = t => new Set(norm(t).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
const sim = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / Math.max(1, Math.min(a.size, b.size)); };
function category(t) {
  const n = norm(t);
  if (/\b(test|review|critique|notre avis)\b/.test(n)) return 'Test';
  if (/\b(rumeur|rumor|rumour|leak|fuite|insider)\b/.test(n)) return 'Rumeur';
  if (/\b(direct|showcase|state of play|conference|keynote|nintendo direct|xbox games showcase|game awards|gamescom|summer game fest)\b/.test(n)) return 'Conférence';
  if (/\b(date de sortie|sortie|release date|launches|out now|disponible|available now)\b/.test(n)) return 'Sortie';
  return 'Actu';
}

/* ---------- IGDB ---------- */
let tok = null;
async function igdb(ep, body) {
  if (!tok) { const t = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${TW_ID}&client_secret=${TW_SECRET}&grant_type=client_credentials`, {method: 'POST'}); if (!t.ok) throw new Error(`Twitch ${t.status}`); tok = (await t.json()).access_token; }
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.igdb.com/v4/${ep}`, {method: 'POST', headers: {'Client-ID': TW_ID, Authorization: `Bearer ${tok}`, 'Content-Type': 'text/plain'}, body});
    if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
    if (!r.ok) throw new Error(`IGDB ${ep} ${r.status} : ${await r.text()}`);
    await sleep(300); return r.json();
  }
  throw new Error('IGDB : trop de requêtes');
}

/* ---------- Programme ---------- */
const report = {startedAt: new Date().toISOString(), feeds: [], errors: []};
try {
  const cfg = JSON.parse(readFileSync(new URL('./news-sources.json', import.meta.url), 'utf8'));
  const since = Date.now() - 36 * 3600e3, all = [];
  for (const s of cfg.sources || []) {
    try {
      const r = await fetch(s.url, {headers: {'User-Agent': 'PressStartBot/1.0 (+collection personnelle)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml'}});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const GAMING = /\b(jeux? video|jeu|jeux|gaming|gamer|game|games|console|playstation|ps5|ps4|xbox|nintendo|switch|steam|epic games|manette|esport|e-sport|trailer|dlc|remaster|remake|rpg|fps|mmo|zelda|mario|pokemon|sony|sega|capcom|ubisoft|bandai|square enix|konami|rockstar|bethesda|blizzard)\b/;
      const items = parseFeed(await r.text()).filter(i => !i.date || i.date >= since).filter(i => !s.filter || GAMING.test(norm(i.title + ' ' + i.summary)));
      items.forEach(i => all.push({...i, source: s.name, lang: s.lang || 'en'}));
      report.feeds.push({name: s.name, items: items.length}); log(`✓ ${s.name} : ${items.length} articles`);
    } catch (e) { report.feeds.push({name: s.name, error: e.message}); log(`⚠ ${s.name} : ${e.message}`); }
  }
  /* regroupement des articles qui parlent de la même chose */
  const clusters = [];
  for (const a of all) {
    const w = words(a.title); let best = null, bs = 0;
    for (const c of clusters) { const s2 = sim(w, c.w); if (s2 > bs) { bs = s2; best = c; } }
    if (best && bs >= 0.6) { best.items.push(a); best.w = new Set([...best.w, ...w]); } else clusters.push({w, items: [a]});
  }
  const articles = clusters.map(c => {
    const srcs = [...new Set(c.items.map(i => i.source))];
    const main = c.items.find(i => i.lang === 'fr') || c.items[0];
    return {title: main.title, summary: main.summary, lang: main.lang, url: main.url, source: main.source, category: category(c.items.map(i => i.title).join(' ')), confirmations: srcs.length, others: srcs.length > 1 ? srcs.length - 1 : 0, sources: srcs, date: main.date ? new Date(main.date).toISOString() : null};
  }).sort((a, b) => b.confirmations - a.confirmations || Date.parse(b.date || 0) - Date.parse(a.date || 0)).slice(0, 48);
  log(`${all.length} articles lus → ${articles.length} sujets`);
  /* traduction en français des sujets anglophones (si la clé Anthropic est fournie) */
  if (env.ANTHROPIC_API_KEY) {
    const en = articles.map((a, i) => [i, a]).filter(([, a]) => a.lang !== 'fr');
    if (en.length) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify({model: env.ANTHROPIC_MODEL_FAST || 'claude-haiku-5-5', max_tokens: 8000, messages: [{role: 'user', content: 'Traduis en français naturel ces titres et résumés d\'articles de presse jeu vidéo. Garde les noms de jeux, de studios et de consoles tels quels. Réponds uniquement avec un JSON : [{"i":0,"title":"…","summary":"…"}].\n\n' + JSON.stringify(en.map(([i, a]) => ({i, title: a.title, summary: a.summary})))}]})});
        const d = await r.json(), txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
        let n = 0; for (const t of arr) { const a = articles[t.i]; if (a && t.title) { a.titleEn = a.title; a.title = t.title; if (t.summary) { a.summaryEn = a.summary; a.summary = t.summary; } a.lang = 'fr'; n++; } }
        log(`${n} sujets traduits en français`);
      } catch (e) { log(`⚠ traduction : ${e.message}`); }
    }
  } else log('Traduction ignorée : secret ANTHROPIC_API_KEY absent');

  /* sorties : 60 prochains jours sur les plateformes suivies */
  const now = Math.floor(Date.now() / 1000), end = now + 60 * 86400, rel = new Map();
  for (let off = 0; off < 2000; off += 500) {
    const rows = await igdb('release_dates', `fields date,game.name,game.url,platform.name,platform.abbreviation; where date >= ${now - 86400} & date <= ${end} & game.hypes > 0; sort date asc; limit 500; offset ${off};`);
    for (const r of rows) {
      if (!r.game || !r.date) continue;
      const k = key(r.game.name) + '|' + new Date(r.date * 1000).toISOString().slice(0, 10);
      const e = rel.get(k) || {title: r.game.name, date: new Date(r.date * 1000).toISOString(), platforms: [], url: r.game.url || ''};
      const pn = r.platform && (r.platform.abbreviation || r.platform.name); if (pn && !e.platforms.includes(pn)) e.platforms.push(pn);
      rel.set(k, e);
    }
    if (rows.length < 500) break;
  }
  const releases = [...rel.values()];
  log(`${releases.length} sorties à venir`);

  /* conférences et événements */
  let conferences = [];
  try {
    const ev = await igdb('events', `fields name,start_time,live_stream_url,event_networks.url; where start_time >= ${now - 6 * 3600}; sort start_time asc; limit 30;`);
    conferences = ev.filter(e => e.start_time).map(e => ({name: e.name, date: new Date(e.start_time * 1000).toISOString(), url: e.live_stream_url || (e.event_networks || [])[0]?.url || ''}));
  } catch (e) { log(`⚠ conférences : ${e.message}`); }
  log(`${conferences.length} conférences à venir`);

  const day = new Intl.DateTimeFormat('fr-CA', {timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const used = report.feeds.filter(f => f.items).map(f => f.name);
  const sourceLinks = (cfg.sources || []).filter(x => used.includes(x.name)).map(x => { let u = ''; try { u = new URL(x.url).origin; } catch {} return {name: x.name, url: u}; });
  const edition = {day, updatedAt: Date.now(), headline: articles[0] || null, articles, releases, conferences, sources: used, sourceLinks, robot: true};
  await upsert([{col: 'news_editions', id: day, data: edition}, {col: 'news', id: 'edition', data: edition}]);
  report.day = day; report.articles = articles.length; report.releases = releases.length; report.conferences = conferences.length;
  log(`Édition du ${day} ${DRY ? '(essai, rien enregistré)' : 'enregistrée'}`);
} catch (e) { report.errors.push(String(e.message || e)); console.error(e); }
report.finishedAt = new Date().toISOString();
await upsert([{col: 'robot', id: 'news-last-run', data: report}]).catch(() => {});
if (report.errors.length) process.exit(1);
