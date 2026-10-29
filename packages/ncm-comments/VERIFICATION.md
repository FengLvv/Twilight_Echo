# 验证记录

日期：2026-10-29（Asia/Shanghai）。宿主源码基线 `0eaa5700`，应用 `1.4.0-perview.1`，Electron `43.8.1`。

## 0.1.2 当前交付与验证

按用户后续授权修改宿主，以底部播放栏按钮打开插件评论面板；原播放页内容与歌词保留。

- 配套播放器：`dist/ncm-comments-host/win-unpacked/TwilightEcho.exe`。移动时需要整个 `win-unpacked` 目录。
- 插件：`dist/plugins/com.twilightecho.tool.ncm-comments-0.1.2.tep`，9,066,152 字节。
- SHA-256：`afaf55ef95d787dfc6966fa117f4c3b6b3d60b2c4af007d1b484c61b770f5b80`。
- 宿主新增通用播放栏面板入口；只有命令的插件继续使用原菜单。未选择歌曲时也可以打开空状态。顶部没有评论按钮。禁用插件会关闭面板并移除入口。
- 面板身份按插件、URL、桥版本和权限比较；注册信息的对象副本不会关闭通道，实际身份变化会重建 iframe。
- 插件自动化测试 23/23、宿主入口与面板身份测试 4/4 通过；Core、Node、Web 类型检查、相关 ESLint、渲染资源预算、Windows EXE 品牌与打包依赖闭包检查通过。
- 匿名在线搜索、歌曲详情、热评、最新、第二页、头像通过。快捷面板 11 项、独立歌词页 13 项界面检查通过。
- 打包宿主的 15 项集成检查通过：包含底部按钮、空状态、在原播放页打开评论、分页、主题同步、人工关联、禁用时关闭面板与移除按钮、独立歌词页下滚评论。
- 真实宿主重启、`0.1.2 → 0.1.3` 测试夹具升级、再次重启后启用状态与关联保留均通过；对外交付版本仍为 `0.1.2`。
- 最新隔离配置：`output/playwright/ncm-comments/profile-kyAXdc`。报告使用下文的固定路径；截图新增 `player-bottom-button.png`，`comments-dark.png` 为原播放页上的评论面板。
- 当前播放器包按当前工作区构建；同一工作区在此期间出现的听歌统计封面改动（`src/core/application*`、`src/core/listening/service*`、`src/core/portableSlice.ts`）未由本次评论入口修改，也未覆盖或撤销。相关 Core 与统计测试 42/42 及 Core／Node 类型检查通过。`pnpm-lock.yaml` 新增本插件工作区条目。
- 集成验证后的最终打包仅重新格式化了 `plugin.json` 空白；运行代码与已验证包一致。
- 未在日常用户配置中安装插件或替换原有 `dist/win-unpacked` 播放器。集成检查使用相同版本 Electron 加载本次包内真实 main/preload/renderer 与资源。

真实音频输出仍受本机 WASAPI 共享输出初始化错误 `0x8889000a` 阻塞，持续播放验收未通过。面板开关前后曲目及 Core 状态一致，本次为 `stopped`；界面测试的模拟播放保持 `playing=true`，插件未发送播放控制命令。

## 0.1.1 历史交付与验证

- 安装包：`dist/plugins/com.twilightecho.tool.ncm-comments-0.1.1.tep`，9,065,563 字节。
- SHA-256：`600253f96f863db61272ba2dd8393371f0b7403264136eb31f2b36b67d468557`。
- 移除顶部按钮及其面板入口，保留侧边导航「歌词与评论」。当前宿主未开放播放栏「词」旁的插件位置，本次没有声称将按钮移动到那里。
- 23/23 自动化测试通过，包含实际激活插件时不注册顶部按钮的回归检查；ESLint 0 错误、0 警告。
- 真实宿主的 11 项集成检查通过，新增 `no-titlebar-button`，同时保留评论、分页、主题、关联及独立歌词页的检查。
- 真实重启、`0.1.1 → 0.1.2` 测试夹具升级、再次重启后关联与启用状态均通过；发行包仍为 `0.1.1`。
- 独立测试配置为 `output/playwright/ncm-comments/profile-QS6EUL`，最新报告仍在下方列出的 `smoke-result.json` 与 `lifecycle-result.json`。
- `git diff --exit-code` 成功，主程序源文件未修改；日常配置未被安装或更新。

