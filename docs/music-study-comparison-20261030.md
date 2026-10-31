# 分轨与和弦：模型比较与网易云实测

2026-10-30 · Windows · NVIDIA RTX 5080 · 本机离线推理

## Executive Summary

本次采用 **SheetSage2 + MERT-v2-FullSong** 作为默认高精度和弦分析，保持六轨、主唱/和声、双歌手分离及原生同步监听流程。[1][2] 它在本次相同输入的五种可运行方案中，三个评测集合的详细和弦指标均最好。结论限于这些样本与口径，不声称全球最优，也不拿论文榜单替代本机结果。

90 段 GuitarSet 的详细性质时间加权得分：原方案 **72.00%**，ChordMini 融合 **75.39%**，SheetSage2 **90.99%**。按演奏者分开的 30 段保留集为 **88.83%**，不是把大小调归并指标称为完整和弦准确率。模型没有在这些录音上进行本次训练或调参；无法据此排除公开预训练数据的交叉。

真实网易云验证覆盖九首完整歌曲、共 **42.01 分钟**，包括爵士、摇滚现场、电子流行、民族流行、古典小提琴、说唱、华语翻唱、钢琴及男女对唱。全部完成缓存、实际 GPU 分轨、高精度重分析、原生定位/暂停和 FLAC/JSON 导出。网易云歌曲没有人工和弦真值及分轨参考，因而这部分证明流程可用，不提供准确率或主观听感结论。

SheetSage2 和基座代码/权重为 **CC-BY-NC-4.0，限非商业使用**。[1][2] 权重另装约 2.76 GB，测试峰值模型 GPU 内存约 3,380 MiB（3.30 GiB）。原始分轨缓存复用，没有重新分离九遍音轨。完整比较和不利结果如下。

Local validation distinguishes recognition quality from successful operation. Five fixed methods were evaluated against the same references. Nine complete NetEase songs additionally exercised caching, separation, reanalysis, native transport and export. These commercial recordings have no independent annotations in this test, so integration success is not an accuracy score. Inversions remain a weakness, and the selected model has a noncommercial license.

## Introduction

目标是把独立的分轨与和弦工作台做成可在本机使用的功能，并用相同音频比较当前候选。用户所说“核酸检测”按前文语境理解为“和弦检测”。音轨分离与和弦识别是两个不同问题：前者产生乐器、人声轨，后者根据选中的轨道给出随时间变化的和弦。此版本不含罗马数字/调内功能和声、MIDI 或完整乐谱 UI。

研究优先检查论文、作者仓库、官方权重及模型卡；检查下载是否真实可用、修订版本、许可证、输入条件和解码方式，而不是只看年份。[3][4][5][6] 保留原始 BTC 作为对照。[7]

## Main Analysis

### 可运行性与选型

| 方案 | 当前证据 | 处理 |
| --- | --- | --- |
| SheetSage2 / MERT-v2 | 2026-10 论文；公开可下载固定权重；本机 CUDA 实测；CC-BY-NC-4.0 | 默认采用，数据与代码固定摘要 |
| ChordMini BTC / 2E1D | 官方 MIT 源码和检查点可用；相同音频实跑 | 保留为轻量比较实现 |
| ChordFormer | 结构化大词汇值得跟踪；检查的 Git 修订缺少 README 所述检查点，也无明确仓库许可 | 没有冒充完成本机运行 |
| anime-song / Chord-Transcription | 检查的 HF 当前版本只有说明文件，缺所述模型文件 | 未纳入可运行排名 |
| MuQ-BTC / MPE-symbolic | 2026 MIREX / ISMIR 公开介绍；未取得可复现的完整权重与管线 | 跟踪，不以摘要代替复现 [13][17] |

ChordMini BTC 修订 `aa6e3a8d7b017f082fd2aaff9329d5c26af49c03`。SheetSage2 修订 `b83c3d79a6d98bcffaf8f9ed112c90aa887887bc`，父模型按配置固定为 `d8ba1c745e733b3908ce6ad16ebeb17ac7600a42`。[1][2][4] 下载 API 的实际状态为公开可读；模型卡“登录访问”的说明不等于当前受限。

