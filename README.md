<img src="docs/logo.png" width="140" alt="嘎嘎课程表-CUST特化版" />

# 嘎嘎课程表 · 长春理工大学特化版

**fork 自 [shuakami/timetable](https://github.com/shuakami/timetable)，只服务长春理工大学（CUST）。**

<a href="https://github.com/MikatoMisaka/CUST-timetable/releases/latest"><img src="docs/download-android.svg" alt="下载 Android 安装包" /></a>

> 这不是上游项目，改动都在下面列清楚了。上游支持 1188 所学校，本分支**只保留长春理工大学**，并为它单独写了教务适配器和一款 2×2 小组件。

## 目录

- [本分支改了什么](#本分支改了什么)
- [安装](#安装)
- [自己构建](#自己构建)
- [已知问题](#已知问题)
- [上游功能](#上游功能)
- [许可](#许可)

## 本分支改了什么

### 1. 新增长春理工大学教务适配器

文件：`src/domain/edu/cust.ts`（约 410 行，无运行时依赖）

**取数入口**（这一步踩了很久）：必须从学校一站式门户进——

```
https://portal.cust.edu.cn/custp/x/to?siteId=d11c3e894ffa410ca9d4786287298714
  → https://jwgl.cust.edu.cn/Student
```

直接开 `jwgl.cust.edu.cn/Student` 也能走完 CAS，换出来的票**没有身份**：`localStorage.STUDENT_DTO` 是字符串 `"null"`，课表接口回 `{"state":2,"message":"页面超时已过期，请重新登录!"}`。门户那条 `x/to` 才是带身份的入口。

**为什么调接口而不是解析页面**：课表页首次渲染**不发任何 XHR**，数据是服务端直接渲染进 HTML 的；而且每个格子只显示第一门课，其余折叠在「查看更多」后面。所以适配器在页面里注入脚本，直接 `POST /api/ClientStudent/Home/StudentHomeApi/QueryStudentScheduleData`：

```jsonc
{
  "param": "<base64(encodeURIComponent(JSON))>",   // {} 即可，不用传校区
  "__permission": { "MenuID": "00000000-0000-0000-0000-000000000000", "Operate": "select", "Operation": 0 },
  "__log": { "MenuID": "00000000-0000-0000-0000-000000000000", "Logtype": 6, "Context": "查询" }
}
```

返回 48 KB JSON，`data.AdjustDays[0..6]` 是周一到周日，每天按 `MN/AM/AF/PM/EV__TimePieces` 分块，每块里 `Dtos[]` 一条课：`LessonOccupyID`、`Content[{Key:Lesson|Teacher|Room|Time}]`、`QueryType`。

几处必须处理的细节：

- **合并**：集中实践课一条 `LessonOccupyID` 会同时出现在同一天的 1-2/3-4/5-6/7-8 四个格子里，按 `id|weekday|time` 合并成 1-8 节。
- **作息表**：`grid` 连**空节次块**一起收。否则学生没选晚课时，作息只到第 8 节，第 9-12 节的课会被课表引擎判 `PERIOD_OUT_OF_GRID` 整条丢掉。
- **单双周**：上游 `parseWeekExpr` 的单/双标记是整串全局生效，适配器改成**按段展开**再输出。
- **调课**：`QueryType === 1` 记成 `ADJUSTED` 诊断，页面上对应那个 `[调]` 徽标。
- **会话失效**：接口回 `state:2` 时转成 `expired`，让上层提示重新登录，而不是报解析错误。

诊断码：`FETCH_FAILED` `EMPTY` `BAD_SLOT` `UNPARSED_WEEKS` `WEEKS_PARTIAL` `ADJUSTED` `NO_GRID`。

### 2. 只保留一所学校

`src/domain/edu/schools.json` 从 1188 行砍到 1 行：

```json
[["长春理工大学", "cust", "https://portal.cust.edu.cn/custp/x/to?siteId=d11c3e894ffa410ca9d4786287298714"]]
```

想加回别的学校，把上游那份 `schools.json` 对应行粘回来即可，适配器是通用的。

改动同时接进了：`src/domain/edu/systems.ts`（`EduSystemId` 加 `'cust'`、`SYSTEM_LABEL`、`SCRIPTED`、`URL_MARKS`、`isTimetablePage`）、`src/app/edu-browser.ts`（`custFetch`）、`src/app/edu.tsx`（探测 + 导入 + 学校页回落）、`src/app/edu-sync.ts`（自动更新分支）。

### 3. 新增 2×2 桌面小组件「下节小卡」

- `android/app/src/main/java/app/timetable/widget/MiniWidget.java`
- `android/app/src/main/res/layout/widget_mini.xml`、`res/xml/widget_mini.xml`

显示**接下来两节课**（正在上的课优先）+ 课程配色 + 倒计时。上游 4 款组件都是 150dp，桌面按 `ceil((dp+30)/70)` 折算成 3 格，看着就不是 2×2 —— 真正的 2 格是 **110dp**。

### 4. 修掉的坑

| 问题 | 现象 | 改动 |
|---|---|---|
| 内置浏览器被盖住 | 登录页能点能输入但一片白 | 原生 WebView 在应用 WebView 下层，「课表来源」页的路由容器背景不透明且带 inline `visibility: visible`，`src/index.css` 的隐藏规则加了 `!important` 并连后代一起隐藏 |
| 每次启动都问要不要同步日历 | 用户不想同步也被反复打扰 | `src/app/calendar.ts` 加 `tt.cal.asked` 标记，只在首次进应用问一次；`src/app/reminder.tsx` 底部加「以后再说」 |
| 自动更新形同虚设 | 开关开着但从不更新 | `src/app/edu-sync.ts`：去掉「上次 `expired` 就再也不试」的短路、`RESUME_GAP` 由 6 小时改 10 分钟、冷启动也试一次；长理能留住登录态，不再因为连续过期被自动关掉开关 |
| 应用名 | 还叫「嘎嘎课程表」 | 改为「嘎嘎课程表-CUST特化版」（`strings.xml`、`index.html`、`Onboarding.tsx`） |

### 5. 测试

- `src/domain/__tests__/cust.test.ts`：13 个用例，用 `new Function(...)` 把注入脚本拉出来喂假 DOM + 真实 JSON，不联网
- `src/domain/__tests__/edu.test.ts`：学校索引相关断言改成本分支事实

`npm run check` 全过：**22 files / 215 tests**。

## 安装

从 [Releases](https://github.com/MikatoMisaka/CUST-timetable/releases) 下载 APK。

> **先卸载官方嘎嘎课程表**。两者签名不同，覆盖安装会提示签名冲突。卸载会清空 App 数据，课表要重新导入一次。

- 最低 Android 7.0（minSdk 24），targetSdk 36
- 首次导入：我的 → 课表来源 → 长春理工大学 → 走学校统一身份认证（学号 + 密码 + 图形验证码 + 短信/企业微信二次验证）→ 落到课表页 → 点「导入」

## 自己构建

```bash
# Node 22+, JDK 21, Android SDK 36（platforms;android-36 + build-tools;36.0.0）
npm ci
npm run check                # tsc --noEmit && vitest run && vite build
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Windows 下需要设的环境变量：

```powershell
$env:JAVA_HOME       = 'F:\Java21'
$env:ANDROID_HOME    = 'F:\Projects\android-sdk'
$env:GRADLE_USER_HOME= 'F:\Projects\.gradle'
$env:TZ              = 'UTC'      # 否则几个 ICS 时区用例会挂
```

打 release 包时补上签名（缺省读 `android/app/release.keystore`）：

```powershell
$env:KEYSTORE_PATH     = 'F:\Projects\keys\cust-release.jks'
$env:KEYSTORE_PASSWORD = '…'
$env:KEY_ALIAS         = 'cust'
$env:KEY_PASSWORD      = '…'
cd android && ./gradlew assembleRelease
```

Gradle 下载慢就换镜像，例如 `https://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-all.zip` 放进 `$GRADLE_USER_HOME/wrapper/dists/…`。

`tools/cdp-probe.mjs` 是调试用的：手机连 ADB 后 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，就能在电脑上读/截图 App 里的 WebView（`node tools/cdp-probe.mjs <url子串> "<js>" --shot out.png`）。

## 已知问题

1. **自动更新仍会报 `expired`** —— 交互式登录是好的，但后台那条路直接开 `jwgl/Student`，大概率还是落进门户首页自我登出那条分支，需要改成后台也从门户 `x/to` 进。
2. **会话约 104 分钟失效** —— 学校服务端行为。自动更新只能做到「打开 App 时静默抓一次，失败就提示重新登录」，撑不过长时间后台。
3. 教务系统在手机上刷新 `/page-timeout` 页无效（桌面端 F5 反而能救），这是学校前端的行为，改不了。

## 上游功能

今天 / 周视图 / 待办 / 冲突处理 / 变更记录 / 多源导入（JSON、xlsx、ICS、CSV、AI 转换）/ 课程贴纸 / 日历同步 / 4 款桌面小组件 —— 这些都来自上游，功能说明见 [shuakami/timetable](https://github.com/shuakami/timetable) 的 README。

## 许可

GPL-3.0（沿用上游）。基于 [shuakami/timetable](https://github.com/shuakami/timetable) 修改，学校教务索引格式整理自 [baoozak/timetable](https://github.com/baoozak/timetable)（MIT）。
