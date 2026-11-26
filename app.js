/* 코너 — 격투기 일정·결과 앱
   실시간 데이터: ESPN 공개 스코어보드 피드 (UFC · PFL · Bellator · RIZIN)
   블랙컴뱃: Sherdog 기록을 GitHub Actions가 6시간마다 data/blackcombat.json으로 저장
   큐레이션 데이터: data.js (레전드 매치, 유명 선수 특징, 복싱 기록) */
(() => {
'use strict';

const API = 'https://site.api.espn.com/apis/site/v2/sports/';
const LEAGUES = {
  ufc:      { label:'UFC',      path:'mma/ufc',      from:2011 },
  pfl:      { label:'PFL',      path:'mma/pfl',      from:2018 },
  bellator: { label:'Bellator', path:'mma/bellator', from:2011, to:2025 },
  rizin:    { label:'RIZIN',    path:'mma/rizin',    from:2015 },
  bc:       { label:'블랙컴뱃',  local:'data/blackcombat.json', from:2021 }
};
const LIVE_LEAGUES = ['ufc','pfl','rizin'];
const SCHED_ORGS = [...LIVE_LEAGUES, 'bc'];
const NOW_Y = new Date().getFullYear();
const FIRST_Y = NOW_Y - 15;
const POLL_LIVE = 30e3, POLL_IDLE = 180e3;

const WC = { 'Super welterweight':'슈퍼웰터급','Super lightweight':'슈퍼라이트급','W Strawweight':'여성 스트로급','W Flyweight':'여성 플라이급','W Bantamweight':'여성 밴텀급','W Featherweight':'여성 페더급','Bridgerweight':'브리저급','Cruiserweight':'크루저급','Super middleweight':'슈퍼미들급','Light middleweight':'라이트미들급','Light welterweight':'라이트웰터급','Super featherweight':'슈퍼페더급','Super bantamweight':'슈퍼밴텀급','Super flyweight':'슈퍼플라이급','Light flyweight':'라이트플라이급','Minimumweight':'미니멈급','Light heavyweight':'라이트헤비급', 'Heavyweight':'헤비급','Light Heavyweight':'라이트헤비급','Middleweight':'미들급','Welterweight':'웰터급','Lightweight':'라이트급','Featherweight':'페더급','Bantamweight':'밴텀급','Flyweight':'플라이급','Strawweight':'스트로급',"Women's Strawweight":'여성 스트로급',"Women's Flyweight":'여성 플라이급',"Women's Bantamweight":'여성 밴텀급',"Women's Featherweight":'여성 페더급','Catchweight':'계약 체중','Super Heavyweight':'슈퍼헤비급','Open Weight':'무차별급','Atomweight':'아톰급',"Women's Atomweight":'여성 아톰급','Pound for Pound':'무차별급' };
const METHOD = { Kotko:'KO/TKO', Ko:'KO/TKO', Tko:'KO/TKO', Submission:'서브미션', Decision:'판정', Dq:'실격', Disqualification:'실격', Draw:'무승부' };

/* ───────── 유틸 */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOf = n => String(n||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
const kst = (d, o) => new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', ...o }).format(new Date(d));
const dayISO = s => s.length === 10 ? s + 'T12:00:00+09:00' : s;
const ymd = d => d.toISOString().slice(0,10).replace(/-/g,'');
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem('corner:'+k)); } catch { return null; } },
  set(k,v){ try { localStorage.setItem('corner:'+k, JSON.stringify(v)); } catch { try { Object.keys(localStorage).filter(x=>x.startsWith('corner:y:')).forEach(x=>localStorage.removeItem(x)); localStorage.setItem('corner:'+k, JSON.stringify(v)); } catch {} } }
};
async function getJSON(url, ms=12000){
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP '+r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

/* ───────── 큐레이션 인덱스 */
const FMAP = new Map();
FIGHTERS.forEach(f => { FMAP.set(keyOf(f.name), f); (f.alias||[]).forEach(a => FMAP.set(keyOf(a), f)); });
const famous = n => FMAP.get(keyOf(n));
const IDS = new Map(Object.entries(window.ESPN_IDS||{}).map(([n,id]) => [keyOf(n), id]));
FIGHTERS.forEach(f => { f.id = IDS.get(keyOf(f.name)); });

/* ───────── 위키백과: 체급별 챔피언 · 타이틀전 기록 · 사진 */
const WIKI_OK = new Set([...FIGHTERS.map(f=>f.name), ...LEGENDS.flatMap(l=>[l.a,l.b]), ...BOXING_RESULTS.flatMap(b=>[b.a,b.b])].map(keyOf));
const WIKI_TITLE = {};
const WIKI = (() => { const w = store.get('wiki') || {}; Object.keys(w).forEach(k => { if (w[k] == null) delete w[k]; }); return w; })();
let wq = new Set(), wqT = 0;
function wikiImg(n){ const v = WIKI[n]; if (v === undefined) queueWiki(n); return v || ''; }
function queueWiki(n){ wq.add(n); clearTimeout(wqT); wqT = setTimeout(flushWiki, 250); }
async function flushWiki(){
  const names = [...wq].filter(n => WIKI[n] === undefined); wq.clear();
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i+40), titles = chunk.map(n => WIKI_TITLE[n] || n);
    try {
      const j = await getJSON('https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=360&titles=' + encodeURIComponent(titles.join('|')));
      const q = j.query || {};
      const follow = t => { (q.normalized||[]).forEach(x => { if (x.from===t) t = x.to; }); (q.redirects||[]).forEach(x => { if (x.from===t) t = x.to; }); return t; };
      const pages = new Map((q.pages||[]).map(p => [p.title, p]));
      chunk.forEach((n,k) => { WIKI[n] = pages.get(follow(titles[k]))?.thumbnail?.source || ''; });
    } catch {}
  }
  store.set('wiki', WIKI); applyWiki();
}
function applyWiki(){
  document.querySelectorAll('img[data-pname]:not([src])').forEach(img => { const u = WIKI[img.dataset.pname]; if (u) { img.className = 'wk'; img.dataset.wk = 1; img.src = u; } });
}
window.__imgFail = img => {
  const n = img.dataset.pname;
  if (img.dataset.wk || !WIKI_OK.has(keyOf(n))) return img.remove();
  img.dataset.wk = 1; img.removeAttribute('src');
  const u = WIKI[n]; if (u) { img.className = 'wk'; img.src = u; } else if (u === undefined) queueWiki(n); else img.remove();
};