### 相同音频的本机比较

此表为 `common_exact`：在预定的 11 种常见三/七和弦性质内保留详细性质，忽略转位低音；N 有效，参考 X、缺核心音或不支持的参考性质排除。预测未知照常计错。它是自定义指标，不能与论文 Maj/min 或 MIREX 指标直接混用。[8]

| 本机方案 | GuitarSet 90 段 | 演奏者 05 保留 30 段 | IDMT 1,425 和弦事件 | MIREX 两首示例 |
| --- | --- | --- | --- | --- |
| 原 BTC + 色度融合 | 72.00% | 70.30% | 61.44% | 40.23% |
| ChordMini BTC + 色度融合 | 75.39% | 73.15% | 66.19% | 47.26% |
| ChordMini BTC 官方解码 | 74.75% | 72.22% | 61.84% | 47.28% |
| ChordMini 2E1D 官方解码 | 69.34% | 67.65% | 63.95% | 42.21% |
| SheetSage2（采用） | 90.99% | 88.83% | 82.01% | 77.17% |

GuitarSet 共 2,672.71 秒，详细性质有效参考 1,860.53 秒，约 69.6%；保留集有效 594.31 秒。60 段为固定均匀抽样的演奏者 00–04，30 段为演奏者 05 的全部伴奏录音。**这是本次选择过程中的保留，不是模型训练无交叉的保证**。[9]

IDMT 为 Campfire guitar、Celestial Pad、Grand Piano 三种完整合成音色，2,850 秒，其中详细性质有效 2,580 秒。全部根音/和弦序列固定。原注释的 `/3`、`/5`、`/7` 按和弦成员转位处理，核对实际低音后转为 Harte 音程：如 `C:min/3`→`C:min/b3`，`C:7/7`→`C:7/b7`，`C:hdim7/5`→`C:hdim7/b5`。原数据未改写，所有模型统一重评分。[10][11]

MIREX 示例为 You were a puppet master 与 Electra Glider，共 610.31 秒，来自组织方公开的 CC 音频和参考 JSON。[12] 两首均偏爵士，仅为辅助检查。参考的独立人工标注过程未核实，不能把它们当独立标准测试集。JSON 中的 ChordFormer、MuQ-BTC、SLASH、Chordino、ChordyV-ACE 是组织方给出的预测，**不是本机执行结果，也不是参考真值**。[12][13]

### 不利结果与资源开销

SheetSage2 的 IDMT `sevenths_inv` 只有 **35.24%**；ChordMini 融合为 33.51%，原方案 31.74%。大幅提升和弦性质，并未解决高音区、人工合成音色及转位低音的全部问题。GuitarSet 保留集同项为 74.16%；两个集合的分布与有效参考不同，不应合并成一个宣传分数。

单曲公开示例 253 秒的生产适配器推理约 12 秒，模型峰值分配约 3,370 MiB；另有约 4 秒冷加载及外部文件校验开销。此为一次 RTX 5080 实测，不是跨硬件速度承诺。Windows 使用 PyTorch SDPA，未要求 FlashAttention；CPU 路径使用 FP32，未以本次 GPU 性能代替 CPU 速度测试。

SheetSage2 仅输出贪心结果，没有可用的校准概率或候选排序。界面与导出使用 `unrated`，提示听辨核对；不伪造置信度、替代和弦或自动调音偏移。扩展的六和弦、小大七、属七挂四及 Harte 转位保留到显示和人工校正协议。

### 网易云完整歌曲测试

