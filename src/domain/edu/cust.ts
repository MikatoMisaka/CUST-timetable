import type { Diagnostic, TimeSlot } from '../types'
import type { RuleCourse, RuleOutput } from '../importer'

/**
 * 长春理工大学「教学信息一体化服务平台」适配器。
 *
 * 数据来源：POST https://jwgl.cust.edu.cn/api/ClientStudent/Home/StudentHomeApi/QueryStudentScheduleData
 *   - 页面首次打开时课表是服务端直出的 HTML（没有任何接口），
 *     但点「刷新」按钮走的是上面这个 JSON 接口，内容比页面全（页面每格只显示第一门课）。
 *   - 接口不需要额外 token，登录态就是 3 个 cookie，脚本在教务页里同源 fetch 即可带上。
 *   - param 是 base64(encodeURIComponent(JSON))，`{}` 就是「当前校区」，不用传校区名。
 *
 * 适配器只在教务系统的页面上执行（location.origin 必须是 https://jwgl.cust.edu.cn），
 * 否则 fetch 会跨域失败。
 */

/** 教务接口拍平后的一条最小记录：一个「星期 + 时间槽 + 课次」 */
export interface CustRecord {
  /** 星期，1=周一 … 7=周日 */
  w: number
  /** 该时间槽的起始节 */
  s: number
  /** 该时间槽的结束节 */
  e: number
  /** 该时间槽开始时间 "08:00" */
  st: string
  /** 该时间槽结束时间 "09:35" */
  en: string
  /** 课程名 */
  name: string
  /** 教师，多人用「、」连接 */
  teacher: string
  /** 地点，已去掉「[理论]/[实践]」后缀 */
  room: string
  /** 服务端给的周次+节次文本，如 "18周[1-8节]" */
  time: string
  /** 0 = 正常，1 = 调课（页面上那个 [调] 徽标） */
  q: number
  /** 课次 id：同一门课的时间槽共用同一个，用来合并 */
  id: string
}

/** 从页面文字里读到的学期信息 */
export interface CustPage {
  /** 当前是第几教学周 */
  week?: number
  /** 当前周周一 'YYYY-MM-DD' */
  weekStart?: string
  campus?: string
  updatedAt?: string
}

export interface CustPayload {
  records: CustRecord[]
  /** 作息表：服务端返回的整块节次（第1-2节 08:00-09:35 …），跟当天有没有课无关 */
  grid?: { s: number; e: number; st: string; en: string }[]
  page?: CustPage
  /** 取数失败的原因（登录过期、接口异常等） */
  reason?: string
}

/* ---------- 注入到教务页里执行的脚本 ---------- */

/**
 * 返回一段 async 函数体（和 scripts.ts 里 zfFetchJs 各自的形式一致），
 * 由 wrapRun 包起来执行，结果经 TtBridge.post 回传。
 *
 * 学校只认一站式门户买的票：直接打开 jwgl.cust.edu.cn/Student 会换到一张“没有身份”的
 * 会话（接口回 state 2「页面超时已过期」）。正确路径是先在 portal 登录，再走门户的
 * 「本科教学平台」跳转链接进教务。所以脚本在门户页面上会自己补这一跳。
 */
