// 通过 adb forward 的 devtools 端口，在设备里的 WebView 页上跑一段 JS 并打印结果。
// 用法: node tools/cdp-probe.mjs <匹配url子串> "<js表达式>" [--shot 输出文件]
const [, , match = 'localhost', expr = '1', ...rest] = process.argv
const shotIdx = rest.indexOf('--shot')
const shotOut = shotIdx >= 0 ? rest[shotIdx + 1] : null

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const target = list.find((t) => (t.url || '').includes(match))
if (!target) {
  console.error('没找到目标，现有：', list.map((t) => t.url).join(' | '))
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const waiting = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id
    waiting.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  const p = waiting.get(msg.id)
  if (!p) return
  waiting.delete(msg.id)
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
  else p.resolve(msg.result)
}

ws.onerror = (e) => {
  console.error('ws 错误', e.message || e)
  process.exit(1)
}

await new Promise((resolve) => (ws.onopen = resolve))

const r = await send('Runtime.evaluate', {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
})
console.log(JSON.stringify(r.result?.value ?? r.result, null, 2))

if (shotOut) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(shotOut, Buffer.from(shot.data, 'base64'))
  console.log('截图已存:', shotOut)
}

ws.close()
process.exit(0)
