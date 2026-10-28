// Press Start · robot « Base de jeux » : MobyGames + IGDB → Supabase
// Lancé par GitHub Actions (chaque nuit, ou à la main). Node 20+, aucune dépendance.
// Secrets attendus : SUPABASE_URL, SUPABASE_SECRET_KEY, MOBYGAMES_API_KEY, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
// Variables facultatives : PLATFORMS (noms séparés par des virgules), MOBY_MAX_REQ (300 par défaut), DRY_RUN=1

const env = process.env;
const SB = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SBK = env.SUPABASE_SECRET_KEY;
const MOBY = env.MOBYGAMES_API_KEY;
const TW_ID = env.TWITCH_CLIENT_ID, TW_SECRET = env.TWITCH_CLIENT_SECRET;
const MOBY_MAX = +(env.MOBY_MAX_REQ || 300);
const DRY = env.DRY_RUN === '1';
const ONLY = (env.PLATFORMS || '').split(',').map(s => s.trim()).filter(Boolean);
const CHUNK = 400;

for (const [k, v] of Object.entries({SUPABASE_URL: SB, SUPABASE_SECRET_KEY: SBK, MOBYGAMES_API_KEY: MOBY, TWITCH_CLIENT_ID: TW_ID, TWITCH_CLIENT_SECRET: TW_SECRET})) {
  if (!v) { console.error(`Secret manquant : ${k}`); process.exit(1); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const key = s => norm(s).replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- Supabase (table docs : col, id, data) ---------- */
async function sb(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {...opts, headers: {apikey: SBK, Authorization: `Bearer ${SBK}`, 'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates', ...(opts.headers || {})}});
  if (!r.ok) throw new Error(`Supabase ${r.status} : ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
async function readCol(col) {
  const out = []; let from = 0;
  for (;;) {
    const rows = await sb(`docs?select=id,data&col=eq.${encodeURIComponent(col)}`, {headers: {Range: `${from}-${from + 999}`, Prefer: 'count=none'}});
    out.push(...rows); if (rows.length < 1000) break; from += 1000;
  }
  return out;
}
async function upsert(rows) {
  if (DRY || !rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    await sb('docs?on_conflict=col,id', {method: 'POST', body: JSON.stringify(rows.slice(i, i + 200).map(r => ({...r, updated_at: new Date().toISOString()})))});
  }
}

/* ---------- MobyGames ---------- */
let mobyReq = 0, mobyLast = 0;
async function moby(path, params = {}) {
  if (mobyReq >= MOBY_MAX) throw Object.assign(new Error('quota'), {quota: true});
  const wait = 1100 - (Date.now() - mobyLast); if (wait > 0) await sleep(wait);
  const u = new URL(`https://api.mobygames.com/v1/${path}`);
  Object.entries({...params, api_key: MOBY}).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let attempt = 0; attempt < 4; attempt++) {
    mobyLast = Date.now(); mobyReq++;
    const r = await fetch(u);
    if (r.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`MobyGames ${r.status} : ${await r.text()}`);
    return r.json();
  }
  throw new Error('MobyGames : trop de requêtes');
}

/* ---------- IGDB ---------- */
let igdbToken = null;
async function igdb(endpoint, body) {
  if (!igdbToken) {
    const t = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${TW_ID}&client_secret=${TW_SECRET}&grant_type=client_credentials`, {method: 'POST'});
    if (!t.ok) throw new Error(`Twitch ${t.status} : ${await t.text()}`);
    igdbToken = (await t.json()).access_token;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {method: 'POST', headers: {'Client-ID': TW_ID, Authorization: `Bearer ${igdbToken}`, 'Content-Type': 'text/plain'}, body});
    if (r.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`IGDB ${r.status} : ${await r.text()}`);
    await sleep(300);
    return r.json();
  }
  throw new Error('IGDB : trop de requêtes');
}
const IGDB_REGION = {1: 'EU', 2: 'NA', 3: 'EU', 4: 'EU', 5: 'JP', 8: 'WW'};

/* ---------- Correspondance des plateformes ---------- */
function bestMatch(names, list, getNames) {
  const keys = names.map(key).filter(Boolean);
  return list.find(p => getNames(p).some(n => keys.includes(key(n)))) || null;
}

/* ---------- Jaquettes et illustrations de MES jeux (copiées dans le stockage Supabase) ---------- */
const OWNED_MAX = +(env.OWNED_MAX || 40);
async function storeImage(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`image ${r.status}`);
  const type = r.headers.get('content-type') || 'image/jpeg', buf = Buffer.from(await r.arrayBuffer());
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (DRY) return id;
  const u = await fetch(`${SB}/storage/v1/object/assets/${id}`, {method: 'POST', headers: {apikey: SBK, Authorization: `Bearer ${SBK}`, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000'}, body: buf});
  if (!u.ok) throw new Error(`stockage ${u.status} : ${await u.text()}`);
  return id;
}
async function ownedImages(cat) {
  const games = (await readCol('games')).filter(r => r.data && r.data.kind !== 'wish' && (!r.data.coverId || !r.data.artId) && !r.data.artTried);
  const out = {checked: 0, covers: 0, arts: 0}; report.owned = out;
  log(`Images de ma collection : ${games.length} jeux à compléter (max ${OWNED_MAX} par passage)`);
  for (const r of games.slice(0, OWNED_MAX)) {
    const g = r.data, name = String(g.name || '').replace(/"/g, ''); if (!name) continue;
    out.checked++;
    try {
      const res = await igdb('games', `search "${name}"; fields name,cover.image_id,artworks.image_id,screenshots.image_id,platforms.name,platforms.abbreviation; limit 8;`);
      const cons = (g.consoles || []).map(key);
      const pick = res.find(x => key(x.name) === key(name) && (x.platforms || []).some(pl => cons.includes(key(pl.name)) || cons.includes(key(pl.abbreviation)))) || res.find(x => key(x.name) === key(name)) || res[0];
      const patch = {artTried: true};
      if (pick) {
        if (!g.coverId && pick.cover?.image_id) { patch.coverId = await storeImage(`https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${pick.cover.image_id}.jpg`); out.covers++; }
        const artImg = pick.artworks?.[0]?.image_id || pick.screenshots?.[0]?.image_id;
        if (!g.artId && artImg) { patch.artId = await storeImage(`https://images.igdb.com/igdb/image/upload/t_1080p/${artImg}.jpg`); out.arts++; }
      }
      await upsert([{col: 'games', id: r.id, data: {...g, ...patch}}]);
    } catch (e) { log(`  ⚠ ${name} : ${e.message}`); }
  }
  log(`  ${out.covers} jaquettes et ${out.arts} illustrations ajoutées`);
}