export function custFetchJs(): string {
  return `
var FIELDS = { lesson: 'Lesson', teacher: 'Teacher', room: 'Room', time: 'Time' };

/* 一站式门户 → 本科教学平台（电脑端）。登录后停在门户首页时补这一跳。 */
var PORTAL_ENTRY = 'https://portal.cust.edu.cn/custp/x/to?siteId=d11c3e894ffa410ca9d4786287298714';
if (/(^|\\.)portal\\.cust\\.edu\\.cn$/.test(location.hostname) && location.pathname.indexOf('/x/to') < 0) {
  var hops = 0;
  try { hops = parseInt(sessionStorage.getItem('tt_cust_hop') || '0', 10) || 0; } catch (e) {}
  if (hops < 3) {
    try { sessionStorage.setItem('tt_cust_hop', String(hops + 1)); } catch (e) {}
    location.replace(PORTAL_ENTRY);
    return { records: [], page: {}, reason: '正在从一站式门户进入教学平台…' };
  }
  return { records: [], page: {}, reason: '门户跳转失败，请手动点「本科教学平台电脑端」' };
}

/* 还在 CAS 登录页 / 别的站点上时不要乱发请求，等用户登完再来一次 */
if (!/(^|\\.)jwgl\\.cust\\.edu\\.cn$/.test(location.hostname)) {
  return {
    records: [],
    page: {},
    reason: '还没到课表页，请先完成登录（当前在 ' + location.hostname + location.pathname + '）',
  };
}

var SLOTS = ['MN__TimePieces', 'AM__TimePieces', 'AF__TimePieces', 'PM__TimePieces', 'EV__TimePieces'];

function texts(content) {
  var out = { lesson: '', teacher: '', room: '', time: '' };
  var teachers = [];
  for (var i = 0; i < (content || []).length; i++) {
    var c = content[i] || {};
    if (c.Key === FIELDS.teacher && c.Name) teachers.push(String(c.Name));
    else if (c.Key === FIELDS.lesson && c.Name && !out.lesson) out.lesson = String(c.Name);
    else if (c.Key === FIELDS.room && c.Name && !out.room) out.room = String(c.Name);
    else if (c.Key === FIELDS.time && c.Name && !out.time) out.time = String(c.Name);
  }
  out.teacher = teachers.join('、');
  return out;
}

/* 页面上有「第 13 教学周（2026-11-16 ~ 2026-11-22）」这类文字，顺手读出来当学期锚点 */
var page = {};
var body = (document.body && document.body.innerText) || '';
var mw = body.match(/第\\s*(\\d+)\\s*教学周/);
if (mw) page.week = parseInt(mw[1], 10);
var md = body.match(/第\\s*\\d+\\s*教学周\\s*[（(]\\s*(\\d{4}-\\d{2}-\\d{2})/);
if (md) page.weekStart = md[1];
var mca = body.match(/(朝阳校区|春明湖校区)/);
if (mca) page.campus = mca[1];
var mu = body.match(/课表更新时间\\s*[:：]?\\s*(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2})/);
if (mu) page.updatedAt = mu[1];

var payload = JSON.stringify({
  param: btoa(encodeURIComponent('{}')),
  __permission: { MenuID: '00000000-0000-0000-0000-000000000000', Operate: 'select', Operation: 0 },
  __log: { MenuID: '00000000-0000-0000-0000-000000000000', Logtype: 6, Context: '查询' }
});

var res = await fetch(location.origin + '/api/ClientStudent/Home/StudentHomeApi/QueryStudentScheduleData', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Accept': 'application/json, text/plain, */*' },
  body: payload
});
if (!res.ok) return { records: [], page: page, reason: 'HTTP ' + res.status + '（' + location.pathname + '）' };
var json = await res.json();
if (!json || json.state !== 0) {
  return {
    records: [],
    page: page,
    reason: ((json && (json.message || json.msg)) || '接口返回异常') + '（' + location.pathname + '）',
  };
}

var records = [];
var grid = [];
var days = (json.data && json.data.AdjustDays) || [];
for (var di = 0; di < days.length; di++) {
  var day = days[di] || {};
  for (var si = 0; si < SLOTS.length; si++) {
    var pieces = day[SLOTS[si]] || [];
    for (var pi = 0; pi < pieces.length; pi++) {
      var piece = pieces[pi] || {};
      var dtos = piece.Dtos || [];
      /* 作息表跟有没有课无关：整个学期的节次块都在，空块也要收，否则节次表会缺后面几节 */
      grid.push({
        s: parseInt(piece.StartSection, 10),
        e: parseInt(piece.EndSection, 10),
        st: String(piece.StartTime || ''),
        en: String(piece.EndTime || '')
      });
      for (var xi = 0; xi < dtos.length; xi++) {
        var dto = dtos[xi] || {};
        var t = texts(dto.Content);
        if (!t.lesson) continue;
        records.push({
          w: parseInt(day.WIndex, 10),
          s: parseInt(piece.StartSection, 10),
          e: parseInt(piece.EndSection, 10),
          st: String(piece.StartTime || ''),
          en: String(piece.EndTime || ''),
          name: t.lesson,
          teacher: t.teacher,
          room: t.room,
          time: t.time,
          q: parseInt(dto.QueryType, 10) || 0,
          id: String(dto.LessonOccupyID || '')
        });
      }
    }
  }
}
return { records: records, grid: grid, page: page };
`
}

/* ---------- 工具函数 ---------- */

const FULLWIDTH: Record<string, string> = {
  '，': ',', '、': ',', '；': ',', ';': ',',
  '－': '-', '—': '-', '–': '-', '～': '-', '~': '-',
  '（': '(', '）': ')', '：': ':', '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
}

const half = (s: string): string => {
  let out = s
  for (const [k, v] of Object.entries(FULLWIDTH)) out = out.split(k).join(v)
  return out
}

const norm = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v))

