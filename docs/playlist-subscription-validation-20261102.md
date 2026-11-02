# 网易云歌单收藏入口

日期：2026-11-02；应用版本：1.4.0-preview.3。

## 行为

网易云歌单详情的「播放全部」「随机」旁增加星形「收藏／已收藏」按钮。搜索、推荐、发现和个人音乐库打开同一详情组件，因此入口一致。已收藏时点击取消收藏；自己创建的歌单和未登录状态不显示该控件。

沿用原生页面按钮与浅色／深色主题。读取和写入时禁用重复点击，失败保留原状态并显示错误；无法确认初始状态时先重试读取。播放、歌曲红心、队列和页面搜索保持原流程。

## 接线

- 插件 SDK、共享方法白名单、Core 路由、host 注册和 renderer provider 增加 `fetchPlaylistSubscriptionState`、`subscribePlaylist` 两个可选方法。方法需要 `library` 能力。
- 收藏状态读取 `/playlist/detail/dynamic` 的 `subscribed`；歌单归属复用 `fetchUserLibrary` 返回的账号歌单元数据，沿用现有 1,000 项范围，不额外下载歌单歌曲或保存另一份曲库。普通详情接口在匿名状态可能返回 `subscribed: null`，不能用于判断未收藏。
- 写入 `/playlist/subscribe?t=1|2&id=...`，显式表达目标状态；不会使用删除歌单接口。复用 renderer、Core、插件的写入幂等键。
- 成功后 `useNcmStore` 更新账号的 `userPlaylists`；新增音乐库变更版本，旧查询不能覆盖已确认写入。账号／插件代次及详情代次阻止延迟响应串页，卸载后不再回写。
- 新状态控制集中在 `usePlaylistSubscription`，页面负责提供当前歌单、账号和能力，详情组件只发出操作事件。

## 验证与范围

- 202 项功能／SDK 契约回归通过。最后补充的方法能力检查及相关重试回归单独跑 29 项通过，其中包含此前已有测试；不重复计总数。
- 两项真实 Electron 界面回归通过：收藏按钮共存于播放控件旁、重复点击只发一次、成功切换、取消、失败反馈、所有权／登录隐藏；原详情布局与定位回归通过。浅色 1280px、深色 780px 截图无横向溢出。
- Core、Node、Web 类型检查通过，Impeccable 扫描结果为空。
- 使用打包依赖匿名读取真实网易云公共歌单：动态接口返回 code 200 和布尔 `subscribed`；原详情接口返回空值。只核对响应结构，没有使用日常账号。
- 生产构建、renderer 预算、NSIS、Windows 品牌与 255 包依赖闭包检查通过。
- 使用 `cli-anything-twilightecho` 启动最终包的独立 profile：Core ready，新插件成功注册两个方法，确认没有登录后通过真实跨进程调用验证未登录收藏被拒绝，随后正常退出。用户原实例和账号收藏未改动。
- 已登录情况下的真实账号收藏／取消写入没有执行；相关成功／失败、幂等和状态同步使用接口夹具验证。

证据：`.local/playlist-subscription-20261102/`，包括 `functional-tests.log`、`routing-final-tests.log`、`ui-tests.log`、`subscribe-ui-final.log`、三份 `typecheck-*.log`、`public-dynamic-schema.json`、`package-smoke.json` 与 `visual/light.png`、`visual/dark.png`。

安装器：`.local/playlist-subscription-20261102/package/TwilightEcho-1.4.0-preview.3-setup.exe`，133,480,385 字节，SHA-256 `4a193e3ece607819ad7cd66d51fae77c25fedc3a33b87816719748dcb762f579`。包含此前日语发音、桌面谱面描边修复，不含完整模型；旧完整离线 ZIP 未刷新。没有 commit、push 或发布 GitHub。