/* ---------- Programme ---------- */
const report = {startedAt: new Date().toISOString(), platforms: [], mobyRequests: 0, errors: []};
try {
  const cat = await readCol('catalog');
  const stateRow = (await readCol('robot')).find(r => r.id === 'catalog-state');
  const state = stateRow ? stateRow.data : {next: 0, offsets: {}};
  log(`${cat.length} plateformes dans la Base de jeux`);

  const mobyPlats = (await moby('platforms')).platforms || [];
  const igdbPlats = await igdb('platforms', 'fields id,name,abbreviation,alternative_name; limit 500;');

  let targets = cat.map(c => ({id: c.id, ...c.data}));
  if (ONLY.length) targets = targets.filter(p => [p.name, ...(p.aliases || [])].some(n => ONLY.map(key).includes(key(n))));
  else { const s = state.next % Math.max(1, targets.length); targets = targets.slice(s).concat(targets.slice(0, s)); }

  for (const p of targets) {
    const names = [p.name, ...(p.aliases || [])];
    const mp = bestMatch(names, mobyPlats, x => [x.platform_name]);
    const ip = bestMatch(names, igdbPlats, x => [x.name, x.abbreviation, x.alternative_name].filter(Boolean));
    const pr = {platform: p.name, moby: mp ? mp.platform_name : null, igdb: ip ? ip.name : null, added: 0, enriched: 0, conflicts: 0, complete: false};
    report.platforms.push(pr);
    if (!mp && !ip) { log(`⚠ ${p.name} : introuvable sur MobyGames et IGDB`); continue; }
    log(`▶ ${p.name} (Moby : ${pr.moby || '—'} · IGDB : ${pr.igdb || '—'})`);

    /* IGDB : liste complète de la plateforme */
    const ig = new Map();
    if (ip) {
      for (let off = 0; ; off += 500) {
        const rows = await igdb('games', `fields id,name,first_release_date,alternative_names.name,alternative_names.comment,release_dates.date,release_dates.platform,release_dates.region,release_dates.release_region,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,genres.name,url,cover.image_id,artworks.image_id,screenshots.image_id; where platforms = (${ip.id}); sort id asc; limit 500; offset ${off};`);
        for (const g of rows) ig.set(key(g.name), g);
        if (rows.length < 500) break;
      }
    }

    /* MobyGames : par pages, avec reprise d'une nuit à l'autre */
    const mo = new Map(); let mOff = (state.offsets && state.offsets[p.id]) || 0, mobyDone = !mp;
    if (mp) {
      try {
        for (;;) {
          const d = await moby('games', {platform: mp.platform_id, format: 'normal', limit: 100, offset: mOff});
          for (const g of d.games || []) mo.set(key(g.title), g);
          mOff += 100; if (!d.games || d.games.length < 100) { mobyDone = true; break; }
        }
      } catch (e) { if (!e.quota) throw e; log(`  quota MobyGames atteint, reprise la prochaine fois (offset ${mOff})`); }
    }
    state.offsets = state.offsets || {}; state.offsets[p.id] = mobyDone ? 0 : mOff;

    /* Fusion avec les jeux déjà présents */
    const chunkCol = `catalog/${p.id}/chunks`;
    const chunks = (await readCol(chunkCol)).map(r => ({id: r.id, ...r.data})).sort((a, b) => (a.n || 0) - (b.n || 0));
    const have = new Map(); chunks.forEach(c => (c.g || []).forEach((row, i) => have.set(key(row[0]), {c, i})));
    const changed = new Set(), added = [];
    const allKeys = new Set([...ig.keys(), ...mo.keys()]);
    for (const k of allKeys) {
      const a = mo.get(k), b = ig.get(k);
      const title = (a && a.title) || (b && b.name) || '';
      const yMoby = a && (a.platforms || []).find(x => x.platform_id === mp.platform_id)?.first_release_date?.slice(0, 4);
      const yIgdb = b && (b.first_release_date ? String(new Date(b.first_release_date * 1000).getUTCFullYear()) : '');
      const dev = b && (b.involved_companies || []).filter(c => c.developer).map(c => c.company?.name).filter(Boolean).join(', ');
      const pub = b && (b.involved_companies || []).filter(c => c.publisher).map(c => c.company?.name).filter(Boolean).join(', ');
      const regions = b ? [...new Set((b.release_dates || []).filter(r => !ip || r.platform === ip.id).map(r => IGDB_REGION[r.region ?? r.release_region]).filter(Boolean))] : [];
      const fr = b && (b.alternative_names || []).find(n => /fran[cç]/i.test(n.comment || ''))?.name || '';
      const jp = b && (b.alternative_names || []).find(n => /japan/i.test(n.comment || ''))?.name || '';
      const genre = (a && (a.genres || []).filter(g => /basic genres/i.test(g.genre_category || '')).map(g => g.genre_name)[0]) || (b && (b.genres || [])[0]?.name) || '';
      const url = (a && a.moby_url) || (b && b.url) || '';
      const igImg = (id, size) => id ? `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg` : '';
      const cover = (b && igImg(b.cover?.image_id, 't_cover_big')) || (a && a.sample_cover && a.sample_cover.image) || '';
      const art = (b && (igImg(b.artworks?.[0]?.image_id, 't_1080p') || igImg(b.screenshots?.[0]?.image_id, 't_1080p'))) || '';
      const conflicts = {};
      if (yMoby && yIgdb && yMoby !== yIgdb) conflicts.y = {moby: yMoby, igdb: yIgdb};
      const year = yMoby || yIgdb || '';
      const fresh = [title, year, dev || '', pub || '', regions.length ? regions : [], fr, jp, genre, url, a ? String(a.game_id) : '', '', Object.keys(conflicts).length ? conflicts : null, b ? String(b.id) : '', cover, art];
      if (Object.keys(conflicts).length) pr.conflicts++;
      const ex = have.get(k);
      if (ex) {
        const row = ex.c.g[ex.i]; let touched = false;
        for (let f = 0; f < fresh.length; f++) {
          if (f === 0 || f === 10) continue;
          const empty = row[f] == null || row[f] === '' || (Array.isArray(row[f]) && !row[f].length);
          if (empty && fresh[f] != null && fresh[f] !== '' && !(Array.isArray(fresh[f]) && !fresh[f].length)) { row[f] = fresh[f]; touched = true; }
        }
        if (touched) { changed.add(ex.c); pr.enriched++; }
      } else { added.push(fresh); pr.added++; }
    }
    /* Nouveaux jeux : dans des blocs « auto-… » pour ne pas toucher aux blocs existants (et à leurs jaquettes) */
    let last = chunks.filter(c => String(c.id).startsWith('auto-')).pop();
    let maxN = chunks.reduce((m, c) => Math.max(m, c.n || 0), 0);
    for (const row of added) {
      if (!last || (last.g || []).length >= CHUNK) { maxN++; last = {id: `auto-${maxN}`, n: maxN, g: []}; chunks.push(last); }
      last.g.push(row); changed.add(last);
    }
    const total = chunks.reduce((s, c) => s + (c.g || []).length, 0);
    pr.complete = mobyDone;
    await upsert([...changed].map(c => ({col: chunkCol, id: c.id, data: {n: c.n, g: c.g}})));
    await upsert([{col: 'catalog', id: p.id, data: {...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'id')), count: total, updatedAt: Date.now(), source: 'MobyGames + IGDB', status: mobyDone && ip ? 'complet' : (p.status || '')}}]);
    log(`  +${pr.added} nouveaux · ${pr.enriched} enrichis · ${pr.conflicts} désaccords · total ${total}`);
    if (mobyReq >= MOBY_MAX) break;
  }
  if (!ONLY.length) state.next = (state.next || 0) + report.platforms.filter(p => p.complete).length;
  await ownedImages(cat);
  await upsert([{col: 'robot', id: 'catalog-state', data: state}]);
} catch (e) {
  report.errors.push(String(e.message || e)); console.error(e);
}
report.mobyRequests = mobyReq; report.finishedAt = new Date().toISOString();
await upsert([{col: 'robot', id: 'catalog-last-run', data: report}]).catch(() => {});
log('Terminé', JSON.stringify({platforms: report.platforms.length, moby: mobyReq, errors: report.errors.length}));
if (report.errors.length) process.exit(1);
