<h1 align="center">Twilight Echo</h1>

<p align="center">
  <img src="./assets/logo.png" width="480" alt="Twilight Echo 渐变色标志" />
</p>

<p align="center">
  <strong>收藏你喜欢的音乐，找到下一首心动。</strong><br />
  一款整合在线音乐、本地播放与歌曲分析的开源桌面播放器。<br />
  从沉浸歌词、HiFi 调音，到六轨混音、和弦与人声曲谱，在听歌时看见音乐的结构。
</p>

<p align="center">
  <a href="https://github.com/FengLvv/Twilight_Echo/releases"><img alt="最新预览版" src="https://img.shields.io/github/v/release/FengLvv/Twilight_Echo?include_prereleases&display_name=tag&style=flat-square&color=8b5cf6" /></a>
  <img alt="支持 Windows 10 和 11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2563eb?style=flat-square" />
  <a href="./LICENSE"><img alt="Apache 2.0 开源许可证" src="https://img.shields.io/badge/license-Apache--2.0-64748b?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://github.com/FengLvv/Twilight_Echo/releases/tag/v1.4.0-preview.4"><strong>下载 Windows 版</strong></a>
  · <a href="#快速开始">快速开始</a>
  · <a href="#功能一览">功能一览</a>
  · <a href="#歌曲分析">歌曲分析</a>
  · <a href="#agent-与-cli">Agent / CLI</a>
  · <a href="#界面预览">界面预览</a>
  · <a href="https://github.com/FengLvv/Twilight_Echo/releases/tag/v1.4.0-preview.4">1.4.0-preview.4 更新说明</a>
  · <a href="#常见问题">常见问题</a>
  · <a href="#反馈与交流">问题反馈</a>
</p>

![Twilight Echo 音乐主页：唱片式正在播放、每日推荐与音乐入口](./assets/screenshots/home-dashboard.png)

<p align="center"><sub>从硬盘里的珍藏，到每日推荐里的新发现，让音乐陪你度过每一个日常。</sub></p>

## 1.4.0-preview.4 更新亮点

- **六轨混音**：分离人声、鼓、贝斯、吉他、钢琴与其他乐器，在播放页直接调节音量、独听和静音。
- **和弦与人声曲谱**：和弦名称／罗马级数、简谱／五线谱与歌词按时间同步；桌面歌词沿用相同的显示控制与主题样式。
- **按需拆分多人声**：从六轨的人声继续进行主唱／和声分离或双歌手分离，结果作为人声子轨呈现。
- **自动分析与缓存管理**：选择播放时自动分析分轨、和弦或曲谱，在任务与通知中查看进度；音频缓存按容量上限淘汰，保留和弦与曲谱结果。
- **网易云收藏与 Agent CLI**：支持歌单收藏／取消收藏、搜索结果喜欢状态，以及由 Agent 控制播放器、批量分析和导出曲谱。
- **近期修复与完整离线包**：修复日语制谱发音转换、桌面谱面描边、封面圆角与界面交互，并提供自带全部当前模型的 Windows 完整包。

