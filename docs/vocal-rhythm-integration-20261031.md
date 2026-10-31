# 带时值的人声简谱

“简谱”入口现使用 Vocal2Midi 的 TiFA + GAME medium 流程。TiFA 对齐已经加载的原文歌词，GAME 提取人声音符，Beat This! 从原曲识别节拍，music21 / jianpu-ly / LilyPond 负责谱面布局。没有运行 ASR，也没有改用模型生成的歌词。

## 使用

在歌曲播放页点“简谱”。有有效六轨缓存时直接复用 `vocals.wav`；没有时先做六轨分离。识别完成后，谱面原文与音符一起随歌词行滚动，播放控制、翻译与罗马音仍使用原页面。点击调性菜单可改变简谱的首调编号，音频和模型结果不转调、不重新推理；关闭“简谱”恢复普通歌词。

需要带时间的原文歌词；现有 LRC、YRC、TTML 共用播放器的歌词解析。取有效原文而非翻译，冻结歌曲身份、行号、时间偏移与内容后再入队。没有时间歌词或歌词已切换到另一首时明确报错。多人重叠歌词暂不作为单旋律谱强行处理。

开启简谱时由排谱器布局原文，以保证音符与原词对应；原文逐字填色使用音符时间高亮替代。普通歌词视图和辅助歌词层保持现有实现。

## 数据与缓存

- 已有六轨、和弦、人声子轨的生成策略保持独立。简谱只读取六轨的人声，不自动拆主唱/和声或双歌手。
- 相邻歌词合并成最长 45 秒的对齐片段，保留边界上下文，再通过源词身份归回歌词行。中文按原字；日语汉字、假名和长音保留原写法，多个音节可以关联同一个原词，不伪造汉字逐字的发音对应。
- `start/end` 是音频秒数；`beat/durationBeats` 是独立的排谱量化结果。播放高亮始终跟原音频时间走。谱面不显示未经确认的拍号或小节结构。
- 缓存校验覆盖人声 SHA-256、原歌词序列化内容、TiFA/GAME/节拍与发音数据指纹、算法版本。改歌词仅使简谱失效；主唱拆分、和弦及有效六轨缓存继续使用。
- 原始时间 MIDI、实际音高 MusicXML 与布局模板存于分析任务的 `notation/` 文件夹。SVG 为经过白名单处理的静态几何，运行时没有远程字体、脚本或外链。

## 本机环境

环境位于 `D:\Tools\TwilightEchoToolchain\study`。原分析环境 `runtime` 保留原依赖，新增 `runtime-vocal2midi` 使用 ONNX DirectML，避免替换原环境的 NumPy / ONNX Runtime。LilyPond 位于独立的 `notation-tools`。

`scripts/install-music-study.ps1` 会安装两套环境，下载并核对官方模型包，使用固定 TiFA 源码导出 ONNX，预装 Open JTalk 发音词典。推理过程中不下载词典或模型。已经验证同版本 TiFA 重新导出的 7 个配置/图文件与注册文件逐字节一致。模型及开源组件许可见 `resources/music-study/THIRD_PARTY.md`。

## 验证

新包在独立用户配置下用完整青花瓷（约 4 分 29 秒）运行真实分轨和简谱：442 个音符、68 行谱面，68 行原文全部保留。六轨约 8.9 秒，简谱阶段约 86.9 秒；首个任务含环境检查和模型冷启动约 139.7 秒。已有结果重新打开约 1.3 秒，没有重新推理。这里的简谱阶段包含节拍识别、对齐、音符提取及排版。

另用相同的中文 16 秒、日本语 14 秒片段验证，分别得到 43 / 41 个音符。确认中文原字和日语原词写法保留；这不是人工标注的准确率测试。

通过 Core 18 项、Python 20 项、三组类型检查、打包资源依赖闭包、254 个打包 Node 依赖闭包及渲染资源体积检查。最终包通过调性切换不推理、缓存开关、队列跳转后的音频时间高亮、1024 / 1440 窗口显示和无页面异常检查。所有音符都有 SVG 映射；MIDI 音高完全对应模型结果，最大时间编码误差约 0.5 ms。

最终排版微调只移除歌词谱面中的假定拍号/小节线，使用已有音符重新排版后，在最终新包中再次验证。未把暂停队列与跳转测试当作真实声卡的听音验收，也未把原词完整对应当作音高、节奏和调式的人工正确率。

机器可读结果：`vocal-rhythm-integration-20261031.json`。新包：`dist/vocal-rhythm/win-unpacked/TwilightEcho.exe`。

## 上游

- [Vocal2Midi](https://github.com/Xiantaidu/Vocal2Midi)，固定 `f589c183ec9a4b25ea234459b8a4b72ba993af50`。
- [TiFA](https://github.com/openvpi/TIFA)，模型 1.0，导出源码固定 `7b210ca36ff5a2b79187fb1727af58fc977cc301`。
- [GAME](https://github.com/openvpi/GAME)，medium ONNX 1.0.3。
- [Beat This!](https://github.com/CPJKU/beat_this)、[music21](https://github.com/cuthbertLab/music21)、[jianpu-ly](https://github.com/ssb22/jianpu-ly)、[LilyPond](https://lilypond.org/)。
