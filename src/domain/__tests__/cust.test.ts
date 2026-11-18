import { describe, expect, it } from 'vitest'
import { custFetchJs, custTimeGrid, parseCustPayload, parsePeriodText, weeksFromCustText, type CustPage, type CustRecord } from '../edu/cust'

/* 长理教务接口拍平后的记录；字段名跟注入脚本回传的一致 */
const rec = (o: Partial<CustRecord> & Pick<CustRecord, 'w' | 's' | 'e'>): CustRecord => ({
  st: '08:00',
  en: '09:35',
  name: '',
  teacher: '',
  room: '',
  time: '',
  q: 0,
  id: '',
  ...o,
})

const page: CustPage = { week: 13, weekStart: '2026-11-16', campus: '朝阳校区', updatedAt: '2026-11-18 11:20' }

/* 服务端给的作息表：6 块两节，跟当天有没有课无关 */
const GRID = [
  { s: 1, e: 2, st: '08:00', en: '09:35' },
  { s: 3, e: 4, st: '10:05', en: '11:40' },
  { s: 5, e: 6, st: '13:30', en: '15:05' },
  { s: 7, e: 8, st: '15:35', en: '17:10' },
  { s: 9, e: 10, st: '18:00', en: '19:35' },
  { s: 11, e: 12, st: '19:45', en: '21:20' },
]

describe('长理：注入脚本', () => {
  const api = {
    state: 0,
    data: {
      AdjustDays: [
        {
          WIndex: 1,
          FullTitle: '星期一',
          MN__TimePieces: [
            {
              StartSection: 1,
              EndSection: 2,
              StartTime: '08:00',
              EndTime: '09:35',
              Title: '第1-2节',
              Dtos: [
                {
                  LessonOccupyID: 'A',
                  QueryType: 0,
                  Content: [
                    { Key: 'Lesson', Name: '操作系统' },
                    { Key: 'Teacher', Name: '黄硕' },
                    { Key: 'Teacher', Name: '李兰婷' },
                    { Key: 'Room', Name: '研608[理论]' },
                    { Key: 'Time', Name: '1-16周[1-2节]' },
                  ],
                },
              ],
            },
          ],
          AM__TimePieces: [],
          AF__TimePieces: [],
          PM__TimePieces: [],
          /* 晚上没有课，但作息块照样在：节次表不能因此只到第 2 节 */
          EV__TimePieces: [
            { StartSection: 11, EndSection: 12, StartTime: '19:45', EndTime: '21:20', Title: '第11-12节', Dtos: [] },
          ],
        },
      ],
    },
  }

  it('请求地址、param 与 cookie 都对，记录拍平', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => api }
    }
    const doc = { body: { innerText: '第 13 教学周（2026-11-16 ~ 2026-11-22）\n朝阳校区  课表更新时间 2026-11-18 11:20:13' } }
    const body = new Function('document', 'location', 'fetch', `return (async()=>{${custFetchJs()}})()`)
    const out = (await body(doc, { origin: 'https://jwgl.cust.edu.cn', hostname: 'jwgl.cust.edu.cn', pathname: '/Student' }, fakeFetch)) as { records: CustRecord[]; grid: { s: number; e: number }[]; page: CustPage }

    expect(calls[0].url).toBe('https://jwgl.cust.edu.cn/api/ClientStudent/Home/StudentHomeApi/QueryStudentScheduleData')
    expect(calls[0].init.credentials).toBe('include')
    const sent = JSON.parse(String(calls[0].init.body)) as { param: string; __permission: { MenuID: string }; __log: { Context: string } }
    expect(sent.param).toBe(Buffer.from(encodeURIComponent('{}')).toString('base64'))
    expect(sent.__permission.MenuID).toBe('00000000-0000-0000-0000-000000000000')
    expect(sent.__log.Context).toBe('查询')

    expect(out.records).toHaveLength(1)
    expect(out.records[0].name).toBe('操作系统')
    expect(out.records[0].teacher).toBe('黄硕、李兰婷')
    expect(out.records[0].room).toBe('研608[理论]')
    /* 空块也进作息表 */
    expect(out.grid).toHaveLength(2)
    expect(out.page.week).toBe(13)
    expect(out.page.weekStart).toBe('2026-11-16')
    expect(out.page.campus).toBe('朝阳校区')
  })

  it('会话过期时带原因返回，不抛错', async () => {
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ state: 2, message: '页面超时已过期，请重新登录!' }) })
    const body = new Function('document', 'location', 'fetch', `return (async()=>{${custFetchJs()}})()`)
    const out = (await body({ body: { innerText: '' } }, { origin: 'https://jwgl.cust.edu.cn', hostname: 'jwgl.cust.edu.cn', pathname: '/Student' }, fakeFetch)) as { records: CustRecord[]; reason?: string }
    expect(out.records).toEqual([])
    expect(out.reason).toContain('超时')
  })
})