完整更新记录见 **[v1.4.0-preview.4 发布说明](https://github.com/FengLvv/Twilight_Echo/releases/tag/v1.4.0-preview.4)**。本版为 **Windows x64 预览版**。

## 下载与安装

**[打开当前版本的 Release 附件 →](https://github.com/FengLvv/Twilight_Echo/releases/tag/v1.4.0-preview.4)**

| 需要什么 | 下载什么 |
| --- | --- |
| 只安装或更新播放器 | [TwilightEcho-1.4.0-preview.4-setup.exe](https://github.com/FengLvv/Twilight_Echo/releases/download/v1.4.0-preview.4/TwilightEcho-1.4.0-preview.4-setup.exe)，约 133 MB，不含 Python 和分析模型 |
| 首次使用完整分析功能、离线使用或分享给朋友 | `TwilightEcho-1.4.0-preview.4-win-x64-full.zip.001` 至 `.005` **全部五卷**，以及 [Offline-Tools.zip](https://github.com/FengLvv/Twilight_Echo/releases/download/v1.4.0-preview.4/Offline-Tools.zip)，分卷合计约 9.31 GB |
| 核对附件完整性 | [SHA256SUMS.txt](https://github.com/FengLvv/Twilight_Echo/releases/download/v1.4.0-preview.4/SHA256SUMS.txt)；发布页同时提供验证摘要 `Verification.json` |
| 获取与本版对应的完整源码 | [TwilightEcho-1.4.0-preview.4-source.zip](https://github.com/FengLvv/Twilight_Echo/releases/download/v1.4.0-preview.4/TwilightEcho-1.4.0-preview.4-source.zip)，包含 Agent CLI 与插件协议源码，不含模型 |

### 安装播放器

Windows 10/11 x64：运行 `setup.exe`，按向导完成安装。已有分析环境可继续使用；首次使用分轨、和弦和制谱时，建议选择下方完整离线包。

### 使用完整离线包

1. 从 [Release 附件](https://github.com/FengLvv/Twilight_Echo/releases/tag/v1.4.0-preview.4) 下载 `.001`～`.005` 五个分卷和 `Offline-Tools.zip`。
2. 解压 `Offline-Tools.zip`，把 `Merge-Offline.cmd`、`Merge-Offline.ps1`、`offline-volumes.json` 与五个分卷放在**同一文件夹**。
3. 双击 `Merge-Offline.cmd`。工具会逐卷校验 SHA-256、合并为普通 ZIP，并核对完整 ZIP 的校验值。
4. 解压生成的 `TwilightEcho-1.4.0-preview.4-win-x64-full.zip`，双击其中的 `Start.cmd`。可运行 `Verify.cmd` 检查全部解压文件。

**完整包已包含播放器、两套独立 Python 运行环境、全部当前分析模型与排谱工具，无需再安装 `setup.exe` 或另装 Python。** 请保留完整目录结构。

完整包解压后约 15.32 GB；同时保留分卷、合并 ZIP 与解压目录时，建议预留 40 GB 空间。合并校验完成后可删除分卷再解压。分析已有本地音频可离线运行；网易云登录、检索和播放等在线服务仍需要网络及使用者自己的账号。

支持 CUDA 的 NVIDIA GPU 可加速分析；**双歌手分离需要 CUDA**，其他功能按可用能力回退 CPU，速度取决于设备与歌曲。完整包不包含个人账号、原始歌曲或用户缓存。

本次 Release 仅提供 Windows x64 成品；macOS / Linux 状态见[常见问题](#常见问题)。

<details>
<summary>安装时提示“未知发布者”？</summary>

当前安装包尚无商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。请从本仓库的 [Releases](https://github.com/FengLvv/Twilight_Echo/releases) 下载，并核对 `SHA256SUMS.txt` 中的校验值。

在安装包所在文件夹打开 PowerShell，运行下面的命令，将引号内的名称替换为实际文件名，然后与发布页的 SHA-256 比对：

```powershell
Get-FileHash -LiteralPath '.\TwilightEcho-1.4.0-preview.4-setup.exe' -Algorithm SHA256
```

完整包的合并工具会自动核对各分卷及合并 ZIP；解压后的 `Verify.cmd` 检查包内全部文件。

</details>

## 快速开始

**听本地收藏** — 在首次使用向导中添加音乐文件夹，或打开「设置 → 媒体库与存储 → 本地媒体库 → 添加文件夹」。扫描完成后，按歌曲、专辑、艺术家、文件夹或流派浏览；设置页的「快速配置」也能直接进入添加音乐和选择输出设备。

本地曲库默认使用 SQLite。升级后首次启动会自动迁移旧曲库，保留原 `music-library.json` 及其备份；后续读写使用 `music-library.sqlite`。备份与恢复继续使用设置页的个人备份入口。

**发现在线音乐** — 无需先建立本地曲库。打开「流媒体音乐 → 推荐主页」，按音源能力浏览公开歌单或排行榜；登录后使用每日推荐、私人漫游与个人收藏。更多音源可在「扩展中心」查找，或从[第三方插件仓库](https://github.com/Px-asen/Twilight-Echo-plugins)获取 `.tep` 扩展包。

**快速找到内容** — 在侧栏「搜索」选择本地音乐、全部来源或已启用音源，查找歌曲、专辑、歌单和艺术家；可用搜索类型取决于音源。按 **Ctrl + K** 打开命令面板，查找歌曲、已加载歌单和常用操作；输入 `>` 可只查找操作与设置。

**调成喜欢的样子** — 在「设置 → 外观」调整深浅主题、字体、播放栏，以及「背景与界面材质」；打开「主题工作室」预览布局和播放器样式。迷你播放器、桌面歌词和主窗口可分别调整。需要制作可分享的主题包时，再使用主题插件工坊（Beta）。

**选择声音与衔接方式** — 在「设置 → 播放与音效」选择输出设备，可用左右声道测试音检查输出。日常听歌可保持默认配置；想尝试自动混音，在「歌曲衔接 → Twilight AutoMix」选择自然或 DJ 模式后再播放队列。基础 AutoMix 无需额外分轨包，分轨增强的安装方式见下方常见问题。

扫描、歌曲分析、下载或更新进行时，可从标题栏「任务与通知」查看进度和处理结果。设置搜索也能直接定位选项，无需逐个展开分类。

## 功能一览

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🎵 把收藏整理好</h3>
      <p>多文件夹监听、专辑与艺术家浏览、元数据补全、批量标签编辑、重复检测和 CUE 整轨分曲。通过曲库整理收件箱处理待整理内容，关联歌曲与专辑的不同版本和来源。</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔎 总有新的声音</h3>
      <p>统一搜索本地与在线歌曲、专辑、艺术家和歌单；浏览网易云推荐、排行榜、个人音乐库与云盘。下载完成后可直接播放、打开目录或复制加入本地曲库。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>✨ 让歌词跟着音乐走</h3>
      <p>逐行、逐词同步，翻译与音译分层显示，支持 TTML、本地歌词导入、编辑和时间偏移。沉浸式播放页随封面变换色彩，桌面歌词独立显示，频谱与波形呈现声音动态。</p>
    </td>
    <td valign="top">
      <h3>🎧 按你的喜好调音</h3>
      <p>原生音频引擎、WASAPI 共享与独占输出、设备档案、OPRA/AutoEQ 耳机校正与 DSP 效果链。参数均衡器支持最多 32 个频段、A/B 快照、多选联动、复制粘贴和撤销重做。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🎚️ 让歌曲自然接上</h3>
      <p>无缝播放、交叉淡化与 Twilight AutoMix 可分别配置。AutoMix 提供自然和 DJ 模式试用，分析适合的交接位置；安装可选分轨包后，可用人声与贝斯分轨辅助过渡。</p>
    </td>
    <td valign="top">
      <h3>🌙 留住播放进度</h3>
      <p>保存命名队列、恢复歌曲与进度、查看实际播放顺序，并使用播放书签、变速不变调、A-B 循环和睡眠定时。迷你播放器、托盘、全局快捷键和局域网遥控适配不同听歌场景；余晖模式（Afterglow）可卸载界面释放内存，由原生引擎继续播放，托盘或快捷键随时恢复。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🎨 做成你喜欢的样子</h3>
      <p>深浅主题、封面取色、自定义图片，以及透明、毛玻璃和液态玻璃材质。按页面设置背景并全窗口预览，调整字体、播放栏和侧栏顺序；主题插件工坊（Beta）可编辑与导出主题。</p>
    </td>
    <td valign="top">
      <h3>🧩 接入更多音乐来源</h3>
      <p>通过 WebDAV、FTP、SFTP、SMB 等网络源浏览 NAS 或远程音乐，协议可用性取决于系统与服务端。支持网络电台、RSS 播客，以及通过扩展中心安装音源、主题和工具插件。</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>📊 回看自己的音乐足迹</h3>
      <p>统计仪表盘展示近 7／30／90 天收听趋势、前一周期对比、活动日历，以及常听歌曲与艺术家排行。可按时长或次数查看歌曲排行，按日期范围清理记录。</p>
    </td>
    <td valign="top">
      <h3>💾 管理任务与个人数据</h3>
      <p>任务与通知中心汇总歌曲分析、扫描、补全、响度分析、下载与更新，支持勿扰。个人数据备份涵盖十类记录，恢复前预览冲突并映射音乐目录；软件更新支持进度显示、续传和完整性校验。</p>
    </td>
  </tr>
</table>

## 歌曲分析

### 六轨与多人声混音

打开歌曲播放页，点击左上角 **HiFi 按钮右侧的分析图标**。默认提交六轨分离与和弦识别；六轨就绪后，封面区域切换为混音控件，不必等待和弦处理结束。歌词、播放进度和底部控制继续使用原来的位置。

- 人声位于最上方，各轨支持音量、独听和静音。
- 点击人声右侧「多人声拆分」，选择「主唱／和声分离」或「双歌手分离」才会执行对应任务；两者都复用六轨人声，不重新跑六轨。
- 再点分析图标，返回封面与原曲播放。切换显示与音源不等于取消后台分析，任务进度统一在标题栏「任务与通知」查看。

### 和弦与旋律

播放页右上角保留 **「和弦」和「旋律」** 两个独立开关。未有结果时，开启会启动所需分析；可分别开启或关闭，无需为了显示和弦而切换分轨播放。

| 功能 | 格式与显示 |
| --- | --- |
| 和弦 | 悬浮按钮选择「和弦名称」或「罗马级数」，例如 `C–Am–F–G` / `I–vi–IV–V`；识别使用去除人声后的伴奏 |
| 旋律 | 悬浮按钮选择「简谱」或「五线谱」；带时值的谱面与原文歌词对应，随播放时间同步 |
| 调性 | 分析结果可用后，在歌名附近显示；名称与级数转换共用调性设置 |
| 桌面歌词 | 同步和弦、谱面格式与主题样式，可在主窗口外查看 |

旋律制谱需要**带时间的原文歌词**，不进行语音转文字。优先使用 AMLL 社区结构化歌词并提取主唱；回退网易云歌词时，自动执行真实歌词提取流程。

在「设置 → 播放与音效 → 歌曲分析 → 播放时自动分析」选择 **分轨、和弦、曲谱**，默认全部关闭。自动分析只提交后台任务，不自动开启分轨播放；额外的多人声拆分始终按需执行。

## Agent 与 CLI

Agent 可通过 CLI 操作真实播放器、查询网易云、调节 DSP、批量分析歌曲，并读取指定时间段的和弦、音高与带时值曲谱。状态、账号与任务仍由播放器统一管理。

从本版[源码包](https://github.com/FengLvv/Twilight_Echo/releases/download/v1.4.0-preview.4/TwilightEcho-1.4.0-preview.4-source.zip)解压，或检出本仓库 `v1.4.0-preview.4` 后，在源码根目录安装客户端（Python 3.10+）：

```powershell
python -m pip install -e ./agent-harness
cli-anything-twilightecho --help
```

首次从 CLI 启动完整包时，先指定包内的分析环境，再启动播放器。把示例路径换成自己的实际路径：

```powershell
$env:TWILIGHT_MUSIC_STUDY_HOME = 'C:/Apps/TwilightEcho/music-study-runtime'
cli-anything-twilightecho --json app start --executable "C:/Apps/TwilightEcho/TwilightEcho.exe" --visible
cli-anything-twilightecho --json doctor
```

```powershell
cli-anything-twilightecho --json music analyze --file "D:/Music/song.flac" --lyrics "D:/Music/song.lrc" --stages six,chords,melody --wait
cli-anything-twilightecho --json music result --id PROJECT_ID --from 45 --to 75
cli-anything-twilightecho --json music export --id PROJECT_ID --directory "D:/Scores" --notation staff
```

使用 `--notation numbered` 导出简谱；分析完成后的 `PROJECT_ID` 可继续用于读取结果、导出分轨和拆分多人声。导出包含 SVG、PDF、分析 JSON，以及可用的 MIDI / MusicXML。

完整命令、批处理和模型配置见 **[Agent CLI 指南](https://github.com/FengLvv/Twilight_Echo/blob/v1.4.0-preview.4/agent-harness/cli_anything/twilightecho/README.md)**。默认后台启动，示例中的 `--visible` 会打开正常窗口。

## 界面预览

### 找歌、逛歌单，也照顾好本地收藏

<table>
  <tr>
    <td width="50%"><a href="./assets/screenshots/streaming-home.png"><img src="./assets/screenshots/streaming-home.png" alt="在线音乐主页：每日推荐与私人漫游" /></a></td>
    <td width="50%"><a href="./assets/screenshots/local-library-light.png"><img src="./assets/screenshots/local-library-light.png" alt="本地音乐库：歌曲列表与专辑封面" /></a></td>
  </tr>
  <tr>
    <td align="center">每日推荐 · 从熟悉的喜好发现新歌</td>
    <td align="center">本地曲库 · 随时翻阅自己的收藏</td>
  </tr>
</table>

### 留一点屏幕空间给音乐

封面、歌词与色彩一起构成正在播放页面；支持深浅主题，也可以把歌词留在桌面上。

![沉浸式播放页：封面取色、同步歌词与双语显示](./assets/screenshots/immersive-lyrics.png)

<details>
<summary>查看更多界面：主题工作室、在线歌单、调音工具与扩展中心</summary>

<table>
  <tr>
    <td width="50%"><a href="./assets/screenshots/theme-studio.png"><img src="./assets/screenshots/theme-studio.png" alt="主题工作室：选择界面风格并实时预览" /></a></td>
    <td width="50%"><a href="./assets/screenshots/streaming-playlist.png"><img src="./assets/screenshots/streaming-playlist.png" alt="每日推荐歌单：歌曲列表与播放控制" /></a></td>
  </tr>
  <tr>
    <td align="center">切换主题，实时预览界面风格</td>
    <td align="center">浏览每日推荐，播放喜欢的歌曲</td>
  </tr>
  <tr>
    <td><a href="./assets/screenshots/dsp-processor.png"><img src="./assets/screenshots/dsp-processor.png" alt="DSP 处理器与音频信号链" /></a></td>
    <td><a href="./assets/screenshots/parametric-equalizer.png"><img src="./assets/screenshots/parametric-equalizer.png" alt="Twilight EQ 参数均衡器：频段曲线、实时频谱与调节旋钮" /></a></td>
  </tr>
  <tr>
    <td align="center">组合 DSP 效果，查看处理状态</td>
    <td align="center">调节频段，直观看到均衡曲线</td>
  </tr>
  <tr>
    <td><a href="./assets/screenshots/audio-visualizer.png"><img src="./assets/screenshots/audio-visualizer.png" alt="音频频谱、波形与响度可视化" /></a></td>
    <td><a href="./assets/screenshots/extension-center.png"><img src="./assets/screenshots/extension-center.png" alt="扩展中心：浏览和管理可选插件" /></a></td>
  </tr>
  <tr>
    <td align="center">看见声音的频谱与动态</td>
    <td align="center">按需添加音源、主题和工具</td>
  </tr>
</table>

</details>

<sub>以上界面截图截取自 v1.3.0 演示视频，实际外观随版本和主题设置变化。截图中的酷狗、Bilibili、QQ 音乐等为可选第三方扩展示例，可用性以当前扩展为准。</sub>

## 支持的音频格式

| 类型            | 格式                                                   |
| --------------- | ------------------------------------------------------ |
| 常见音频        | MP3、AAC、OGG、Opus、WMA                               |
| 无损与 PCM 音频 | FLAC、WAV / WAVE、AIFF / AIF、ALAC、APE、WavPack（WV） |
| 其他容器        | M4A、MP4、WebM                                         |
| DSD 与整轨收藏  | DSF、DFF、SACD ISO；支持 CUE 整轨分曲                  |

实际解码与输出能力取决于发布包、音频驱动和设备。`.mqa` 文件按 FLAC 兼容容器扫描与解码，不提供 MQA unfold、认证或授权能力。

## 常见问题

<details>
<summary>只听本地音乐，需要登录或联网吗？</summary>

播放已有本地音乐无需登录音乐平台账号。在线推荐、网络音源、在线歌词获取、电台和播客等功能需要网络；部分在线内容还需要对应平台的登录或订阅权限。

</details>

<details>
<summary>在哪里打开统计、电台、播客和 NAS 网络源？</summary>

这些页面默认不固定在侧栏。打开「全部页面」，或通过侧栏「编辑页面」显示「统计仪表盘」「电台 / 播客」「网络源」，也可以用 Ctrl + K 查找入口。侧栏支持调整页面顺序和隐藏不常用项。

</details>

<details>
<summary>连接 NAS / WebDAV 网络源失败，怎么排查？</summary>

先确认地址与根路径：地址可写 `https://nas.local`，也可写 `nas.local` 并单独填写端口。使用 HTTPS 时可写明 `https://`，或把端口填为 `443`。用户名/口令走标准 Basic 认证；如果服务器强制要求 Digest 认证，会提示「仅支持 Basic」，此时需要在服务器端启用 Basic 或使用其他挂载方式。

匿名源可直接串流播放；需要认证的来源会先下载到「网络源缓存」再播放，可在网络源页面查看缓存大小并清理。连接超时、认证失败、路径不存在等都会给出结构化提示。若服务器使用自签名证书，HTTPS 连接会被拒绝，请改用受信任证书，或在可信内网中改用 HTTP。

</details>

<details>
<summary>添加文件夹后，歌曲没有出现怎么办？</summary>

先确认文件夹中有受支持的音频文件，并等待扫描完成。在「设置 → 媒体库与存储」检查目录、自动扫描和扫描状态，必要时展开「扫描与诊断」执行完整重扫。标题栏「任务与通知」也能查看扫描进度。

下载目录在曲库之外时，可在下载完成项点击「加入曲库（复制）」；应用会保留原文件，并把副本加入已配置的音乐目录。也可以直接把下载目录添加到媒体库。

</details>

<details>
<summary>没有声音，或者其他应用突然不能出声？</summary>

先检查播放器音量、静音状态和 Windows 音量混合器，再到「设置 → 播放与音效」确认输出设备；暂停播放后可用左右声道测试音检查输出。如果启用了 WASAPI 独占模式，设备可能被播放器独占；日常多应用同时播放时，使用共享模式更方便。

</details>

<details>
<summary>为什么有些在线歌曲或扩展暂时不可用？</summary>

内置网易云音乐与第三方音源均依赖对应平台服务，可用内容受账号权限、所在地区和平台策略影响。扩展由各自作者维护，可先检查登录状态并更新扩展；仍有问题时，向对应扩展作者反馈。使用账号和内容时，请遵守对应服务条款。

</details>

<details>
<summary>AutoMix 怎么开启？分轨包需要另外下载吗？</summary>

在「设置 → 播放与音效 → 歌曲衔接 → Twilight AutoMix」选择自然或 DJ 模式，再开始播放队列。AutoMix 默认关闭，当前已开放试用；自然模式侧重保留歌曲内容，DJ 模式允许更长重叠、对拍和更明显的片头／片尾调整。不适合混音或过渡准备失败时会回退常规播放。

基础 AutoMix 不需要安装分轨包。AutoMix 的可选人声／贝斯过渡包通过同一设置中的「安装分轨包…」安装；它与本版歌曲分析使用的六轨环境分别配置，完整分析包不会自动开启 AutoMix 分轨增强。没有匹配运行包时仍可使用基础 AutoMix。详见[AutoMix 指南](./audio-engine/automix-native/README.md)。

</details>

<details>
<summary>换电脑后，怎么带走歌单、队列和收听记录？</summary>

打开「设置 → 系统与关于 → 备份与恢复」，导出个人数据；在新电脑上选择备份并预览，勾选恢复类别、选择冲突处理方式，并把原音乐目录映射到新位置。确认后，在下次启动时执行恢复。

个人数据备份包含曲库索引、歌单收藏、队列、当前播放、歌词修改、播放书签、电台、播客、收听统计和版本关系。**音频文件需要另行复制，账号登录、插件和封面缓存不随备份迁移。** 设置与主题配置使用同一区域的「设置备份」单独导出、导入。

</details>

<details>
<summary>如何更新播放器？</summary>

打开「设置 → 系统与关于」检查更新，可选择稳定或测试频道，并查看更新说明、下载进度与安装状态。Windows 使用完整安装包升级，下载支持中断恢复，并在安装前校验文件大小和 SHA-256；任务与通知中心也能查看更新进度。后台检查只提示新版本，下载和安装由你决定。

本仓库预览版请从 [Releases](https://github.com/FengLvv/Twilight_Echo/releases) 手动下载安装包；当前变化见 [v1.4.0-preview.4 发布说明](https://github.com/FengLvv/Twilight_Echo/releases/tag/v1.4.0-preview.4)。应用内更新渠道以实际显示的仓库和版本为准。已有模型环境可继续使用，只更新播放器无需重新下载五个完整包分卷。

</details>

<details>
<summary>HiFi 进阶：独占输出、DSD、ASIO 和 DSP 有哪些限制？</summary>

- **共享与独占**：WASAPI Shared（共享）经过 Windows 系统混音；Exclusive（独占）可在设备允许时进行格式直通。日常播放无需开启独占。
- **DSD**：Native DSD、DoP 与 SACD ISO 的实际播放模式取决于设备、驱动和发布包。WASAPI 与 CoreAudio 没有平台级 native DSD 通道，会使用 DoP 或 PCM 回退；Linux 仅在兼容的 ALSA `hw:` 设备上尝试 native DSD。DSD / 直通播放会绕过部分 DSP，这是预期行为。
- **ASIO 与 VST3**：Windows x64 的 ASIO 兼容层仍属实验性，真实设备支持尚未验证；VST3 的实际运行与设备兼容性同样尚未完成验证。请结合发布包能力清单与应用中的输出诊断判断。
- **重采样与转换**：PCM SRC 支持 SWR；SoXR 随构建可选。SoX 档位是请求配置，实际是否使用 SoX、回退到 SWR，或本引擎没有进行重采样，请查看 DSP「输出与性能」或输出诊断中的 SRC 状态。旧引擎没有提供运行时证据时会显示「未验证」；设备或系统混音器仍可能另行转换。实验性 PCM→DSD64/128/256 由 CPU 执行，不代表完整高品质 SDM；当前不提供 CUDA SDM。
- **原样输出与混音**：EQ、DSP 和 AutoMix 可能改变输出样本。需要 bit-perfect 时，应关闭会改变信号的处理，并以播放时的 HiFi 状态和原因说明为准；AutoMix 分轨可使用 GPU，不代表核心音频链路提供 CUDA 加速。

更详细的能力状态见[发布能力说明](./docs/release-capability-status.md)，实际发布包以随附的 `audio-capabilities.json` 与 `release-capability-status.json` 为准。

</details>

<details>
<summary>macOS 和 Linux 可以用吗？</summary>

CoreAudio 与 ALSA 后端已存在，但目前没有经过与 Windows 同等级别的发布和真实设备验证。现阶段建议普通用户使用 Windows 版本；macOS / Linux 构建供开发、测试和贡献使用。

</details>

## 反馈与交流

本分支暂未开放 GitHub Issue。可通过分享本版本的交流渠道反馈，建议包含以下信息：

- **Bug 反馈**：提供应用版本、系统版本、问题表现、复现步骤和预期结果。无法稳定复现时，说明发生前的操作与大致频率即可。
- **功能建议**：描述使用场景、当前困难和希望改善的体验。
- **使用问题**：说明想完成什么操作、在哪一步遇到困难，以及已经尝试的方法。

反馈前先查看[常见问题](#常见问题)。每条反馈只讨论一个问题，标题描述具体现象，例如「切换 WASAPI 独占模式后播放无声」。原项目通用功能的问题，也可在[上游 Issue](https://github.com/Px-asen/Twilight_Echo/issues) 中搜索和反馈；歌曲分析与 CLI 的功能说明以本分支为准。

截图和日志按需提供。音频问题建议补充输出设备、驱动、输出模式及歌曲格式，也可在「设置 → 系统与关于 → 导出音频诊断」保存诊断文件，并附上导出的 Markdown 报告。AutoMix 问题可补充模式、分轨运行包和计算设备；插件问题请提供插件名称、版本和来源。如果仅涉及第三方插件，可优先向对应插件作者反馈。

上传截图或日志前请删除密码、Cookie、Token、账号信息及私人文件路径，无需上传整首音乐或完整媒体库。

**原项目 QQ 群：1093775290** — 原项目的交流与内测渠道；分析功能反馈请使用分享本版本的交流渠道。

## 支持原项目

##### **如果 Twilight Echo 成了你常用的播放器，欢迎给项目点一个 Star、分享给朋友，或通过[爱发电](https://afdian.com/a/pxasen)支持后续开发。捐赠者将记录在软件内的贡献者名单中，感谢每一份支持。**

原项目开发交流联系方式：QQ3248974986。

## 扩展与开发

想制作扩展、贡献代码或从源码运行，可以从这里开始：

[开发者文档](./docs/DEVELOPER_README.md) · [插件开发指南](./docs/PLUGIN_README.md) · [插件规范](./docs/twilight-echo-plugin-spec.md) · [第三方插件仓库](https://github.com/Px-asen/Twilight-Echo-plugins) · [全部文档](./docs/README.md)

第三方开发者可在自己的公开仓库发布 `.tep`，通过 GitHub Topic 和 Release 自动进入插件市场；无需把源码提交到目录仓库。发布步骤见[插件开发指南](./docs/PLUGIN_README.md#14-发布到插件市场)。

当前分析版的发布源码以 [`v1.4.0-preview.4`](https://github.com/FengLvv/Twilight_Echo/tree/v1.4.0-preview.4) 为准，持续开发位于 [`codex/music-study-cli`](https://github.com/FengLvv/Twilight_Echo/tree/codex/music-study-cli)；默认分支保留原有开发线。开发环境使用项目锁定的 `pnpm@11.7.0`；依赖安装、原生音频工具链和运行步骤见开发者文档，Windows 发布流程见[发布检查](./docs/windows-release-gate.md)。

## 开源许可

本仓库在 [Px-asen/Twilight_Echo](https://github.com/Px-asen/Twilight_Echo) 基础上开发，保留原项目的开源许可与署名。

Twilight Echo 软件采用 [Apache License 2.0](./LICENSE) 开源。第三方依赖、字体、图标、插件和内容素材遵循各自的许可证或服务条款；相关商标归其权利人所有，Twilight Echo 与这些服务不存在官方隶属或背书关系。

完整分析包中的模型另有许可：SheetSage2 / MERT-v2 权重采用 CC BY-NC 4.0，TiFA / GAME 权重采用 CC BY-NC-SA 4.0。完整模型包用于非商业分享与个人学习，详见[模型与工具许可](https://github.com/FengLvv/Twilight_Echo/blob/v1.4.0-preview.4/resources/music-study/THIRD_PARTY.md)。

如有原项目版权或侵权问题，请联系 Pxasen@outlook.com；本分支的问题见[反馈与交流](#反馈与交流)。
