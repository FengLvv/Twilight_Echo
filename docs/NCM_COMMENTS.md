# 原生网易云评论

在原播放页的封面或空白区域向下滚动，进入原生评论区；歌词区内的滚轮继续浏览歌词。无需安装、启用评论插件，也没有播放栏评论按钮。原播放页、队列和播放控件保留。

- 提供热评、最新、每页 20 条、刷新、加载更多、长评论展开、复制、引用内容和头像。
- 全页延续原封面模糊背景，评论区透明，不使用白色卡片。当前歌曲条可返回歌词；列表使用宿主字体与播放页文字颜色。
- 仅评论区域进入可见范围时查询。上滚离开评论、离开播放页、切歌和切换排序会取消旧请求，过期结果不能覆盖当前曲目。切歌回到播放页顶部。
- 优先明确网易云 ID，再使用人工关联或有效自动关联。自动匹配要求唯一候选的歌名、歌手、专辑、时长及版本信息一致；否则要求选择候选或输入链接／ID。
- 关联保存在用户配置的 `ncm-comments/associations.json`，不改曲库元数据。首次使用复制旧 `plugin-data/com.twilightecho.tool.ncm-comments/associations.json`，不覆盖已有原生关联，也不改旧文件。
- 评论浏览的匿名请求复用应用代理策略，15 秒超时、最多两个并发、相同请求合并和 5 分钟缓存。
- “写评论”复用内置网易云音乐源的登录态，支持最多 140 个 Unicode 字符和 Ctrl+Enter 发布。输入区延续封面色透明背景；草稿按关联的网易云歌曲区分，在本次运行中保留，离开评论区或切歌不会把草稿发到别的歌曲。
- 发布前重新检查登录态与账号上下文。Cookie 只在后台读取，不传给页面；页面只能提交歌曲 ID、正文和一次性提交标识，不能指定接口、删除操作或回复目标。发评通过新增的 `comments.publish` 命令，要求 `providers:call` 权限。
- 发布成功后作废该歌曲的评论缓存并刷新“最新”。提交期间禁止重复点击；相同提交标识复用结果。失败保留草稿；超时、断连等结果不明确的情况不自动重发，提示先查看最新评论，确认后再手动重发。列表切换或收起输入区不取消、重放已提交的写操作。
- 首版只新增发顶层评论，点赞、回复、删除仍未提供。测试使用模拟提交，不在真实账号下发布测试评论。

实现：`src/core/comments` 是原生数据服务；`comments.read`／`comments.edit` 通过现有 Core 连接，分别要求曲库读取／设置写入权限；`comments.account`／`comments.publish` 通过后台网易云会话和既有官方 API 适配器提供登录检查与发评。`PlayingMusic.vue` 拥有外层滚动和共享背景，`NativeCommentsSection.vue` 提供透明列表和原生输入区。原评论插件保留为历史兼容包，其网络、匹配和存储模块复用原生实现。

验证：

```powershell
node --test packages/ncm-comments/test/*.test.mjs
node --experimental-strip-types --test --import ./scripts/register-renderer-aliases.mjs src/core/comments/service.test.ts src/shared/coreProtocol.test.ts src/core/application.test.ts
$env:PLAYWRIGHT_MODULE = 'C:\path\to\node_modules\playwright'
node scripts/smoke-native-comments.mjs
```

集成脚本默认加载 `dist/win-unpacked` 的真实资源并创建隔离配置；用 `NCM_COMMENTS_TEST_PACKAGE` 可指定其他解包目录。不安装评论插件，检查原播放页、歌词滚轮隔离、封面滚轮进入评论、透明背景、在线热评与最新第二页、回到歌词、切歌归位、人工关联、窄窗口及离开播放页。报告和截图在 `output/playwright/native-comments`。

现有 `PlayingMusic.lyrics.behavior.test.ts` 使用直接写入只读播放器投影的旧夹具，当前 Core 架构下失败；`PlayingMusic.backdrop.behavior.test.ts` 在本机 Electron 离屏截图返回 `UnknownVizError`。未把这两项计为通过；上面的真实打包宿主集成检查覆盖本次交互和背景。
