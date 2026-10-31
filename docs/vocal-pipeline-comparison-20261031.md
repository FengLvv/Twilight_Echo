# 人声与已有歌词转谱：两方案本机对比（2026-10-31）

两套方案均已实际运行并排出对比简谱。对这次的两个片段，建议优先采用 Vocal2Midi 的 TiFA→带词边界约束的 GAME 流程，保留 SheetSage-Pro 的节拍量化和原始时间保留方式作为参考。这是适配当前播放器需求的初步选择，没有证明哪一套在整体音高或节奏准确率上最好。

## 测试范围

使用 RTX 5080、同一份已分离人声和已有歌词，不运行 ASR，不重新做六轨、和弦或多人声分离。实跑的是两个仓库的转谱相关组件，不含完整桌面 GUI 或所有歌曲分析模块。

- 中文：《青花瓷》现有录音的 62–78 秒，16 秒、40 字。
- 日文：My Friend / SPYAIR 的 64–78 秒，14 秒、36 个书写字符。按转音和读音结构统计，不以汉字数直接充当音拍数。
- 为避免半个字落在截取边缘，片段边界与此前 VocalParse 的 20 秒试跑不同，因此不把本轮耗时与上一轮直接做模型速度排名。
- 输入 WAV 与歌词文件的 SHA-256 固定在配套 JSON；两个方案使用相同文件。歌词来自已有公开歌词，模型只负责对齐和音符处理。

## 结构与词音对应

| 方案 | 中文片段 | 日文片段 |
| --- | --- | --- |
| Vocal2Midi，TiFA + GAME medium ONNX | 43 个音符，40/40 字有对应，3 个续音事件 | 41 个音符，41/41 个可唱单位按原生罗马音顺序对应 |
| SheetSage-Pro，Phonsa + 默认 GAME small | 44 个音符，40/40 字有对应，1 个音符未挂词 | 43 个音符，39/41 个单位匹配；两个「ク」未匹配 |
| SheetSage-Pro，GAME medium 对照 | 44 个音符，40/40 字有对应，1 个音符未挂词 | 39 个音符，39/41 个单位匹配；未匹配项变为「ハ」「オ」 |

日文 TiFA 的词表有一个 `cl`（促音）单位没有独立音高，未计入可唱单位。默认罗马音模式能按词身份跳过它；测试脚本使用该原生模式，排谱时再转换为假名。不能把音拍计数解释为原歌词汉字覆盖率。后续接入播放器时仍需保留原文、读音和音符之间的身份映射。

两套中文对齐结果的逐字起点绝对差，中位数为 20 毫秒，最大约 190 毫秒。这反映两个估计之间的一致性，没有人工标注来证明哪一个更准。音符更多也不代表转谱更好。

## 实测耗时

Vocal2Midi 的两个 ONNX 模型本轮装载合计 4.51 秒。模型驻留、相关资源已就绪后的单次处理：

| 片段 | 歌词对齐 | 音符提取与对应 | 合计 |
| --- | ---: | ---: | ---: |
| 中文 16 秒 | 0.46 秒 | 0.22 秒 | 0.67 秒 |
| 日文 14 秒 | 0.61 秒 | 0.67 秒 | 1.27 秒 |

这是一次驻留推理的计时，不含模型下载、Python 导入、六轨或排谱。首次资源初始化和计算图预热会更慢，原始日志单独保留。

SheetSage-Pro 保持原生组件子进程调用：中文 Phonsa 27.55 秒 + GAME small 22.30 秒，约 49.85 秒；日文约 47.25 秒。该时间包含子进程启动、导入和模型装载，与上述驻留计时口径不同；没有测其模型常驻后的同口径速度，不能据此推断纯推理慢多少。

## 排谱与校验

