# 五项架构整理交接

更新时间：2026-11-02（Asia/Shanghai）
工作目录：`C:\Users\vilolu\.codex\worktrees\music-study\twilight_echo`
分支：`codex/music-study-cli`；HEAD：`c15df3de`；版本：`1.4.0-preview.4`（发布准备）

## 当前目标

完成五项架构整理：分析状态／结果版本分离、有预算的结果缓存、全部旧 I/O shim 消费者迁移、分析进程监督与回收、领域组装／请求分发／页面职责拆分。保留此前桌面歌词主题、自动分析、歌词过滤及播放功能的工作区修改。

## 当前状态

五项实现及近期修复已完成。用户已授权发布新的 GitHub Release；当前准备 `v1.4.0-preview.4` Windows x64 预览版，保留全部当前模型和完整离线环境。发布提交以该 tag 为准，历史版本不覆盖。以下 preview.3 安装器为本次发布前的验证记录。

发布流程：提交完整源码 → 构建 preview.4 → 复制已校验的便携 runtime 并更新程序 → 隔离 profile 实际验证 → 封存 SHA-256 清单／对应 Git 源码 → 压缩分卷 → 上传并验证全部附件 → 发布。发布准备证据在 `.local/release-preview4-20261102/`；发布说明见 `docs/releases/1.4.0-preview.4.md`。生产依赖已升级到安全修复版，旧 node-forge 补丁移除。

- 最新安装器：`.local/cover-corners-20261102/package/TwilightEcho-1.4.0-preview.3-setup.exe`，133,479,718 字节，SHA-256 `c2414269527cc5c7bd31fb4fc1c28c175b51b41c4739d4090702488862546b35`。包含播放页封面圆角、网易云歌单收藏、架构整理、日语复合读音和桌面谱面描边修复。
- 程序目录：同目录 `win-unpacked/TwilightEcho.exe`；此安装包不含完整模型环境。
- `dist/releases/1.4.0-preview.3/full` 和旧离线 ZIP 是本轮架构整理前的程序版本。本轮只读复用了其中的模型环境，没有刷新／重新封存完整包。不能把旧 ZIP 当成本轮新版程序。
- 本轮证据与迁移前源码快照：`.local/architecture-implementation-20261102/`。迁移已完成，不要重跑其中的一次性迁移脚本。

## 最新播放页封面圆角修复

真实封面组件的异步图片替换曾触发分轨界面切换动画；现用稳定 `.cover-artwork` 包装层承接视图切换，图片继承圆角，父容器仅在分轨面板离场时允许溢出。同时修复装饰图片规则中编译后残留的无效 `:deep` 选择器。32 项回归、Web 类型检查和生产打包通过；首次加载、切歌、三种动效、分轨切换、玻璃／拍立得／唱片与自定义 0px 均验证。见 `docs/cover-corners-validation-20261102.md` 和 `.local/cover-corners-20261102/`。

## 网易云歌单收藏入口

网易云歌单详情在播放／随机旁增加「收藏／已收藏」，再次点击取消；自建歌单和未登录隐藏。两个可选 provider 方法贯穿 SDK／Core／host／renderer，状态走 `/playlist/detail/dynamic`，归属复用账号歌单元信息，写入走 `/playlist/subscribe?t=1|2` 并受幂等键保护。账号音乐库在成功确认后同步，旧读请求不能回滚已确认修改。

202 项功能／契约回归、额外能力检查、真实 Electron 控件和布局、三套类型检查均通过；浅／深色截图已检查。最终包用隔离 profile 经 CLI 验证注册及未登录拦截，并已正常退出。只做了公共匿名接口结构实测，没有执行用户真实账号收藏／取消；成功写入使用接口夹具验证。详见 `docs/playlist-subscription-validation-20261102.md` 和 `.local/playlist-subscription-20261102/`。

## 桌面歌词描边修复

《汪洋与浩渺》真实谱面复现：SVG 的 `tspan` 默认不继承 `vector-effect`，歌词和休止符描边被放大，改写掉子层的音符数字正常。简谱与五线谱组件已让子层继承不缩放描边；14 项回归通过，真实谱面同条件截图确认恢复细边，最终 `app.asar` 样式核对通过。见 `docs/desktop-outline-fix-20261102.md` 与 `.local/desktop-outline-fix-20261102/`。无需重跑已有曲谱；更新重启后生效，没有修改或重启用户当前实例。

## 日语旋律失败修复

《春灯》已完成六轨／和弦，旋律因「あぁ」生成 `aa` 而字典缺项失败。共享 kana 转换器现从已有字典音节／辅音组成完整音素路径，保留原词、长音和候选读音；同时修复 `ー` 被 Unicode 偏移成 `゜`。未修改模型文件或共享运行环境。

36 项相关回归通过；新包内转换器通过 330 个 kana 条目，包括 157 个原先缺失的复合读音。独立复制原曲／人声重跑整曲得到 315 个音符、15 行简谱，包含原先失败的两行，15 行歌词均逐字保持。没有修改日常 profile 或关闭正在运行的旧版本；用户更新并重启后重试失败任务即可复用已完成的六轨／和弦。证据和验证范围见 `docs/japanese-pronunciation-fix-20261102.md`，产物在 `.local/phoneme-fix-20261102/`。旧完整离线 ZIP 未更新。

## 重要决策与实现