describe('长理：解析成课表', () => {
  const records: CustRecord[] = [
    rec({ w: 1, s: 1, e: 2, name: '操作系统', teacher: '黄硕', room: '研608[理论]', time: '1-16周[1-2节]', id: 'A' }),
    rec({ w: 1, s: 3, e: 4, st: '10:05', en: '11:40', name: '数学模型', teacher: '陈钰婷', room: '研602[理论]', time: '1-16周[3-4节]', id: 'B' }),
    rec({ w: 2, s: 1, e: 2, name: '脑与认知科学', teacher: '王萌', room: '研602[理论]', time: '11周[1-2节]', q: 1, id: 'C1' }),
    rec({ w: 2, s: 1, e: 2, name: '脑与认知科学', teacher: '杨菁菁', room: '研602[理论]', time: '2-4,6-7,9,12-16周[1-2节]', id: 'C2' }),
    /* 集中实践课：同一个课次占 4 个时间槽，节次只在 Time 的括号里写全 */
    rec({ w: 1, s: 1, e: 2, name: '人工智能数学应用课程设计', teacher: '吴凤侠、何新', room: '校内-南实训516[实践]', time: '18周[1-8节]', id: 'P' }),
    rec({ w: 1, s: 3, e: 4, st: '10:05', en: '11:40', name: '人工智能数学应用课程设计', teacher: '吴凤侠、何新', room: '校内-南实训516[实践]', time: '18周[1-8节]', id: 'P' }),
    rec({ w: 1, s: 5, e: 6, st: '13:30', en: '15:05', name: '人工智能数学应用课程设计', teacher: '吴凤侠、何新', room: '校内-南实训516[实践]', time: '18周[1-8节]', id: 'P' }),
    rec({ w: 1, s: 7, e: 8, st: '15:35', en: '17:10', name: '人工智能数学应用课程设计', teacher: '吴凤侠、何新', room: '校内-南实训516[实践]', time: '18周[1-8节]', id: 'P' }),
  ]
  const out = parseCustPayload({ records, grid: GRID, page })

  it('按课次合并，一门课多个时间槽只出一条规则', () => {
    expect(out.courses).toHaveLength(5)
    const p = out.courses.filter((c) => c.name === '人工智能数学应用课程设计')
    expect(p).toHaveLength(1)
    expect(p[0].weekday).toBe(1)
    expect(p[0].startPeriod).toBe(1)
    /* 槽位并集到第 8 节，括号里也是 1-8 */
    expect(p[0].endPeriod).toBe(8)
    expect(p[0].location).toBe('校内-南实训516')
    expect(p[0].weeks).toBe('18')
  })

  it('周次、地点、教师按引擎吃的格式输出', () => {
    const os = out.courses.find((c) => c.name === '操作系统')!
    expect(os.weeks).toBe('1-16')
    expect(os.location).toBe('研608')
    const brain = out.courses.filter((c) => c.name === '脑与认知科学')
    expect(brain.map((c) => c.weeks).sort()).toEqual(['11', '2-4,6-7,9,12-16'])
    expect(out.courses.every((c) => /^[\d,-]+$/.test(c.weeks))).toBe(true)
  })

  it('调课有提示，课次 id 不同就各算一条', () => {
    const adj = out.diagnostics.find((d) => d.code === 'ADJUSTED')
    expect(adj?.level).toBe('info')
    expect(adj?.message).toContain('1 条')
  })

  it('节次表按两节一块拆成逐节，中间留课间', () => {
    const g = out.timeGrid!
    expect(g).toHaveLength(12)
    expect(g.every((s, i) => s.index === i + 1)).toBe(true)
    expect(g[0]).toEqual({ index: 1, start: 480, end: 525 })
    expect(g[1]).toEqual({ index: 2, start: 530, end: 575 })
  })

  it('由当前教学周反推第 1 周周一', () => {
    expect(out.semester?.startDate).toBe('2026-08-24')
    expect(out.semester?.totalWeeks).toBeGreaterThanOrEqual(18)
  })

  it('会话过期给错误诊断，没有课程', () => {
    const dead = parseCustPayload({ records: [], reason: '页面超时已过期，请重新登录!' })
    expect(dead.courses).toHaveLength(0)
    expect(dead.diagnostics[0]).toMatchObject({ level: 'error', code: 'FETCH_FAILED' })
  })
})

describe('长理：周次与节次文本', () => {
  it('常见写法都认', () => {
    expect(weeksFromCustText('18周[1-8节]').weeks).toBe('18')
    expect(weeksFromCustText('2-4,6-7,9,12-16周[1-2节]').weeks).toBe('2-4,6-7,9,12-16')
    expect(weeksFromCustText('1-16周[3-4节]').weeks).toBe('1-16')
    expect(parsePeriodText('18周[1-8节]')).toEqual([1, 8])
    expect(parsePeriodText('1-16周[3-4节]')).toEqual([3, 4])
  })

  it('中文逗号、全角数字也能读', () => {
    expect(weeksFromCustText('１-８周').weeks).toBe('1-8')
    expect(weeksFromCustText('1，3，5周').weeks).toBe('1,3,5')
  })

  it('单双周按段展开，不让前一段的单周标记吃掉后一段', () => {
    expect(weeksFromCustText('1-8单,10-16周').weeks).toBe('1,3,5,7,10,11,12,13,14,15,16')
    expect(weeksFromCustText('2-16双周').weeks).toBe('2,4,6,8,10,12,14,16')
  })

  it('读不懂的周次报错，不静默丢成空', () => {
    expect(weeksFromCustText('下周[1-2节]').error).toBeTruthy()
    expect(parsePeriodText('没有括号')).toBeNull()
  })

  it('节次不连续时整份节次表丢弃，避免引擎按错的时间排课', () => {
    expect(custTimeGrid([{ s: 1, e: 2, st: '08:00', en: '09:35' }, { s: 4, e: 5, st: '10:05', en: '11:40' }])).toBeUndefined()
    expect(custTimeGrid([{ s: 1, e: 2, st: '08:00', en: '09:35' }])).toHaveLength(2)
  })
})