const CH = { ufc:null, boxing:null, titles:[], at:0 };
const CHAMP = new Map(), TITLE_IDX = new Map();
const MON = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
const pDate = s => { const m = /([A-Z][a-z]+)\.? (\d{1,2}), (\d{4})/.exec(s||''); const mo = m && MON[m[1].slice(0,3)]; return mo ? `${m[3]}-${String(mo).padStart(2,'0')}-${m[2].padStart(2,'0')}` : null; };
const clean = s => (s||'').replace(/\[[^\]]*\]/g,'').replace(/\s+/g,' ').trim();
const WP = p => `https://en.wikipedia.org/w/api.php?action=parse&page=${p}&prop=text&format=json&formatversion=2&origin=*`;
const wikiHref = a => { const h = a?.getAttribute('href')||''; return h.includes('/wiki/') ? decodeURIComponent(h.split('/wiki/')[1]).replace(/_/g,' ') : ''; };
const firstName = cell => [...cell.querySelectorAll('a')].find(a => clean(a.textContent) && !/champion|vacant/i.test(a.textContent) && !a.closest('sup'));
function tablesWithHeads(html){
  const doc = new DOMParser().parseFromString(html, 'text/html'); const out = []; let h = '';
  const w = doc.createTreeWalker(doc.body, 1); let n;
  while ((n = w.nextNode())) { if (/^H[2-4]$/.test(n.tagName)) h = clean(n.textContent); else if (n.tagName==='TABLE' && n.classList.contains('wikitable')) out.push({ h, t:n }); }
  return out;
}
function parseUFC(html){
  const tabs = tablesWithHeads(html);
  const cur = (x, women) => !x ? [] : [...x.t.rows].slice(1).map(r => { const c = [...r.cells]; if (c.length < 3) return null; const a = firstName(c[1]);
    return { div:(women?"Women's ":'') + clean(c[0].textContent), name:clean(a?.textContent || c[1].textContent), wiki:wikiHref(a), since:pDate(c[2].textContent), def:clean(c[3]?.textContent) }; }).filter(Boolean);
  const titles = [];
  tabs.filter(x => /Championship$|BMF Title/.test(x.h) && /No\./.test(x.t.rows[0]?.textContent||'')).forEach(({ h, t }) => {
    const bmf = /BMF/.test(h), div = h.replace(/ Championship$/, '');
    [...t.rows].slice(1).forEach(r => {
      const c = [...r.cells]; if (c.length < 5) return;
      const a = firstName(c[1]); const champ = clean(a?.textContent); if (!champ) return;
      const txt = clean(c[1].textContent), interim = /interim/i.test(txt);
      const dcell = c.find(x => /^[A-Z][a-z]+\.? \d{1,2}, \d{4}$/.test(clean(x.textContent)));
      const m = /def\.\s*(.+?)(?:\s+for\b|\s*$)/.exec(txt);
      if (m && dcell) titles.push({ d:pDate(dcell.textContent), a:champ, b:clean(m[1].replace(/\(\d+\)/g,'')), i:interim?1:0, x:bmf?1:0, v:div });
      for (const d of clean(c[c.length-1].textContent).matchAll(/def\.\s*(.+?)\s+at\s+(.+?)\s+on\s+([A-Z][a-z]+\.? \d{1,2}, \d{4})/g))
        titles.push({ d:pDate(d[3]), a:champ, b:clean(d[1].replace(/\(\d+\)/g,'')), i:interim?1:0, x:bmf?1:0, v:div });
    });
  });
  return { ufc:{ men:cur(tabs.find(x=>x.h==='Men' && /Division/.test(x.t.rows[0]?.textContent)), false), women:cur(tabs.find(x=>x.h==='Women' && /Division/.test(x.t.rows[0]?.textContent)), true) }, titles };
}
function parseBoxing(html){
  return tablesWithHeads(html).filter(x => /WBA/.test(x.t.rows[0]?.textContent||'') && x.t.rows[1]).map(({ h, t }) => {
    const hdr = [...t.rows[0].cells].map(c => clean(c.textContent)), belts = {};
    [...t.rows[1].cells].forEach((c, i) => { const txt = clean(c.textContent), a = firstName(c);
      belts[hdr[i]] = (!a || /^vacant/i.test(txt)) ? null : { name:clean(a.textContent), wiki:wikiHref(a), rec:(/(\d+–\d+(?:–\d+)?(?: \(\d+\))? \(\d+ KO\))/.exec(txt)||[])[1]||'', since:pDate(txt) }; });
    return { div:clean(h.replace(/\(.*$/,'')), lbs:(/\(([^)]*)\)/.exec(h)||[])[1]||'', belts };
  });
}
const boxDiv = s => { const m = /^(.*?)\s*([+\d].*)?$/.exec(String(s||'')); return { name:(m[1]||s).split('/')[0].trim(), lbs:(m[2]||'').split(/ or |\//)[0].trim() }; };
function indexChamps(){
  CHAMP.clear(); TITLE_IDX.clear();
  const add = (n, info, wiki) => { const k = keyOf(n); (CHAMP.get(k) || CHAMP.set(k, []).get(k)).push(info); WIKI_OK.add(k); if (wiki) WIKI_TITLE[n] = wiki; };
  if (CH.ufc) [...CH.ufc.men, ...CH.ufc.women].forEach(c => add(c.name, { org:'UFC', div:c.div }, c.wiki));
  (CH.boxing||[]).forEach(d => Object.entries(d.belts).forEach(([b, c]) => c && add(c.name, { org:b, div:boxDiv(d.div).name }, c.wiki)));
  if (BC.evs.length) bcChamps().forEach(c => c.name && add(c.name, { org:'블랙컴뱃', div:c.div }));
  (CH.titles||[]).forEach(t => { if (t.d) (TITLE_IDX.get(t.d) || TITLE_IDX.set(t.d, []).get(t.d)).push(t); });
}
async function loadChampions(force){
  const c = store.get('champs');
  if (c && !CH.at) { Object.assign(CH, c); indexChamps(); }
  if (c && !force && Date.now() - c.at < 6*36e5) return false;
  const [u, b] = await Promise.allSettled([ getJSON(WP('List_of_UFC_champions'), 30000), getJSON(WP('List_of_current_world_boxing_champions'), 30000) ]);
  let ok = false;
  if (u.status==='fulfilled' && u.value.parse) { const r = parseUFC(u.value.parse.text); if (r.ufc.men.length) { CH.ufc = r.ufc; CH.titles = r.titles; ok = true; } }
  if (b.status==='fulfilled' && b.value.parse) { const r = parseBoxing(b.value.parse.text); if (r.length) { CH.boxing = r; ok = true; } }
  if (ok) { CH.at = Date.now(); store.set('champs', { ufc:CH.ufc, boxing:CH.boxing, titles:CH.titles, at:CH.at }); indexChamps(); }
  return ok;
}
const toks = n => String(n||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
function same(x, y){ if (keyOf(x) === keyOf(y)) return true; const a = toks(x), b = toks(y); if (a[a.length-1] === b[b.length-1]) return true; return a.some(t => t.length > 3 && b.includes(t)); }
const normDiv = s => String(s||'').toLowerCase().replace(/^w(omen'?s)?\s+/, 'w').replace(/\s+/g,'');
function titleOf(f, e){
  if (e.lg === 'bc') return f.ttl ? { k:'타이틀전' } : null;
  if (f._tv === CH.at && f._t !== undefined) return f._t;
  let r = null; const d = new Date(f.date || e.date);
  for (const off of [0,-1,1]) {
    const k = new Date(d.getTime() + off*864e5).toISOString().slice(0,10);
    const hit = (TITLE_IDX.get(k)||[]).find(t => (same(t.a,f.a.name) && same(t.b,f.b.name)) || (same(t.a,f.b.name) && same(t.b,f.a.name)));
    if (hit) { r = { k: hit.x ? 'BMF 타이틀전' : hit.i ? '잠정 타이틀전' : '타이틀전' }; break; }
  }
  if (!r && e.lg==='ufc' && !f.done && f.rounds===5) {
    const ch = [f.a,f.b].map(s => (CHAMP.get(keyOf(s.name))||[]).find(c => c.org==='UFC')).find(Boolean);
    if (ch && normDiv(ch.div) === normDiv(f.wc)) r = { k:'타이틀전' };
  }
  f._t = r; f._tv = CH.at; return r;
}
const titleBadge = t => t ? `<span class="mthd title">${esc(t.k)}</span>` : '';
const isChamp = n => CHAMP.has(keyOf(n));
function popScore(f, e){
  let s = (famous(f.a.name)?2:0) + (famous(f.b.name)?2:0);
  if (titleOf(f, e)) s += 3; if (isChamp(f.a.name) || isChamp(f.b.name)) s += 1; if (f === mainOf(e)) s += 1;
  return s;
}
const LEGEND_BY_DAY = new Map();
LEGENDS.forEach((l,i) => { l.i = i; const k = l.date; (LEGEND_BY_DAY.get(k) || LEGEND_BY_DAY.set(k,[]).get(k)).push(l); });
function legendFor(dateISO, a, b){
  const d = new Date(dateISO);
  for (const off of [0,-1,1]) {
    const k = new Date(d.getTime() + off*864e5).toISOString().slice(0,10);
    const hit = (LEGEND_BY_DAY.get(k)||[]).find(l => { const s = new Set([keyOf(l.a), keyOf(l.b)]); return s.has(keyOf(a)) && s.has(keyOf(b)); });
    if (hit) return hit;
  }
  return null;
}

/* 선수 인덱스: 피드에서 본 모든 선수 (사진 id, 국기, 최신 전적) */
const PEOPLE = new Map();
function indexPerson(s, date){
  const k = keyOf(s.name); const p = PEOPLE.get(k);
  if (!p) PEOPLE.set(k, { name:s.name, id:s.id, flag:s.flag, country:s.country, rec:s.rec, at:date });
  else if (date >= p.at) Object.assign(p, { id:s.id||p.id, flag:s.flag||p.flag, country:s.country||p.country, rec:s.rec||p.rec, at:date });
}

/* ───────── 정규화 */
function parseMethod(c){
  for (const d of (c.details||[])) {
    const m = /Unofficial Winner (\w+)/i.exec(d.type?.text||'');
    if (m) return METHOD[m[1]] || m[1];
  }
  return '';
}
function norm(ev, lg){
  const fights = (ev.competitions||[]).map(c => {
    const st = c.status?.type || {};
    const sides = (c.competitors||[]).slice().sort((x,y)=>(x.order||0)-(y.order||0)).map(x => ({
      id: x.athlete ? x.id : null, name: x.athlete?.displayName || x.athlete?.fullName || '미정',
      flag: x.athlete?.flag?.href || '', country: x.athlete?.flag?.alt || '',
      rec: (x.records||[]).find(r=>r.type==='total')?.summary || '', w: !!x.winner,
      belt: (x.athlete?.accolades||[]).some(a=>a.type==='Belt')
    }));
    while (sides.length < 2) sides.push({ name:'미정', rec:'', w:false });
    return { id:c.id, date:c.date, wc:c.type?.abbreviation||'', rounds:c.format?.regulation?.periods||3,
      state: st.state||'pre', done: !!st.completed, rd: c.status?.period||0, clk: c.status?.displayClock||'',
      method: st.completed ? parseMethod(c) : '', a:sides[0], b:sides[1] };
  });
  const st = fights.some(f=>f.state==='in') ? 'in' : (fights.length && fights.every(f=>f.state==='post')) ? 'post' : (ev.status?.type?.state||'pre');
  const v = ev.competitions?.[0]?.venue;
  const e = { id:ev.id, lg, name:ev.name||'', date:ev.date, state:st,
    venue: v?.fullName||'', city:[v?.address?.city, v?.address?.country].filter(Boolean).join(', '), fights };
  fights.forEach(f => { [f.a,f.b].forEach(s => s.id && indexPerson(s, f.date||e.date)); f.legend = f.done ? legendFor(e.date, f.a.name, f.b.name) : null; });
  return e;
}
const EVENTS = new Map();
const put = e => (EVENTS.set(e.lg+':'+e.id, e), e);
const mainOf = e => e.fights[e.fights.length-1];

/* ───────── 블랙컴뱃 */
const BC = { evs:[], fighters:{}, byName:new Map(), img:new Map(), at:0, updated:'' };
const RES_DONE = new Set(['win','loss','draw','nc','no_contest']);
function bcMethod(m){
  const s = String(m||''), base = s.split('(')[0].trim().toLowerCase(), det = (/\(([^)]+)\)/.exec(s)||[])[1] || '';
  const k = /^t?ko/.test(base) ? 'KO/TKO' : /^sub/.test(base) ? '서브미션' : /^dec/.test(base) ? '판정' : /^draw/.test(base) ? '무승부' : /no contest|^nc/.test(base) ? 'NC' : /^dq|disq/.test(base) ? '실격' : s;
  return { k, det };
}
const bcImg = n => BC.img.get(keyOf(n)) || '';
function bcSide(s){
  const p = BC.fighters[s.fid];
  return { id:null, fid:s.fid, name:s.name || '미정', flag:'', country:p?.nat || '', rec: s.rec || (p ? `${p.w}-${p.l}-${p.d}` : ''), w: s.res === 'win', belt:false };
}
function normBC(ev){
  const date = ev.date + 'T09:00:00Z';
  const fights = (ev.fights||[]).slice().sort((x,y) => (x.main - y.main) || (x.no - y.no)).map((f,i) => {
    const done = RES_DONE.has(f.a.res) || RES_DONE.has(f.b.res), m = bcMethod(f.method);
    return { id:`bc:${ev.id}:${f.no||i}`, date, wc:f.wc, rounds: f.title ? 5 : 3, state: done ? 'post' : 'pre', done,
      rd: done ? (+f.rd || 0) : 0, clk: done ? (f.time||'') : '', method: done ? m.k : '', det: done ? m.det : '', ttl: !!f.title, a: bcSide(f.a), b: bcSide(f.b), legend:null };
  });
  const st = fights.length && fights.every(f => f.done) ? 'post' : 'pre';
  return { id:ev.id, lg:'bc', name:ev.name, date, state:st, venue:ev.venue||'', city:'', fights };
}
async function loadBC(force){
  if (!force && BC.at && Date.now() - BC.at < 10*60e3) return BC.evs;
  if (BC.p) return BC.p;
  BC.p = (async () => {
    const j = await getJSON(`${LEAGUES.bc.local}?v=${Math.floor(Date.now()/6e5)}`, 15000);
    BC.fighters = j.fighters || {}; BC.updated = j.updated || '';
    Object.entries(BC.fighters).forEach(([fid, p]) => { if (p.name) { BC.byName.set(keyOf(p.name), fid); if (p.img) BC.img.set(keyOf(p.name), p.img); } });
    (j.events||[]).forEach(e => (e.fights||[]).forEach(f => [f.a, f.b].forEach(x => {
      const k = keyOf(x.name); if (!x.fid) return;
      if (!BC.byName.has(k)) BC.byName.set(k, x.fid);
      if (x.img && !BC.img.has(k)) BC.img.set(k, x.img);
    })));
    BC.evs = (j.events||[]).map(normBC).filter(e => e.fights.length).map(put);
    BC.evs.forEach(e => e.fights.forEach(f => [f.a, f.b].forEach(x => x.name !== '미정' && indexPerson(x, e.date))));
    BC.at = Date.now(); KO_CACHE.clear(); indexChamps(); indexBCPeople(); return BC.evs;
  })();
  try { return await BC.p; } finally { BC.p = null; }
}

/* 블랙컴뱃 안에서의 성적 · 유명 선수 판단 · 주 체급 */
const BCI = new Map();
const bcInfo = n => BCI.get(keyOf(n));
function indexBCPeople(){
  BCI.clear();
  const champs = new Set(bcChamps().map(c => keyOf(c.name)));
  const evs = BC.evs.slice().sort((a,b) => b.date.localeCompare(a.date));
  evs.forEach(e => e.fights.forEach(f => [f.a, f.b].forEach(x => {
    if (!x.name || x.name === '미정') return;
    const k = keyOf(x.name), op = x === f.a ? f.b : f.a;
    const i = BCI.get(k) || BCI.set(k, { name:x.name, fid:x.fid, w:0, l:0, d:0, tw:0, tf:0, last:e.date, wc:'', wcs:[] }).get(k);
    if (f.done) { if (x.w) i.w++; else if (op.w) i.l++; else if (f.method !== 'NC') i.d++; }
    if (f.ttl) { i.tf++; if (x.w) i.tw++; }
    if (BC_ORDER.includes(f.wc)) i.wcs.push(f.wc);
  })));
  BCI.forEach((i, k) => {
    const p = BC.fighters[i.fid] || {};
    i.nick = p.nick || ''; i.p = p;
    i.wc = i.wcs[0] || (BC_ORDER.includes(p.cls) ? p.cls : '') || p.cls || '기타';
    i.champ = champs.has(k);
    i.tag = i.champ ? '챔피언' : i.tw ? '전 챔피언' : i.tf ? '타이틀 도전' : i.w >= 4 ? `블랙컴뱃 ${i.w}승` : '';
    i.famous = !!i.tag;
    i.score = (i.champ ? 1000 : 0) + i.tw * 60 + i.tf * 25 + i.w * 6 - i.l * 2;
    i.rec = p.w != null ? `${p.w}-${p.l}-${p.d}` : '';
  });
}

/* ───────── 전적이 비어 있는 선수: ESPN 기록 API로 채우기 */
const RECS = store.get('recs') || {};
let rq = new Set(), rqT = 0;
const idOf = (n, id) => id || famous(n)?.id || PEOPLE.get(keyOf(n))?.id || null;
function recOf(n, rec, id){
  if (rec) return esc(rec);
  id = idOf(n, id); if (!id) return '';
  const c = RECS[id];
  if (c && Date.now() - c[1] < 864e5) return esc(c[0]);
  rq.add(id); clearTimeout(rqT); rqT = setTimeout(flushRecs, 150);
  return `<span data-rec-id="${esc(id)}">${c ? esc(c[0]) : '…'}</span>`;
}
function fillRec(id, sum){
  document.querySelectorAll(`[data-rec-id="${CSS.escape(String(id))}"]`).forEach(el => { el.textContent = sum || '—'; });
  if (sum) PEOPLE.forEach(p => { if (p.id === id && !p.rec) p.rec = sum; });
  const top = sheetStack[sheetStack.length-1]; if (top && $('#sheet').classList.contains('on')) top.html = $('#sheetBody').innerHTML;
}
async function flushRecs(){
  const ids = [...rq]; rq.clear();
  const one = async id => {
    try {
      const j = await getJSON(`https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}/records`, 10000);
      const sum = (j.items||[]).find(x => x.type === 'total')?.summary || j.items?.[0]?.summary || '';
      RECS[id] = [sum, Date.now()]; fillRec(id, sum);
    } catch { fillRec(id, RECS[id]?.[0] || ''); }
  };
  for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i+6).map(one));
  const ks = Object.keys(RECS); if (ks.length > 1500) ks.sort((a,b) => RECS[a][1] - RECS[b][1]).slice(0, ks.length-1500).forEach(k => delete RECS[k]);
  store.set('recs', RECS);
}

/* ───────── 선수 상세 기록: ESPN → Sherdog(블랙컴뱃) → 위키백과 */
const STANCE = { Orthodox:'오소독스', Southpaw:'사우스포', Switch:'스위치', 'Open Stance':'오픈 스탠스' };
const DETAIL = new Map();
function cacheDetail(key, d){
  DETAIL.set(key, d); store.set('det:'+key, d);
  const idx = (store.get('detIdx') || []).filter(k => k !== key); idx.push(key);
  while (idx.length > 40) { try { localStorage.removeItem('corner:det:'+idx.shift()); } catch {} }
  store.set('detIdx', idx); return d;
}
function cachedDetail(key, ttl){
  const d = DETAIL.get(key) || store.get('det:'+key);
  return d && Date.now() - d.at < ttl ? d : null;
}
async function espnDetail(id){
  const key = 'e'+id, hit = cachedDetail(key, 12*36e5); if (hit) return hit;
  const base = 'https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/'+id;
  const [a, s, r] = await Promise.allSettled([getJSON(base, 15000), getJSON(base+'/stats', 15000), getJSON(`https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}/records`, 10000)]);
  if (a.status !== 'fulfilled') throw new Error('athlete');
  const A = a.value.athlete || {}, map = a.value.eventsMap || {};
  const rs = Object.fromEntries(((r.value?.items||[]).find(x=>x.type==='total') || r.value?.items?.[0] || {}).stats?.map(x => [x.name, x.value]) || []);
  const sumTxt = (A.statsSummary?.statistics||[]).find(x => x.name==='wins-losses-draws')?.displayValue || '';
  const [sw, sl, sd] = sumTxt.split('-').map(Number);
  const w = rs.wins ?? sw ?? 0, l = rs.losses ?? sl ?? 0;
  const rec = { w, l, d: rs.draws ?? sd ?? 0, nc: rs.noContests || 0, ko: rs.tkos || 0, sub: rs.submissions || 0, lko: rs.tkoLosses || 0, lsub: rs.submissionLosses || 0, tw: rs.titleWins || 0, tl: rs.titleLosses || 0 };
  rec.dec = Math.max(0, w - rec.ko - rec.sub); rec.ldec = Math.max(0, l - rec.lko - rec.lsub);
  const hist = (a.value.events||[]).map(u => map[u]).filter(x => x && x.gameResult).map(x => ({
    res: x.gameResult, opp: x.opponent?.displayName || '', oppId: x.opponent?.id || '', date: x.gameDate, ev: x.name || '',
    method: espnMethod(x.status?.result), rd: x.status?.period || '', time: x.status?.displayClock || '', title: !!x.titleFight }));
  const st = { n:0, ssl:0, ssa:0, kd:0, tdl:0, tda:0, sm:0 };
  (s.value?.categories||[]).forEach(c => {
    const ix = Object.fromEntries((c.labels||[]).map((l,i) => [l.trim(), i]));
    (c.statistics||[]).forEach((row, i) => {
      const v = k => ix[k] == null ? 0 : (parseFloat(row.stats[ix[k]]) || 0);
      if ('SSL' in ix) { st.n++; st.ssl += v('SSL'); st.ssa += v('SSA'); st.kd += v('KD'); }
      if ('TDL' in ix) { st.tdl += v('TDL'); st.tda += v('TDA'); }
      if ('SM' in ix) st.sm += v('SM');
    });
  });
  const dob = A.displayDOB ? `${A.age ? A.age+'세 · ' : ''}${A.displayDOB}` : A.age ? A.age+'세' : '';
  const bio = [['키', A.displayHeight], ['체중', A.displayWeight], ['리치', A.displayReach], ['나이', dob], ['스탠스', STANCE[A.stance?.text] || A.stance?.text],
    ['체급', wc(A.weightClass?.text)], ['소속팀', A.association?.name], ['스타일', A.displayFightingStyle], ['국적', A.citizenship || A.flag?.alt]];
  return cacheDetail(key, { at:Date.now(), src:'ESPN', sum: rec.w||rec.l ? `${rec.w}-${rec.l}-${rec.d}` : sumTxt, rec, hist, st, bio, nick:A.nickname || '' });
}
const DEC = { unanimous:'만장일치', split:'스플릿', majority:'다수' };
function espnMethod(r){
  const n = String(r?.name||'').toLowerCase(), d = String(r?.displayName||'');
  if (/^kotko|^ko|^tko/.test(n)) return 'KO/TKO';
  if (/^sub/.test(n)) return '서브미션';
  if (/^dec/.test(n) || /^decision/i.test(d)) { const k = Object.keys(DEC).find(k => d.toLowerCase().includes(k)); return '판정' + (k ? ` (${DEC[k]})` : ''); }
  if (/draw/.test(n)) return '무승부';
  if (/^dq|disq/.test(n)) return '실격';
  if (/contest/.test(n)) return 'NC';
  return d;
}
const shDate = s => { const m = /([A-Za-z]{3}) \/ (\d{1,2}) \/ (\d{4})/.exec(s||''); const mo = m && MON[m[1]]; return mo ? `${m[3]}-${String(mo).padStart(2,'0')}-${m[2].padStart(2,'0')}` : ''; };
function sherdogDetail(fid){
  const p = BC.fighters[fid]; if (!p) return null;
  const rec = { w:p.w, l:p.l, d:p.d, nc:p.nc, ko:p.ko, sub:p.sub, dec:p.dec, lko:p.lko, lsub:p.lsub, ldec:p.ldec };
  const hist = (p.hist||[]).map(h => { const m = bcMethod(h.method); return { res: {win:'W',loss:'L',draw:'D',nc:'NC',no_contest:'NC'}[h.res] || '', opp:h.opp, oppId:'', date: shDate(h.date), ev:h.ev, method: m.k + (m.det ? ` (${m.det})` : ''), rd:h.rd, time:h.time, title:false }; }).filter(h => h.res);
  const bio = [['키', p.height ? `${p.height}${p.heightCm ? ` (${p.heightCm}cm)` : ''}` : ''], ['체중', p.weight], ['나이', p.age && p.age!=='N/A' ? `${p.age}세${p.born ? ' · '+p.born : ''}` : p.born], ['체급', wc(p.cls)], ['소속팀', p.team], ['국적', p.nat]];
  return { at:Date.now(), src:'Sherdog', sum:`${p.w}-${p.l}-${p.d}`, rec, hist, st:null, bio, nick:p.nick || '' };
}
async function wikiDetail(n, boxing){
  const key = 'w'+keyOf(n), hit = cachedDetail(key, 7*864e5); if (hit) return hit;
  const tries = [...new Set([WIKI_TITLE[n] || n, boxing ? n+' (boxer)' : n+' (fighter)'])];
  for (const t of tries) {
    let j; try { j = await getJSON(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(t)}&redirects=1&prop=text&section=0&format=json&formatversion=2&origin=*`); } catch { continue; }
    const box = new DOMParser().parseFromString(j.parse?.text || '', 'text/html').querySelector('.infobox'); if (!box) continue;
    box.querySelectorAll('style,sup,.noprint').forEach(x => x.remove());
    const R = {}, B = {}; let sec = '', grp = '';
    box.querySelectorAll('tr').forEach(tr => {
      const th = tr.querySelector('th'), td = tr.querySelector('td'); if (!th) return;
      const lab = clean(th.textContent).toLowerCase();
      if (!td) { sec = lab; grp = ''; return; }
      const val = clean(td.textContent);
      if (/record/.test(sec)) { if (/^(wins|losses)$/.test(lab)) grp = lab; R[(/^by /.test(lab) ? grp+' ' : '') + lab] = parseInt(val, 10) || 0; }
      else B[lab] = val;
    });
    if (!('wins' in R)) continue;
    const g = (...ks) => ks.map(k => R[k]).find(v => v != null) || 0;
    const rec = { w:g('wins'), l:g('losses'), d:g('draws'), nc:g('no contests'),
      ko: g('wins by knockout', 'wins by ko', 'win by ko', 'wins by ko/tko'), sub:g('wins by submission'), dec:g('wins by decision'),
      lko:g('losses by knockout', 'losses by ko', 'loss by ko'), lsub:g('losses by submission'), ldec:g('losses by decision') };
    const bio = [['키', B.height], ['리치', B.reach], ['나이', (b => { const d = /(\d{4})-(\d\d)-(\d\d)/.exec(b), a = d && [0, Math.floor((Date.now() - Date.UTC(+d[1], d[2]-1, +d[3])) / (365.2425*864e5))]; return d ? `${a ? a[1]+'세 · ' : ''}${d[1]}.${d[2]}.${d[3]}` : b.slice(0, 40); })(B.born||'')], ['스탠스', STANCE[B.stance] || B.stance], ['국적', B.nationality], ['체급', B.division ? wc(B.division.split(/[\s,(]{2,}/)[0]) : '']];
    return cacheDetail(key, { at:Date.now(), src:'위키백과', sum:`${rec.w}-${rec.l}-${rec.d}`, rec, hist:[], st:null, bio, boxing:/boxing/.test(Object.keys(R).join(' ')) || !!boxing });
  }
  return cacheDetail(key, { at:Date.now(), src:'', none:true });
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function detailHTML(D, me){
  if (!D || D.none) return '';
  const r = D.rec || {}, bio = (D.bio||[]).filter(x => x[1]);
  const seg = (x, n, c) => x ? `<i class="${c}" style="width:${(x/n*100).toFixed(1)}%"></i>` : '';
  const bar = (lab, n, ko, sub, dec, cls) => n ? `<div class="brk ${cls}"><div class="bh"><b>${n}</b><span>${lab}</span></div>
      <div class="bar" role="img" aria-label="${lab} ${n}: KO/TKO ${ko}, 서브미션 ${sub}, 판정 ${dec}">${seg(ko,n,'ko')}${seg(sub,n,'sub')}${seg(dec,n,'dec')}</div>
      <div class="bl"><span><i class="ko"></i>${D.boxing?'KO':'KO/TKO'} ${ko}</span>${D.boxing?'':`<span><i class="sub"></i>서브미션 ${sub}</span>`}<span><i class="dec"></i>판정 ${dec}</span></div></div>` : '';
  const other = [r.d ? `무승부 ${r.d}` : '', r.nc ? `무효 ${r.nc}` : '', (r.tw || r.tl) ? `타이틀전 ${r.tw}승 ${r.tl}패` : ''].filter(Boolean).join(' · ');
  const decW = D.boxing ? Math.max(0, r.w - r.ko) : r.dec, decL = D.boxing ? Math.max(0, r.l - r.lko) : r.ldec;
  const st = D.st && D.st.n ? D.st : null;
  const res = x => x.res === 'W' ? '<b class="win">승</b>' : x.res === 'L' ? '<b style="color:var(--red)">패</b>' : x.res === 'D' ? '<b style="color:var(--muted)">무</b>' : '<b style="color:var(--muted)">NC</b>';
  const when = d => /^\d{4}-\d\d-\d\d/.test(d||'') ? `${d.slice(0,4)}.${d.slice(5,7)}.${d.slice(8,10)}` : esc(d||'');
  const hrow = x => `<button class="row hrow" data-f="${esc(x.opp)}"><span class="datebox" style="width:30px">${res(x)}</span><span class="main"><span class="t">vs ${nameHTML(x.opp)}</span>
      <span class="s">${x.title?'<span class="tt">타이틀전</span> · ':''}${x.method?esc(x.method)+' · ':''}${x.rd?`R${esc(x.rd)}${x.time?' '+esc(x.time):''} · `:''}${when(x.date)}${x.ev?' · '+esc(x.ev):''}</span></span>${chev}</button>`;
  const streak = (() => { const h = D.hist||[]; if (!h.length) return ''; const f = h[0].res; let n = 0; for (const x of h) { if (x.res === f) n++; else break; } return n >= 2 && (f==='W'||f==='L') ? `${n}연${f==='W'?'승':'패'}` : ''; })();
  return `${bio.length ? `<div class="card-sec">프로필</div><div class="bio">${bio.map(([k,v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
    ${(r.w || r.l) ? `<div class="card-sec">승패 내역</div><div class="brkwrap">${bar('승', r.w, r.ko, r.sub||0, decW, 'w')}${bar('패', r.l, r.lko, r.lsub||0, decL, 'l')}${other||streak?`<p class="brk-o">${[streak, other].filter(Boolean).join(' · ')}</p>`:''}</div>` : ''}
    ${st ? `<div class="card-sec">경기 기록 · ESPN 집계 ${st.n}경기</div><div class="stats st4">
      <div class="stat"><b>${pct(st.ssl, st.ssa)}%</b><small>유효타 적중률</small></div>
      <div class="stat"><b>${(st.ssl/st.n).toFixed(1)}</b><small>경기당 유효타</small></div>
      <div class="stat"><b>${st.kd}</b><small>넉다운</small></div>
      <div class="stat"><b>${st.tdl}<span class="of">/${st.tda}</span></b><small>테이크다운</small></div>
      <div class="stat"><b>${st.tda ? pct(st.tdl, st.tda)+'%' : '—'}</b><small>테이크다운 성공률</small></div>
      <div class="stat"><b>${st.sm}</b><small>서브미션 시도</small></div></div>` : ''}
    ${(D.hist||[]).length ? `<div class="card-sec">전체 경기 기록 · ${D.hist.length}경기</div><div class="group">${D.hist.map(hrow).join('')}</div>` : ''}
    <p class="foot">상세 기록 출처: ${esc(D.src)}${D.src==='ESPN'?' (ESPN이 중계한 경기 기준)':''}.</p>`;
}

/* ───────── 데이터 로딩 */
const state = { upcoming:[], recent:[], live:[], lastSync:0, err:false, tab:'schedule',
  schedOrg:'all', year:NOW_Y, resOrg:'all', legendK:'all', fK:'all', q:'',
  chK:'ufc', favs: new Set(store.get('favs')||[]), seen: store.get('seen')||{} };

async function loadUpcoming(){
  const from = ymd(new Date(Date.now()-10*864e5)), to = ymd(new Date(Date.now()+200*864e5));
  const res = await Promise.allSettled(LIVE_LEAGUES.map(lg =>
    getJSON(`${API}${LEAGUES[lg].path}/scoreboard?dates=${from}-${to}&limit=200`).then(j => (j.events||[]).map(ev => put(norm(ev, lg))))
  ));
  const lo = Date.now() - 45*864e5, hi = Date.now() + 200*864e5;
  res.push(...await Promise.allSettled([loadBC().then(evs => evs.filter(e => { const t = new Date(e.date).getTime(); return t > lo && t < hi; }))]));
  const ok = res.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
  if (!ok.length && res.every(r=>r.status==='rejected')) throw new Error('feed');
  ok.sort((a,b)=>new Date(a.date)-new Date(b.date));
  const now = Date.now();
  state.live = ok.filter(e=>e.state==='in');
  state.upcoming = ok.filter(e=>e.state==='pre' && new Date(e.date).getTime() > now - 12*36e5);
  state.recent = ok.filter(e=>e.state==='post').reverse();
  store.set('upcoming', { at:now, events: ok });
  detectNewResults(ok);
}
function restoreUpcoming(){
  const c = store.get('upcoming'); if (!c) return false;
  const evs = c.events.map(put); const now = Date.now();
  evs.forEach(e => e.fights.forEach(f => [f.a,f.b].forEach(s => s.id && indexPerson(s, f.date||e.date))));
  state.live = evs.filter(e=>e.state==='in');
  state.upcoming = evs.filter(e=>e.state==='pre' && new Date(e.date).getTime() > now - 12*36e5);
  state.recent = evs.filter(e=>e.state==='post').reverse();
  state.lastSync = c.at; return true;
}
const yearMem = new Map();
async function loadYear(lg, y, force){
  const k = `y:${lg}:${y}`;
  if (!force && yearMem.has(k)) return yearMem.get(k);
  const cached = LEAGUES[lg].local ? null : store.get(k);
  const fresh = cached && (y < NOW_Y - 0 ? true : Date.now() - cached.at < 10*60e3);
  if (LEAGUES[lg].local) { const evs = (await loadBC(force)).filter(e => e.date.startsWith(String(y))); yearMem.set(k, evs); return evs; }
  if (cached && fresh && !force) { const evs = cached.events.map(put); yearMem.set(k, evs); return evs; }
  try {
    const j = await getJSON(`${API}${LEAGUES[lg].path}/scoreboard?dates=${y}&limit=300`, 20000);
    const evs = (j.events||[]).map(ev => put(norm(ev, lg)));
    yearMem.set(k, evs); store.set(k, { at:Date.now(), events:evs }); return evs;
  } catch (e) { if (cached) { const evs = cached.events.map(put); yearMem.set(k, evs); return evs; } throw e; }
}

/* 새로 끝난 경기 알림 */
function detectNewResults(evs){
  const first = !Object.keys(state.seen).length; const fresh = [];
  evs.forEach(e => e.fights.forEach(f => { if (f.done && !state.seen[f.id]) { state.seen[f.id] = 1; fresh.push(f); } }));
  const keys = Object.keys(state.seen); if (keys.length > 3000) keys.slice(0, keys.length-3000).forEach(k=>delete state.seen[k]);
  store.set('seen', state.seen);
  if (!first && fresh.length) {
    const f = fresh[fresh.length-1]; const w = f.a.w ? f.a : f.b.w ? f.b : null;
    toast(w ? `결과 업데이트 · ${disp(w.name)} 승${f.method?' ('+f.method+')':''}` : `결과 업데이트 · ${fresh.length}경기`);
  }
}

/* ───────── 표시 헬퍼 */
const KO_SUR = { Kim:'김',Lee:'이',Yi:'이',Rhee:'이',Park:'박',Pak:'박',Choi:'최',Choe:'최',Jung:'정',Jeong:'정',Chung:'정',Kang:'강',Cho:'조',Jo:'조',Yoon:'윤',Yun:'윤',Jang:'장',Chang:'장',Lim:'임',Im:'임',Han:'한',Oh:'오',Seo:'서',Suh:'서',Shin:'신',Sin:'신',Kwon:'권',Gwon:'권',Hwang:'황',Ahn:'안',An:'안',Song:'송',Yoo:'유',Yu:'유',Ryu:'류',Hong:'홍',Jeon:'전',Jun:'전',Ko:'고',Go:'고',Moon:'문',Mun:'문',Yang:'양',Son:'손',Bae:'배',Baek:'백',Paik:'백',Heo:'허',Huh:'허',Nam:'남',Noh:'노',Roh:'노',Ha:'하',Kwak:'곽',Seong:'성',Sung:'성',Cha:'차',Joo:'주',Ju:'주',Woo:'우',Ku:'구',Koo:'구',Gu:'구',Min:'민',Na:'나',Ra:'라',Jin:'진',Ji:'지',Eom:'엄',Um:'엄',Chae:'채',Won:'원',Cheon:'천',Bang:'방',Gong:'공',Hyun:'현',Ham:'함',Byun:'변',Yeom:'염',Yeo:'여',Chu:'추',Do:'도',So:'소',Seok:'석',Sun:'선',Seol:'설',Ma:'마',Gil:'길',Wi:'위',Pyo:'표',Myung:'명',Ki:'기',Ban:'반',Wang:'왕',Ok:'옥',In:'인',Maeng:'맹',Je:'제',Mo:'모',Tak:'탁',Yong:'용',Ye:'예',Kook:'국',Kuk:'국',Gwak:'곽',Shim:'심',Sim:'심',Seon:'선',You:'유',Yeon:'연',Hyeon:'현' };
const KO_SYL = { A:'아',Ah:'아',Ae:'애',Bi:'비',Bin:'빈',Bit:'빛',Bo:'보',Bok:'복',Bong:'봉',Bum:'범',Beom:'범',Byeol:'별',Byeong:'병',Byung:'병',Cha:'차',Chae:'채',Chan:'찬',Chang:'창',Cheol:'철',Chul:'철',Cheon:'천',Chi:'치',Chun:'춘',Choong:'충',Chung:'충',Da:'다',Dae:'대',Dam:'담',Deok:'덕',Duk:'덕',Do:'도',Dong:'동',Doo:'두',Du:'두',Eo:'어',Eui:'의',Ui:'의',Eun:'은',Ga:'가',Gang:'강',Geon:'건',Gun:'건',Geun:'근',Keun:'근',Gi:'기',Ki:'기',Gil:'길',Goo:'구',Gu:'구',Guk:'국',Kook:'국',Gook:'국',Kuk:'국',Gwang:'광',Kwang:'광',Gyeom:'겸',Gyeong:'경',Kyeong:'경',Kyung:'경',Gyo:'교',Kyo:'교',Gyu:'규',Kyu:'규',Gyun:'균',Kyun:'균',Ha:'하',Hae:'해',Haeng:'행',Hak:'학',Han:'한',Hee:'희',Hui:'희',Heon:'헌',Heum:'흠',Ho:'호',Hong:'홍',Hoon:'훈',Hun:'훈',Hwa:'화',Hwan:'환',Hwi:'휘',Hyang:'향',Hye:'혜',Hyeok:'혁',Hyuk:'혁',Hyeon:'현',Hyun:'현',Hyeong:'형',Hyung:'형',Hyo:'효',Il:'일',In:'인',Jae:'재',Je:'제',Ji:'지',Jin:'진',Jo:'조',Jong:'종',Joo:'주',Ju:'주',Jun:'준',Joon:'준',Jung:'정',Jeong:'정',Kang:'강',Kwon:'권',Mi:'미',Min:'민',Mo:'모',Moon:'문',Mun:'문',Myung:'명',Myeong:'명',Na:'나',Nam:'남',Ok:'옥',Pil:'필',Ra:'라',Rae:'래',Ran:'란',Ri:'리',Rim:'림',Rin:'린',Ryeong:'령',Ryong:'룡',San:'산',Sang:'상',Se:'세',Seo:'서',Seok:'석',Suk:'석',Seol:'설',Seon:'선',Sun:'선',Seong:'성',Sung:'성',Seop:'섭',Sub:'섭',Seung:'승',Shin:'신',Si:'시',Sik:'식',Sol:'솔',Song:'송',Soo:'수',Su:'수',Soon:'순',Tae:'태',Taek:'택',Tak:'탁',Wan:'완',Wi:'위',Won:'원',Woo:'우',Wook:'욱',Uk:'욱',Woon:'운',Woong:'웅',Ung:'웅',Ye:'예',Yeo:'여',Yeol:'열',Yeon:'연',Yeop:'엽',Yup:'엽',Yerin:'예린',Yong:'용',Yoo:'유',Yu:'유',Yoon:'윤',Yun:'윤',Young:'영',Yeong:'영',Yul:'율',Ku:'구',Yui:'의',Un:'운',Kyoel:'결',Gyeol:'결',Joong:'중',Ug:'욱',Gwan:'관',Kwan:'관',Gon:'곤',Kon:'곤',Ik:'익',Pyo:'표',Nak:'낙',Mok:'목',Myeung:'명',Pyoung:'평',Pyeong:'평' };
const KO_CACHE = new Map();
function korName(n){
  if (!n) return '';
  if (KO_CACHE.has(n)) return KO_CACHE.get(n);
  let r = (window.BC_KO||{})[n] || '';
  if (!r) {
    const t = n.replace(/-/g, ' ').split(/\s+/).map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
    const nat = BC.fighters[BC.byName.get(keyOf(n))]?.nat;
    const sur = KO_SUR[t[t.length-1]], given = t.slice(0, -1).map(x => KO_SYL[x]);
    if (t.length >= 2 && t.length <= 4 && sur && given.every(Boolean) && (!nat || nat === 'South Korea')) r = sur + given.join('');
  }
  KO_CACHE.set(n, r); return r;
}
const disp = n => famous(n)?.ko || korName(n) || n;
function nameHTML(n, { tag=false, en=false } = {}){
  const f = famous(n);
  const belt = isChamp(n) ? '<span class="belt" title="현 챔피언" aria-label="현 챔피언">C</span>' : '';
  if (!f) { const ko = korName(n), b = bcInfo(n);
    return `<span class="fname">${esc(ko || n)}</span>${b?.famous ? '<span class="mark" aria-hidden="true"></span>' : ''}${belt}${tag && b?.tag ? `<span class="tag">${esc(b.tag)}</span>` : ''}${en && ko ? `<span class="s" style="display:block">${esc(n)}${b?.nick ? ` "${esc(b.nick)}"` : ''}</span>` : ''}`; }
  return `<span class="fname">${esc(f.ko)}</span><span class="mark" title="${esc(f.tag)}" aria-hidden="true"></span>${belt}${tag?`<span class="tag">${esc(f.tag)}</span>`:''}${en?`<span class="s" style="display:block">${esc(n)}${f.nick?` "${esc(f.nick)}"`:''}</span>`:''}`;
}
const shot = id => id ? `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png` : '';
function avatar(n, id){
  const f = famous(n), p = PEOPLE.get(keyOf(n)); id = id || f?.id || p?.id;
  const ini = esc((disp(n)||'?').replace(/[^\p{L}]/gu,'').slice(0,1));
  const bi = !id && bcImg(n);
  const src = id ? shot(id) : bi || (WIKI_OK.has(keyOf(n)) ? wikiImg(n) : '');
  return `<span class="avatar">${ini}<img ${src?`src="${esc(src)}"`:''} class="${id||bi?'':'wk'}${bi?' sd':''}" ${id?'':'data-wk="1"'} data-pname="${esc(n)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="__imgFail(this)"></span>`;
}
const orgBadge = lg => `<span class="org ${lg}">${esc(LEAGUES[lg]?.label || (lg==='boxing'?'복싱':lg))}</span>`;
const mClass = m => /KO|TKO/.test(m) ? 'mthd ko' : /서브미션/.test(m) ? 'mthd sub' : 'mthd';
const WCL = Object.fromEntries(Object.entries(WC).map(([k,v]) => [k.toLowerCase(), v]));
const wc = s => { const c = /^(\d+)\s*lb\s*catchweight$/i.exec(String(s||'')); return c ? `계약 체중 ${c[1]}lb` : WC[s] || WCL[String(s||'').toLowerCase()] || s; };
function resultLine(f){
  if (f.state==='in') return `<span class="live">LIVE</span> <span>${f.rd?f.rd+'라운드':'진행 중'}</span>`;
  if (!f.done) return '';
  const w = f.a.w ? f.a : f.b.w ? f.b : null;
  const m = f.method || (w ? '' : '무승부/NC');
  return `${w?`<span class="win">${esc(disp(w.name))} 승</span>`:''}${m?`<span class="${mClass(m)}">${esc(m)}</span>`:''}${f.det?`<span>${esc(f.det)}</span>`:''}${f.rd?`<span>R${f.rd} ${esc(f.clk)}</span>`:''}`;
}
const chev = '<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m1.5 1.5 5 5-5 5"/></svg>';
const star = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z"/></svg>';
const starO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.8z"/></svg>';

function eventRow(e, { results=false } = {}){
  const m = mainOf(e); const d = new Date(e.date);
  const leg = e.fights.some(f=>f.legend);
  const tb = m ? titleOf(m, e) : null;
  let sub;
  if (e.state==='in') sub = `<span class="live">LIVE</span> ${esc(e.city||e.venue)}`;
  else if (results || e.state==='post') { const w = m && (m.a.w?m.a:m.b.w?m.b:null); sub = m ? (w ? `${esc(disp(w.name))} 승${m.method?' · '+esc(m.method):''}` : (m.done ? '무승부/NC' : esc(e.venue))) : esc(e.venue); }
  else sub = `${kst(d,{hour:'numeric',minute:'2-digit'})} KST · ${esc(e.city||e.venue||'장소 미정')}`;
  return `<button class="row" data-ev="${e.lg}:${e.id}">
    <span class="datebox"><b>${kst(d,{day:'numeric'}).replace('일','')}</b><small>${kst(d,{weekday:'short'})}</small></span>
    <span class="main"><span class="t">${orgBadge(e.lg)} ${esc(e.name)}</span><span class="s">${tb?`<span class="tt">${esc(tb.k)}</span> · `:''}${leg?'<span class="lgd">레전드 매치</span> · ':''}${sub}</span></span>${chev}</button>`;
}
/* 인기 매치 카드 */
function popCard(e, f){
  const t = titleOf(f, e), w = f.done ? (f.a.w ? f.a : f.b.w ? f.b : null) : null;
  const side = s => `<div class="${w && w!==s ? 'lost' : ''}">${avatar(s.name, s.id)}<div class="n">${nameHTML(s.name)}</div><div class="r">${recOf(s.name, s.rec, s.id)}</div></div>`;
  return `<button class="pc" data-ev="${e.lg}:${e.id}">
    <div class="pm">${orgBadge(e.lg)}<span>${kst(f.date||e.date,{month:'numeric',day:'numeric',weekday:'short'})}</span><span>· ${esc(wc(f.wc))}</span></div>
    <div class="duo">${side(f.a)}<span class="vs">VS</span>${side(f.b)}</div>
    <div class="foot2">${titleBadge(t)}${f===mainOf(e)&&!t?'<span class="mthd">메인 이벤트</span>':''}${f.done?resultLine(f):''}</div></button>`;
}
function popularOf(evs, { done=false } = {}){
  const out = [];
  evs.forEach(e => e.fights.forEach(f => { if (f.done === done && f.a.name!=='미정') { const s = popScore(f, e); if (s >= 2) out.push({ e, f, s }); } }));
  return out;
}
function popStrip(list){
  if (!list.length) return '';
  const arrow = (dir, label, d) => `<button class="nav ${dir}" data-scroll="${d}" aria-label="${label}" ${d<0?'hidden':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d<0?'m14.5 6-6 6 6 6':'m9.5 6 6 6-6 6'}"/></svg></button>`;
  return `<div class="strip">${arrow('prev','이전 경기',-1)}<div class="pop">${list.map(x=>popCard(x.e, x.f)).join('')}</div>${arrow('next','다음 경기',1)}</div>`;
}
/* 마우스로도 가로 목록을 넘길 수 있게: 화살표 · 휠 · 드래그 */
function syncArrows(sc){
  const st = sc.closest('.strip'); if (!st) return;
  const max = sc.scrollWidth - sc.clientWidth - 2;
  st.querySelector('.nav.prev').hidden = sc.scrollLeft <= 2;
  st.querySelector('.nav.next').hidden = sc.scrollLeft >= max;
}
const HSCROLL = '.pop, .chips';
document.addEventListener('scroll', e => { if (e.target.matches?.('.pop')) syncArrows(e.target); }, true);
document.addEventListener('wheel', e => {
  const sc = e.target.closest?.(HSCROLL); if (!sc || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const max = sc.scrollWidth - sc.clientWidth; if (max <= 0) return;
  const next = Math.max(0, Math.min(max, sc.scrollLeft + e.deltaY));
  if (next === sc.scrollLeft) return;
  e.preventDefault(); sc.scrollLeft = next;
}, { passive:false });
(() => { let sc = null, x0 = 0, l0 = 0, moved = false;
  document.addEventListener('pointerdown', e => { moved = false; if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('[data-scroll]')) return; sc = e.target.closest(HSCROLL); if (!sc) return; x0 = e.clientX; l0 = sc.scrollLeft; });
  document.addEventListener('pointermove', e => { if (!sc) return; const dx = e.clientX - x0; if (!moved && Math.abs(dx) > 6) { moved = true; sc.classList.add('dragging'); } if (moved) sc.scrollLeft = l0 - dx; });
  document.addEventListener('pointerup', () => { if (sc) sc.classList.remove('dragging'); sc = null; });
  document.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
})();
function initStrips(){ document.querySelectorAll('.strip .pop').forEach(syncArrows); }
function groupByMonth(list, rowFn){
  let out = '', cur = '';
  list.forEach(x => { const m = kst(x.date, { year:'numeric', month:'long' }); if (m !== cur) { if (cur) out += '</div>'; cur = m; out += `<div class="month">${m}</div><div class="group">`; } out += rowFn(x); });
  return out + (cur ? '</div>' : '');
}

/* ───────── 일정 탭 */
function renderSchedule(){
  const orgs = ['all', ...SCHED_ORGS];
  const cnt = lg => state.upcoming.filter(e => lg==='all' || e.lg===lg).length;
  $('#schedOrgs').innerHTML = orgs.map(o => `<button class="chip" aria-pressed="${state.schedOrg===o}" data-sorg="${o}">${o==='all'?'전체':LEAGUES[o].label}<span class="n">${cnt(o)}</span></button>`).join('');
  const f = e => state.schedOrg==='all' || e.lg===state.schedOrg;
  const live = state.live.filter(f), up = state.upcoming.filter(f), recent = state.recent.filter(f);
  let heroEv = live[0], heroF = null;
  if (!heroEv) for (const [x, y] of (window.FEATURED||[])) {
    for (const e of up) { const f = e.fights.find(f => (keyOf(f.a.name)===keyOf(x) && keyOf(f.b.name)===keyOf(y)) || (keyOf(f.a.name)===keyOf(y) && keyOf(f.b.name)===keyOf(x))); if (f) { heroEv = e; heroF = f; break; } }
    if (heroEv) break;
  }
  heroEv = heroEv || up.find(e => mainOf(e));
  const heroFight = heroEv ? (heroF || mainOf(heroEv)) : null;
  const pop = popularOf(up.slice(0, 12)).filter(x => x.f !== heroFight)
    .sort((a,b) => new Date(a.f.date||a.e.date) - new Date(b.f.date||b.e.date) || b.s - a.s).slice(0, 16);
  $('#heroWrap').innerHTML = (heroEv ? poster(heroEv, heroFight) : '') +
    (pop.length ? `<div class="section-h"><h2>인기 매치</h2><span>스타·타이틀전 ${pop.length}경기</span></div>${popStrip(pop)}` : '');
  $('#liveWrap').innerHTML = live.length > 1 ? `<div class="section-h"><h2>지금 진행 중</h2></div><div class="group">${live.map(e=>eventRow(e)).join('')}</div>` : '';
  const rest = up.filter(e => e !== heroEv);
  $('#upcomingWrap').innerHTML = `<div class="section-h"><h2>다가오는 대회</h2><span>${up.length}개 · 한국 시간</span></div>` +
    (rest.length ? groupByMonth(rest, e => eventRow(e)) : `<div class="empty"><b>${heroEv?'이후 일정은 곧 발표돼요':'예정된 대회가 없어요'}</b>다른 단체를 골라 보거나 잠시 뒤 새로고침해 주세요.</div>`);
  const boxing = [...LEGENDS.filter(l=>l.sport==='boxing'), ...BOXING_RESULTS].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
  $('#recentWrap').innerHTML =
    (recent.length ? `<div class="section-h"><h2>최근 결과</h2><button class="s" data-goto="results" style="color:var(--blue);font-size:14px">모두 보기</button></div><div class="group">${recent.slice(0,4).map(e=>eventRow(e,{results:true})).join('')}</div>` : '') +
    (state.schedOrg==='all' ? `<div class="section-h"><h2>복싱</h2><span>주요 경기 기록</span></div><div class="group">${boxing.map(boxRow).join('')}</div>
    <p class="foot">UFC·PFL·RIZIN 일정과 결과는 ESPN 공개 피드에서 자동으로 받아와요. 경기 중에는 30초, 평소에는 3분마다 새로 고칩니다. 블랙컴뱃은 Sherdog 기록을 6시간마다 받아와요${BC.updated?` (마지막 ${ago(new Date(BC.updated).getTime())})`:''}. 복싱은 실시간 피드가 없어 주요 경기만 직접 기록해요.</p>` : '');
  tickCountdown(); initStrips();
}
function poster(e, m = mainOf(e)){
  const live = e.state==='in', idx = e.fights.indexOf(m), n = e.fights.length;
  const slot = idx === n-1 ? '메인 이벤트' : idx === n-2 ? '코메인 이벤트' : '주목할 경기';
  const t = titleOf(m, e), when = m.date || e.date;
  const surOf = n => { const parts = n.split(' '); return parts.length>1 ? parts.slice(1).join(' ') : n; };
  const longest = Math.max(surOf(m.a.name).length, surOf(m.b.name).length);
  const fs = `style="font-size:min(${Math.min(44, Math.floor(300/Math.max(longest,6)))}px, ${Math.min(9.5, +(70/Math.max(longest,6)).toFixed(2))}vw)"`;
  const sur = n => `<span class="sur" ${fs}>${esc(surOf(n))}</span>`;
  const face = (s, cls) => { const id = s.id || PEOPLE.get(keyOf(s.name))?.id, src = id ? shot(id) : bcImg(s.name);
    return `<div class="face ${cls}">${src?`<img src="${esc(src)}" referrerpolicy="no-referrer" class="${id?'':'sd'}" alt="" onerror="this.insertAdjacentHTML('afterend','<span class=ph aria-hidden=true>${esc((s.name||'?')[0])}</span>');this.remove()">`:`<span class="ph" aria-hidden="true">${esc((s.name||'?')[0])}</span>`}</div>`; };
  const sm = s => { const f = famous(s.name), r = recOf(s.name, s.rec, s.id); return `<small>${f?`${esc(f.ko)}<br>${esc(f.tag)}`:esc(s.country||'')}${r?`<br><b style="font-family:var(--f-display);font-size:15px">${r}</b>`:''}</small>`; };
  const enter = !poster.shown; poster.shown = true;
  return `<button class="poster ${enter?'enter':''} ${live?'is-live':''}" data-ev="${e.lg}:${e.id}" aria-label="${esc(e.name)} 자세히 보기">
    <div class="halves"></div><div class="grain"></div>
    <div class="top">${live?'<span class="live">LIVE</span>':orgBadge(e.lg)}<span class="slot">${slot}</span>${t?`<span class="slot gold">${esc(t.k)}</span>`:''}<span class="when">${live?'지금 진행 중':kst(when,{month:'numeric',day:'numeric',weekday:'short'})}</span></div>
    <div class="faces">${face(m.a,'a')}${face(m.b,'b')}</div>
    <div class="vs" aria-hidden="true">VS</div>
    <div class="names"><div class="nm a">${sur(m.a.name)}${sm(m.a)}</div><div class="nm b">${sur(m.b.name)}${sm(m.b)}</div></div>
    <div class="bottom"><div class="ev"><b>${esc(e.name)}</b>${esc(wc(m.wc))} ${m.rounds}라운드 · ${kst(when,{hour:'numeric',minute:'2-digit'})} KST</div>
    <div class="count" data-to="${when}" aria-label="남은 시간"><div><b data-u="d">0</b><small>일</small></div><div><b data-u="h">00</b><small>시간</small></div><div><b data-u="m">00</b><small>분</small></div><div><b data-u="s">00</b><small>초</small></div></div></div>
  </button>`;
}
function tickCountdown(){
  document.querySelectorAll('.count[data-to]').forEach(el => {
    let s = Math.max(0, (new Date(el.dataset.to) - Date.now())/1000);
    s = Math.floor(s); const d = Math.floor(s/86400); s -= d*86400; const h = Math.floor(s/3600); s -= h*3600; const m = Math.floor(s/60); s -= m*60;
    const set = (u, v) => { const b = el.querySelector(`[data-u=${u}]`); if (b && b.textContent !== v) b.textContent = v; };
    set('d', String(d)); set('h', String(h).padStart(2,'0')); set('m', String(m).padStart(2,'0')); set('s', String(s).padStart(2,'0'));
  });
}
function boxRow(b){
  const i = LEGENDS.includes(b) ? b.i : null;
  return `<button class="row" ${i!=null?`data-legend="${i}"`:`data-box="${BOXING_RESULTS.indexOf(b)}"`}>
    <span class="datebox"><b>${kst(dayISO(b.date),{day:'numeric'}).replace('일','')}</b><small>${b.date.slice(2,4)}.${b.date.slice(5,7)}</small></span>
    <span class="main"><span class="t">${orgBadge('boxing')} ${nameHTML(b.a)} <span style="color:var(--muted);font-weight:400">vs</span> ${nameHTML(b.b)}</span>
    <span class="s">${b.draw?'무승부':esc(disp(b.a))+' 승'} · ${esc(b.method)} ${b.round}R · ${esc(b.title)}${i!=null?' · <span class="lgd">레전드</span>':''}</span></span>${chev}</button>`;
}

/* ───────── 결과 탭 */
let resToken = 0;
function renderResultsChrome(){
  const ys = []; for (let y = NOW_Y; y >= FIRST_Y; y--) ys.push(y);
  $('#years').innerHTML = ys.map(y => `<button class="chip" aria-pressed="${state.year===y}" data-year="${y}">${y}</button>`).join('');
  const orgs = ['all','ufc','pfl','bellator','rizin','bc','boxing'].filter(o => o==='all'||o==='boxing'|| (LEAGUES[o].from<=state.year && (!LEAGUES[o].to||LEAGUES[o].to>=state.year)));
  if (!orgs.includes(state.resOrg)) state.resOrg = 'all';
  $('#resOrgs').innerHTML = orgs.map(o => `<button class="chip" aria-pressed="${state.resOrg===o}" data-rorg="${o}">${o==='all'?'전체':o==='boxing'?'복싱':LEAGUES[o].label}</button>`).join('');
}
async function renderResults(force){
  renderResultsChrome();
  const tok = ++resToken, y = state.year, o = state.resOrg, wrap = $('#resultsWrap');
  const lgs = (o==='all' ? Object.keys(LEAGUES) : o==='boxing' ? [] : [o]).filter(lg => LEAGUES[lg].from<=y && (!LEAGUES[lg].to||LEAGUES[lg].to>=y));
  if (lgs.some(lg => !yearMem.has(`y:${lg}:${y}`))) wrap.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  const res = await Promise.allSettled(lgs.map(lg => loadYear(lg, y, force)));
  if (tok !== resToken) return;
  const evs = res.filter(r=>r.status==='fulfilled').flatMap(r=>r.value).filter(e => e.state!=='pre' && e.fights.length);
  const box = (o==='all'||o==='boxing') ? [...LEGENDS.filter(l=>l.sport==='boxing'), ...BOXING_RESULTS].filter(b => +b.date.slice(0,4)===y) : [];
  const items = [...evs.map(e=>({date:e.date, html:()=>eventRow(e,{results:true})})), ...box.map(b=>({date:dayISO(b.date), html:()=>boxRow(b)}))]
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  const failed = res.some(r=>r.status==='rejected');
  const legendCount = evs.reduce((n,e)=>n+e.fights.filter(f=>f.legend).length,0) + box.filter(b=>LEGENDS.includes(b)).length;
  const pops = popularOf(evs, { done:true }).filter(x => x.s >= 4).sort((a,b) => b.s - a.s || new Date(b.e.date) - new Date(a.e.date)).slice(0, 15);
  const titleCount = evs.reduce((n,e) => n + e.fights.filter(f => titleOf(f, e)).length, 0);
  wrap.innerHTML = items.length
    ? (pops.length ? `<div class="section-h" style="margin-top:6px"><h2>${y}년 인기 매치</h2><span>${pops.length}경기</span></div>${popStrip(pops)}` : '') + `<div class="section-h" style="margin-top:${pops.length?22:6}px"><h2>${y}년</h2><span>${items.length}개 대회${titleCount?` · 타이틀전 ${titleCount}`:''}${legendCount?` · 레전드 ${legendCount}`:''}</span></div>` + groupByMonth(items, x => x.html()) + (failed?'<p class="foot">일부 단체의 기록을 불러오지 못했어요. 새로고침하면 다시 시도해요.</p>':'')
    : failed ? `<div class="empty"><b>기록을 불러오지 못했어요</b>인터넷 연결을 확인한 뒤 다시 시도해 주세요.<br><button data-retry="results">다시 시도</button></div>`
    : `<div class="empty"><b>${y}년 기록이 없어요</b>다른 연도나 단체를 골라 보세요.</div>`;
  initStrips();
}

/* ───────── UFC 한국어 사이트: 뉴스 · 랭킹 (GitHub Actions가 6시간마다 data/ufc.json으로 저장) */
const UFC = store.get('ufc') || { news:[], rankings:[], updated:'' };
let ufcAt = 0, ufcP = null;
async function loadUFC(force){
  if (!force && ufcAt && Date.now() - ufcAt < 10*60e3) return UFC;
  if (ufcP) return ufcP;
  ufcP = getJSON(`data/ufc.json?v=${Math.floor(Date.now()/6e5)}`, 12000).then(j => {
    Object.assign(UFC, { news:j.news||[], rankings:j.rankings||[], updated:j.updated||'' });
    ufcAt = Date.now(); store.set('ufc', UFC); return UFC;
  }).finally(() => { ufcP = null; });
  return ufcP;
}
const rel = iso => { if (!iso) return ''; const d = (Date.now() - new Date(iso)) / 864e5; return d < 1 ? '오늘' : d < 2 ? '어제' : d < 7 ? `${Math.floor(d)}일 전` : kst(iso, { month:'long', day:'numeric' }); };
function renderNews(){
  const wrap = $('#newsWrap'), list = UFC.news || [];
  if (!list.length) { wrap.innerHTML = ufcP || !ufcAt ? '<div class="skeleton" style="height:220px"></div><div class="skeleton"></div><div class="skeleton"></div>' : `<div class="empty"><b>뉴스를 불러오지 못했어요</b>잠시 뒤 다시 시도해 주세요.<br><button data-retry="news">다시 시도</button></div>`; return; }
  const meta = n => `<span class="nk">${n.cat?`<span>${esc(n.cat)}</span>`:''}${n.date?`<time>${esc(rel(n.date))}</time>`:''}</span>`;
  const img = (n, eager) => n.img ? `<img src="${esc(n.img)}" alt="" ${eager?'':'loading="lazy"'} referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  const card = (n, eager) => `<a class="news-lead" href="${esc(n.url)}" target="_blank" rel="noopener"><div class="im">${img(n, eager)}</div><div class="tx">${meta(n)}<h3>${esc(n.title)}</h3></div></a>`;
  const [lead, ...rest] = list, side = rest.slice(0, 6), more = rest.slice(6);
  wrap.innerHTML = `<div class="news-top">${card(lead, true)}<div class="news-list">${side.map((n,i) => `<a class="nrow" href="${esc(n.url)}" target="_blank" rel="noopener"><span class="nn">${i+2}</span><div>${meta(n)}<h4>${esc(n.title)}</h4></div><div class="im">${img(n)}</div></a>`).join('')}</div></div>
    ${more.length ? `<div class="news-grid">${more.map(n => card(n)).join('')}</div>` : ''}
    <p class="foot">출처: UFC 한국어 공식 사이트(kr.ufc.com). 제목과 사진만 모아 보여 주고, 기사는 UFC 사이트에서 열려요. 6시간마다 새 기사를 확인해요${UFC.updated?` · 마지막 확인 ${ago(new Date(UFC.updated).getTime())}`:''}.</p>`;
}

/* 블랙컴뱃 챔피언: 체급별 가장 최근 타이틀전 승자 */
const BC_ORDER = ['Flyweight','Bantamweight','Featherweight','Lightweight','Welterweight','Middleweight','Light Heavyweight','Heavyweight','Atomweight','Strawweight'];
function bcChamps(){
  const by = new Map();
  BC.evs.forEach(e => e.fights.forEach(f => { if (f.ttl && f.done && BC_ORDER.includes(f.wc)) (by.get(f.wc) || by.set(f.wc, []).get(f.wc)).push({ e, f }); }));
  return BC_ORDER.filter(w => by.has(w)).map(w => {
    const list = by.get(w).sort((a,b) => b.e.date.localeCompare(a.e.date));
    const top = list[0], win = top.f.a.w ? top.f.a : top.f.b.w ? top.f.b : null;
    let since = top.e.date, def = 0;
    if (win) for (const x of list.slice(1)) { const wn = x.f.a.w ? x.f.a : x.f.b.w ? x.f.b : null; if (wn && keyOf(wn.name) === keyOf(win.name)) { since = x.e.date; def++; } else break; }
    return { div:w, name: win?.name || '', since, def, hist: list.slice(0, 4), women: w === 'Atomweight' || w === 'Strawweight' };
  });
}

/* ───────── 챔피언 탭 */
const fmtSince = d => d ? `${d.slice(0,4)}.${d.slice(5,7)}.${d.slice(8,10)}` : '';
const DIVK = { "Men's Pound-for-Pound":'파운드 포 파운드', "Women's Pound-for-Pound":'여성 파운드 포 파운드' };
function champHead({ div, name, img, sub, meta, vacant }){
  const f = name && famous(name);
  const pic = img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : (() => { const a = avatar(name || '?'); const src = /src="([^"]+)"/.exec(a)?.[1]; return src ? `<img class="round" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<span class="ini">${esc((disp(name)||'?')[0])}</span>`; })();
  return `<${vacant?'div':'button'} class="chead ${vacant?'vacant':''}" ${vacant?'':`data-f="${esc(name)}"`}>
    <div><div class="cdiv">${esc(div)}</div><div class="cn">${esc(vacant ? '공석' : name)}</div>${f?`<div class="ck">${esc(f.ko)}</div>`:''}<div class="cmeta">${esc(meta || 'Champion')}</div>${sub?`<div class="ck" style="color:var(--muted);font-weight:500;margin:-8px 0 14px">${sub}</div>`:''}</div>
    <div class="cimg">${vacant ? '' : pic}</div></${vacant?'div':'button'}>`;
}
const rkRow = r => `<li><button data-f="${esc(r.name)}"><span class="no">${r.rank}</span><span class="nm">${esc(disp(r.name))}${isChamp(r.name)?'<span class="belt">C</span>':''}</span>${r.chg?`<span class="ch ${r.chg>0?'up':'dn'}">${Math.abs(r.chg)}</span>`:r.new?'<span class="ch" style="color:var(--red)">NEW</span>':'<span></span>'}</button></li>`;
function renderChamps(){
  const k = state.chK, wrap = $('#champWrap');
  document.querySelectorAll('#chSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k));
  if (k === 'ufc' && (UFC.rankings||[]).length) {
    const wk = n => CH.ufc && [...CH.ufc.men, ...CH.ufc.women].find(c => same(c.name, n));
    const col = g => {
      const p4p = g.p4p, c = g.champ, w = c && wk(c.name);
      const sub = !p4p && w ? `${fmtSince(w.since)}부터${w.def && w.def!=='0' ? ` · ${esc(w.def)}차 방어` : ''}` : '';
      const list = p4p ? g.list.slice(1, 11) : g.list.slice(0, 10);
      return `<div class="ccol">${champHead({ div: DIVK[g.div] || g.div, name: c?.name || '', img: c?.img, meta: p4p ? 'No. 1 Pound-for-Pound' : 'Champion', sub, vacant: !c })}
        <ol class="rk">${list.map(rkRow).join('')}</ol></div>`;
    };
    const men = UFC.rankings.filter(g => !/^Women|^여성/.test(g.div)), women = UFC.rankings.filter(g => /^Women|^여성/.test(g.div));
    wrap.innerHTML = `<div class="cgroup">남자<small>${men.filter(g=>!g.p4p).length}체급</small></div><div class="cgrid">${men.map(col).join('')}</div>
      <div class="cgroup">여자<small>${women.filter(g=>!g.p4p).length}체급</small></div><div class="cgrid">${women.map(col).join('')}</div>
      <p class="foot">UFC 공식 랭킹(kr.ufc.com)을 6시간마다 받아와요${UFC.updated?` · 마지막 확인 ${ago(new Date(UFC.updated).getTime())}`:''}. 화살표는 지난 발표 대비 순위 변화예요. 이름 옆 C 표시는 앱 어디서든 현 챔피언을 뜻해요.</p>`;
    return;
  }
  if (k === 'bc') {
    if (!BC.at) { wrap.innerHTML = '<div class="skeleton" style="height:160px"></div><div class="skeleton"></div>'; loadBC().then(() => state.chK==='bc' && state.tab==='champs' && renderChamps()).catch(() => { wrap.innerHTML = `<div class="empty"><b>블랙컴뱃 기록을 불러오지 못했어요</b><button data-retry="champs">다시 시도</button></div>`; }); return; }
    const list = bcChamps();
    const col = c => `<div class="ccol">${champHead({ div: wc(c.div), name: c.name, img: bcImg(c.name), meta:'Champion', sub: `${fmtSince(c.since)}부터${c.def ? ` · ${c.def}차 방어` : ''}` })}
      <ol class="rk">${c.hist.map(x => { const w = x.f.a.w ? x.f.a : x.f.b, l = w === x.f.a ? x.f.b : x.f.a;
        return `<li><button data-ev="bc:${esc(x.e.id)}"><span class="no" style="font-size:12px;color:var(--muted);white-space:nowrap">${x.e.date.slice(2,4)}.${x.e.date.slice(5,7)}</span><span class="nm">${esc(w.name)} <span style="color:var(--muted)">def.</span> ${esc(l.name)}</span><span class="ch" style="color:var(--muted)">${esc(x.f.method)}</span></button></li>`; }).join('')}</ol></div>`;
    const men = list.filter(c => !c.women), women = list.filter(c => c.women);
    wrap.innerHTML = `<div class="cgroup">남자<small>${men.length}체급</small></div><div class="cgrid">${men.map(col).join('')}</div>
      ${women.length ? `<div class="cgroup">여자<small>${women.length}체급</small></div><div class="cgrid">${women.map(col).join('')}</div>` : ''}
      <p class="foot">블랙컴뱃 타이틀전 기록(Sherdog)에서 체급별 가장 최근 승자를 챔피언으로 보여 줘요. 아래 목록은 그 체급의 최근 타이틀전이에요. 반납·박탈된 벨트는 바로 반영되지 않을 수 있어요.</p>`;
    applyWiki(); return;
  }
  if (k === 'ufc') {
    if (!CH.ufc) { wrap.innerHTML = CH.loading ? '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>' : `<div class="empty"><b>챔피언 정보를 불러오지 못했어요</b>인터넷 연결을 확인한 뒤 다시 시도해 주세요.<br><button data-retry="champs">다시 시도</button></div>`; return; }
    const col = c => `<div class="ccol">${champHead({ div: wc(c.div), name: c.name, meta:'Champion', sub: `${fmtSince(c.since)}부터${c.def && c.def!=='0' ? ` · ${esc(c.def)}차 방어` : ''}` })}</div>`;
    wrap.innerHTML = `<div class="cgroup">남자<small>${CH.ufc.men.length}체급</small></div><div class="cgrid">${CH.ufc.men.map(col).join('')}</div>
      <div class="cgroup">여자<small>${CH.ufc.women.length}체급</small></div><div class="cgrid">${CH.ufc.women.map(col).join('')}</div>
      <p class="foot">위키백과 UFC 챔피언 목록 기준이에요. 공식 랭킹을 받아오면 체급별 순위도 함께 보여 줘요.</p>`;
    loadUFC().then(() => state.chK==='ufc' && state.tab==='champs' && UFC.rankings.length && renderChamps()).catch(() => {});
  } else {
    if (!CH.boxing) { wrap.innerHTML = CH.loading ? '<div class="skeleton"></div><div class="skeleton"></div>' : `<div class="empty"><b>챔피언 정보를 불러오지 못했어요</b><button data-retry="champs">다시 시도</button></div>`; return; }
    const ORG = ['WBA','WBC','IBF','WBO','The Ring'];
    wrap.innerHTML = CH.boxing.map(d => {
      const four = ['WBA','WBC','IBF','WBO'].map(b => d.belts[b] && keyOf(d.belts[b].name));
      const undisputed = four.every(x => x && x === four[0]);
      const rows = ORG.filter(b => b in d.belts).map(b => { const c = d.belts[b];
        return c ? `<li><button data-f="${esc(c.name)}" style="grid-template-columns:54px 1fr auto"><span class="bo ${b==='The Ring'?'ring':''}">${b==='The Ring'?'RING':b}</span><span class="nm">${esc(disp(c.name))}</span><span class="ch" style="color:var(--muted)">${esc(c.rec||'')}</span></button></li>`
                 : `<li><button disabled style="grid-template-columns:54px 1fr auto;cursor:default"><span class="bo">${b==='The Ring'?'RING':b}</span><span class="nm" style="color:var(--muted)">공석</span><span></span></button></li>`; }).join('');
      const bd = boxDiv(d.div);
      const lead = undisputed ? d.belts.WBA : (d.belts['The Ring'] || ['WBC','WBA','IBF','WBO'].map(b => d.belts[b]).find(Boolean));
      return `<div class="ccol">${lead ? champHead({ div:`${wc(bd.name)} · ${String(d.lbs || bd.lbs).split(' or ')[0]}`, name: lead.name, meta: undisputed ? 'Undisputed Champion' : d.belts['The Ring'] === lead ? 'The Ring Champion' : 'Champion' }) : champHead({ div: wc(bd.name), vacant:true })}<ol class="rk">${rows}</ol></div>`;
    }).join('');
    wrap.innerHTML = `<div class="cgroup">체급별 세계 챔피언<small>${CH.boxing.length}체급</small></div><div class="cgrid">${wrap.innerHTML}</div><p class="foot">위키백과 현역 복싱 세계 챔피언 목록을 6시간마다 받아와요. 4대 기구(WBA·WBC·IBF·WBO)를 한 명이 모두 가지면 언디스퓨티드예요.</p>`;
  }
  applyWiki();
}

/* ───────── 레전드 탭 */
function renderLegends(){
  const k = state.legendK;
  const list = LEGENDS.filter(l => k==='all' || l.sport===k).slice().sort((a,b)=>b.date.localeCompare(a.date));
  $('#legendSub').textContent = `${FIRST_Y}–${NOW_Y}, 다시 봐도 소름 돋는 ${LEGENDS.length}경기`;
  let html = '<div class="tl">', y = '';
  list.forEach(l => {
    const ly = l.date.slice(0,4); if (ly !== y) { y = ly; html += `<div class="tl-year">${ly}</div>`; }
    html += `<button class="lg" data-legend="${l.i}">
      <div class="lm">${orgBadge(l.sport==='boxing'?'boxing':'ufc').replace('>UFC<','>MMA<')}<span>${esc(l.org)}</span><span>· ${kst(dayISO(l.date),{month:'long',day:'numeric'})}</span></div>
      <div class="hook">${esc(l.hook)}</div>
      <div class="bout">${nameHTML(l.a)}<span class="def">${l.draw?'vs':'def.'}</span>${nameHTML(l.b)}</div>
      <div class="story">${esc(l.story)}</div>
      <div class="ft"><span class="${mClass(l.method)}">${esc(l.method)}</span><span class="mthd">${l.round}라운드${l.time?' '+esc(l.time):''}</span><span class="mthd">${esc(l.title)}</span></div>
    </button>`;
  });
  $('#legendWrap').innerHTML = html + '</div>';
}

/* ───────── 선수 탭 */
function upcomingPeople(){
  const m = new Map();
  state.upcoming.concat(state.live).forEach(e => e.fights.forEach(f => [f.a,f.b].forEach(s => { if (s.name!=='미정' && !m.has(keyOf(s.name))) m.set(keyOf(s.name), { ...s, ev:e, f }); })));
  return [...m.values()];
}
function fighterRow(n, extra){
  const f = famous(n), p = PEOPLE.get(keyOf(n)), fav = state.favs.has(keyOf(n));
  const sub = extra || (f ? `${f.nick?`"${esc(f.nick)}" · `:''}${esc(f.org)} ${esc(f.div)}` : esc(p?.country||''));
  return `<div class="row" style="padding-right:6px"><button class="row" data-f="${esc(n)}" style="padding:0;flex:1;min-width:0">${avatar(n)}<span class="main"><span class="t">${nameHTML(n,{tag:!!f})}</span><span class="s">${sub}${(r => r ? ` · ${r}` : '')(recOf(n, p?.rec, p?.id))}</span></span></button>
    <button class="fav" data-fav="${esc(n)}" aria-pressed="${fav}" aria-label="${esc(disp(n))} 즐겨찾기">${fav?star:starO}</button></div>`;
}
const BC_OPEN = new Set();
function bcRow(i){
  const fav = state.favs.has(keyOf(i.name)), ko = korName(i.name);
  return `<div class="row" style="padding-right:6px"><button class="row" data-f="${esc(i.name)}" style="padding:0;flex:1;min-width:0">${avatar(i.name)}<span class="main"><span class="t">${nameHTML(i.name, { tag:true })}</span>
    <span class="s" style="white-space:normal"><b style="color:var(--ink);font-family:var(--f-display);font-size:14.5px">${esc(i.rec || `${i.w}-${i.l}-${i.d}`)}</b> · 블랙컴뱃 ${i.w}승 ${i.l}패${i.tw ? ` · 타이틀전 ${i.tw}승` : ''}<br>${ko ? esc(i.name) : ''}${i.nick ? `${ko ? ' · ' : ''}"${esc(i.nick)}"` : ''}</span></span></button>
    <button class="fav" data-fav="${esc(i.name)}" aria-pressed="${fav}" aria-label="${esc(disp(i.name))} 즐겨찾기">${fav?star:starO}</button></div>`;
}
function renderBCFighters(match){
  if (!BC.at) { $('#fightersWrap').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; loadBC().then(() => state.fK === 'bc' && renderFighters()).catch(() => { $('#fightersWrap').innerHTML = '<div class="empty"><b>블랙컴뱃 선수 기록을 불러오지 못했어요</b>잠시 뒤 다시 시도해 주세요.</div>'; }); return; }
  const all = [...BCI.values()].filter(i => match(i.name, null, [korName(i.name), i.nick, i.tag, wc(i.wc)].join(' ')));
  const by = new Map(); all.forEach(i => (by.get(i.wc) || by.set(i.wc, []).get(i.wc)).push(i));
  const order = [...BC_ORDER, ...[...by.keys()].filter(w => !BC_ORDER.includes(w)).sort()];
  const q = state.q.trim();
  let html = `<p class="sub" style="margin-top:0">블랙컴뱃에 나온 선수 ${BCI.size}명. 빨간 사선은 챔피언·타이틀전 경험자·블랙컴뱃 4승 이상 선수예요.</p>`;
  order.filter(w => by.has(w)).forEach(w => {
    const list = by.get(w).sort((a,b) => b.score - a.score || b.last.localeCompare(a.last));
    const top = list.filter(i => i.famous), rest = list.filter(i => !i.famous), open = q || BC_OPEN.has(w) || !top.length;
    html += `<div class="section-h"><h2>${esc(wc(w))}</h2><span>${list.length}명${top.length ? ` · 주요 선수 ${top.length}명` : ''}</span></div>
      <div class="group">${(open ? list : top).map(bcRow).join('')}${!open && rest.length ? `<button class="row" data-bcopen="${esc(w)}" style="justify-content:center;font-weight:700;font-size:13.5px">선수 ${rest.length}명 더 보기</button>` : ''}</div>`;
  });
  if (!all.length) html = `<div class="empty"><b>"${esc(state.q)}"에 맞는 블랙컴뱃 선수가 없어요</b>한글·영문 이름이나 링네임으로 찾을 수 있어요.</div>`;
  $('#fightersWrap').innerHTML = html + `<p class="foot">선수 정보와 전적은 Sherdog 기록이에요. 한글 이름은 영문 표기를 바꾼 것이라 실제 이름과 한두 글자 다를 수 있어요. 링네임은 Sherdog에 등록된 표기 그대로예요.</p>`;
  applyWiki();
}
function renderFighters(){
  const q = keyOf(state.q).replace(/ /g,''), qRaw = state.q.trim().toLowerCase(), k = state.fK;
  if (k === 'bc') return renderBCFighters((n, f, extra) => !qRaw || keyOf(n).replace(/ /g,'').includes(q) || String(extra||'').toLowerCase().includes(qRaw));
  const match = (n, f) => !qRaw || keyOf(n).replace(/ /g,'').includes(q) || (f && [f.ko,f.nick,f.tag,f.div,f.org].join(' ').toLowerCase().includes(qRaw)) || (korName(n)||'').includes(state.q.trim()) || (bcInfo(n)?.nick||'').toLowerCase().includes(qRaw);
  const sportOk = f => k==='all' || k==='fav' || (f ? f.sport===k : k==='mma');
  let html = '';
  const favs = [...state.favs].map(x => FIGHTERS.find(f=>keyOf(f.name)===x)?.name || PEOPLE.get(x)?.name).filter(Boolean).filter(n=>match(n,famous(n)));
  if ((k==='fav' || k==='all') && favs.length) html += `<div class="section-h"><h2>즐겨찾기</h2><span>${favs.length}명</span></div><div class="group">${favs.map(n=>fighterRow(n)).join('')}</div>`;
  if (k==='fav' && !favs.length) html += `<div class="empty"><b>즐겨찾기한 선수가 없어요</b>선수 옆의 별을 눌러 추가하면 여기 모여요.</div>`;
  if (k !== 'fav') {
    const stars = FIGHTERS.filter(f => sportOk(f) && match(f.name, f));
    if (stars.length) html += `<div class="section-h"><h2>레전드 & 스타</h2><span>${stars.length}명</span></div><div class="group">${stars.map(f=>fighterRow(f.name)).join('')}</div>`;
    if (k !== 'boxing' && BC.at) {
      const bcTop = [...BCI.values()].filter(i => i.famous && (i.champ || i.tw) && match(i.name)).sort((a,b) => b.score - a.score);
      if (bcTop.length) html += `<div class="section-h"><h2>블랙컴뱃 챔피언 출신</h2><button class="s" data-fk="bc" style="font-size:13px">블랙컴뱃 전체 선수</button></div><div class="group">${bcTop.map(bcRow).join('')}</div>`;
    }
    if (k !== 'boxing') {
      const ups = upcomingPeople().filter(s => !famous(s.name) && match(s.name)).sort((a,b)=>new Date(a.ev.date)-new Date(b.ev.date));
      if (ups.length) html += `<div class="section-h"><h2>출전 예정 선수</h2><span>${ups.length}명</span></div><div class="group">${ups.map(s=>fighterRow(s.name, `${kst(s.ev.date,{month:'numeric',day:'numeric'})} ${esc(LEAGUES[s.ev.lg]?.label||'')} · ${esc(wc(s.f.wc))}`)).join('')}</div>`;
      if (qRaw) {
        const shown = new Set([...stars.map(f=>keyOf(f.name)), ...ups.map(s=>keyOf(s.name)), ...[...BCI.values()].filter(i => i.champ || i.tw).map(i => keyOf(i.name))]);
        const others = [...PEOPLE.values()].filter(p => !shown.has(keyOf(p.name)) && match(p.name)).slice(0,40);
        if (others.length) html += `<div class="section-h"><h2>기록 속 선수</h2><span>${others.length}명</span></div><div class="group">${others.map(p=>fighterRow(p.name)).join('')}</div>`;
      }
    }
    if (!html) html = `<div class="empty"><b>"${esc(state.q)}"에 맞는 선수가 없어요</b>영문 이름이나 별명으로도 찾을 수 있어요.</div>`;
  }
  $('#fightersWrap').innerHTML = html;
}

/* ───────── 시트 */
const sheetStack = [];
function openSheet(title, html, push=true){
  if (push) sheetStack.push({ title, html }); else sheetStack.splice(0, sheetStack.length, { title, html });
  drawSheet();
}
function drawSheet(){
  const top = sheetStack[sheetStack.length-1]; if (!top) return closeSheet();
  $('#sheetTitle').innerHTML = (sheetStack.length>1 ? `<button data-back style="margin-right:6px;color:var(--blue);font-weight:600" aria-label="뒤로">‹ 뒤로</button>` : '') + esc(top.title);
  $('#sheetBody').innerHTML = top.html; $('#sheetBody').scrollTop = 0;
  const sh = $('#sheet'); sh.classList.add('on'); sh.setAttribute('aria-hidden','false'); $('#scrim').classList.add('on');
  document.body.style.overflow = 'hidden'; setTimeout(()=>$('#sheetClose').focus({preventScroll:true}), 50);
}
function closeSheet(){
  sheetStack.length = 0; const sh = $('#sheet'); sh.classList.remove('on'); sh.setAttribute('aria-hidden','true');
  $('#scrim').classList.remove('on'); document.body.style.overflow = '';
}
function fightHTML(f, isMain, e){
  const side = (s, c) => { const lost = f.done && (f.a.w||f.b.w) && !s.w;
    return `<button class="side ${c} ${lost?'lost':''}" data-f="${esc(s.name)}">${avatar(s.name, s.id)}<span class="who"><span class="nm">${nameHTML(s.name)}${s.w?'<span class="wflag">승</span>':''}</span>
      <span class="rec">${s.flag?`<img src="${esc(s.flag)}" alt="${esc(s.country)}" loading="lazy">`:''}${recOf(s.name, s.rec, s.id) || '—'}</span></span></button>`; };
  return `<div class="fight">${f.legend?`<button class="legend-ribbon" data-legend="${f.legend.i}">레전드 매치</button>`:''}
    <div class="meta">${isMain?'<span class="mthd" style="background:var(--ink);color:var(--bg)">메인 이벤트</span>':''}${titleBadge(titleOf(f, e))}<span class="wc">${esc(wc(f.wc))}</span><span>${f.rounds}라운드</span></div>
    <div class="vsrow">${side(f.a,'a')}<span class="vsmid">VS</span>${side(f.b,'b')}</div>
    ${resultLine(f)?`<div class="result">${resultLine(f)}</div>`:''}</div>`;
}
function openEvent(key){
  const e = EVENTS.get(key); if (!e) return;
  const fs = e.fights.slice().reverse();
  const when = kst(e.date,{year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'});
  const done = e.fights.filter(f=>f.done).length;
  const html = `<div class="hero">${e.state==='in'?'<span class="live">LIVE</span>':orgBadge(e.lg)}<h3>${esc(e.name)}</h3>
    <p>${when} KST</p><p>${esc([e.venue, e.city].filter(Boolean).join(' · '))}</p></div>
    ${e.state==='pre'?`<div class="stats"><div class="stat"><b>${e.fights.length}</b><small>경기</small></div><div class="stat"><b>${Math.max(0,Math.ceil((new Date(e.date)-Date.now())/864e5))}</b><small>일 남음</small></div><div class="stat"><b>${e.fights.filter(f=>famous(f.a.name)||famous(f.b.name)).length}</b><small>스타 출전</small></div></div>`
    : `<div class="stats"><div class="stat"><b>${done}/${e.fights.length}</b><small>경기 종료</small></div><div class="stat"><b>${e.fights.filter(f=>/KO/.test(f.method)).length}</b><small>KO/TKO</small></div><div class="stat"><b>${e.fights.filter(f=>f.method==='서브미션').length}</b><small>서브미션</small></div></div>`}
    <div class="card-sec">대진표</div><div class="group">${fs.map((f,i)=>fightHTML(f, i===0, e)).join('') || '<div class="empty" style="margin:0;border:0">대진이 아직 발표되지 않았어요.</div>'}</div>
    ${e.state==='in'?'<p class="foot">경기 중에는 30초마다 자동으로 갱신돼요.</p>':''}`;
  openSheet(e.name, html, $('#sheet').classList.contains('on'));
}
function legendHTML(l){
  const side = (n, c, w) => `<button class="side ${c} ${!l.draw&&!w?'lost':''}" data-f="${esc(n)}">${avatar(n)}<span class="who"><span class="nm">${nameHTML(n)}${w&&!l.draw?'<span class="wflag">승</span>':''}</span><span class="rec">${esc(famous(n)?.tag||'')}</span></span></button>`;
  return `<div class="hero"><span class="org ${l.sport==='boxing'?'boxing':'ufc'}">${l.sport==='boxing'?'복싱':'MMA'}</span>
    <h3 style="font-weight:900;font-size:28px;line-height:1.2;letter-spacing:-.03em">${esc(l.hook)}</h3>
    <p>${esc(l.org)} · ${kst(dayISO(l.date),{year:'numeric',month:'long',day:'numeric'})}</p></div>
    <div class="group"><div class="fight"><div class="meta"><span class="wc">${esc(l.title)}</span></div>
    <div class="vsrow">${side(l.a,'a',true)}<span class="vsmid">VS</span>${side(l.b,'b',false)}</div>
    <div class="result"><span class="${mClass(l.method)}">${esc(l.method)}</span><span>${l.round}라운드${l.time?' '+esc(l.time):''}</span></div></div></div>
    ${l.story?`<div class="note">${esc(l.story)}</div>`:''}`;
}
function openLegend(i){ const l = LEGENDS[i]; openSheet('레전드 매치', legendHTML(l), sheetStack.length>0 && $('#sheet').classList.contains('on')); }
function openBox(i){ const b = BOXING_RESULTS[i]; openSheet('복싱', legendHTML({ ...b, sport:'boxing', hook: disp(b.a)+' 승' }), false); }

function fightsOf(n){
  const k = keyOf(n), out = [];
  EVENTS.forEach(e => e.fights.forEach(f => { if (keyOf(f.a.name)===k || keyOf(f.b.name)===k) out.push({ e, f }); }));
  const seen = new Set();
  return out.filter(x => !seen.has(x.f.id) && seen.add(x.f.id)).sort((a,b)=>new Date(b.f.date||b.e.date)-new Date(a.f.date||a.e.date));
}
function openFighter(n){
  const f = famous(n), p = PEOPLE.get(keyOf(n)), k = keyOf(n), fav = state.favs.has(k);
  const all = fightsOf(n), next = all.filter(x=>!x.f.done && x.e.state!=='post').pop(), past = all.filter(x=>x.f.done);
  const legends = LEGENDS.filter(l => keyOf(l.a)===k || keyOf(l.b)===k);
  const titleFights = all.filter(x => x.f.done && titleOf(x.f, x.e)).length;
  const boxing = BOXING_RESULTS.filter(b => keyOf(b.a)===k || keyOf(b.b)===k);
  const wl = past.reduce((a,x)=>{ const me = keyOf(x.f.a.name)===k ? x.f.a : x.f.b; if (me.w) a.w++; else if (x.f.a.w||x.f.b.w) a.l++; return a; }, {w:0,l:0});
  const id = idOf(n, p?.id), fid = BC.byName.get(k), sd = fid && sherdogDetail(fid);
  const pre = sd || (id ? cachedDetail('e'+id, 12*36e5) : cachedDetail('w'+k, 7*864e5));
  const rec = pre?.sum || p?.rec || (f?.name==='Floyd Mayweather' ? '50-0-0' : f?.name==='Khabib Nurmagomedov' ? '29-0-0' : '');
  const pastRow = x => { const me = keyOf(x.f.a.name)===k ? x.f.a : x.f.b, op = me===x.f.a ? x.f.b : x.f.a;
    const r = me.w ? '<b class="win">승</b>' : (x.f.a.w||x.f.b.w) ? '<b style="color:var(--red)">패</b>' : '<b style="color:var(--muted)">무</b>';
    return `<button class="row" data-ev="${x.e.lg}:${x.e.id}"><span class="datebox" style="width:30px">${r}</span><span class="main"><span class="t">vs ${nameHTML(op.name)}</span><span class="s">${titleOf(x.f,x.e)?`<span class="tt">${esc(titleOf(x.f,x.e).k)}</span> · `:''}${x.f.method?esc(x.f.method)+' · ':''}${kst(x.e.date,{year:'numeric',month:'short',day:'numeric'})} · ${esc(x.e.name)}</span></span>${chev}</button>`; };
  const html = `<div class="pf">${avatar(n, p?.id)}<div style="min-width:0"><h3>${esc(disp(n))}${f||bcInfo(n)?.famous?'<span class="mark" aria-hidden="true"></span>':''}${isChamp(n)?'<span class="belt" title="현 챔피언">C</span>':''}</h3>
      <div class="nick">${esc(n)}${(f?.nick||pre?.nick)?` · "${esc(f?.nick||pre?.nick)}"`:''}</div>
      <div style="margin-top:6px">${f?`<span class="tag" style="margin:0">${esc(f.tag)}</span>`:''} ${p?.flag?`<img src="${esc(p.flag)}" alt="${esc(p.country)}" style="display:inline;width:18px;height:12px;border-radius:2px;vertical-align:-1px;margin-left:4px">`:''} <span class="s" style="font-size:13px;color:var(--muted)">${esc(f?`${f.org} ${f.div}`:(p?.country||''))}</span></div></div></div>
    <div class="pf-actions"><button class="chip" data-fav="${esc(n)}" aria-pressed="${fav}">${fav?'즐겨찾기됨':'+ 즐겨찾기'}</button></div>
    <div class="stats"><div class="stat"><b id="pfRec">${esc(rec||'—')}</b><small>통산 전적</small></div><div class="stat"><b>${past.length?`${wl.w}-${wl.l}`:'—'}</b><small>앱 기록 승-패</small></div><div class="stat"><b>${titleFights || legends.length}</b><small>${titleFights ? '타이틀전(앱 기록)' : '레전드 매치'}</small></div></div>
    ${(b => b ? `<div class="note">블랙컴뱃 ${esc(wc(b.wc))}${b.tag ? ` · ${esc(b.tag)}` : ''}<br>블랙컴뱃 전적 ${b.w}승 ${b.l}패${b.d ? ` ${b.d}무` : ''}${b.tf ? ` · 타이틀전 ${b.tw}승 ${b.tf - b.tw}패` : ''} · 통산 ${esc(b.rec || '—')}</div>` : '')(bcInfo(n))}
    ${(CHAMP.get(k)||[]).length?`<div class="note champ-note">현 챔피언 · ${(CHAMP.get(k)||[]).map(c=>`${esc(c.org)} ${esc(wc(c.div))}`).join(', ')}</div>`:''}
    ${f?`<div class="note">${esc(f.note)}</div>`:''}
    ${next?`<div class="card-sec">다음 경기</div><div class="group"><button class="row" data-ev="${next.e.lg}:${next.e.id}">${orgBadge(next.e.lg)}<span class="main"><span class="t">vs ${nameHTML(keyOf(next.f.a.name)===k?next.f.b.name:next.f.a.name)}</span><span class="s">${kst(next.e.date,{month:'long',day:'numeric',weekday:'short'})} · ${esc(next.e.name)}</span></span>${chev}</button></div>`:''}
    ${legends.length?`<div class="card-sec">레전드 매치</div><div class="group">${legends.map(l=>`<button class="row" data-legend="${l.i}"><span class="main"><span class="t"><span class="lgd"></span>${esc(l.hook)}</span><span class="s">${esc(disp(l.a))} ${l.draw?'vs':'def.'} ${esc(disp(l.b))} · ${l.date.slice(0,4)}</span></span>${chev}</button>`).join('')}</div>`:''}
    <div id="pfDetail" data-k="${esc(k)}">${pre ? detailHTML(pre) : '<div class="card-sec">상세 기록</div><div class="skeleton" style="height:120px"></div>'}</div>
    ${past.length && !(pre?.hist||[]).length ?`<div id="pfPast"><div class="card-sec">최근 경기</div><div class="group">${past.slice(0,10).map(pastRow).join('')}</div></div>`:''}
    ${boxing.length?`<div class="card-sec">복싱 기록</div><div class="group">${boxing.map(boxRow).join('')}</div>`:''}
`;
  openSheet(disp(n), html, $('#sheet').classList.contains('on'));
  if (pre) return;
  const job = id ? espnDetail(id).catch(() => wikiDetail(n, f?.sport==='boxing')) : wikiDetail(n, f?.sport==='boxing');
  job.catch(() => null).then(D => {
    const box = $('#pfDetail'); if (!box || box.dataset.k !== k) return;
    box.innerHTML = D && !D.none ? detailHTML(D) : (past.length || legends.length ? '' : '<p class="foot">이 선수의 상세 기록을 찾지 못했어요.</p>');
    if (D?.sum && $('#pfRec')?.textContent === '—') $('#pfRec').textContent = D.sum;
    if ((D?.hist||[]).length) $('#pfPast')?.remove();
    applyWiki();
    const top = sheetStack[sheetStack.length-1]; if (top) top.html = $('#sheetBody').innerHTML;
  });
}

/* ───────── 동기화 */
async function refreshChamps(force){
  CH.loading = !CH.ufc; if (state.tab==='champs') renderChamps();
  try { await loadChampions(force); } catch {}
  CH.loading = false;
  if (state.tab==='champs') renderChamps();
  if (state.tab==='results') renderResults();
  if (state.tab==='fighters') renderFighters();
  renderSchedule();
}
let pollT = 0;
function setSync(mode){
  const el = $('#sync'), t = $('#syncText');
  el.className = 'sync' + (mode==='busy'?' busy':'') + (state.err?' err':'');
  if (mode==='busy') { t.textContent = '업데이트 중'; return; }
  if (state.err) { t.textContent = state.lastSync ? `오프라인 · ${ago(state.lastSync)} 기준` : '연결 안 됨'; return; }
  t.textContent = state.live.length ? `LIVE · ${ago(state.lastSync)}` : ago(state.lastSync) + ' 업데이트';
}
const ago = t => { const s = (Date.now()-t)/1000; return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s/60)}분 전` : `${Math.floor(s/3600)}시간 전`; };
async function sync(manual){
  clearTimeout(pollT); setSync('busy'); $('#refreshBtn').classList.add('spin');
  try {
    if (manual) BC.at = 0;
    await loadUpcoming(); state.err = false; state.lastSync = Date.now();
    if (state.tab==='results' && state.year===NOW_Y) renderResults(true);
    if (manual) toast('최신 정보로 업데이트했어요');
  } catch { state.err = true; if (manual) toast('연결할 수 없어요. 저장된 정보를 보여드려요'); }
  $('#refreshBtn').classList.remove('spin');
  renderSchedule(); if (state.tab==='fighters') renderFighters();
  setSync();
  pollT = setTimeout(sync, state.live.length ? POLL_LIVE : POLL_IDLE);
}
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove('on'), 2600); }

/* ───────── 탭 & 이벤트 */
const TITLES = { schedule:'일정', results:'결과', news:'뉴스', champs:'챔피언', legends:'레전드 매치', fighters:'선수' };
function go(tab){
  state.tab = tab;
  document.querySelectorAll('.tabbar [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.v===tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id==='v-'+tab));
  $('#miniTitle').textContent = TITLES[tab]; window.scrollTo({ top:0 });
  if (tab==='results') renderResults(); if (tab==='news') { renderNews(); loadUFC().then(() => state.tab==='news' && renderNews()).catch(() => state.tab==='news' && renderNews()); } if (tab==='champs') renderChamps(); if (tab==='legends') renderLegends(); if (tab==='fighters') renderFighters();
  try { history.replaceState(null, '', '#'+tab); } catch {}
}
function toggleFav(n){
  const k = keyOf(n); state.favs.has(k) ? state.favs.delete(k) : state.favs.add(k);
  store.set('favs', [...state.favs]); toast(state.favs.has(k) ? `${disp(n)} 즐겨찾기에 추가했어요` : `${disp(n)} 즐겨찾기를 해제했어요`);
  if (state.tab==='fighters') renderFighters();
  document.querySelectorAll(`#sheet [data-fav]`).forEach(b => { if (keyOf(b.dataset.fav)===k) { const on = state.favs.has(k); b.setAttribute('aria-pressed', on); b.textContent = on?'즐겨찾기됨':'+ 즐겨찾기'; const top = sheetStack[sheetStack.length-1]; if (top) top.html = $('#sheetBody').innerHTML; } });
}
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-bcopen],[data-fk],[data-scroll],#chSeg button,[data-v],[data-ev],[data-f],[data-legend],[data-box],[data-fav],[data-year],[data-rorg],[data-sorg],[data-goto],[data-retry],[data-back],#legendSeg button,#fSeg button');
  if (!t) return;
  const d = t.dataset;
  if (d.bcopen) { BC_OPEN.add(d.bcopen); return renderFighters(); }
  if (d.fk) { state.fK = d.fk; document.querySelectorAll('#fSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === d.fk)); window.scrollTo({ top:0 }); return renderFighters(); }
  if (d.scroll) { const sc = t.parentElement.querySelector('.pop'); return sc.scrollBy({ left: (+d.scroll) * Math.max(240, sc.clientWidth * .85), behavior:'smooth' }); }
  if (d.fav !== undefined) return toggleFav(d.fav);
  if (d.v) return go(d.v);
  if (d.back !== undefined) { sheetStack.pop(); return drawSheet(); }
  if (d.legend !== undefined) return openLegend(+d.legend);
  if (d.box !== undefined) return openBox(+d.box);
  if (d.ev) return openEvent(d.ev);
  if (d.f) return openFighter(d.f);
  if (d.year) { state.year = +d.year; return renderResults(); }
  if (d.rorg) { state.resOrg = d.rorg; return renderResults(); }
  if (d.sorg) { state.schedOrg = d.sorg; return renderSchedule(); }
  if (d.goto) return go(d.goto);
  if (d.retry === 'champs') return refreshChamps(true);
  if (d.retry === 'news') { ufcAt = 0; return go('news'); }
  if (d.retry) return renderResults(true);
  if (t.closest('#chSeg')) { state.chK = d.k; return renderChamps(); }
  if (t.closest('#legendSeg')) { state.legendK = d.k; document.querySelectorAll('#legendSeg button').forEach(b=>b.setAttribute('aria-pressed', b===t)); return renderLegends(); }
  if (t.closest('#fSeg')) { state.fK = d.k; document.querySelectorAll('#fSeg button').forEach(b=>b.setAttribute('aria-pressed', b===t)); return renderFighters(); }
});
$('#q').addEventListener('input', e => { state.q = e.target.value; renderFighters(); });
$('#refreshBtn').addEventListener('click', () => sync(true));
$('#sheetClose').addEventListener('click', closeSheet);
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key==='Escape' && $('#sheet').classList.contains('on')) closeSheet(); });
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 36), { passive:true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now()-state.lastSync > 60e3) sync(); });
window.addEventListener('online', () => sync());
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TITLES[h] && h !== state.tab) go(h); });
// 시트 아래로 끌어 닫기
(() => { const sh = $('#sheet'); let y0 = null, dy = 0;
  sh.addEventListener('touchstart', e => { const inBody = e.target.closest('.body'); if (inBody && inBody.scrollTop > 0) return; y0 = e.touches[0].clientY; dy = 0; sh.style.transition = 'none'; }, { passive:true });
  sh.addEventListener('touchmove', e => { if (y0==null) return; dy = Math.max(0, e.touches[0].clientY - y0); if (dy > 0) sh.style.transform = `translateY(${dy}px)`; }, { passive:true });
  sh.addEventListener('touchend', () => { if (y0==null) return; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; });
})();
setInterval(tickCountdown, 1000);
setInterval(() => { if (!$('#sync').classList.contains('busy')) setSync(); }, 15e3);

/* ───────── 시작 */
try { const c = store.get('champs'); if (c) { Object.assign(CH, c); indexChamps(); } } catch {}
const had = restoreUpcoming();
if (had) renderSchedule();
const start = (location.hash||'').slice(1);
if (TITLES[start] && start !== 'schedule') go(start);
loadUFC().then(() => { if (state.tab==='champs') renderChamps(); if (state.tab==='news') renderNews(); }).catch(() => {});
refreshChamps(false);
setInterval(() => refreshChamps(false), 30*60e3);
sync().then(() => {
  // 선수 사진·전적을 채우기 위해 올해와 작년 UFC 기록을 미리 받아 둡니다
  setTimeout(() => Promise.allSettled([loadYear('ufc', NOW_Y), loadYear('ufc', NOW_Y-1), loadYear('pfl', NOW_Y)]).then(() => { if (state.tab==='fighters') renderFighters(); renderSchedule(); }), 800);
});
})();
