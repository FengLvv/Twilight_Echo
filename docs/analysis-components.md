# 分析组件

Windows x64 播放器首次使用分析功能时，先列出缺失组件的实际下载量、安装占用和保存位置。用户确认后，由任务与通知下载、校验并安装；任务继续分析点击时的歌曲。普通播放和已有结果浏览不需要 Python 或模型。

设置 → 播放 → 歌曲分析提供组件安装、已有环境导入、目录选择和删除。自动分析的缺失组件需要明确安装；后台预分析不会发起未经确认的下载。暂停或退出会保留分卷进度，重启后等待用户继续。

## 组件与运行时

`resources/music-study/components.json` 固定平台、内容版本、附件地址、压缩与安装大小和 SHA-256。15 个组件包含两个相互隔离的 Python 环境、一份共享 PyTorch/CUDA、排谱工具和各项模型。文件清单独立保存在 `component-manifests`，不进入 renderer 或常规 IPC。

安装根目录默认为 `%LOCALAPPDATA%/TwilightEcho/analysis-components`：

```text
components/<组件 ID>/<内容版本>/
downloads/<附件 SHA-256>.part
staging/<安装事务>/
installed.json
```

组件目录使用内容哈希前 16 位缩短 Windows 路径；完整哈希仍保留并验证，目录内容版本不匹配时拒绝覆盖。受管组件索引保存相对路径，可随完整离线包移动。导入环境保存外部路径，只登记校验通过的组件，删除不会操作外部文件。安装使用跨实例锁，临时目录完成校验与运行探测后原子提交。公开命令不接受 URL、任意目标路径、脚本或命令行。

Windows 原生库通过临时目录下经过目标校验的短路径目录联接访问组件，避免 Guile/ONNX 的长路径限制；目录联接不复制模型，组件保存位置保持不变。

Core 负责功能依赖、安装同意和歌曲队列。宿主负责固定目录的下载、解包、校验和进程。固定 bootstrap 在科学计算库导入前组装宿主验证过的共享依赖路径；模型按组件定位，不依赖一体式 `models` 目录。六轨和和弦分别准备，前者不等待后者下载。

AMLL 结构化歌词不安装或使用 MiniLM。回退到网易云歌词时，曲谱任务增加歌词过滤组件。主唱／和声和双歌手拆分复用已完成的六轨人声。

## Agent CLI

```powershell
cli-anything-twilightecho --json call study.components
cli-anything-twilightecho --json call study.componentPlan --payload '{"features":["six","chords"]}'
cli-anything-twilightecho --json call study.componentInstall --payload '{"features":["six","chords"]}'
cli-anything-twilightecho --json call study.componentTask --payload '{"id":"engine-torch","action":"pause"}'
cli-anything-twilightecho --json call study.componentTask --payload '{"id":"engine-torch","action":"resume"}'
```

`study.componentInstall` 是显式安装命令，适用于 Agent 已决定下载安装的情况。查询和预估不下载文件。`study.componentRemove` 只接受注册组件 ID；正在使用的组件和仍被其他功能需要的公共环境不能删除。

## 发布

`build-study-components.py` 从已校验的完整环境构建标准 ZIP64/Deflate 包，超过 1.5 GiB 后切卷。模型文件不进入 Git；仅提交目录、校验清单、适配器和构建脚本。每包附上来源与完整许可说明。

`publish-study-components.py` 默认创建或续传草稿，逐一核对 GitHub 附件摘要。`--publish` 才公开。已公开组件附件不可替换。组件标签为 `analysis-components-<目录版本>`，标记预发布且不成为最新播放器版本；播放器更新器只接受播放器 SemVer 标签。

`assemble-study-components.py` 使用同一目录和已验证附件组装完整离线播放器，包含相对组件索引、Start.cmd 和 Verify.cmd。在线与离线模型及运行环境字节一致。封存与分卷继续执行现有离线发布校验流程。

模型许可保持上游条件：SheetSage2/MERT 为 CC BY-NC 4.0；TiFA/GAME 权重为 CC BY-NC-SA 4.0。播放器 Apache-2.0 许可不改变模型的使用条件。