/** "08:00" → 480 分钟 */
function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** "[1-8节]" → [1,8]；没有括号返回 null */
export function parsePeriodText(text: string): [number, number] | null {
  const m = /\[\s*(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*节/.exec(half(text))
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  return a >= 1 && b >= a ? [a, b] : null
}

/**
 * "18周[1-8节]" / "2-4,6-7,9,12-16周[1-2节]" → 引擎能吃的周次表达式。
 * 输出一定是纯 ASCII、逗号分段、无空格（parseWeekExpr 不认「第」和空格）。
 * 出现单/双周时展开成显式周列表：引擎的单双标记是「整串全局生效」，
 * 这里按段展开才不会让 "1-8单,10-16" 的后半段也被过滤成奇数周。
 */
export function weeksFromCustText(text: string): { weeks: string; error?: string } {
  const s = half(text)
  const cut = s.indexOf('周')
  const raw = (cut >= 0 ? s.slice(0, cut) : s.replace(/\[[^\]]*\]/g, '')).trim()
  if (!raw) return { weeks: '', error: 'EMPTY_WEEKS' }
  const weeks: number[] = []
  const plain: string[] = []
  let error: string | undefined
  let anyParity = false
  for (const part of raw.split(',')) {
    const p = part.trim()
    if (!p) continue
    const odd = /单/.test(p)
    const even = /双/.test(p)
    if (odd || even) anyParity = true
    const body = p.replace(/[()（）单双周节第教学\s]/g, '')
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(body)
    if (!m) {
      error = `UNPARSED_WEEK_PART:${p}`
      continue
    }
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a < 1 || b < a || b > 64) {
      error = `WEEK_RANGE_INVALID:${p}`
      continue
    }
    if (!odd && !even) plain.push(b === a ? String(a) : `${a}-${b}`)
    for (let w = a; w <= b; w++) {
      if (odd && w % 2 === 0) continue
      if (even && w % 2 === 1) continue
      weeks.push(w)
    }
  }
  if (!weeks.length) return { weeks: '', error: error ?? 'EMPTY_WEEKS' }
  if (!anyParity && !error) {
    // 没有单双周、全部解析成功：原样保留区间写法，读起来更像课表
    return { weeks: plain.join(',') }
  }
  const uniq = [...new Set(weeks)].sort((a, b) => a - b)
  return { weeks: uniq.join(','), ...(error ? { error } : {}) }
}

/**
 * 把「第 1-2 节 08:00-09:35」这种两节一块的作息拆成逐节的 TimeSlot。
 * 教务只给整块的起止时间，节与节之间的分界只能按「中间留 5 分钟课间」推。
 */
export function custTimeGrid(blocks: { s: number; e: number; st: string; en: string }[]): TimeSlot[] | undefined {
  const slots = new Map<number, TimeSlot>()
  for (const b of blocks) {
    const start = parseHm(b.st)
    const end = parseHm(b.en)
    if (start == null || end == null || end <= start) continue
    const n = Math.max(1, b.e - b.s + 1)
    const gap = n > 1 && end - start >= n * 30 ? 5 : 0
    const each = Math.round((end - start - gap * (n - 1)) / n)
    for (let i = 0; i < n; i++) {
      slots.set(b.s + i, { index: b.s + i, start: start + i * (each + gap), end: start + i * (each + gap) + each })
    }
  }
  const list = [...slots.values()].sort((a, b) => a.index - b.index)
  if (!list.length) return undefined
  // parseTimeSlots 要求 index 从 1 连续递增，断了就整份丢掉，所以这里自己判
  for (let i = 0; i < list.length; i++) if (list[i].index !== i + 1) return undefined
  return list
}

