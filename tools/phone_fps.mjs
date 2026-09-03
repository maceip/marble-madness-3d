// Measure the game's real frame rate inside the Android app's WebView over the Chrome DevTools Protocol.
// Needs a test build (DEBUG_WEBVIEW=true) and:  adb -s <serial> forward tcp:9222 localabstract:webview_devtools_remote_<pid>
//   node tools/phone_fps.mjs                 measure on whatever screen is showing
//   node tools/phone_fps.mjs --race          start a race (game.newGame(0)) first, measure after the intro
//   node tools/phone_fps.mjs --eval "expr"   evaluate an expression in the page and print the result
const args = process.argv.slice(2);
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
if (!page) { console.error('no debuggable page; is the app running a DEBUG_WEBVIEW build and is adb forward set up?'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const call = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
};
const fps = (seconds) => evaluate(`new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last;
  const tick = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < ${seconds * 1000}) requestAnimationFrame(tick); else res({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worstFrameMs: +worst.toFixed(1), frames: n }); };
  requestAnimationFrame(tick); })`, true);

const ex = args.indexOf('--eval');
if (ex >= 0) { console.log(JSON.stringify(await evaluate(args[ex + 1], true), null, 1)); ws.close(); process.exit(0); }
console.log('page:', page.url);
console.log('screen:', await evaluate('window.game ? window.game.screen : "(no game object)"'));
console.log('viewport:', await evaluate('JSON.stringify({ innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio, canvas: window.game && [window.game.r.canvas.width, window.game.r.canvas.height], view: window.game && [window.game.r.viewW, window.game.r.viewH] })'));
if (args.includes('--race')) {
  await evaluate('window.game.sound && window.game.sound.init && window.game.sound.init(); window.game.newGame(0); "started"');
  await evaluate('new Promise((res) => { const t = setInterval(() => { if (window.game.screen === "race") { clearInterval(t); res(true); } }, 100); setTimeout(() => { clearInterval(t); res(false); }, 15000); })', true);
  console.log('screen now:', await evaluate('window.game.screen'));
}
console.log('3 s sample:', JSON.stringify(await fps(3)));
console.log('3 s sample:', JSON.stringify(await fps(3)));
ws.close();