## 0.1.0 历史交付物

- 插件：`dist/plugins/com.twilightecho.tool.ncm-comments-0.1.0.tep`
- 大小：9,065,890 字节，431 个运行文件／字体与许可文件。
- SHA-256：`ff7fc3f231328fee35fe03d5b121652e10ce3738a43ff59ee40de413acb1a86e`
- 源码及说明全部位于 `packages/ncm-comments`。

最终检查 `git diff --exit-code` 成功，`git status --short` 只有新增的 `packages/ncm-comments/`。播放器既有受跟踪文件无修改；`dist/win-unpacked/TwilightEcho.exe` 修改时间仍为 2026-10-29 11:38:53。没有重新构建或替换播放器二进制，也没有在日常用户配置中安装插件。

## 已通过

| 检查               | 结果                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Node 自动化测试    | 22/22 通过                                                                                                                     |
| ESLint             | 0 错误、0 警告                                                                                                                 |
| 匿名在线调用       | 搜索 20 个候选、歌曲详情、20 条热评、20 条最新评论及第二页 20 条、头像数据图片均成功                                           |
| 快捷面板界面场景   | 11 项通过，包含长评论、文本注入保护、失败保留列表、重试去重、主题切换、键盘标签、通道重连、320px 无横向溢出、快速切歌与 Escape |
| 独立歌词页界面场景 | 13 项通过；额外确认当前歌曲展示和滚入前不请求评论                                                                              |
| 真实宿主集成       | `.tep` 安装启用、读取曲库网易云 ID、实际评论与第二页、主题同步、手动链接关联、禁用再启用保留关联、独立歌词页与下滚评论均通过   |
| 重启与升级         | 真实宿主重启保留关联、安装 `0.1.1` 测试升级包保留关联、再次启动后版本／启用状态／关联仍保留                                    |

数据测试还覆盖了严格唯一匹配、翻唱／现场／重制／伴奏区别、缺失标签、时长差异、明确 ID 优先、人工关联优先、取消后暂停自动匹配、元数据指纹、请求合并／缓存／并发／超时／取消、非法响应和图片边界、原子持久化、损坏文件错误，以及 LRC／TTML 文本和时间解析。刷新失败重试从首屏重新读取，翻页失败重试沿用该页 offset。

## 证据位置

以下是运行检查生成的本地文件，可按 README 的命令重建：

- `output/playwright/ncm-comments/live-result.json`
- `output/playwright/ncm-comments/ui-result.json`
- `output/playwright/ncm-comments/page-ui-result.json`
- `output/playwright/ncm-comments/smoke-result.json`
- `output/playwright/ncm-comments/lifecycle-result.json`
- `output/playwright/ncm-comments/player-lyrics-page.png`
- `output/playwright/ncm-comments/player-lyrics-comments.png`
- `output/playwright/ncm-comments/ui-narrow.png`

真实宿主最终使用独立配置 `output/playwright/ncm-comments/profile-IjXfUq`，由检查脚本创建静音 WAV／LRC 样例。生命周期测试只在此配置内安装 `0.1.1` 夹具；对外交付的 `.tep` 版本仍为 `0.1.0`。

## 验证边界

真实设备尝试播放静音样例时，宿主返回 WASAPI 共享输出初始化失败 `0x8889000a`。没有更改系统音频设备、停止其他播放器或替换音频引擎。因此未宣称真实声卡持续播放验收通过。

已确认：插件没有播放控制权限；界面模拟播放保持 `playing=true` 且未发出播放／暂停／停止操作；真实宿主打开与关闭面板前后的 Core 曲目和播放状态保持一致（本次为 `stopped`）。这与实际声卡持续播放验证分别记录。

原有歌词页完整保留。新增的歌词页由插件独立实现，提供逐行高亮；原页的全部逐字渲染／编辑功能没有被替换。原生主题的用户／第三方自定义色板尚未通过窄只读 API 暴露，首版跟随深浅色与字体，并使用随包复制的内置主题色板。