| 曲风 | 实际歌曲版本 | 完整时长 | 输出轨数 | 流程 |
| --- | --- | --- | --- | --- |
| jazz | [Take Five — Dave Brubeck](https://music.163.com/#/song?id=2097976450) | 325.2 s | 6 | 通过 |
| rock-live | [Hotel California (Live, 1994) — Eagles](https://music.163.com/#/song?id=2698479305) | 339.8 s | 8 | 通过 |
| electronic-pop | [Something Just Like This — The Chainsmokers / Coldplay](https://music.163.com/#/song?id=461347998) | 247.6 s | 8 | 通过 |
| chinese-folk-pop | [最炫民族风 — 凤凰传奇](https://music.163.com/#/song?id=354738) | 284.0 s | 8 | 通过 |
| classical-violin | [梁祝（小提琴版）— 西崎崇子爱乐乐队](https://music.163.com/#/song?id=2020775778) | 376.3 s | 6 | 通过 |
| hip-hop | [Lose Yourself — Eminem](https://music.163.com/#/song?id=26936683) | 265.6 s | 8 | 通过 |
| chinese-pop-cover | [青花瓷 — 刘芳（翻唱）](https://music.163.com/#/song?id=259138) | 268.9 s | 8 | 通过 |
| piano-instrumental | [稻香（钢琴版）— 纪钧瀚](https://music.163.com/#/song?id=1945895725) | 196.1 s | 6 | 通过 |
| male-female-duet | [因为爱情 — 陈奕迅 / 王菲](https://music.163.com/#/song?id=25640795) | 216.9 s | 10 | 通过 |

每首保留原曲 SHA-256 与采样帧数，并检查升级模型后分轨文件修改时间不变。新模型重分析在 QA 配置已经移除网易云会话的条件下完成，验证已完整缓存的来源可离线复用。所有曲目均用原生混音器执行贝斯独奏、定位 60 秒、暂停及导出；测试监听音量为零，**不声称已完成人耳听音评审**。

男女对唱额外输出歌手 A/B。模型在 23 个区间、共约 62.81 秒标记音色身份含糊；这是风险提示，不是人工确认的串音或身份交换统计。双歌手模型原生 24 kHz 单声道，重采样为 44.1 kHz 双声道仅为同步，不等于补回丢失信息。[14][15]

## Synthesis

采用 SheetSage2 的依据是三组相同输入上更好的详细性质结果、真实可用的固定权重、本机可承受的资源开销及全曲流程复测。ChordMini 的优势仍是 MIT 与轻量体积，但本次默认质量要求下不占优。没有取得权重的较新系统不被误判为效果差；它们仍可能更好，当前证据不足以选择它们。

应用只执行随包固定的 Python 源码。模型目录只读取已登记摘要的权重和配置，禁止从用户选择的目录动态加载 Python；父模型改用随包 MERT2 类，并保留源文件及权重摘要检查。推理关闭 Hub 网络访问。原工程与正常播放器配置保留，测试配置隔离；歌曲和模型文件均不放进源码与安装包。

## Counterevidence Register

| 反向证据 | 对结论的限制 |
| --- | --- |
| IDMT 转位只有 35.24% | 不能宣传“转位基本准确” |
| 网易云没有真值，人耳听音未做 | 九首通过证明端到端运行，不能证明输出干净或和弦准确率 |
| 私有/未披露预训练语料 | 演奏者保留集不证明完全独立泛化 |
| MIREX 仅两首，参考独立性未证实 | 不能以两首榜单推断全球 SOTA |
| 大模型、NC 许可 | 当前选择适合本机非商业研究；MIT 权重仍有发布便利性 |

## Claims-Evidence Table

| 声明 | 可复核证据 |
| --- | --- |
| 五方案同输入比较 | `benchmark_chords.py`；带音频/注释/模型/配置摘要的预测缓存 |
| SheetSage2 生产适配器保持标签语义 | 相同公开歌曲的研究运行与生产结果复评分；低音、空白区间单测 |
| 网易云完整来源 | 完整源缓存、预期时长拒绝试听、帧数及源摘要检查 |
| 原生试听与导出完成 | Core 返回的播放位置/暂停状态；实际 FLAC、JSON 文件读回 |
| 模型不需要在线推理 | 移除 QA 会话后重分析通过；HF 离线环境与数据目录 |

## Limitations

这不是盲听报告或正式学术排行榜。没有对九首歌曲做人工逐和弦标注，也没有针对每条真实分离音轨计算 SI-SDR；因此不能量化这些商业歌曲的分离质量。原有 MedleyVox 八片段的双歌手 SI-SDR 改善中位数约 5.62 dB 属另一小样本实验，不能转移成网易云质量指标。[14][16]

所有准确率来自原始 GuitarSet / IDMT / CC 音频，不含上游分轨误差；实际选轨后的表现仍需听辨与人工校正。人工编辑属于项目层，导出遵循已保存校正。没有为追求测试分数训练模型、按单曲切换算法、删除低分曲目或复用旧输入的预测缓存。

## Recommendations

本机默认使用已安装的 SheetSage2；六轨和双歌手选项保持原流程。完成分析后可在“分轨与和弦”中切换参与和弦分析的轨道，结合原曲参考听辨并校正。对转位、密集爵士延伸音与相近人声尤其需要复核。

后续如要面向商业分发，应先获得 NC 模型及代码许可，或重新选择许可证允许的模型并重跑这组比较。当前未上传歌曲、提交代码、推送仓库或发布安装包。进一步质量验收最有价值的是给固定的多曲风实际分轨样本补充独立人工参考，而不是再扩大无真值歌曲数量。

## Methodology

The comparison freezes the input cohort before scoring. GuitarSet microphone accompaniment recordings are selected by deterministic file order: sixty uniformly spaced files from players 00 through 04 form the development screen, and all thirty accompaniment recordings from player 05 form the held-out screen. Held-out means that no decisions or parameters were optimized against those results during this task. It does not establish that a pretrained encoder or a private training corpus has never seen a recording. Public model cards do not provide the evidence required for that stronger statement.

Five runnable variants receive the same decoded mono waveform. The original BTC teacher and the newer ChordMini BTC checkpoint use the same existing spectral fusion. The official ChordMini BTC and 2E1D variants use their supplied architectures, strict state loading, stored normalization, fifty percent overlapping windows, Gaussian smoothing and categorical smoothing with kernel nine. Short predictions are retained. SheetSage2 uses the public paper preset with timestamp, downbeat_meter and chord_full prompts, greedy generation, FP32 parameters and CUDA BF16 autocast. No song-dependent thresholds or trained parameters are introduced.

For each prediction cache, the harness records the audio digest, annotation digest, fixed weights and inference configuration. Cached predictions are reused only after those inputs agree. The SheetSage2 harness independently verifies the older cache keys before rescoring them against the same reference. Unknown estimates are counted as errors rather than removed from the valid denominator. Reference regions marked unknown are excluded according to each metric. Standard mir_eval metrics and the narrower custom common_exact metric are reported separately because they do not have identical reference coverage.

The IDMT inversion convention is normalized uniformly before scoring. Chord-member positions are converted to chromatic Harte intervals using the annotated chord quality. Direct inspection of the lowest notes confirms minor thirds, diminished fifths and minor sevenths. Original audio and annotation files remain unchanged. This normalization corrects the representation of a fixed musical reference; it is not chosen separately for each model. Regression tests cover the convention and penalization of unknown predictions.

Two organizer demonstration songs provide a mixed-audio sanity check. Their reference arrays are used as supplied, with zero audio offset verified. Existing system predictions in the same JSON files are scored as published predictions and clearly distinguished from local execution. The annotation process and independence from the candidate systems have not been established. These two jazz-related examples therefore receive lower evidential weight than a documented independent benchmark would receive.

NetEase tests are integration checks. The actual provider search, authorized complete source retrieval, cache capture, GPU workers, Core project state and native audio transport run in an isolated profile. Model-upgrade tests compare source hashes, sample counts and stem modification times, then verify a seek and pause and read back exported files. Listening volume is zero. This verifies synchronization and successful operation without making a subjective listening claim. Private session material is removed from the QA settings and backup after acquisition; there is no logout request against the user's normal session.

## Bibliography

[1] SheetSage2 authors (2026). "SheetSage2: Coherent Lead-Sheet Transcription with Synthetic Supervision". arXiv:2610.05336. https://arxiv.org/abs/2610.05336 (Retrieved: 2026-10-30).

[2] Multimodal Art Projection (2026). "SheetSage2 and MERT-v2-FullSong model cards and fixed inference sources". Hugging Face. https://huggingface.co/m-a-p/SheetSage2 ; https://huggingface.co/m-a-p/MERT-v2-FullSong (Retrieved: 2026-10-30).

[3] Nghia Phan, Rong Jin, Gang Liu, Xiao Dong (2026). "Enhancing Automatic Chord Recognition via Pseudo-Labeling and Knowledge Distillation". DAFx26, arXiv:2602.19778v5. https://arxiv.org/abs/2602.19778 (Retrieved: 2026-10-30).

[4] ChordMini contributors (2026). "ChordMini source and released checkpoints". GitHub. https://github.com/ptnghia-j/ChordMini (Retrieved: 2026-10-30).

[5] Muhammad Waseem Akram, Stefano Dettori, Valentina Colla, Giorgio Carlo Buttazzo (2025). "ChordFormer: A Conformer-Based Architecture for Large-Vocabulary Audio Chord Recognition". arXiv:2502.11840 and official source. https://arxiv.org/abs/2502.11840 ; https://github.com/mwaseemrandhawa/ChordFormer (Retrieved: 2026-10-30).

[6] anime-song (2026). "Chord-Transcription model repository". GitHub and Hugging Face current files. https://github.com/anime-song/Chord-Transcription ; https://huggingface.co/anime-song/Chord-Transcription (Retrieved: 2026-10-30).

[7] BTC-ISMIR19 authors (2019). "BTC-ISMIR19". Official inference source and teacher checkpoint. https://github.com/jayg996/BTC-ISMIR19 (Retrieved: 2026-10-30).

[8] mir_eval contributors (2025). "Chord evaluation metrics". Official documentation. https://craffel.github.io/mir_eval/#module-mir_eval.chord (Retrieved: 2026-10-30).

[9] GuitarSet authors (2019). "GuitarSet dataset". Zenodo audio and annotations. https://zenodo.org/records/3371780 (Retrieved: 2026-10-30).

[10] Fraunhofer IDMT (2023). "IDMT-SMT-CHORDS". Official dataset description. https://www.idmt.fraunhofer.de/en/publications/datasets/chords.html (Retrieved: 2026-10-30).

[11] Fraunhofer IDMT (2023). "IDMT-SMT-CHORDS dataset files". Zenodo. https://zenodo.org/records/7544213 (Retrieved: 2026-10-30).

[12] FutureMIREX organizers (2026). "Audio Chord Estimation 2026 demonstration". Public audio, reference arrays and published predictions. https://futuremirex.com/demos/audio-chord-estimation-2026/ (Retrieved: 2026-10-30).

[13] MIREX organizers (2026). "Audio Chord Estimation Results". Official system reports. https://music-ir.org/mirex/wiki/2026:Audio_Chord_Estimation_Results (Retrieved: 2026-10-30).

[14] Yi Chin Yang and Duet contributors (2023). "duet-svs-diffusion". Official source and model. https://github.com/iamycy/duet-svs-diffusion (Retrieved: 2026-10-30).

[15] SpeechBrain contributors (2021). "spkrec-ecapa-voxceleb". Model card. https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb (Retrieved: 2026-10-30).

[16] MedleyVox authors (2023). "MedleyVox". Public singing separation evaluation dataset. https://zenodo.org/records/7984549 (Retrieved: 2026-10-30).

[17] Yiwei Ding, Yannik Venohr, Sebastian Strahl, Meinard Müller, Christof Weiß (2026). "Revisiting Two-Stage Audio Chord Recognition in the Deep-Learning Era: Leveraging Multi-Pitch Estimation and Symbolic Pretraining". ISMIR 2026 official program. https://ismir2026program.ismir.net/poster_266.html (Retrieved: 2026-10-30).
