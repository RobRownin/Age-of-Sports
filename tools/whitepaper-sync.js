#!/usr/bin/env node
// Keeps whitepaper.html in sync with the game code in index.html – without rewriting prose.
//
//   node tools/whitepaper-sync.js --check   report differences (exit code 1 if anything is out of date)
//   node tools/whitepaper-sync.js --fix     update numbers/tables in place and stamp the synced commit
//
// What it does:
//   1. Runs the app's classic <script> in a sandbox (DOM stubbed) and reads the game constants.
//   2. Replaces every  <span data-sync="key">…</span>  with the current value.
//   3. Regenerates every block between  <!-- sync:name -->  and  <!-- /sync:name -->  (tables).
//   4. Reports coverage gaps (e.g. an attribute or activity type the prose never mentions).
// Prose stays untouched; it is reviewed manually from the commit log since <meta name="wp-synced-commit">.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.resolve(process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]) || path.join(__dirname, '..'));
const mode = process.argv.includes('--fix') ? 'fix' : 'check';
const appFile = path.join(root, 'index.html');
const wpFile = path.join(root, 'whitepaper.html');

// ---------- 1. Load the game code in a sandbox ----------
function loadGame() {
  const html = fs.readFileSync(appFile, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('classic <script> not found in index.html');
  const stub = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : stub),
    apply: () => stub, construct: () => stub, set: () => true, has: () => true,
  });
  const ctx = vm.createContext({
    window: {}, document: stub, localStorage: stub, navigator: stub, location: { pathname: '/' },
    console: { log() {}, warn() {}, error() {} }, alert() {}, confirm() { return false; }, prompt() { return null; },
    setInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: stub,
  });
  ctx.window = ctx; // `window.X = …` and bare `X` should be the same
  ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; ctx.scrollTo = () => {};
  vm.runInContext(m[1], ctx, { filename: 'index.html' });
  return (expr) => vm.runInContext(expr, ctx);
}

const g = loadGame();
const pct = (x) => `${+(x * 100).toFixed(1)}`;
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ATTR_TAG = { endurance: 'a-end', pace: 'a-pac', strength: 'a-str', mental: 'a-men', discipline: 'a-dis' };
const attrAbbr = g('ATTR_ABBR');
const tiers = g('ITEM_TIERS');
const tierTag = (t) => `<span class="tag t${t}">${tiers[t]}</span>`;
const attrTag = (k, extra) => `<span class="tag ${ATTR_TAG[k]}">${attrAbbr[k]}${extra || ''}</span>`;

