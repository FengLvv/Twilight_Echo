# Twilight Echo Core 依赖审计与能力 Port 迁移清单（阶段 0 基线）

- **基线提交 SHA**：`65688cccf919cbf36d900e92fd0a06eb4fb557c0`
- **审计日期**：`2026-10-26`
- **关联架构文档**：`docs/architecture/Twilight_Echo_Core_Architecture_and_Migration_Plan.md`

---

## 1. 现状分层总览

当前 `src/core/` 与 `src/shared/` 的模块按跨平台可移植性分为三个区域：

| 分区 | 定义 | 当前状态 | 移动端策略 |
|---|---|---|---|
| **绿区（100% Portable Core）** | 零 `node:*`、零 DOM、零 `src/core/ports/index.ts`（不依赖 `coreFs`/`coreProcess`/`coreModule`），全部外部能力经构造函数/接口注入 | 已就绪（涵盖 `CoreApplication`、`CorePlaybackSession`、队列控制、设置、搜索、目录、书签、统计、工作区） | 直接打入 `dist/portable-core/music-core.js`，在 Android/iOS 的嵌入式 JS Runtime（QuickJS / JSC）中运行 |
| **黄区（Legacy Node I/O 兼容层过渡模块）** | 通过 `src/core/ports/index.ts` 调用 `coreFs`、`coreStream`、`coreHttp`、`coreCrypto`、`coreAudioMetadata` 等 Node 1:1 包装接口（共 63 个文件） | 仅桌面端由 `src/adapters-node/index.ts` 注入运行 | **严禁进入移动端 Portable Core Bundle**；在阶段 2 按业务能力拆解为领域 Port（`ResourceAccessPort`、`SessionStorePort`、`HttpClientPort` 等），由 `scripts/core-boundaries.test.cjs` 实施棘轮门禁（只减不增） |
| **桌面专属可选能力** | VST3 插件桥、SMB/NFS/SFTP 系统挂载、AutoMix 本地推理安装器、局域网 Cast HTTP 媒体服 | 作为 `CoreApplicationDependencies` 的可选依赖注入 | 移动端不实现，通过显式能力声明与 `Unsupported` 错误返回 |

---

## 2. 绿区：100% Portable Core 模块清单（受边界测试硬性保护）

以下模块及目录已完全脱离 Node.js 与 `src/core/ports/index.ts`，由 `scripts/core-boundaries.test.cjs` 强制保护（任何新增对 `src/core/ports/index.ts` 的引用都会导致测试失败）：

- `src/core/application.ts` — Core 业务入口、客户端连接、命令分发、序列号与快照发布
- `src/core/projections.ts` — 播放、曲目、扫描与错误的纯函数投影
- `src/core/portableSlice.ts` — 跨平台嵌入式 JS Runtime 最小业务切片宿主入口
- `src/core/playback/**` — 播放会话（`session.ts`）、队列游标控制器（`libraryPlaybackController.ts`）、分页队列源（`libraryQueueSource.ts`）、原生队列窗口维护器（`libraryNativeQueueMaintainer.ts`）、音源解析与恢复（`sourceResolver.ts`、`sourceRecovery.ts`、`sourceResources.ts`）、A-B 循环、睡眠定时器（`sleepService.ts`）
- `src/core/settings/service.ts` & `src/core/settings/normalization.ts` — 设置状态机、并发修订校验与规范化
- `src/core/catalog/**` — 统一目录与跨源播放范围
- `src/core/search/**` — 曲库与聚合搜索服务
- `src/core/bookmarks/**` — 播放书签领域服务
- `src/core/listening/**` — 听歌统计与曲库投影
- `src/core/workspace/**` — 队列工作区与会话恢复规则

---

## 3. 黄区：63 个依赖 `src/core/ports/index.ts` 的文件与阶段 2 目标 Port 映射

遵循架构方案 **第 7.3 节（按业务所需能力抽象，而不是按 Node 内置模块逐个包装）**，以下 63 个文件将在阶段 2 分批替换为业务能力 Port：

### 批次 2.1：持久化与文档存储（目标：`KeyValueDocumentStorePort` / `SessionStorePort`）
- `src/core/persistence/jsonFile.ts`
- `src/core/persistence/versionedDataStore.ts`
- `src/core/persistence/fileHash.ts`
- `src/core/persistence/pathGrants.ts`
- `src/core/persistence/personalBackup.ts`
- `src/core/plugins/settingsRepository.ts`
- `src/core/plugins/statePersistence.ts`
- `src/core/plugins/contributionsCache.ts`

