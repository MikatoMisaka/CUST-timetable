# 长春理工大学（CUST）接入说明

本分支把「嘎嘎课程表」的教务导入改成了长春理工大学专用。所有院校清单已裁剪到只剩一所，
适配器在 `src/domain/edu/cust.ts`。

## 一、入口：必须走一站式门户

| 入口 | 结果 |
| --- | --- |
| `https://jwgl.cust.edu.cn/Student`（教务首页） | 会跳到统一身份认证，换回来的票**没有身份**：接口回 `{"state":2,"message":"页面超时已过期，请重新登录!"}`，页面在 `/Login` 与 `/page-timeout` 之间来回 |
| `https://portal.cust.edu.cn/custp/x/to?siteId=d11c3e894ffa410ca9d4786287298714`（门户「本科教学平台电脑端」） | 正确。1~2 秒落到 `/Student`，接口 `state:0`、48448 字节、`AdjustDays` 7 天 |

`schools.json` 里登记的就是后者。原因：学校把身份挂在门户（shiro-cas）那条链路里，
教务自己发的票是空壳。桌面浏览器在旧入口上偶发可用，是因为它还留着门户那套 cookie。

未登录时点那个 `x/to` 链接，会跳
`https://mysso.cust.edu.cn/cas/login?service=https://portal.cust.edu.cn/custp/shiro-cas`；
登录完成后回到**门户首页**，而不是 `x/to` 本身——所以需要再补一跳，见下文。

## 二、接口

```
POST https://jwgl.cust.edu.cn/api/ClientStudent/Home/StudentHomeApi/QueryStudentScheduleData
Content-Type: application/json;charset=UTF-8

{"param":"JTdCJTdE",
 "__permission":{"MenuID":"00000000-0000-0000-0000-000000000000","Operate":"select","Operation":0},
 "__log":{"MenuID":"00000000-0000-0000-0000-000000000000","Logtype":6,"Context":"查询"}}
```

`param` = `base64(encodeURIComponent(JSON))`，空参数就是 `base64("{}")` = `JTdCJTdE`。
传 `{"XQJC":"朝阳校区"}` 与空参等价；传 `春明湖校区` 返回 0 条。

响应 `data.AdjustDays[7]`，每天 `{WIndex, FullTitle, MN__TimePieces…EV__TimePieces[]}`，
每个时间块 `{Title:"第1-2节", StartTime, EndTime, StartSection, EndSection, Dtos[]}`；
`Dtos[].Content[]` 里 `Key` 为 `Lesson` / `Teacher` / `Room` / `Time`（`Time` 形如 `18周[1-8节]`），
`LessonOccupyID` 同一门课在多个时间块里出现时值相同——按它合并即可把这门课铺满整段节次。

## 三、会话

1. **首次登录必须走门户**，之后才可能有身份。
2. 建立之后，**只留 `jwgl.cust.edu.cn` 的两个 cookie 就够**：
   `wengine_new_ticket`（16 字节）+ `ASP.NET_SessionId`（24 字节）。
   实测把它们塞进一个全新的浏览器上下文，直接开 `/Student`、直接调接口，`state:0`、7 天。
3. 全部 cookie 都是**会话级**（`expires=-1`），且服务端空闲约 104 分钟就失效。
   所以：不要做后台定时抓取，只在打开 App 时抓一次；失败就提示重新登录。

## 四、补一跳

登录完停在门户首页时，注入脚本会自己 `location.replace` 到那个 `x/to` 链接，
最多跳 3 次（`sessionStorage.tt_cust_hop` 计数），防止门户出故障时无限循环。
还没到 `jwgl.cust.edu.cn` 之前不会发任何请求，只返回一句「还没到课表页，请先完成登录」。

## 五、排查工具

`tools/` 下是一批一次性脚本，都走 CDP，没有第三方依赖：

| 脚本 | 用途 |
| --- | --- |
| `cdp-probe.mjs` | 对已连上的 WebView/浏览器页执行一段 JS，可截图；`node tools/cdp-probe.mjs <url子串> "<js>"` |
| `cookies.mjs` | 列出 `Network.getAllCookies` 的全部 cookie（`document.cookie` 看不到 HttpOnly 的） |
| `navchain.mjs` | 浏览器级录制所有页面的跳转链（跨重定向不断） |
| `pc-enter-edu.mjs` / `pc-api.mjs` | 在电脑上用门户会话进教务、打一次接口 |
| `pc-min-cookies.mjs` | 试最小 cookie 组合能不能直连接口 |
| `pc-reuse.mjs` | 把已登录环境的 cookie 搬进全新上下文，验证能否复用 |

真机调试：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，
`pid` 每次重启应用都会变，用 `adb shell "cat /proc/net/unix | grep webview_devtools_remote_"` 取。