/** 'YYYY-MM-DD' 加减天数 */
function shiftDate(date: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ---------- 主解析 ---------- */

/**
 * 接口记录 → RuleOutput。
 *
 * 合并规则（都拿真实数据验过）：
 *   1. 同一「课次 id + 星期 + 周次文本」合起来是一条规则：集中实践课一节 8 节课，
 *      服务端会把它铺在 4 个时间槽里（1-2/3-4/5-6/7-8），合并后才是完整的一整段。
 *      实测 35 组全部连续，括号里的 [x-y节] 与槽位并集 100% 一致，所以优先用括号里的。
 *   2. 同一门课不同周次在不同格子里（调课），服务端会给不同的课次 id + 不同周次文本，
 *      自然落成两条规则，交给引擎按「课名+教师」归到同一门课下。
 */
export function parseCustPayload(input: unknown): RuleOutput {
  const payload = (input ?? {}) as Partial<CustPayload>
  const diagnostics: Diagnostic[] = []
  const list = Array.isArray(payload.records) ? payload.records : []

  if (payload.reason) {
    diagnostics.push({ level: 'error', code: 'FETCH_FAILED', message: String(payload.reason) })
  }
  if (!list.length) {
    if (!payload.reason) diagnostics.push({ level: 'error', code: 'EMPTY', message: '接口没有返回课程' })
    return { courses: [], diagnostics }
  }

  interface Group {
    w: number
    id: string
    time: string
    name: string
    teacher: string
    room: string
    q: number
    s: number
    e: number
  }
  const groups = new Map<string, Group>()
  const blocks = new Map<string, { s: number; e: number; st: string; en: string }>()
  /* 先放作息表：没有课的节次块也要在，否则节次表只到最后一门课的节次为止 */
  for (const b of Array.isArray(payload.grid) ? payload.grid : []) {
    const s = Number(b?.s)
    const e = Number(b?.e)
    if (!(s >= 1) || !(e >= s)) continue
    blocks.set(`${s}-${e}`, { s, e, st: norm(b?.st), en: norm(b?.en) })
  }
  let maxWeek = 0

  for (const raw of list) {
    const r = (raw ?? {}) as CustRecord
    const w = Number(r.w)
    const s = Number(r.s)
    const e = Number(r.e)
    const name = norm(r.name)
    if (!name) continue
    if (!(w >= 1 && w <= 7) || !(s >= 1) || !(e >= s)) {
      diagnostics.push({ level: 'warn', code: 'BAD_SLOT', message: `「${name}」星期或节次无法识别（周${r.w} ${r.s}-${r.e}）` })
      continue
    }
    blocks.set(`${s}-${e}`, { s, e, st: norm(r.st), en: norm(r.en) })
    const key = `${norm(r.id)}|${w}|${norm(r.time)}`
    const hit = groups.get(key)
    if (hit) {
      hit.s = Math.min(hit.s, s)
      hit.e = Math.max(hit.e, e)
      if (!hit.room && r.room) hit.room = norm(r.room)
      if (!hit.teacher && r.teacher) hit.teacher = norms(r.teacher)
    } else {
      groups.set(key, {
        w, id: norm(r.id), time: norm(r.time), name,
        teacher: norms(r.teacher), room: roomOf(r.room), q: Number(r.q) || 0,
        s, e,
      })
    }
  }

  const courses: RuleCourse[] = []
  for (const g of groups.values()) {
    const wk = weeksFromCustText(g.time)
    if (!wk.weeks) {
      diagnostics.push({ level: 'error', code: 'UNPARSED_WEEKS', message: `「${g.name}」周次无法解析：${g.time}` })
      continue
    }
    if (wk.error) {
      diagnostics.push({ level: 'warn', code: 'WEEKS_PARTIAL', message: `「${g.name}」周次部分无法解析：${g.time}` })
    }
    const pr = parsePeriodText(g.time)
    const startPeriod = pr ? pr[0] : g.s
    const endPeriod = pr ? pr[1] : g.e
    // 括号写的节次区间比槽位宽时以括号为准（集中实践就是这种），窄的时候仍取并集
    const lo = Math.min(startPeriod, g.s)
    const hi = Math.max(endPeriod, g.e)
    for (const part of wk.weeks.split(',')) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part)
      if (m) maxWeek = Math.max(maxWeek, Number(m[2] ?? m[1]))
    }
    const course: RuleCourse = {
      name: g.name,
      weekday: g.w,
      startPeriod: lo,
      endPeriod: hi,
      weeks: wk.weeks,
      raw: {
        time: g.time,
        room: g.room,
        occupyId: g.id,
        adjust: g.q === 1 ? '调课' : '正常',
      },
    }
    if (g.teacher) course.teacher = g.teacher
    if (g.room) course.location = g.room
    courses.push(course)
  }

  if (!courses.length) {
    diagnostics.push({ level: 'error', code: 'EMPTY', message: '没有解析出任何课程' })
    return { courses: [], diagnostics }
  }

  const adjust = courses.filter((c) => c.raw?.adjust === '调课').length
  if (adjust) {
    diagnostics.push({ level: 'info', code: 'ADJUSTED', message: `其中 ${adjust} 条是调课后的安排` })
  }

  const timeGrid = custTimeGrid([...blocks.values()])
  if (!timeGrid) {
    diagnostics.push({ level: 'warn', code: 'NO_GRID', message: '节次时间表没拼完整，沿用学期设置' })
  }

  /* 学期锚点：页面写着「第 13 教学周（2026-11-16 ~ 2026-11-22）」，反推第 1 周周一 */
  const out: RuleOutput = { courses, diagnostics }
  const page = (payload.page ?? {}) as CustPage
  const week = Number(page.week)
  const weekStart = norm(page.weekStart)
  if (week >= 1 && weekStart) {
    const startDate = shiftDate(weekStart, -(week - 1) * 7)
    if (startDate) out.semester = { startDate, totalWeeks: Math.max(20, maxWeek) }
  }
  if (timeGrid) out.timeGrid = timeGrid
  return out
}

const norms = (v: unknown): string => norm(v).replace(/[、,，;；]+/g, '、').replace(/^、|、$/g, '')

/** "校内-南实训516[实践]" → "校内-南实训516"（性质留在 raw 里，不进地点） */
const roomOf = (v: unknown): string => norm(v).replace(/\[[^\]]*\]\s*$/, '').trim()