### 批次 2.2：本地资源访问、歌词与歌单文件读写（目标：`ResourceAccessPort` / `MetadataReaderPort`）
- `src/core/lyrics/files.ts`
- `src/core/lyrics/loadLyrics.ts`
- `src/core/lyrics/saveLyrics.ts`
- `src/core/playlists/fileParser.ts`
- `src/core/playlists/readFile.ts`
- `src/core/library/playlistRepairService.ts`
- `src/core/library/tagWriteService.ts`
- `src/core/library/watcher.ts`
- `src/core/library/watcherExtensions.ts`
- `src/core/downloads/taglib.ts`
- `src/core/downloads/downloadMetadata.ts`
- `src/core/downloads/downloadTargets.ts`
- `src/core/downloads/completedDownloadResult.ts`
- `src/core/downloads/providerDownloadManager.ts`

### 批次 2.3：网络请求、在线歌词与音源缓存（目标：`HttpClientPort` / `MediaCachePort`）
- `src/core/lyrics/amllTtml.ts`
- `src/core/providers/musicCacheLayout.ts`
- `src/core/providers/ncmApi.ts`
- `src/core/providers/ncmCache.ts`
- `src/core/providers/ncmServerBinding.ts`
- `src/core/providers/autoMixSourceDownload.ts`
- `src/core/ncm/cloudTransferIo.ts`
- `src/core/ncm/cloudTransferService.ts`
- `src/core/network/networkCache.ts`
- `src/core/network/networkCover.ts`
- `src/core/network/networkLibraryPersistence.ts`
- `src/core/network/networkMetadata.ts`
- `src/core/network/profileStore.ts`
- `src/core/audio/opraCatalog.ts`

### 批次 2.4：音频分析缓存、DSP 资产与桌面专属可选模块（目标：`DspAssetPort` / 桌面可选 Adapter）
- `src/core/audio/audioDiagnostics.ts`
- `src/core/audio/autoMixStemCapabilities.ts`
- `src/core/audio/autoMixStemInstaller.ts`
- `src/core/audio/autoMixStemService.ts`
- `src/core/audio/correctionProfile.ts`
- `src/core/audio/dspAssetLibrary.ts`
- `src/core/audio/dspProfileArchive.ts`
- `src/core/audio/dspService.ts`
- `src/core/audio/fileAnalysisCache.ts`
- `src/core/audio/fileAnalysisManager.ts`
- `src/core/audio/libraryLoudnessCache.ts`
- `src/core/audio/libraryLoudnessManager.ts`
- `src/core/audio/modelPackService.ts`
- `src/core/audio/outputTest.ts`
- `src/core/audio/twilightAutoMixCache.ts`
- `src/core/audio/vst3Catalog.ts`
- `src/core/cast/chromecastClient.ts`
- `src/core/cast/dlnaClient.ts`
- `src/core/cast/httpServer.ts`
- `src/core/plugins/experienceDocuments.ts`
- `src/core/plugins/experiences.ts`
- `src/core/plugins/indexService.ts`
- `src/core/plugins/indexTrust.ts`
- `src/core/plugins/installTrust.ts`
- `src/core/plugins/manager.ts`
- `src/core/plugins/packageSecurity.ts`
- `src/core/plugins/qishuiAuthBridge.ts`
- `src/core/plugins/updateTransaction.ts`

---

## 4. 播放命令端到端真实路径（Desktop vs Android 对照）

```text
[UI 意图: playback.play / playback.fromTrack / playback.select]
       |
       v
[CoreApplication.handleMessage (src/core/application.ts)]
  - 校验 CORE_PROTOCOL_VERSION、权限、请求去重与 AbortController
       |
       v
[CorePlaybackSession (src/core/playback/session.ts)]
  - 唯一业务队列游标所有者 (createLibraryPlaybackController)
  - 通过 SourceResolver 解析 Track -> ResourceId / 可播放 URI
  - 通过 LibraryNativeQueueMaintainer 同步有界原生队列窗口
       |
       v
[CorePlaybackEngine / AudioEnginePort]
  - Desktop: AudioEngineServiceClient -> N-API / UtilityProcess -> C++ Audio Core -> WASAPI/ASIO/CoreAudio/ALSA
  - Android: CorePortBridge (QuickJS) -> NativeAudioEngineAdapter -> JNI -> C++ Audio Core (TAE_*) -> Oboe/AAudio
       |
       v
[引擎事件回传: playback-info / end-file / error]
  - 经非实时控制队列回到 CorePlaybackSession.listen()
  - 更新快照并经 CoreApplication.changed() 广播给 UI 与 MediaSession
```