// ---------- 2. Values (data-sync keys) ----------
const fpOf = (a) => g(`computeActivityScore(${JSON.stringify(a)})`);
const support = g('MISSION_RULES');
const arena = g('ARENA');
const values = {
  'fp.km': fmt(fpOf({ type: 'run', km: 1 })),
  'fp.min': fmt(fpOf({ type: 'run', mins: 1 })),
  'fp.bpm': fmt(g(`activityFPParts({type:'run',avgHeartRate:10})[0].value`) / 10),
  'fp.elev': fmt(g(`activityFPParts({type:'run',elevationGain:10})[0].value`) / 10),
  'fp.sleepH': fmt(g(`activityFPParts({type:'sleep',mins:60})[0].value`)),
  'fp.sleepCap': fmt(g(`activityFPParts({type:'sleep',mins:6000})[0].value`) / g(`activityFPParts({type:'sleep',mins:60})[0].value`)),
  'fp.example.run': fmt(fpOf({ type: 'run', km: 5, mins: 30 })),
  'level.first': fmt(g('levelStepFP(1)')),
  'level.step': fmt(g('levelStepFP(2) - levelStepFP(1)')),
  'level.l5': g('(() => { let s = 0; for (let l = 1; l < 5; l++) s += levelStepFP(l); return s; })()').toLocaleString('en-US'),
  'level.l10': g('(() => { let s = 0; for (let l = 1; l < 10; l++) s += levelStepFP(l); return s; })()').toLocaleString('en-US'),
  'base.min': fmt(g('BASE_RANGE.min')), 'base.max': fmt(g('BASE_RANGE.max')), 'base.total': fmt(g('BASE_TOTAL')),
  'train.max': fmt(g('TRAINING.MAX_FACTOR')), 'train.scale': fmt(g('TRAINING.SCALE')), 'train.decay': pct(g('TRAINING.DAILY_DECAY')),
  'item.cap': fmt(g('ITEM_BONUS_CAP')),
  'support.success': pct(support.SUPPORT_SUCCESS), 'support.brilliant': pct(support.SUPPORT_BRILLIANT),
  'support.kleos': pct(support.SUPPORT_KLEOS), 'support.injury': pct(support.SUPPORT_INJURY),
  'injury.penalty': pct(support.INJURY_PENALTY), 'injury.days': fmt(support.INJURY_DAYS),
  'kleos.max': fmt(g('KLEOS.MAX')), 'kleos.decay': pct(g('KLEOS.DAILY_DECAY')), 'kleos.weight': fmt(g('KLEOS_WEIGHT')),
  'arena.start': fmt(arena.START_RATING), 'arena.k': fmt(arena.K), 'arena.daily': fmt(arena.DAILY_DUELS),
  'arena.luckMin': fmt(1 - arena.NOISE), 'arena.luckMax': fmt(1 + arena.NOISE),
  'missions.count': fmt(g('MISSION_ORDER.length')),
  'missions.minH': fmt(Math.min(...g('MISSION_ORDER.map((id) => MISSIONS[id].hours)'))),
  'missions.maxD': fmt(Math.max(...g('MISSION_ORDER.map((id) => MISSIONS[id].hours)')) / 24),
};
// success cap is a literal inside missionOdds()
const capMatch = g('missionOdds.toString()').match(/Math\.min\(\s*([0-9.]+)/);
if (capMatch) values['support.cap'] = pct(+capMatch[1]);

// ---------- 3. Generated tables (sync blocks) ----------
const blocks = {};
blocks['fp-table'] = (() => {
  const ex = g('EXERCISE_ORDER.map((id) => ({ id, name: EXERCISES[id].name, fp: EXERCISES[id].fp }))');
  return `<div class="grid2">
      <div class="tbl"><table>
        <tr><th>Activity</th><th class="num">FP</th></tr>
        <tr><td>Distance</td><td class="num">${values['fp.km']} / km</td></tr>
        <tr><td>Duration</td><td class="num">${values['fp.min']} / min</td></tr>
        <tr><td>Avg. heart rate</td><td class="num">${values['fp.bpm']} / bpm</td></tr>
        <tr><td>Elevation gain</td><td class="num">${values['fp.elev']} / m</td></tr>
        <tr><td>Sleep (max. ${values['fp.sleepCap']} h)</td><td class="num">${values['fp.sleepH']} / h</td></tr>
      </table></div>
      <div class="tbl"><table>
        <tr><th>Strength exercise</th><th class="num">FP / rep</th></tr>
${ex.map((e) => `        <tr><td>${esc(e.name)}</td><td class="num">${fmt(e.fp)}</td></tr>`).join('\n')}
      </table></div>
    </div>`;
})();

blocks['tiers-table'] = (() => {
  const rows = Object.keys(tiers).map(Number).map((t) => {
    const items = g(`itemsOfTier(${t}).map((id) => ITEM_CATALOG[id])`);
    const sums = items.map((it) => Object.values(it.bonus || {}).reduce((s, v) => s + v, 0));
    const avg = sums.length ? Math.round(sums.reduce((s, v) => s + v, 0) / sums.length) : 0;
    const names = items.slice(0, 3).map((it) => esc(it.name)).join(', ') + (items.length > 3 ? ' …' : '');
    return `        <tr><td>${tierTag(t)}</td><td class="num">≈ +${avg}</td><td class="num">${items.length}</td><td>${names}</td></tr>`;
  });
  return `<div class="tbl"><table>
        <tr><th>Tier</th><th class="num">Bonus</th><th class="num">Items</th><th>Examples</th></tr>
${rows.join('\n')}
      </table></div>`;
})();

blocks['missions-table'] = (() => {
  const ms = g(`MISSION_ORDER.map((id) => { const m = MISSIONS[id]; return { id, icon: m.icon, name: m.name, hours: m.hours, minLevel: m.minLevel,
    focus: Object.keys(m.w).filter((k) => m.w[k] >= 0.3 || Object.keys(m.w).length <= 2), all: Object.keys(m.w).length >= 5,
    tier: missionTier(m), goal: goalsText(m) }; })`);
  const dur = (h) => (h % 24 === 0 ? `${h / 24} d` : `${h} h`);
  return `<div class="tbl"><table>
        <tr><th>Mission</th><th class="num">Time</th><th class="num">Lvl</th><th>Focus</th><th>Tier</th><th>Your training goal</th></tr>
${ms.map((m) => `        <tr data-mission="${m.id}"><td>${m.icon} ${esc(m.name)}</td><td class="num">${dur(m.hours)}</td><td class="num">${m.minLevel}</td><td>${m.all ? 'all' : m.focus.map((k) => attrTag(k)).join(' ')}</td><td>${tierTag(m.tier)}</td><td>${esc(m.goal)}</td></tr>`).join('\n')}
      </table></div>`;
})();

blocks['loot-table'] = (() => {
  const lt = g('LOOT_TABLES');
  const tierNums = Object.keys(tiers).map(Number);
  return `<div class="tbl"><table>
        <tr><th>Mission tier</th>${tierNums.map((t) => `<th class="num">${tierTag(t)}</th>`).join('')}</tr>
${Object.keys(lt).map(Number).map((mt) => `        <tr><td>${tiers[mt]}</td>${lt[mt].map((p, i) => `<td class="num">${p ? (i + 1 === mt ? `<b>${Math.round(p * 100)} %</b>` : `${Math.round(p * 100)} %`) : '–'}</td>`).join('')}</tr>`).join('\n')}
      </table></div>`;
})();

blocks['disciplines-table'] = (() => {
  const ds = g('DISCIPLINE_KEYS.map((k) => ({ id: k, ...DISCIPLINES[k] }))');
  return `<div class="tbl"><table>
        <tr><th>Discipline</th><th>Attribute weights</th></tr>
${ds.map((d) => {
    const ws = Object.entries(d.w).sort((a, b) => b[1] - a[1]);
    const equal = ws.every(([, v]) => v === ws[0][1]) && ws.length >= 5;
    return `        <tr data-discipline="${d.id}"><td>${d.icon} ${esc(d.name)}</td><td>${equal ? `all five, ${Math.round(ws[0][1] * 100)} % each` : ws.map(([k, v]) => attrTag(k, ` ${Math.round(v * 100)} %`)).join(' ')}</td></tr>`;
  }).join('\n')}
      </table></div>`;
})();

blocks['titles-table'] = (() => {
  // find title boundaries by probing ratings
  const bands = [];
  let cur = null;
  for (let r = 0; r <= 3000; r++) {
    const t = g(`arenaTitle(${r})`);
    if (!cur || cur.t !== t) { if (cur) cur.to = r - 1; cur = { t, from: r }; bands.push(cur); }
  }
  cur.to = null;
  const label = (b, i) => (i === 0 ? `&lt; ${b.to + 1}` : b.to == null ? `≥ ${b.from}` : `${b.from}–${b.to}`);
  return `<div class="tbl"><table>
        <tr><th>Title</th>${bands.map((b) => `<td>${b.t}</td>`).join('')}</tr>
        <tr><th>Rating</th>${bands.map((b, i) => `<td>${label(b, i)}</td>`).join('')}</tr>
      </table></div>`;
})();

// ---------- 4. Apply ----------
let wp = fs.readFileSync(wpFile, 'utf8');
const changes = [];
const warnings = [];

wp = wp.replace(/<span data-sync="([^"]+)">([^<]*)<\/span>/g, (all, key, old) => {
  if (!(key in values)) { warnings.push(`unknown data-sync key "${key}"`); return all; }
  if (old !== values[key]) changes.push(`value ${key}: "${old}" → "${values[key]}"`);
  return `<span data-sync="${key}">${values[key]}</span>`;
});
Object.entries(blocks).forEach(([name, html]) => {
  const re = new RegExp(`(<!-- sync:${name} -->)([\\s\\S]*?)(<!-- /sync:${name} -->)`);
  const m = wp.match(re);
  if (!m) { warnings.push(`sync block "${name}" missing in whitepaper.html`); return; }
  const fresh = `\n    ${html}\n    `;
  if (m[2] !== fresh) changes.push(`table ${name} regenerated`);
  wp = wp.replace(re, `$1${fresh}$3`);
});
const usedKeys = new Set([...wp.matchAll(/data-sync="([^"]+)"/g)].map((x) => x[1]));
// (values not referenced by a span may still be used inside generated tables, so unused keys are not reported)
void usedKeys;

// Coverage of concepts the prose should mention
const text = wp.replace(/<[^>]+>/g, ' ');
g('ATTRIBUTES.map((a) => a.name)').forEach((n) => { if (!text.includes(n)) warnings.push(`attribute "${n}" not mentioned in the prose`); });
Object.values(g('TYPE_LABEL')).forEach((n) => { if (!new RegExp(n.slice(0, 4), 'i').test(text)) warnings.push(`activity type "${n}" not mentioned`); });

// ---------- 5. Report / write ----------
let head = null;
try { head = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (e) { /* not a git checkout */ }
const synced = (wp.match(/<meta name="wp-synced-commit" content="([^"]*)"/) || [])[1];
console.log(`Whitepaper last synced at commit: ${synced || '(none)'}${head ? `, HEAD: ${head}` : ''}`);
if (synced && head) {
  try {
    const log = execSync(`git log --oneline --no-merges ${synced}..HEAD -- index.html`, { cwd: root }).toString().trim();
    console.log(log ? `\nApp commits since last sync (review prose for these):\n${log}` : '\nNo app commits since last sync.');
  } catch (e) { console.log('(could not read git log since last sync)'); }
}
console.log(changes.length ? `\nOut of date:\n- ${changes.join('\n- ')}` : '\nNumbers and tables are up to date.');
if (warnings.length) console.log(`\nNotes:\n- ${warnings.join('\n- ')}`);

if (mode === 'fix') {
  if (head) wp = wp.replace(/(<meta name="wp-synced-commit" content=")[^"]*(")/, `$1${head}$2`);
  fs.writeFileSync(wpFile, wp);
  console.log(`\nwhitepaper.html updated${head ? ` (synced commit ${head})` : ''}.`);
} else if (changes.length) {
  process.exit(1);
}
