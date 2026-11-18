<img src="docs/logo.png" width="140" alt="嘎嘎课程表-CUST特化版" />

# 嘎嘎课程表 · 长春理工大学特化版

**你的课表，理应如此。**

今天 / 周视图 / 待办 / 冲突处理 / 变更记录 / 教务一键导入 / 桌面小组件

<a href="https://github.com/MikatoMisaka/CUST-timetable/releases/latest"><img src="docs/download-android.svg" alt="下载 Android 安装包" /></a>

基于 [嘎嘎课程表](https://github.com/shuakami/timetable)，只保留长春理工大学一所学校，并新增一款 2×2 桌面小组件。

## 功能

**今天**
- 按节次排布的当日时间线，已结束、上课中（剩余分钟）、下一节倒计时一目了然
- 明天预览；周六日、假期、学期外各有独立空状态
- 底部日期条搭配从底部滑出的月历面板，与学期周次对齐

**课表**
- 周视图网格，正在上的课高亮，单双周、假期、考试周均有标注
- 时间重叠自动检测，支持「都保留」或「只留一门」，被隐藏的课可随时恢复
- 长按课程卡片：静音本节、标记已上、请假一次、查看变更记录、编辑、停课

**课程**
- 详情页展示下次上课时间、地点、老师、上课日、考核方式、提醒、学期进度、出勤、作业与备忘
- 编辑时可选生效范围「仅本次」或「每周」，可调整状态、时间、地点、老师、备注、颜色
- 单节改动与常规课表分离，每次修改留一条变更记录，支持撤销

**导入**
- **长春理工大学教务一键导入**：选学校 → 学校统一身份认证登录 → 停在课表页点导入，自动读出整学期课表
- 调课会单独标记；同一门课不同周次、集中实践课跨多个节次都能正确合并
- 也支持 JSON、Excel（xlsx）、ICS、CSV，以及「让 AI 转换课表」：复制 Prompt 把课表截图或文字交给任意 AI，粘回 JSON 即可导入
- 导入前逐条预览新增、变化、无法解析的条目；重复导入做三方合并，手动改过的字段不被覆盖
- 分享课表：导出标准 .ics，对方在任何日历应用里都能打开

**待办**
- 作业、考试、自定义待办，可挂在课程上，按今天、近期、已完成分组

**提醒与小组件**
- 课程、作业、考试同步至系统日历：每门课一本日历、沿用课程颜色，提醒交给系统日历
- 停课、请假的那节保留在日历里（标题带标注，不提醒）；老师电话写在事件描述里可直接拨号
- **5 款桌面小组件**：今日、下一节、两日、本周，以及专为长理加的 **2×2「下节小卡」**——接下来两节课 + 课程配色 + 倒计时，塞进桌面角落刚好
- 跟随系统深浅色

**Android**
- 日期、时间、下拉选择使用系统原生对话框
- Android 13+ 主题图标、自适应开屏、边到边加安全区
- 系统返回键依次关闭菜单或面板、出栈、回到「今天」、两次返回退出

## 安装

从 [Releases](https://github.com/MikatoMisaka/CUST-timetable/releases) 下载 APK。

> 与官方嘎嘎课程表签名不同，**安装前请先卸载原版**，否则提示签名冲突。卸载会清空 App 数据，课表需重新导入。

- Android 7.0 及以上（minSdk 24）
- 首次使用：我的 → 课表来源 → 长春理工大学 → 登录统一身份认证（学号 + 密码 + 验证码 + 短信/企业微信二次验证）→ 停在课表页 → 点「导入」

教务会话在学校服务端约两小时失效，隔天再打开可能需要重新登录导入一次。

## 自己构建

```bash
# Node 22+, JDK 21, Android SDK 36
npm ci
npm run check
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

Windows 下需要这些环境变量：`JAVA_HOME`、`ANDROID_HOME`、`GRADLE_USER_HOME`，以及 `TZ=UTC`（否则少数时区用例会挂）。打 release 包再补 `KEYSTORE_PATH` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`。

## 许可

GPL-3.0。基于 [shuakami/timetable](https://github.com/shuakami/timetable) 修改；学校教务索引格式整理自 [baoozak/timetable](https://github.com/baoozak/timetable)（MIT）。