1. `artifactRevision` 独立于状态 `revision`。`studyRepository` 分为 `saveSummary` 和 `commitArtifacts`，哈希未变不重压缩、不增加内容版本。一次性升级前用 SQLite 一致性备份保护现有记录。保存失败保留 producer 结果并重试。
2. Main 的 `workerStatus` 只返回 runId／generation／resultRevision 等元数据；完整结果独立获取。Core 事务保存后 ACK，Main 才删除终态结果。取消、异常和关闭也先接收已完成阶段，再保存与确认。
3. `shared/leasedLru.ts`：Core 128 MiB／32 项，每个 renderer 48 MiB／16 项，按 UTF-8 JSON 大小 × 3 估算。当前、任务、预取、导出和编辑持租约；保护项可临时超预算，暂停额外预取，释放时淘汰。内存淘汰不删除持久化曲谱。
4. 原 66 个 shim 消费者及 10 个相关 Node 文件已按域迁入 `main/adapters`；18 个 Core 业务模块通过显式能力工厂组装。旧 shim、全局注册和启动副作用均已删除。Core／shared 不依赖 Node，comments 不再使用 Buffer。
5. `StudyRequestWatchdog`：心跳 2 秒；丢失心跳 30 秒；启动 180 秒；warm 600 秒；无进度 GPU `max(180秒,时长×6)`、CPU `max(600秒,时长×30)`。取消宽限 5 秒，退出确认 10 秒。Windows 核对子进程身份；无法确认退出时保留租约并停住队列，确认后其他歌曲继续，失败歌曲显式重试。
6. `core/requests` 分为 9 个有类型约束的 handler 域，391 个操作加 4 个播放准入操作覆盖全部 395 个公共操作。`main/coreProcess/entry.ts` 只传输消息，`composition/coreHost.ts` 组装，`composition/study.ts` 持有分析端口与来源 pins。
7. `ShutdownSequence` 合并关闭、保留失败步骤并允许明确重试。窗口监听、歌单定位、流媒体滚动、播放谱面分别由 `useAppWindowLifecycle`、`useCollectionAlphabet`、`useStreamingViewport`、`usePlayingNotation` 管理，保持原 UI 和动效。
8. 扩大回归还修复了 recording-only 技术维度查询不必要的专辑关联，以及只读 reconciliation 对当前 schema 30 的拒绝；没有迁移或修改用户曲库 schema。

长期说明见 `docs/application-architecture.md`。公开 CLI 命令和插件 API 名称保持不变。

## 已尝试方案与失败原因

- 最初使用 Node namespace imports，构建通过但真实 Electron 包在 Rollup `_interopNamespaceDefault` 枚举属性时启动失败。已改用直接 Node 默认／命名导出，重建并通过真实应用验证。不要使用中间的 `package` 或 `package-fixed` 代替最终 `package-final`。
- 读取旧源码位置的测试和 VM 夹具已随迁移同步；文件异步等待用有限墙钟，避免用空转次数代替磁盘完成时间。
- AutoMix decoder 测试首次因缺失 `7za.exe` 失败；通过已有准备脚本安装锁定的 26.04 版本及许可证，SHA-256 通过。
- 没有用磁盘数据迁移实现内存淘汰，没有保留旧内部 API 别名。

## 构建／测试／验证情况

- 2,007 项 Core／跨进程／主界面集成回归通过：`core-integration-verified.log`。
- Core、Node、Web 三套类型检查和 CLI 生成清单检查通过。
- 18 项边界／便携运行检查通过：旧 shim 引用 0，契约无运行代码，便携 Core 在无 Node 沙箱运行。Android 插件包构建及运行测试通过。
- 专项通过：100 次进度／混音变化不重取谱面；浏览 200 首后缓存受限、当前受保护、淘汰项重载；旧数据升级备份、手工和弦保留；保存失败不提前 ACK；取消时保存尚未轮询的完成阶段。
- 真实 Electron UI 回归覆盖分析开关／悬浮格式／HiFi、TaskCenter、AMLL 排谱和桌面歌词主题／描边；静态路径断言也已修正。截图在 `.local/playback-polish-v4-20261101/visual/`。
- 启动了真正忽略取消的 Python 及后代进程，确认两者退出后才启动下一代 worker：`owned-tree-final.log`。Python resident 协议／编码单测通过。
- 生产构建、renderer 预算、NSIS、品牌及 255 包依赖闭包检查通过。
- 最终安装包：独立 `smoke-final` profile，Core ready；《I Love You So》六轨完成后取消，版本 1、六轨保留；下一项目完成六轨和 74 段和弦，版本 2，正常退出。六轨 3,070 ms、和弦 4,178 ms，均非分析缓存命中：`final-package-smoke.json`。
- 另一 profile 验证了设置读写、分析结果重启读取、正常退出：160 秒歌曲、版本 2、74 段和弦保持。没有读取日常账号或改变日常设置，测试程序已退出。

## 已知阻塞与验证边界

本轮无实现阻塞。未做真实声卡试听与设备切换听感验收；输出枚举没有具体 WASAPI endpoint，只有默认项与已安装 ASIO 驱动。时长仅代表本机这首歌。没有重跑完整 20 首制谱质量评估，本轮未更换模型算法。

## 下一步

用户已明确授权提交与发布。本次发布将完整工作区变更一起提交，重新构建 preview.4 并封存完整离线版，不能复用含旧程序的 ZIP。旧 runtime 只读复制到新目录；共享 runtime 可能含 NTFS 硬链接，不要直接编辑其依赖。

本机使用工具链二进制直接构建，不要执行可能清理依赖的 `pnpm run`。打包使用 `.local/study-continuity-20261101/native` 两份已验证原生文件，不要复制含测试 VST host 的整个临时构建目录。