使用现成 **music21 → jianpu-ly 1.891 → LilyPond 2.24.4**，没有自行实现绘谱引擎。每份 PDF 上半为 Vocal2Midi，下半为 SheetSage-Pro 默认 small。为方便直观对比，两者共享从完整原曲检测后截取的 Beat This! 节拍，纸面采用统一 1/32 音符网格、共同估计调性及 4/4 展示；这些不是人工确认的调号、拍号或最终出版谱。

分别保存了模型真实秒时间、各项目原生量化结果、MusicXML 和简谱。播放同步应使用原始秒时间，不用纸面拍数反推真实唱点。

现成 MusicXML 导入器需要格式适配：整数显示 BPM、把双附点拆成等值标准时值、从原始音符关系供给歌词、用关系大调转换后恢复小调 `6=主音`。这些适配只发生在独立排谱脚本，未改上游源码或模型预测。

四个谱面变体的导出 MIDI 已逐事件核对：音符数量、音高顺序、歌词槽位数量全部一致；相对 MusicXML 的音符起点差为 0 拍。两份 PDF 均为一页，已通过 Poppler 再渲染和目视检查。此校验确认导出没有改错数据，不能代替对模型音高/时值的人工听辨。

## 复现与文件

实验根目录：`D:/Tools/TwilightEchoToolchain/study/research-20261031/notation-comparison`。

- `prepare_assets.py`、`asset-manifest.json`：公开权重、来源及校验和。
- `prepare_inputs.py`、`inputs.json`：同源输入与既有歌词。
- `run_vocal2midi.py`：原生 TiFA 和 GAME API，复用既有歌词，含两轮计时。
- `run_sheetsage_pro.py`：原生 Phonsa、GAME 和 DP 匹配；关闭均分时间先验及伪造对齐回退。
- `run_beats.py`：Beat This! 官方权重，完整原曲节拍上下文。
- `render_scores.py`、`validate_engraving.py`：现成排谱器的数据适配及导出检查。
- `output/pdf/zh_qinghuaci-comparison.pdf`、`output/pdf/ja_myfriend-comparison.pdf`：两份对比谱。
- 每个方案目录保存原始 JSON、MIDI、量化结果和组件调用日志。

SheetSage-Pro 的原始日文注册表标记缺少本地检查点。本次显式下载了公开的 **Japanese_pretrained_model_Phonsa**，在测试进程内注册为实验后端；没有借用中文模型。Phonsa 权重修订为 `cdfcedcaa44d8ba47a659acd29ed7b3b7a46c244`。

Vocal2Midi 的 GAME 默认使用语言中性 ID，SheetSage-Pro 的原生接口带语言条件。medium 对照保留各自策略，因此仅是同容量对照，没有将其包装成单变量算法实验。

上游源码均保持干净，提交号与环境版本见配套 JSON。应用环境复查仍为 torch 2.8.0+cu128 / transformers 4.45.2 / numpy 2.4.6；现有播放器包哈希仍为 `2a461349af91db8306f788bb6729c35adc524c6db322e013821847b252af102c`。未接入播放器、未替换现有包。

## 局限与下一步判断

本次只有两个短片段，没有人工逐音音高、边界和节奏真值，没有完成整曲转谱或跨曲风评测。覆盖统计不是 ASR 准确率，也不是音符准确率。当前结果足以支持优先验证 Vocal2Midi 的带词边界流程；上线前仍应补整曲、多人声干扰和人工听辨样本。

代码与权重许可分别适用；TIFA/GAME 的公开权重为 CC BY-NC-SA 4.0，本次仅在独立本地测试环境使用。

来源：[Vocal2Midi](https://github.com/Xiantaidu/Vocal2Midi)、[SheetSage-Pro](https://github.com/pingw220/sheetsage-pro)、[Phonsa](https://github.com/YatingMusic/Phonsa)、[Phonsa 权重](https://huggingface.co/Lonian/Phonsa)、[TIFA](https://github.com/openvpi/TIFA)、[GAME](https://github.com/openvpi/GAME)、[Beat This!](https://github.com/CPJKU/beat_this)、[jianpu-ly](https://github.com/ssb22/jianpu-ly)。
