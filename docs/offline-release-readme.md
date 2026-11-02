# Twilight Echo @VERSION@ · Windows x64 完整离线包

解压全部分卷后，双击 `Start.cmd`。播放器也可直接运行 `TwilightEcho.exe`。
首次验证文件可运行 `Verify.cmd`；它会检查全部文件的 SHA-256，耗时取决于磁盘速度。

分轨、和弦、曲谱、主唱／和声拆分和双歌手拆分的当前模型已包含，无需安装 Python、下载模型或配置本机绝对路径。分析使用本地音频；网易云登录、检索和歌曲播放等在线服务仍需要网络及朋友自己的账号。

设置 → 播放与音效 → 歌曲分析，可选择“播放时自动分析”的项目。默认全部关闭。
若从其他版本保留过分析环境配置，可在“分析环境”中选择本目录下的 `music-study-runtime`。

CUDA 可用时自动启用 NVIDIA GPU；没有 CUDA 时可用的功能会回退 CPU。双歌手拆分需要 CUDA。GPU 性能、驱动与歌曲长度会影响分析速度。桌面歌词、分轨播放、简谱／五线谱沿用播放器内的控制。

请保留整个目录结构。升级或移动文件夹前正常退出播放器。用户登录与个人设置由播放器单独保存在用户数据目录，不随本分享包提供。

下载分卷、合并后的 ZIP 和解压目录同时保留时，建议预留 40 GB 磁盘空间。合并校验成功后可先删除分卷，再解压，以降低空间占用。

## 包内内容

- 播放器：Windows x64 Release 构建。
- `music-study-runtime/models`：按当前校验注册表收集的固定权重、配置和词典。
- 两套独立 CPython 3.11 分析环境：保留各自 NumPy、ONNX Runtime 等依赖；相同的 PyTorch/CUDA 文件只保留一份，由相对路径共享。
- GNU LilyPond 2.24.4 与原有第三方许可文件。
- `release-manifest.json`：每个发布文件的大小与 SHA-256。

软件与第三方组件的许可不同。SheetSage2 / MERT-v2 权重采用 CC BY-NC 4.0，TiFA / GAME 权重采用 CC BY-NC-SA 4.0，本完整模型包用于非商业分享与个人学习。详见 `resources/music-study/THIRD_PARTY.md`、`resources/music-study/licenses`、vendored 组件许可、Python 包的 `.dist-info/licenses` 及 LilyPond 的 `licenses`。

本包不包含旧实验模型、研究目录、原始歌曲、个人登录数据、下载缓存和训练检查点副本。
