# 网易云评论插件

独立的 Twilight Echo API v4 插件。0.1.2 在配套播放器的底部播放栏提供「网易云评论」按钮，点击打开右侧评论面板。侧边导航中的「歌词与评论」也保留：上方显示封面、歌词与逐行高亮，向下滚动进入评论。顶部没有评论按钮。

配套播放器新增通用的播放栏插件面板入口，并修复面板在插件注册信息刷新时的连接保持。原播放页内容、歌词、播放引擎和曲库元数据保留；评论、匹配、存储与界面均由插件提供。

## 安装与使用

1. 在播放器的插件管理中选择本地 `.tep` 安装并启用。
2. 在原播放器中播放或选择歌曲，点击底部播放栏的评论图标；也可以从侧边导航打开「歌词与评论」，向下滚动进入评论。
3. 网易云歌曲或曲库中已有网易云 ID 的歌曲直接读取评论。本地歌曲按歌名、歌手、专辑、时长和版本信息搜索；只有唯一严格匹配才自动关联。
4. 匹配不确定时选择候选，或展开「粘贴网易云歌曲链接或 ID」。人工选择会保存在插件目录，升级和重启后继续使用。
5. 「更换关联」重新搜索；「取消」暂停该曲自动关联。此后可以主动搜索或粘贴链接重新关联。

首版只读：提供热评、最新、每页 20 条、刷新、复制、引用内容和长评论展开。评论排序与可访问的内容以网易云匿名接口实际返回为准，某些下架歌曲的最新可见评论可能停留在较早年份。插件不使用内置网易云插件的 Cookie。

### 播放器兼容性

底部直接打开面板需要使用本次构建的配套播放器。原始 `0eaa5700` 播放器仍可安装插件并使用侧边导航页，其更多／HiFi 菜单按钮会提示从侧边栏打开。小型布局也保留菜单入口。原播放页不增加滚动区域；底部按钮在原播放页中也能使用。

## 外观与歌词

- 7 套内置主题的颜色、字体、字号、圆角来自当前源码的原生主题配置快照；同款 Inter、MiSans 等字体及许可随 `.tep` 打包，不依赖字体 CDN。
- 每 2 秒读取播放器的深浅色、字体和主题选择。系统模式跟随操作系统，减少动态效果设置也会同步。
- 用户／第三方自定义主题尚无已解析色板的独立只读桥，因此使用原生基础色板和已公开的字体设置，不读取其他插件的私有目录。
- 支持 LRC、逐字 LRC 的行文本、普通文本和 TTML 行文本。插件页使用逐行高亮；原播放器的逐字渲染、歌词编辑与其他功能继续保留在原页。
- 歌词区内可浏览歌词；在封面区域向下滚动或使用提示按钮进入评论。读取评论不会把页面拉回歌词。切歌重置歌词区，正在阅读评论时也不会复用上一首请求的结果。
- 插件不声明播放控制权限。播放、暂停和队列继续由原播放器管理；返回播放器不停止播放。

## 权限与数据

`ui:inject`、`player:observe`、`network`、`library:read`、`settings`、`app:settings`。

`app:settings` 是宿主现有的合并权限；本插件只调用读取接口，将主题相关字段投影给界面，不调用设置更新接口。曲库只读，用于取得当前曲目的网易云 ID 和封面。关联保存在宿主的 `plugin-data/com.twilightecho.tool.ncm-comments/associations.json`，不写歌曲标签、不改曲库元数据。

网络请求在插件后台完成：超时 15 秒、最多两个并发、相同请求合并、评论缓存 5 分钟；头像从网易云图片域获取并转成有大小限制的数据图片。评论与搜索仅在相应评论区域打开／滚入可见区时加载。

切歌主动取消旧请求，返回或关闭页面发送取消消息；对宿主丢失关闭通知的情况，后台会话租约在最多约 6.2 秒内取消遗留网络任务。兼容当前宿主刷新扩展列表时关闭通道的行为，插件会按既有握手协议重连并保留请求与列表。

## 开发与打包

兼容基线：源码 `0eaa5700`，应用 `1.4.0-perview.1`，API v4／bridge v2。

在仓库根目录执行：

```powershell
node --test packages/ncm-comments/test/*.test.mjs
node packages/ncm-comments/scripts/live.mjs
node packages/ncm-comments/scripts/pack.mjs
```

输出：`dist/plugins/com.twilightecho.tool.ncm-comments-0.1.2.tep` 及 `.sha256`。打包仅包含运行代码、界面、原生主题快照及字体／许可。`ui/page.html` 和字体样式在打包时生成；如需从目录安装，选择生成的 `packages/ncm-comments/dist/stage-0.1.2`。

更新内置主题快照时运行 `node packages/ncm-comments/scripts/sync-theme.mjs`；它只读取宿主源码，输出到本插件的 `lib/native-themes.json`。

可重复的界面与播放器检查：

```powershell
# 如项目未安装 playwright，将此变量指向可用的 playwright 包目录。
$env:PLAYWRIGHT_MODULE = 'C:\path\to\node_modules\playwright'
node packages/ncm-comments/scripts/ui-smoke.mjs
$env:NCM_COMMENTS_UI_PAGE = '1'
node packages/ncm-comments/scripts/ui-smoke.mjs
Remove-Item Env:NCM_COMMENTS_UI_PAGE
$env:NCM_COMMENTS_TEST_PACKAGE = 'D:\Tools\twilight_echo\dist\ncm-comments-host\win-unpacked'
node packages/ncm-comments/scripts/smoke.mjs
node packages/ncm-comments/scripts/lifecycle.mjs
```

播放器检查通过相同版本 Electron 加载真实包内的 main/preload/renderer 和资源。本次配套包位于 `dist/ncm-comments-host/win-unpacked`，也是脚本默认测试目录；可用 `NCM_COMMENTS_TEST_PACKAGE` 指定其他构建。所有检查使用独立配置目录和生成的静音 WAV，不访问日常配置。生命周期检查会在测试配置中安装当前版本的下一个补丁版本作为升级夹具，发行包仍为 `0.1.2`。

验证记录见 [VERIFICATION.md](./VERIFICATION.md)。

代码沿用仓库 Apache-2.0 许可；字体各自的 SIL OFL／MiSans 许可包含在插件字体目录中。
