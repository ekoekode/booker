// Run JavaScript inside the running Obsidian (started with --remote-debugging-port=9222) and optionally save a screenshot.
//   node scripts/cdp.mjs '<expression>' [screenshot.png]
const [,, expr, shot] = process.argv;
const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = pages.find((p) => p.type === "page" && p.url.startsWith("app://obsidian.md/index.html"));
if (!page) throw new Error("No Obsidian window on port 9222. Start it with: open -a Obsidian --args --remote-debugging-port=9222");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Runtime.exceptionThrown") logs.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") logs.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  pend.get(d.id)?.(d);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
if (expr && expr !== "-") {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
}
await new Promise((r) => setTimeout(r, 1000));
console.log("ERRORS", logs.slice(0, 15));
if (shot) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  (await import("node:fs")).writeFileSync(shot, Buffer.from(r.result.data, "base64"));
}
ws.close();
