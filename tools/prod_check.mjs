// Production smoke check: is the live site running the current server and bundle?
// Fails loudly when the deployment is behind the repo — the situation that made the Android app's login 404.
//   node tools/prod_check.mjs [origin]      default https://marbles.secure.build
const origin = (process.argv[2] || process.env.PUBLIC_ORIGIN || 'https://marbles.secure.build').replace(/\/+$/, '');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const get = async (path, opts = {}) => {
  try {
    const r = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...opts });
    return { status: r.status, headers: r.headers, text: await r.text() };
  } catch (e) { return { status: 0, headers: new Headers(), text: String(e) }; }
};

const index = await get('/');
check('index served', index.status === 200, String(index.status));
check('index carries __MM__ with an install nonce', /__MM__=.*"nonce":"/.test(index.text), 'server too old if missing');
const cookie = index.headers.get('set-cookie') || '';
check('index sets the lobby cookie', /mm_lobby=/.test(cookie));

const bundle = await get('/bundle.js');
check('bundle served', bundle.status === 200, `${(bundle.text.length / 1024).toFixed(0)} KB`);
check('bundle has the Android bridge wiring (triggerAuth + NativeBridge)', bundle.text.includes('triggerAuth') && bundle.text.includes('NativeBridge'));
check('bundle has telemetry', bundle.text.includes('/api/telemetry/event'));

const gh = await get('/auth/github?app=prodcheck0001');
check('/auth/github redirects to GitHub', gh.status === 302 && /github\.com\/login\/oauth\/authorize/.test(gh.headers.get('location') || ''), String(gh.status));
check('/auth/github keeps the app nonce in the state cookie', /mm_oauth_gh=[^;|]+\|prodcheck0001/.test(gh.headers.get('set-cookie') || ''));
const tw = await get('/auth/twitter?app=prodcheck0001');
check('/auth/twitter redirects to X', tw.status === 302 && /(twitter|x)\.com\/i\/oauth2\/authorize/.test(tw.headers.get('location') || ''), String(tw.status));

const sum = await get('/api/telemetry/summary');
check('/api/telemetry/summary answers', sum.status === 200, String(sum.status));
const ev = await get('/api/telemetry/event', { method: 'POST', body: '{}' });
check('telemetry refuses requests without a session', ev.status === 403, String(ev.status));

if (failed) { console.log(`\n${failed} check(s) failed: ${origin} is not running the current build. Deploy (npm run build; restart tools/serve.mjs with .env) and re-run.`); process.exit(1); }
console.log(`\n${origin} is current.`);
