# Twilight Echo 跨平台架构与 Core 独立化方案

> **文档性质：** 本轮对话的完整主题整理与优化版，不是逐字聊天记录。  
> **整理日期：** 2026-10-26  
> **适用范围：** Twilight Echo 主仓库、未来 Android 仓库、未来 iOS 仓库。  
> **核心方向：** 主仓维护共享核心与桌面端；移动端各自独立建仓；从业务 Core 中剥离 Node.js；通过平台宿主与适配层复用核心能力。

---

## 阅读说明

本文件以对话最后确定的方向为准，合并重复内容，保留关键取舍，并修正前面方案中的冲突。阅读时请区分：

- **已确定：** 用户明确表达的选择。
- **建议：** 对这些选择的工程化落实方式，不代表已经实现或已经最终选型。
- **待核验：** 前面对话中提及的源码结构、运行时能力、平台支持情况，仍需基于指定提交和实际测试确认。

**本次整理没有重新拉取或审计 GitHub 源码，也没有执行构建或测试。** 前面对话中的“已查看源码”“当前版本”“测试存在”等说法，不作为本文件独立核验过的事实。本文涉及现有路径和类名时，将其作为迁移检查入口；涉及目标目录、接口和版本号时，均是设计建议或示例。

本文件中的“完整”指完整覆盖讨论过的目标、方案演进、架构边界、复用方式、风险和实施步骤，而不是保留重复回答、无依据的确定性表述或互相矛盾的建议。

---

## 目录

1. [最终决策摘要](#01-decisions)
2. [项目背景与现状边界](#02-background)
3. [方案演进与已修正的结论](#03-evolution)
4. [最终架构：Core、Ports、Adapters、Host、Bridge、UI](#04-architecture)
5. [两个 Core 的职责与状态所有权](#05-two-cores)
6. [三个仓库的职责与代码归属](#06-repositories)
7. [Node.js 拆分：从运行时依赖到能力接口](#07-node-extraction)
8. [Port 设计与资源访问原则](#08-port-design)
9. [协议、版本与 Bridge 设计](#09-protocol)
10. [移动端如何运行同一份 TypeScript Core](#10-runtime)
11. [Android 原生架构](#11-android)
12. [iOS 原生架构](#12-ios)
13. [C++ 音频核心、输出后端与 C ABI](#13-native)
14. [曲库、数据库、文件与网络](#14-data)
15. [插件系统与安全边界](#15-plugins)
16. [主仓库目标结构](#16-layout)
17. [跨仓依赖、SDK 与独立发布](#17-release)
18. [测试、持续集成与独立性验收](#18-testing)
19. [渐进迁移路线与阶段门槛](#19-migration)
20. [AI 辅助开发的约束](#20-ai)
21. [待决事项与架构决策记录](#21-open-items)
22. [下一步最小执行清单](#22-next)
23. [附录：完整议题索引与核验入口](#23-appendix)

---

<a id="01-decisions"></a>
## 1. 最终决策摘要

### 1.1 已确定的方向

| 事项 | 最终决定 |
|---|---|
| 项目目标 | 长期维护，逐步支持桌面、Android 和 iOS |
| 主仓库 | 保留 `Px-asen/Twilight_Echo`，同时维护 Core 与桌面端 |
| Android | 单独建立仓库，UI 使用 Kotlin + Jetpack Compose |
| iOS | 后续单独建立仓库 |
| Core | 做成真正独立的核心，不再把 Node.js 作为业务核心的运行时前提 |
| Node.js | 不从桌面产品中删除，而是从 Core 内部剥离，成为桌面平台的适配实现 |
| 代码复用 | 避免复制和分叉，优先复用共享核心，平台差异由各端适配 |
| 开发方式 | 借助 AI 开发，但仍以清晰边界、可验证契约和回归测试保障维护质量 |

### 1.2 整理后的架构建议

采用：

> **共享 Music Core + 共享 Audio Core + 平台适配器 + 原生宿主 + 原生 UI。**

其中：

- **Music Core：** 保留 TypeScript 业务实现，逐步移除 Node.js、Electron、DOM 和平台专属依赖。
- **Audio Core：** 保留 C++ 音频处理能力，隔离平台输出、系统设备和语言绑定。
- **Desktop Host：** 继续使用 Node.js / Electron，负责装配适配器、管理进程和连接桌面 UI。
- **Android Host：** Kotlin 原生宿主，管理播放生命周期、系统媒体会话、资源访问和 JavaScript 运行时。
- **iOS Host：** 建议使用 Swift 原生宿主，管理音频会话、系统媒体控制、资源访问和 JavaScript 运行时。
- **移动端业务复用：** 优先验证在嵌入式 JavaScript 运行时中运行同一份 Music Core；验证失败时再评估替代路线。

**iOS 的 Swift + SwiftUI 是建议，不应误记成用户已经明确选择的技术栈。**

### 1.3 必须同时记住的四个区别

**Core 独立，不等于 Core 必须单独建仓。**  
当前选择是“同仓维护、包级独立、构建独立、版本可独立”，不是创建第四个 Core 仓库。

**脱离 Node.js，不等于脱离 JavaScript 运行时。**  
TypeScript 编译后的 JavaScript 仍需要执行引擎。Kotlin 和 Swift 不会因为移除了 Node 依赖，就能直接执行 TypeScript。

**共享核心，不等于共享 UI 或所有平台实现。**  
Compose、SwiftUI、Vue 可以各自演进；文件访问、系统媒体控制、音频设备和生命周期也应保留平台实现。

**AI 降低编码成本，不自动降低架构错误的成本。**  
并发、音频实时性、后台生命周期、跨语言内存管理与设备兼容，仍需要测试和明确的所有权约束。

---

<a id="02-background"></a>
## 2. 项目背景与现状边界

### 2.1 对话中的项目背景

仓库：

`https://github.com/Px-asen/Twilight_Echo`

整个讨论围绕一个已有桌面播放器展开，目标不是重新开发一款播放器，而是利用现有业务与原生音频能力，建立可长期维护的跨平台体系。

用户已说明：

1. 主项目已经进行 Core 拆分与迁移。
2. 最新版本已经把相关 Core 工作合并到主仓库。
3. Android 采用原生 UI，并独立维护仓库。
4. iOS 也计划独立维护仓库。
5. 主仓库继续承担 Core 与桌面端的共同上游角色。
6. 下一步把 Core 进一步独立化，将 Node.js 依赖拆出去。

### 2.2 前面对话形成的工作假设

以下是前面对话中的架构描述，适合作为排查起点，**不是本次整理重新验证的现状清单**。

| 模块 | 前文提及的位置 | 需要确认的职责 |
|---|---|---|
| TypeScript 业务 Core | `src/core/` | 播放会话、曲库、歌单、设置、歌词、搜索、Provider、插件协调 |
| Core 入口 | `src/core/application.ts` | 业务装配边界、命令处理、状态发布 |
| 桌面 Core 运行入口 | `src/main/coreProcess/entry.ts` | 平台依赖创建、进程通信、Core 启动 |
| Core 进程监督 | `src/main/coreProcess/supervisor.ts` | 启停、连接、异常恢复 |
| 窗口桥接 | `src/main/coreProcess/windowBridge.ts` | Renderer 与 Core 通信 |
| Core 协议 | `src/shared/coreProtocol.ts` | 命令、查询、快照、版本、权限和一致性语义 |
| 平台类型 | `src/shared/corePlatform.ts` | 平台能力和相关类型 |
| UI 播放状态 | `src/renderer/src/stores/player/corePlayerStore.ts` | UI 状态映射、发送命令 |
| 播放业务会话 | `src/core/playback/session.ts` | 队列业务、音源协调、会话恢复 |
| C++ 音频引擎 | `audio-engine/` | 解码、DSP、混音、原生执行、输出 |
| 原生 API | `audio-engine/include/twilight_audio_engine.h` | 外部宿主调用音频引擎的接口 |
| 输出抽象 | `audio-engine/output/IOutputBackend.h` | 平台输出后端契约 |
| 边界测试 | `scripts/core-boundaries.test.cjs` | Core 依赖约束及例外规则 |

正式开始迁移时，先固定一个提交 SHA，再核对这些入口。若路径或职责已变化，以实际源码为准。

### 2.3 这轮重构真正要解决的问题

上一阶段的主要目标是：

> 业务逻辑不再依赖窗口、Renderer 或 UI 的存活。

下一阶段的目标进一步变为：

> 业务逻辑不再依赖 Node.js、Electron 或特定操作系统，能够由不同平台宿主承载。

这不是否定前一次重构，而是在已有业务所有权与协议边界上继续隔离运行环境。

---

<a id="03-evolution"></a>
## 3. 方案演进与已修正的结论

### 3.1 对话的决策过程

| 阶段 | 当时讨论的方向 | 现在的处理 |
|---|---|---|
| 初始了解项目 | 项目功能、Star、Fork、桌面技术栈 | 仅保留背景；动态数据不纳入架构依据 |
| 最初 Android 方案 | Vue + Capacitor，优先复用 Web UI | 已不作为主方案 |
| 用户明确原生 UI | Kotlin + Jetpack Compose | 保留，为 Android 最终 UI 方向 |
| 早期仓库建议 | Desktop、Android、Core 三个独立仓库 | 已被后续仓库决定替代 |
| 重新理解现有 Core | 发现需要区分 TS Music Core 与 C++ Audio Core | 保留为核心判断 |
| 保守复用路线 | 共享 C++，Android 用 Kotlin 重写业务 | 保留为备选，不再是首选目标 |
| 加入 iOS 规划 | 三个应用仓库，共享上游核心 | 保留 |
| 用户确定主仓职责 | 主仓维护 Core + Desktop，移动端独立 | 保留，不创建第四个 Core 仓库 |
| 最新决定 | 从 Core 中拆出 Node.js | 成为本文件的主要实施方向 |

### 3.2 对前面建议的关键修正

#### 修正一：不再把 Capacitor 当作 Android 主方案

初期推荐 Capacitor，是以复用 Vue UI 为优先条件。

用户之后明确选择原生 Android UI，因此最终方案采用 Compose。现有 Vue 组件不作为必须复用的资产；应优先复用业务规则、协议、测试和音频能力。

#### 修正二：不再要求单独建立 Core 仓库

独立性通过包、接口、构建、测试、版本和产物实现，不通过仓库数量衡量。

主仓可以同时拥有 Desktop 与 Core，前提是 Core 不反向依赖桌面应用。

#### 修正三：不再把“共享 C++”等同于“共享完整播放器”

只共享音频引擎，仍可能导致 TS、Kotlin、Swift 各自维护一份复杂业务逻辑。

最新决定是进一步抽离 Node，使现有 TypeScript Music Core 有机会成为真正跨平台的业务核心。

#### 修正四：不再要求所有队列与状态都放到 C++

业务队列、音源选择和恢复规则，与音频引擎内部的预加载、双流混音和实际解码状态，是不同层次。

正确目标是**每类状态只有一个权威所有者**，而不是把所有状态强行塞进同一种语言。

#### 修正五：不把“纯 TypeScript”误认为“可以直接在手机原生代码中运行”

移动端复用 TS Core 需要 JavaScript 运行时与原生桥接，这是一项真实的工程工作。

QuickJS、Hermes、JavaScriptCore 只是候选，不是已经选定或已经验证的依赖。

#### 修正六：输出后端与系统宿主分开归属

前文曾分别建议把 Android 输出后端放在 Android 仓库或主仓。

本文件建议统一为：

- 为构建共享音频 SDK 所必需的底层输出后端，原则上放主仓。
- Android 媒体会话、音频焦点、通知和权限等应用宿主代码，放 Android 仓库。
- iOS 音频会话、系统控制和应用生命周期代码，放 iOS 仓库。

特殊情况可以通过外部后端注册接口处理，但不能让两边各自维护同一份后端实现。

#### 修正七：不要等完整重构结束才验证移动端运行时

前文倾向于先完成所有 Node 拆分，再做移动端验证。

整理后的建议是：**尽早抽取一个最小业务切片，同时验证 Android 与 iOS 的宿主链路。**

这样可以避免把整个 Core 改成“理论上可移植”，最后才发现所选运行时或桥接方式不可接受。

---

<a id="04-architecture"></a>
## 4. 最终架构：Core、Ports、Adapters、Host、Bridge、UI

### 4.1 先定义术语

| 名称 | 主要职责 | 不应承担的职责 |
|---|---|---|
| Music Core | 业务规则、应用用例、业务状态协调 | 系统 API、UI 渲染、进程创建 |
| Audio Core | 解码、DSP、混音、原生播放执行 | UI、平台权限、业务持久化策略 |
| Port | Core 所需能力的抽象契约 | 具体平台实现 |
| Adapter | 实现某个 Port，转换平台语义 | 不必要地复制核心业务规则 |
| Host | 装配依赖、持有运行时、管理生命周期与系统事件 | 重写共享业务逻辑 |
| Bridge | 跨语言或跨进程的传输、编码、调度与错误映射 | 决定播放策略和曲库规则 |
| UI | 展示状态、收集用户意图 | 持有后台播放的唯一实例 |

**Port 与 Bridge 不是同一个概念。**

Port 回答：“Core 需要什么能力？”  
Bridge 回答：“这个调用如何跨过语言或进程边界？”  
Host 回答：“谁创建、持有、停止这些对象，并与操作系统协作？”

### 4.2 逻辑依赖方向

```text
                    应用 UI
                       |
                       v
             业务客户端 / 状态映射
                       |
                       v
          Host 对外入口 / Command Bridge
                       |
                       v
                  Music Core
                  /        \
                 v          v
            领域模型      Port 接口
                              ^
                              |
                       平台 Adapter
                              ^
                              |
                         Host 装配
```

从源码依赖看：

```text
Core -> Core 自己定义或依赖的纯契约
Adapter -> Core 的 Port
Host -> Core + Adapter + 平台 SDK
UI -> 客户端接口 / 展示模型
```

**Core 不得 import Node Adapter、Android Host、iOS Host 或 Electron。**

### 4.3 运行时总体结构

```text
Desktop UI          Android UI              iOS UI
Vue                 Kotlin + Compose        SwiftUI（建议）
 |                   |                       |
 v                   v                       v
Desktop Host        Android Host             iOS Host
Electron / Node     Kotlin / 播放服务         Swift / 播放协调器
 |                   |                       |
 |                   +--> JS Runtime         +--> JS Runtime
 |                        |                       |
 +------------------------+-----------------------+
                          |
                 同一份 Music Core 产物
                          |
                    注入的能力 Ports
                          |
         +----------------+----------------+
         |                |                |
     持久化/资源       网络/插件        Audio Adapter
                                           |
                           Node-API / JNI / C Bridge
                                           |
                                      Audio Core
                                         C++
                                           |
                                    平台输出后端
```

这里的“同一份”表示相同源码与受控版本的业务实现。是否能使用完全相同的 JS 文件、是否需要按运行时生成不同封装，必须由运行时验证决定。

### 4.4 不强行统一的部分

不要求：

- 三端共用 UI 框架、导航或页面布局。
- 三端使用相同数据库访问库。
- 三端以相同方式申请文件权限。
- 三端拥有完全相同的后台执行机制。
- 三端的所有桌面高级功能都同时可用。

要求：

- 业务规则的所有权明确。
- 相同业务能力具有一致的协议语义。
- 差异通过能力契约与平台适配表达。
- 不支持的功能有显式结果，而不是静默失效。

---

<a id="05-two-cores"></a>
## 5. 两个 Core 的职责与状态所有权

### 5.1 Music Core：共享业务核心

建议保留或逐步收敛到这里的内容：

| 领域 | 典型职责 |
|---|---|
| 播放会话 | 用户播放意图、曲目选择、命令协调、会话恢复 |
| 业务队列 | 队列编辑、播放顺序、随机与循环规则、队列版本 |
| 曲库 | 歌曲/专辑/艺术家模型、索引业务、去重与身份规则 |
| 歌单 | 编辑规则、排序、导入导出语义 |
| Provider | 搜索与解析流程、来源选择、能力编排 |
| 歌词 | 解析规则、时间轴、匹配与业务状态 |
| 设置 | 设置模型、校验、迁移与默认值策略 |
| 插件协调 | 插件能力发现、调用编排、结果校验 |
| 应用协议 | 命令、查询、快照、事件与错误语义 |

需要区分“共享业务规则”和“业务所依赖的外部工作”。

例如：

- 歌词匹配规则可在 Core，读取文件与网络请求交给 Port。
- 曲库去重规则可在 Core，MediaStore 查询或文件遍历交给 Adapter。
- Provider 调度可在 Core，平台网络、凭证存储和插件执行交给宿主能力。

### 5.2 Audio Core：共享原生音频核心

建议保持：

- 音频解码与数据转换。
- 重采样、DSP、EQ、混音算法。
- 无缝播放和预加载的原生执行机制。
- 实际播放时钟、缓冲与解码状态。
- 音频输出抽象与原生错误报告。
- 面向宿主的稳定接口。

不要为了“真正独立”把所有音乐业务重写成 C++。是否下沉某个业务算法，应由一致性收益、性能需求和维护成本决定。

### 5.3 状态所有权表

| 状态 | 权威所有者 | 其他层如何使用 |
|---|---|---|
| 业务播放队列、随机顺序、循环策略 | Music Core | UI 和系统会话读取投影 |
| 用户希望播放/暂停、用户选中的曲目 | Music Core | Host 转发用户或系统控制意图 |
| 实际是否正在出声、缓冲、解码错误 | Audio Core | Music Core 根据引擎事件更新综合状态 |
| 实际播放位置、音频时钟 | Audio Core | Host/Core 提供快照，UI 可做显示插值 |
| AutoMix 内部重叠音轨、预加载执行 | Audio Core | 向 Music Core 报告语义事件 |
| 系统是否允许输出、音频中断、路由状态 | 平台 Host | 映射为 Core 输入与引擎约束 |
| 持久化的会话恢复数据 | 由 Music Core 定义语义，Store Adapter 保存 | Host 启动时加载并交给 Core |
| 当前页面、面板展开、滚动位置 | UI | 不进入共享播放状态机 |
| 通知栏/控制中心展示 | 平台媒体适配层 | 来自 Core 与引擎状态的投影 |

**避免三套真相：Music Core、Media3、UI 不应分别维护可独立演进的播放队列。**

Media3 或 iOS 系统层可以持有为了集成所需的数据镜像，但镜像必须由权威状态更新，不能成为另一份业务规则实现。

### 5.4 平台安全操作是必要例外

“所有播放命令都经过 Core”不能阻止宿主及时处理系统中断。

例如发生音频焦点丢失、设备断开或服务关闭时，Host 可以立即执行暂停、静音或停止等必要操作，然后把结果和原因回传 Core。

需要约定：

1. 哪些平台事件允许 Host 直接制动。
2. 如何更新实际引擎状态与 Core 状态。
3. 是否允许恢复播放，以及恢复前如何检查用户后续意图。
4. 正常用户控制不能借此绕过业务 Core。

---

<a id="06-repositories"></a>
## 6. 三个仓库的职责与代码归属

### 6.1 主仓库：`Twilight_Echo`

负责：

```text
共享 Music Core
共享契约与行为测试
共享 Audio Core
原生输出后端
基础语言绑定与 SDK 构建
Node Adapters
Desktop Host
Electron / Vue 桌面应用
```

它是共享代码的唯一上游，但不意味着桌面版本号就是所有移动端必须跟随的版本号。

### 6.2 Android 仓库：`Twilight_Echo_Android`

名称是建议，负责：

```text
Kotlin + Compose UI
ViewModel 与原生展示状态
Android Playback Host
Media3 集成
文件、权限、数据库、网络等 Android 适配
JS Runtime 的 Android 宿主集成
Android 生命周期、前台播放、通知、设备与音频焦点
Android 测试、打包、发布
```

不维护另一份 Music Core 源码，也不复制 Audio Core 进行长期修改。

### 6.3 iOS 仓库：`Twilight_Echo_iOS`

名称是建议，负责：

```text
Swift / SwiftUI UI（建议）
iOS Playback Host
音频会话与系统媒体控制
文件授权、持久化、网络等 iOS 适配
JS Runtime 的 iOS 宿主集成
iOS 生命周期与后台音频协作
iOS 测试、打包、发布
```

### 6.4 哪些代码归主仓，哪些归移动端？

| 内容 | 建议归属 | 原因 |
|---|---|---|
| Music Core 业务逻辑 | 主仓 | 唯一共享实现 |
| Audio Core 算法与公共接口 | 主仓 | 避免原生引擎分叉 |
| Oboe / iOS 原生输出后端 | 原则上主仓 | 便于构建可测试的完整音频 SDK |
| 基础 JNI / C ABI 包装 | 原则上主仓 SDK | 与引擎 ABI 同版本演进 |
| Media3 Player 适配 | Android 仓库 | 与 Android 应用宿主和系统媒体层关联 |
| AVAudioSession 管理 | iOS 仓库 | 属于 iOS 生命周期与系统策略 |
| Core 业务协议 | 主仓 | 三端共享 |
| 平台资源、权限、数据库实现 | 对应平台仓库 | 受系统 API 与产品策略影响 |
| UI、导航、主题和交互 | 对应应用仓库 | 原生体验独立演进 |
| 跨平台契约测试数据 | 主仓 | 统一行为标准 |

基础 SDK 包装与应用宿主适配之间要划清边界。不要让音频 AAR 内部依赖某个应用 Activity，也不要让 XCFramework 直接管理 SwiftUI 页面。

---

<a id="07-node-extraction"></a>
## 7. Node.js 拆分：从运行时依赖到能力接口

### 7.1 拆出的不是功能，而是平台实现

目标不是删掉文件、网络、数据库、插件等功能。

目标是把：

```text
业务逻辑直接调用 Node API
```

改成：

```text
业务逻辑调用 Port
       |
       v
Host 注入的 Adapter
       |
       v
Node / Android / iOS 的具体实现
```

### 7.2 依赖迁移清单

下表来自前面对话涉及的依赖类别；实际是否存在及位置，需要扫描源码确认。

| 依赖或能力 | 推荐处理 |
|---|---|
| `node:fs`、`fs/promises` | 移到资源访问、扫描或持久化 Adapter |
| `node:path` | OS 路径语义留在 Adapter；Core 使用稳定资源标识 |
| `node:crypto` | 拆为随机、摘要、凭证等实际需要的能力，不照搬整个模块 |
| `node:http`、`node:https` | 通过网络 Port 提供请求、取消、流式读取等所需语义 |
| `node:net`、`node:dgram` | 移到具体协议 Adapter，并暴露能力支持情况 |
| `node:stream` | 改用约定的数据流或读取接口，显式处理背压与取消 |
| `node:events` | 使用运行时无关事件机制或 Core 自有订阅接口 |
| `Buffer` | 跨核心边界优先使用明确的字节契约，如 `Uint8Array`；验证运行时支持 |
| `process`、环境变量 | Host 读取后注入配置，不让 Core 自行发现运行环境 |
| `require`、Node 动态加载 | 由构建产物与宿主模块加载机制解决 |
| Node 数据库绑定 | 实现领域存储 Port，不让 Core 依赖具体驱动 |
| `music-metadata`、`node-taglib-sharp` 等 | 核查实际依赖图；平台部分移出，纯算法部分再评估共享 |
| Electron Utility Process | 保留在 Desktop Host，不进入共享 Core |
| Node 插件执行器 | 移入插件运行时 Adapter |
| N-API 音频绑定 | 保留在桌面 Audio Adapter，Core 只见音频契约 |
| 日志、时钟、定时任务 | 视业务确定性与运行时差异，通过轻量接口注入 |

### 7.3 不要把 Node API 原样包一层就称为独立

不理想的接口：

```text
NodeFsPort
NodeProcessPort
SpawnChildProcessPort
RequireModulePort
```

这些接口虽然移除了 import，但仍要求 Android 和 iOS 模拟 Node 的能力和语义。

优先设计：

```text
LibraryScannerPort
ResourceAccessPort
SessionStorePort
MetadataReaderPort
NetworkPort
PluginRuntimePort
AudioEnginePort
```

**按业务所需能力抽象，而不是按 Node 内置模块逐个包装。**

对于真正桌面专有的能力，例如某些外部进程或桌面插件宿主，不要强制放入所有平台必须实现的最小 Port 集。

### 7.4 依赖扫描不能只看 `node:*`

还要检查：

- 没有 `node:` 前缀的内置模块导入。
- 第三方包的传递依赖。
- `Buffer`、`process` 等隐式全局。
- 对 `window`、`document` 等浏览器对象的依赖。
- 打包器自动注入的兼容层。
- 动态 `require`、动态导入和条件导出。
- 只在特定业务分支中才出现的宿主调用。
- 运行时不保证存在的 `fetch`、`URL`、定时器、编码器等 API。

**没有 Node import，只能证明一部分边界，不能证明可移植性。**

### 7.5 构建期 Node 与运行期 Node 分开

允许：

```text
使用 Node 运行 TypeScript 编译器、打包器、测试工具和发布脚本。
```

最终要消除的是：

```text
Core 发布产物在执行业务时，必须依赖 Node 的运行时能力。
```

同样，在 Node 中跑通单元测试不等于已经证明 Core 可以在嵌入式 JavaScript 引擎中运行。

---

<a id="08-port-design"></a>
## 8. Port 设计与资源访问原则

### 8.1 最小接口示例

以下代码只展示契约形态，不是当前仓库已有实现，也不是完整 SDK。接口应先从现有业务调用反推，不要先发明庞大的通用框架。

```typescript
export type ResourceId = string;
export type Unsubscribe = () => void;

export interface CancelHandle {
  cancel(): void;
}

export interface ClockPort {
  nowUnixMs(): number;
  nowMonotonicMs(): number;
}

export interface SchedulerPort {
  schedule(delayMs: number, task: () => void): CancelHandle;
}

export interface AudioSource {
  resourceId: ResourceId;
  mimeType?: string;
}

export interface AudioSnapshot {
  engineSessionId: string;
  state: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  positionMs: number;
  durationMs: number | null;
}

export type AudioEvent =
  | { type: "snapshot"; snapshot: AudioSnapshot }
  | { type: "error"; code: string; recoverable: boolean };

export interface AudioEnginePort {
  load(source: AudioSource): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  getSnapshot(): Promise<AudioSnapshot>;
  subscribe(listener: (event: AudioEvent) => void): Unsubscribe;
}

export interface StoredSession {
  revision: string;
  payloadJson: string;
}

export type SaveSessionResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "conflict" };

export interface SessionStorePort {
  load(): Promise<StoredSession | null>;
  save(
    payloadJson: string,
    expectedRevision: string | null
  ): Promise<SaveSessionResult>;
}
```

正式接口还要补充：

- 参数校验、取消与超时。
- 错误分类与是否可重试。
- 事件发送顺序与回调线程。
- 订阅释放和关闭语义。
- 引擎操作完成、命令接受和实际出声之间的区别。
- 存储版本冲突的原子性保证。
- 资源句柄与引擎会话的生命周期。

`subscribe` 和回调属于进程内 Port 形态；跨语言 Bridge 应转换成事件 ID、订阅 ID 和消息，而不是假定可以直接传输函数对象。

### 8.2 音频文件不能用“全部读入内存”的通用接口代替

早期示例里的：

```typescript
read(uri: string): Promise<Uint8Array>
```

可以说明依赖注入，但不适合作为所有音频资源的最终接口。

音频资源可能很大，也可能是网络流、不可随机访问的文档资源或临时授权资源。

正式设计应区分：

| 能力 | 需要明确的语义 |
|---|---|
| 元信息读取 | 大小、类型、是否可 seek、访问是否仍有效 |
| 随机读取 | 偏移、读取长度、EOF、失败语义 |
| 顺序流读取 | 背压、取消、缓冲上限 |
| 原生句柄访问 | 谁打开、谁关闭、是否复制句柄、何时失效 |
| 写入 | 原子替换、失败回滚、权限、空间不足 |
| 扫描 | 分页、增量、取消、授权变化 |

**PCM 音频数据和大文件字节流尽量不经过 JS 业务桥。**

Music Core 传递资源标识与控制意图，宿主和原生引擎负责高吞吐数据路径。

### 8.3 URI 与资源标识不要混用

建议区分：

```text
TrackId       稳定的业务曲目身份
ResourceId    宿主可解析的资源引用
URI / Path    某个平台上的访问地址
Native Handle 原生层已打开的访问句柄
```

一首歌曲可能更换访问地址，但不应该因此自动变成另一首业务曲目。

Core 不应假定：

```text
所有资源都是文件路径。
所有 content:// 地址都能转换为真实路径。
所有资源都能 seek。
所有读取权限永久有效。
```

### 8.4 错误必须保留语义

不要把所有错误变成 `false` 或空数组。

至少要能区分：

```text
资源不存在
权限失效
不支持该能力
网络暂时不可用
格式不支持
引擎错误
请求被取消
状态版本冲突
结果未知
```

例如，文件访问失败不总是“文件不存在”；把权限错误当作不存在，可能导致错误删除曲库记录。

---

<a id="09-protocol"></a>
## 9. 协议、版本与 Bridge 设计

### 9.1 保留已有协议思想，不盲目照搬桌面传输

前文提及当前协议已经考虑命令、查询、快照、Epoch、Sequence、队列 Revision、客户端权限以及恢复错误码。

这些设计应先在源码中核实，再决定复用范围。

建议保留的是：

```text
命令的业务含义
状态的所有权
版本与兼容规则
请求与响应关联
状态恢复与重连语义
并发修改规则
```

不必强制保留的是：

```text
Electron 专用 MessagePort
窗口身份与 Renderer 特有字段
桌面专属能力
为了现有进程布局产生的传输细节
```

### 9.2 建议区分两类契约

**对外业务协议**

用于 UI、系统媒体控制、测试客户端向 Core 发送业务请求，以及接收快照和事件。

**内部能力 Port**

用于 Core 调用音频、网络、存储、插件等宿主能力。

两者可以共享基础模型，但不要把所有内部 Port 调用都机械地变成对外可调用 RPC。

### 9.3 建议的业务消息结构

以下字段是协议设计清单，不表示当前协议已经采用这些名称。

| 字段 | 作用 |
|---|---|
| `protocolVersion` | 声明业务协议版本 |
| `requestId` | 关联请求与响应 |
| `commandId` | 有副作用命令的去重标识 |
| `coreInstanceId` 或 `epoch` | 区分 Core 重启前后的实例 |
| `sequence` | 同一实例中的事件顺序 |
| `expectedRevision` | 队列等状态的乐观并发控制 |
| `capabilities` | 声明当前宿主支持的能力 |
| `payload` | 明确类型的业务数据 |
| `error.code` | 稳定的机器可读错误码 |
| `error.retryable` | 是否允许自动重试 |

不要同时引入多个用途重叠的版本字段而没有定义。应先理解已有协议，再补缺口。

### 9.4 必须写清楚的协议语义

#### 命令接受不等于操作完成

例如“收到播放命令”“资源已加载”“引擎进入播放状态”“实际开始输出”可能是不同阶段。

UI 不能把 RPC 返回成功直接解释为已经出声。

#### 超时不等于失败

超时可能表示操作尚未完成，也可能表示已经执行但响应丢失。

对于 `OUTCOME_UNKNOWN` 一类情况，优先查询或重同步状态，不要盲目重复执行“下一首”“追加队列”等有副作用命令。

#### 去重不等于自动实现跨重启的恰好一次

命令 ID 与内存去重缓存可以解决部分重试问题，但跨进程重启是否仍能去重，取决于持久化与事务设计。

协议中应明确实际保证，不能仅靠字段名称承诺“绝不重复执行”。

#### 重连要处理快照与事件的竞态

订阅事件与读取快照之间可能发生状态变化。

应明确采用：

```text
带版本的快照 + 从某个 Sequence 补事件
```

或其他等价的一致性机制，而不是简单“先读一次，再开始监听”。

#### Epoch 与业务 Revision 含义不同

Core 实例重启后可以更换 Epoch；持久化队列的 Revision 则表示业务数据版本。不要把进程序号当作数据版本。

### 9.5 跨语言数据约束

建议使用明确 Schema 或可生成的契约，但不在本次整理中强制选定 JSON Schema、Protocol Buffers 或其他工具。

共同要求：

- 明确整数范围，避免 JavaScript 数字精度导致 ID 或时间戳损坏。
- 明确空值、缺省值与字段缺失的区别。
- 不直接传输类实例、闭包、宿主对象。
- 错误对象转换为稳定 DTO，而不是依赖平台异常类。
- 二进制大对象使用单独通道或原生句柄。
- 对未知字段与未知枚举值有兼容策略。
- 区分持久化数据格式、UI 协议和原生 ABI，不把它们当成一个版本号。

### 9.6 Bridge 应保持薄而明确

Bridge 可以做：

```text
序列化与反序列化
线程切换
请求关联
事件订阅
错误映射
输入大小与类型校验
调用方身份与权限检查
取消与超时传播
```

Bridge 不应该做：

```text
重新决定下一首播放什么
复制播放恢复算法
自行维护另一份可编辑业务队列
擅自选择音源
把 UI 特例写入共享业务规则
```

权限不能只相信消息中自报的客户端身份。真正的调用方身份与授权应由 Host 或可信连接上下文确定。

### 9.7 能力协议要表达实际状态

前面对话中的能力分层值得保留：

```text
Compiled   构建中包含该能力
Available  当前环境可用
Requested  用户或 Core 请求启用
Active     实际已经启用
Verified   在约定的验证范围内得到确认
```

这不是要求所有能力都拥有五个字段，而是提醒不要把“编译支持”“用户勾选”“实际生效”混为一谈。

例如：

```text
支持某输出后端
≠ 当前设备支持某格式
≠ 已经以该格式打开
≠ 已证明端到端 bit-perfect
```

---

<a id="10-runtime"></a>
## 10. 移动端如何运行同一份 TypeScript Core

### 10.1 首选验证路线

```text
TypeScript 源码
       |
       v
编译 / 打包后的 JavaScript
       |
       v
Android / iOS 的嵌入式 JavaScript 运行时
       |
       v
原生 Host 提供的 Port 与事件循环集成
```

UI 仍然是原生 UI。

**嵌入 JavaScript 业务运行时，不等于使用 WebView，也不等于采用 React Native、Capacitor 或 HTML UI。**

### 10.2 运行时尚未选定

前面对话讨论过：

| 候选 | 本项目需要验证的重点 |
|---|---|
| QuickJS | 嵌入方式、异步任务驱动、限制机制、宿主绑定与维护成本 |
| Hermes | 脱离既有框架单独嵌入时的支持情况、构建和桥接成本 |
| JavaScriptCore | 两个平台的嵌入与分发方式、API 一致性、调试与宿主集成 |
| 其他运行时 | 仅在前述候选无法满足约束时再评估 |

这张表不是当前版本兼容性结论，也不是性能排名。

**不能只因某引擎“轻量”或“原生”就决定全项目路线。** 必须使用项目自己的 Core 切片验证。

### 10.3 需要选择的两种策略

**同一引擎覆盖 Android 与 iOS**

潜在收益是行为和调试体系更统一；成本是要在两个平台维护构建、绑定和分发。

**不同平台使用不同引擎，统一宿主契约**

潜在收益是利用各平台条件；成本是需要更严格的语言特性约束和一致性测试。

两种策略都可评估。现在应固定的是 **Host API 和可移植性标准**，而不是未经验证的引擎名字。

### 10.4 纯 JavaScript 引擎不自动提供完整宿主环境

必须逐项明确：

| 能力 | 需要回答的问题 |
|---|---|
| 模块加载 | bundle、模块路径、动态加载如何处理 |
| Promise / 微任务 | 谁驱动任务队列，何时执行，关闭时如何处理未完成任务 |
| 定时器 | 谁提供，暂停与关闭语义是什么 |
| 网络 | 是否由原生 Port 实现，如何取消与限流 |
| URL / 编码 | 所需 API 是否存在，是否需要可控实现 |
| 字节与流 | 如何跨桥传输，是否复制，有何大小上限 |
| 日志 | 如何归属 Core 实例并接入原生诊断 |
| 异常 | JS 异常如何变成原生错误，如何关联请求 |
| 线程 | 哪条线程拥有 JS 上下文，外部回调怎样调度 |
| 内存与终止 | 如何处理失控任务、关闭和资源回收 |
| 调试 | 如何拿到堆栈、源码映射和崩溃上下文 |

TypeScript 编译目标应依据实际运行时能力决定，不应仅以桌面 Node 的语言支持为基准。

### 10.5 运行时线程模型建议

优先采用可解释的单一所有权：

```text
Core 专属串行执行上下文
      |
      +-- 执行业务命令
      +-- 接收 Host 事件
      +-- 驱动 JS 任务队列
      +-- 发布业务快照
```

平台回调和原生引擎事件先进入受控队列，再调度到 Core 所在线程。

避免：

```text
任意 Kotlin / Swift / C++ 线程直接访问 JS 上下文
音频回调同步等待 JS
UI 主线程执行长时间 Core 任务
关闭运行时时仍有未受控回调持有旧对象
```

### 10.6 最小概念验证的内容

同一份业务切片至少要在 Desktop、Android 和 iOS 的验证宿主中执行：

```text
创建 Core
注入 Clock / Store / Audio 等最小 Port
发送加载与播放命令
处理一个异步原生结果
订阅状态
修改队列或执行一条业务规则
暂停
关闭
重建并恢复状态
```

第一轮可以使用 Fake AudioPort 验证业务运行时；紧接着再打通真实 C++ 音频链路。

只有纯计算函数能跑，不足以证明完整宿主方案可行。

### 10.7 失败时的备选路线

备选方案包括：

- 调整运行时选择或桥接设计。
- 暂时只共享一部分已独立的 TS 业务模块。
- 移动端先复用 Audio Core，并以原生业务实现作为阶段性方案。
- 对少数稳定且高价值的规则评估共享原生实现。

**不建议默认把整个 Music Core 重写成 Kotlin、Swift、C++ 或 Rust。**

备选方案的触发条件，应是实际的性能、稳定性、平台兼容或维护成本证据，而不是单纯语言偏好。

---

<a id="11-android"></a>
## 11. Android 原生架构

### 11.1 推荐结构

Android UI 已确定使用 Kotlin + Jetpack Compose。

应用结构建议采用分层、ViewModel 和单向数据流，并用 Port/Adapter 隔离共享核心与平台能力。

这里不需要把 Clean Architecture、MVVM、MVI、UDF 都当成必须安装的框架：

- 分层用于约束职责和依赖。
- ViewModel 用于管理页面状态和交互。
- UDF 用于明确事件与状态流向。
- Port/Adapter 用于实现跨平台边界。

### 11.2 播放链路

```text
Compose UI
    |
    v
ViewModel / UI 状态映射
    |
    v
Playback Client
    |
    v
MediaController
    |
    v
MediaSessionService
    |
    v
自定义 Media3 Player 适配
    |
    v
Android Playback Host
    |
    v
JS Runtime + Music Core
    |
    v
Audio Port / Native Bridge
    |
    v
JNI
    |
    v
C++ Audio Core
    |
    v
Oboe / Android 输出后端
```

这是职责示意，不要求为每个方框创建一个类或 Gradle Module。

曲库、歌单、搜索等非标准媒体业务，可以通过同一宿主管理的 Core 客户端访问，不必强行把所有 API 都塞进 MediaController。

### 11.3 Media3 在这里的角色

建议使用 Media3 的媒体会话体系对接系统控制，并评估通过 `SimpleBasePlayer` 等自定义播放器机制映射共享核心。

这里不把 ExoPlayer 作为第二个实际音频引擎。

要验证的内容包括：

```text
系统播放/暂停如何映射为 Core 命令
队列和时间线怎样投影
异步操作完成如何通知
Core 状态变化如何刷新系统媒体状态
不可用命令怎样反映
错误怎样映射
```

具体 API、线程要求和实现方式应以开发时所用版本的官方文档为准。

### 11.4 生命周期所有权

建议由播放宿主持有：

```text
JS Runtime
Music Core 实例
Audio Core 句柄
媒体会话
事件订阅
资源适配器
```

Activity、Compose 页面、ViewModel 只连接宿主，不拥有后台播放器的唯一实例。

目标是：

```text
UI 退出或重建，不直接导致正在进行的播放被释放。
```

但不能承诺：

```text
系统永远不会杀死应用。
Service 天然永生。
应用进程被终止后仍可在原进程继续播放。
```

必须设计服务停止、进程重建、状态恢复和权限变化。

### 11.5 同进程与独立进程

初期建议优先同进程，降低调试与通信复杂度。

只有出现明确的崩溃隔离、资源隔离或安全需求时，再评估独立进程和 AIDL 等方案。

**Service 并不自动等于独立进程。**

独立进程也不能替代应用状态恢复机制。

### 11.6 Android 平台职责

Android Host 需要负责或协调：

- 音频焦点、播放中断、耳机与路由变化。
- 后台播放、系统媒体会话和通知。
- MediaStore / SAF 等资源入口及授权。
- 系统数据库、网络与凭证能力。
- JS Runtime 和 JNI 的线程调度与释放。
- 系统恢复与重新连接。

这些平台策略不应转移到纯 TypeScript Core 中通过 `if (android)` 大量分支实现。

### 11.7 Android 技术选型状态

| 部分 | 状态 |
|---|---|
| Kotlin + Compose | 已确定 |
| ViewModel + UDF / StateFlow | 推荐 |
| Media3 媒体会话与播放服务 | 推荐，需实现验证 |
| 自定义 Player 适配 | 推荐，具体基类需核验 |
| JNI + C++ 引擎 | 推荐复用链路 |
| Oboe 输出 | 推荐候选，需设备和构建验证 |
| Room / DataStore | 平台存储候选，不是 Core 依赖 |
| Hilt | 可选的依赖注入工具，不是架构前提 |
| OkHttp | 网络实现候选，不进入 Music Core |
| Navigation Compose | UI 导航候选，与共享核心解耦 |

### 11.8 Android 仓库逻辑结构

```text
Twilight_Echo_Android/
├── app/                    # 入口、导航、装配
├── feature/                # 播放、曲库、歌词、搜索、设置
├── ui/                     # 设计系统、原生展示模型
├── core-client/            # 共享契约的 Kotlin 侧客户端
├── playback-host/          # 播放生命周期与唯一实例
├── media-session/          # Media3 系统适配
├── runtime-host/           # JS Runtime、任务调度、Bridge
├── adapters/
│   ├── resources/
│   ├── persistence/
│   ├── network/
│   └── platform/
├── native-integration/     # SDK 集成，必要的应用侧薄封装
├── tests/
└── docs/
```

与早期“Kotlin Domain 重写完整业务”的方案不同，这里的 Kotlin 主要承担原生宿主、展示与平台适配。已有共享业务规则仍由 Music Core 执行。

---

<a id="12-ios"></a>
## 12. iOS 原生架构

### 12.1 推荐方向

用户已确定 iOS 单独建仓，但尚未明确 UI 技术。

建议采用 Swift + SwiftUI，保持原生 UI 与共享核心分离。

```text
SwiftUI（建议）
    |
    v
原生展示模型 / ViewModel
    |
    v
Core Client
    |
    v
iOS Playback Host
    |
    +--> 音频会话与系统媒体控制
    |
    v
JS Runtime + Music Core
    |
    v
Audio Port / C Bridge
    |
    v
C++ Audio Core
    |
    v
iOS 音频输出后端
```

### 12.2 不照搬 Android Service

iOS 不应机械复制 Android 的服务结构。

建议由原生播放宿主协调：

```text
AVAudioSession
系统媒体控制
播放信息展示
后台音频协作
中断与路由变化
应用生命周期
运行时与原生引擎资源
```

前面对话提及 `MPRemoteCommandCenter` 等系统入口；正式实现时应核对官方文档、目标系统版本与实际权限配置。

### 12.3 iOS 与 macOS 不能混为同一平台

即使两者都属于 Apple 平台，也不能据此假定：

```text
现有 macOS 输出后端可以直接用于 iOS。
所有 APPLE 条件分支都适用于手机。
桌面动态库和插件加载方式在 iOS 同样可行。
```

需要分别验证：

- C++ 和 FFmpeg 的构建。
- 输出设备与音频会话配合。
- 真机与模拟器构建产物。
- 系统中断、路由和后台恢复。
- JS Runtime 的嵌入与分发。
- SDK 的链接、符号和依赖打包。

### 12.4 不把后台音频当作无限后台执行许可

设计目标是让必要的音频控制与业务运行时配合系统后台音频机制，而不是假设 JS Core 可在任何状态下无限运行。

扫描曲库、下载、插件任务与播放控制需要分别评估生命周期和调度策略。

### 12.5 iOS 仓库逻辑结构

```text
Twilight_Echo_iOS/
├── App/
├── Features/
├── DesignSystem/
├── CoreClient/
├── PlaybackHost/
├── SystemMedia/
├── RuntimeHost/
├── Adapters/
│   ├── Resources/
│   ├── Persistence/
│   ├── Network/
│   └── Platform/
├── NativeIntegration/
├── Tests/
└── Docs/
```

不要等 Android 完成后才第一次尝试 iOS 核心构建。可以暂不开发完整 iOS UI，但应提前保留一个最小宿主验证工程。

---

<a id="13-native"></a>
## 13. C++ 音频核心、输出后端与 C ABI

### 13.1 保留已有原生能力，避免重复实现

前面对话认为项目已经有 C++ 音频引擎、FFmpeg 解码、DSP、AutoMix、输出接口和 C API。

本文件建议以这些已有能力为迁移基础，但以下问题必须重新检查：

```text
是否真的能够不构建 Node-API 而单独构建引擎？
公共头文件是否泄漏平台类型？
第三方依赖是否支持目标平台？
构建目标是否混入桌面专属功能？
回调、内存和线程约定是否完整？
```

不要仅因为某文件是 C++ 就认定其已经跨平台。

### 13.2 输出后端安排

建议：

```text
Audio Core 的算法与执行逻辑
                |
                v
          IOutputBackend
                |
       +--------+---------+---------+---------+
       |        |         |         |         |
    Windows   macOS     Linux    Android     iOS
    后端      后端      后端      后端      后端
```

Android 可以评估 Oboe；iOS 可以评估适当的 AudioUnit 等原生输出实现。

后端实现与系统生命周期应分开：

```text
输出后端：打开流、输出 PCM、报告实际格式、处理底层输出状态。
平台宿主：音频会话、焦点、权限、系统中断、应用生命周期。
```

### 13.3 CMake 平台条件要显式区分

示意：

```cmake
if(ANDROID)
    # Android backend and dependencies
elseif(CMAKE_SYSTEM_NAME STREQUAL "iOS")
    # iOS backend and dependencies
elseif(WIN32)
    # Windows backends
elseif(APPLE)
    # macOS backend
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    # Linux backend
else()
    message(FATAL_ERROR "Unsupported target platform")
endif()
```

这只是分支示例，不是可直接替换现有 CMakeLists 的完整补丁。

实际构建还需要核对工具链、模拟器目标、依赖探测、可选功能和发布产物。

### 13.4 C ABI 应重点稳定的内容

| 项目 | 要明确的内容 |
|---|---|
| 句柄 | 创建、销毁、无效句柄处理 |
| ABI 版本 | 如何拒绝不兼容调用 |
| 结构体版本 | 大小、扩展字段与兼容策略 |
| 字符串 | 编码、所有权、有效期 |
| 内存 | 谁分配、谁释放、是否允许跨运行库释放 |
| 错误 | 稳定错误码、附加信息、可恢复性 |
| 线程 | 哪些 API 可在哪些线程调用 |
| 回调 | 调用线程、顺序、重入限制 |
| 关闭 | 停止后是否还有回调、何时可以释放宿主对象 |
| 异步操作 | 请求 ID、取消、完成与失败事件 |
| 能力查询 | 编译能力与当前设备能力分开 |
| 格式报告 | 请求值与实际打开值分开 |

采用 C ABI 可以降低不同语言绑定对 C++ 内部细节的依赖，但 C ABI 本身并不会自动保证版本兼容。

### 13.5 实时音频线程约束

核心原则：

> **音频实时回调不等待 JavaScript，不同步调用 Kotlin/Swift UI，不执行阻塞 IO。**

建议分离：

```text
控制面：
UI -> Core -> Audio Port -> 原生控制线程

数据面：
读取/解码 -> PCM 缓冲 -> DSP -> 原生音频输出
```

事件从原生侧经非实时通道报告给 Host/Core。

例如播放位置没有必要以音频回调频率传给 UI。可以采用适度频率的快照与显示插值，但必须基于引擎时钟，且处理暂停、seek 与换曲。

若不同层采用不同单调时钟，Host 需要定义时间映射，不能直接比较不同钟域的数值。

### 13.6 HiFi 能力不能只看选项是否开启

保留前面对话的谨慎原则：

- 请求独占不等于独占已经生效。
- 实际输出格式不等于源文件格式。
- 输出流格式正确不自动证明整条设备链路 bit-perfect。
- 普通 Android 输出不自动具备 USB DAC 的所有特殊能力。
- Native DSD、DoP、特殊设备通路都应独立验证。

建议提供：

```text
源格式
内部处理格式
请求输出格式
实际输出格式
处理链与可能的转换
设备及路由
能力状态与验证范围
```

不能把桌面版的音质标签直接复制到移动端而不验证实际路径。

---

<a id="14-data"></a>
## 14. 曲库、数据库、文件与网络

### 14.1 共享数据语义，不强迫共享访问库

Music Core 应定义：

```text
Track / Album / Artist / Playlist 的业务模型
ID 与关联规则
排序、去重和索引语义
迁移与兼容规则
恢复数据的含义
查询与事务所需保证
```

平台可以使用不同实现：

```text
Desktop：现有 Node / SQLite 适配
Android：Room / SQLite 等候选
iOS：适当的本地持久化实现
```

这不是要求三端立即共享完全相同的数据库文件。

**共享业务模型、交换格式与底层表结构是三个不同的层次。**

### 14.2 存储 Port 应表达事务语义

对于队列、歌单等需要一致性的操作，要明确：

- 原子更新范围。
- 版本冲突处理。
- 崩溃后是否会出现部分写入。
- 迁移失败如何恢复。
- 分页与排序是否稳定。
- 是否需要批量操作。

不要只提供 `get` / `set` 后默认所有复杂事务都能跨平台一致执行。

### 14.3 本地资源访问

桌面端常见路径：

```text
D:/Music/Album/song.flac
```

移动端可能使用平台资源地址或授权引用，不能把磁盘路径作为跨平台统一前提。

Android 侧的 MediaStore / SAF，iOS 侧的应用沙箱与平台文件授权，都应由对应 Host/Adapter 负责。

Core 接收到的是稳定的业务与资源标识，以及明确的可用性、元信息和错误。

### 14.4 FFmpeg 与原生资源读取

建议通过适配的原生读取方式接入系统资源，而不是让 Core 将整个文件读成字节数组再跨 JS Bridge 传给解码器。

需要明确：

```text
打开资源的权限归属
句柄所有权
资源是否可 seek
读取取消
资源失效
预加载与并发读取
关闭顺序
```

某个资源的 `content://` 或其他平台地址，是否能直接被现有解码路径识别，必须实际验证。

### 14.5 网络能力也要拆清楚

共享部分可以包括：

```text
音源选择规则
重试策略中的业务判断
搜索结果合并
歌曲身份与来源映射
缓存有效性的业务规则
```

宿主负责或提供：

```text
HTTP 执行
TLS 与系统网络
流式读取
取消与超时机制
凭证与授权访问
连接状态
平台下载与后台任务能力
```

对于大音频流，控制消息与媒体数据应分离。不要让 JS 桥成为所有下载和播放字节的中转站。

### 14.6 桌面特殊能力保持可选

VST3、特定网络挂载、桌面系统集成或外部工具等，不应成为 Core 初始化的硬性依赖。

可以通过：

```text
可选 Port
能力查询
显式 Unsupported 错误
按能力启用的业务模块
```

保留桌面功能，同时避免阻塞移动端核心启动。

---

<a id="15-plugins"></a>
## 15. 插件系统与安全边界

### 15.1 插件协议兼容，不等于运行时兼容

前面对话提及桌面 JS 插件、`.tep` 包、Electron Utility Process 和原生扩展。

这些入口及格式应先核验，但架构判断可以明确：

```text
同一套插件能力协议
≠ 同一套平台执行方式
≠ 所有插件包都能原样跨平台运行
```

插件可能依赖 Node、文件系统、动态原生库或桌面专属能力。

### 15.2 分成三个层次

```text
Plugin Contract
  能力、输入输出、错误与权限声明

Plugin Coordinator
  Music Core 中的发现、选择、调度与结果处理

Plugin Runtime Adapter
  平台实际执行环境、资源限制与宿主 API
```

不要把 Node 插件运行器留在共享 Music Core 内。

### 15.3 Core 运行时与不可信插件运行时不能默认共用信任边界

Music Core 是应用自身的业务代码；第三方插件可能是不可信代码。

即使都使用 JavaScript，也需要单独考虑：

- 可访问的宿主能力。
- 网络与文件授权范围。
- CPU、内存和执行时间限制。
- 任务取消与故障恢复。
- 插件退出是否会损坏核心状态。
- 插件能否读取其他插件或应用凭证。

**嵌入一个 JavaScript 引擎，不自动等于建立了足够强的安全沙箱。**

### 15.4 第一版不要承诺完整桌面插件兼容

建议先完成：

```text
核心播放
曲库与歌词
基础 Provider 契约
最小可信功能集
```

再逐步扩展插件宿主。

移动端分发涉及动态脚本、可下载原生代码、签名和平台审核等问题。相关政策会变化，必须在实际分发前核对官方要求，本文件不据此前对话做合规结论。

许可证、FFmpeg 构建配置和第三方依赖的再分发条件，也应单独审查，不因主仓某个许可证名称而默认全部兼容。

---

<a id="16-layout"></a>
## 16. 主仓库目标结构

### 16.1 建议的逻辑布局

```text
Twilight_Echo/
│
├── packages/
│   ├── music-core/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── playback/
│   │   ├── library/
│   │   ├── playlists/
│   │   ├── lyrics/
│   │   ├── providers/
│   │   ├── settings/
│   │   └── ports/
│   │
│   ├── core-contracts/
│   │   ├── model/
│   │   ├── commands/
│   │   ├── events/
│   │   ├── capabilities/
│   │   └── errors/
│   │
│   └── adapters-node/
│       ├── resources/
│       ├── persistence/
│       ├── network/
│       ├── crypto/
│       ├── metadata/
│       ├── plugins/
│       └── audio/
│
├── src/
│   ├── main/
│   │   └── coreProcess/        # Desktop Host / 进程装配
│   ├── preload/               # 桌面通信边界
│   └── renderer/              # Vue UI
│
├── audio-engine/
│   ├── core/
│   ├── decoder/
│   ├── dsp/
│   ├── output/
│   │   ├── windows/
│   │   ├── macos/
│   │   ├── linux/
│   │   ├── android/
│   │   └── ios/
│   ├── include/
│   ├── napi/
│   └── CMakeLists.txt
│
├── sdk/
│   ├── android/               # 基础绑定、原生产物与发布
│   └── ios/                   # C 包装、原生产物与发布
│
├── contracts/
│   ├── schema/                # 跨语言格式源定义（采用生成时）
│   ├── conformance/           # 行为契约用例
│   └── fixtures/              # 公共测试数据
│
├── tests/
│   ├── portable-core/
│   ├── adapters-node/
│   ├── host-contract/
│   └── native/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   └── migration/
│
└── .github/
    └── workflows/
```

这是目标职责图，不是一次性搬目录的要求。现有 `audio-engine` 子目录应尽量保留，只在必要时调整。

### 16.2 避免契约出现两个手写来源

上面的：

```text
packages/core-contracts
contracts/schema
```

不能各自维护一份互不约束的同名模型。

需要选定一种方式：

```text
Schema 为源 -> 生成 TypeScript / Kotlin / Swift 类型
```

或：

```text
某种明确的契约源定义 -> 导出其他语言与验证器
```

另一部分只存测试、生成产物或发布包装。

核心原则是：**契约只有一个可编辑的权威来源。**

### 16.3 为什么先隔离依赖，再移动目录

同时进行：

```text
大规模改路径
改接口
改线程模型
改行为
换运行时
```

会使问题难以定位，也不利于 AI 辅助审查。

建议顺序：

```text
先建立边界测试
再提取一个 Port
移动对应平台实现
保持调用语义与桌面行为
最后统一包结构
```

### 16.4 不为了架构名称过度拆包

初期可以先形成少数明确单元：

```text
music-core
core-contracts
adapters-node
desktop-host
audio-engine
```

内部按领域组织即可。

只有当依赖隔离、构建速度、团队协作或发布需求需要时，再拆成更多物理模块。

---

<a id="17-release"></a>
## 17. 跨仓依赖、SDK 与独立发布

### 17.1 源码唯一上游

共享代码的修复统一回到主仓。

移动端允许有临时调试补丁，但必须有明确的回流计划，不能形成长期私有分叉。

不要依靠手动复制：

```text
src/core/
audio-engine/
```

来维持跨仓共享。

### 17.2 初期：锁定源码提交

可选择：

| 方式 | 特点 | 需要注意 |
|---|---|---|
| Git Submodule | 提交锁定清楚，便于追踪上游 | 默认会引入整个仓库工作树；团队需熟悉子模块 |
| 单独检出指定提交 | 接入脚本与构建布局更灵活 | 必须显式锁定 SHA、校验来源和依赖 |
| Sparse Checkout | 减少工作树中的目录 | 不自动等于只下载部分历史，也不自动形成完整 SDK |
| 固定源码归档 | CI 接入简单 | 校验内容、许可证和构建依赖完整性 |

不要将 sparse checkout 误解为“可以无条件只拿一个目录就完成构建”。

真实依赖可能包含：

```text
公共头文件
第三方依赖配置
CMake 模块
生成脚本
契约文件
许可证与构建信息
```

应提供受控的导出清单或独立构建入口。

### 17.3 锁文件示例

下面只是格式示例，不代表已经存在对应发布版本：

```json
{
  "upstream": "https://github.com/Px-asen/Twilight_Echo",
  "commit": "<full-commit-sha>",
  "musicCoreVersion": "<music-core-version>",
  "audioCoreVersion": "<audio-core-version>",
  "protocolVersion": "<protocol-version>",
  "hostApiVersion": "<host-api-version>",
  "nativeAbiVersion": "<native-abi-version>"
}
```

禁止在可复现发布中使用：

```text
每次构建自动拉最新 main
依赖未锁定分支
只写 latest 而不记录真实产物
```

### 17.4 成熟后：发布可复用产物

主仓的发布内容可以逐步包括：

```text
Music Core bundle
Core contracts / Schema
Host API 规范
Android 原生 AAR 或适当的 NDK 包
iOS XCFramework
类型与基础绑定
测试向量
兼容性清单
构建元信息与校验值
许可证及依赖说明
```

**AAR 或 XCFramework 主要解决原生分发，不会自动包含并正确启动 TS Music Core。**

因此需要区分：

```text
Audio SDK
Music Core bundle
Runtime / Host integration
```

可以在应用中组合，也可以后续提供统一 SDK 包装，但对三者的版本关系必须明确。

### 17.5 版本可以独立，但兼容关系要可追踪

示例：

```text
Desktop App 1.x
  Music Core A
  Audio Core B
  Host API C

Android App 0.x
  Music Core A
  Audio Core B
  Host API C

iOS App 0.x
  Music Core A-1
  Audio Core B-1
  Host API C-1
```

应用可以独立发布和延后升级 Core。

同时应避免过度版本化：不是每个文件夹都需要一个独立版本号。可以先提供一个经过验证的 **Core SDK 组合版本**，内部记录各组成部分版本与提交。

### 17.6 同仓标签与发布边界

可采用类似：

```text
desktop/v...
core/v...
```

的标签区分发布系列。

这是建议命名，不是当前标签事实。

即使标签指向整个仓库提交，也应明确 Core 发布包含哪些目录、产物、变更说明和兼容保证。

### 17.7 升级流程

建议每次移动端升级 Core 都经过：

```text
修改锁定版本
       |
       v
检查协议 / Host API / ABI 兼容
       |
       v
运行共享契约测试
       |
       v
编译与宿主集成测试
       |
       v
真实设备关键回归
       |
       v
应用发布
```

主仓可以触发跨仓集成验证，但不应未经验证自动把移动端生产依赖升级到最新提交。

---

<a id="18-testing"></a>
## 18. 测试、持续集成与独立性验收

### 18.1 “真正独立”的验收定义

| 维度 | 验收条件 |
|---|---|
| 源码依赖 | Core 不直接依赖 Node、Electron、DOM、平台 SDK 和 UI 框架 |
| 传递依赖 | 第三方依赖与打包产物不偷偷要求这些运行环境 |
| 构建 | Core 有独立构建入口，不需要构建整个桌面应用 |
| 运行 | 至少在一种无 Node 的目标 JS 宿主中完成代表性业务闭环 |
| 平台覆盖 | Android 与 iOS 的最小宿主均有实际验证记录 |
| 生命周期 | 创建、关闭、重连、恢复语义明确 |
| 能力注入 | 必需与可选 Port 明确，不靠隐式全局发现平台 |
| 状态一致性 | 共享行为测试在各宿主中结果一致 |
| 发布 | 源码或产物可锁定版本，兼容性可追踪 |
| 桌面回归 | 拆分后桌面现有行为没有被无意改变 |

可以分阶段达成，但不能只完成目录迁移就宣布全部完成。

### 18.2 边界测试

建议自动检查：

```text
禁止 Core 导入平台目录
禁止 Electron / Node 内置模块
禁止不允许的宿主全局
禁止平台专属类型泄漏到公共契约
检查第三方依赖图
检查打包后的外部依赖与动态加载点
```

前面对话提及已有 Core 边界测试，可在核实后扩展，而不是另起一套相互矛盾的规则。

### 18.3 TypeScript 类型环境

可以为可移植 Core 设置专门的类型检查配置，例如：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noEmit": true
  },
  "include": [
    "packages/music-core/**/*.ts",
    "packages/core-contracts/**/*.ts"
  ]
}
```

这是示例：

- `ES2022` 不是已经确认适合所有候选运行时的目标。
- 需要按实际工具链与项目配置调整。
- `types: []` 不会阻止所有显式导入，也不能代替依赖边界测试。
- 类型检查通过不能证明运行时 API 齐全。

### 18.4 测试矩阵

| 测试层 | 主要目的 |
|---|---|
| 纯领域单元测试 | 队列、排序、歌词、模型迁移等确定性规则 |
| Core + Fake Ports | 业务流程、错误、取消、恢复和状态转换 |
| Node Adapter 测试 | 桌面文件、网络、持久化和插件适配 |
| 非 Node 运行时测试 | 验证真正的运行环境独立性 |
| Host 契约测试 | 三端异步、错误、取消、关闭语义一致 |
| 原生引擎测试 | 解码、DSP、时钟、缓冲和输出接口 |
| 跨语言绑定测试 | JNI / C ABI 参数、内存、线程与回调 |
| 应用集成测试 | UI 重建、服务重连、系统控制 |
| 真机测试 | 后台播放、路由、中断、设备兼容 |
| 发布产物测试 | 安装实际生成的 SDK / App 后仍能运行 |

### 18.5 共享行为测试的重点

建议建立同一套测试向量，覆盖：

```text
队列追加、删除、替换、移动
当前曲目被移除后的行为
顺序、随机、单曲循环和列表循环
下一首/上一首边界
加载失败与音源回退
播放中断与恢复
重复命令与状态冲突
Core 重启后的恢复
歌词时间轴
设置与持久化数据迁移
```

随机、时钟和外部结果应可控制，否则不同宿主之间很难判断差异来自业务还是环境。

### 18.6 音频与平台关键回归

覆盖：

```text
播放、暂停、seek、切歌
长时间连续播放
锁屏与后台
UI 销毁和重新连接
系统中断与音频焦点变化
有线 / 蓝牙 / USB 路由变化
不同采样率和输出格式
资源权限失效
不可 seek 的资源
读取或网络中断
大曲库扫描
运行时关闭与回调竞态
```

设备相关测试不能由静态代码分析或单元测试完全代替。

### 18.7 CI 建议

主仓至少逐步建立：

```text
Portable Core 类型与边界检查
Core 单元测试与公共行为测试
Desktop / Node Adapter 回归
非 Node Runtime 测试
Audio Core 的目标平台构建
契约生成与兼容性检查
SDK 构建与包内容检查
```

移动端仓建立：

```text
锁定版本的 Core 集成验证
宿主契约测试
系统媒体集成测试
应用构建与发布产物检查
设备级回归
```

不要求第一天完成完整矩阵，但关键边界应从最早的迁移提交开始受到保护。

### 18.8 诊断与可观测性

建议日志至少关联：

```text
Core 实例
请求 / 命令
业务会话
引擎会话
资源标识
协议与 SDK 版本
平台能力快照
```

错误链应能从 UI 请求追踪到 Core、Adapter 与原生引擎。

不要把凭证、完整敏感路径或插件私有数据无控制地写进诊断日志。

---

<a id="19-migration"></a>
## 19. 渐进迁移路线与阶段门槛

### 19.1 迁移总原则

> 保留已经完成的业务所有权重构；提取平台实现；尽早验证移动端；每一步都保留可运行的桌面版本。

不进行一次性全仓重写，也不以目录变动数量作为进度指标。

### 19.2 阶段 0：固定基线与建立清单

工作：

```text
固定当前提交 SHA
核对真实目录与依赖
记录现有测试结果
列出 Node / Electron / DOM / 原生依赖
标出高风险业务流程
记录现有行为与已知问题
```

交付：

```text
dependency-inventory
port-candidates
baseline-test-report
architecture-boundaries
```

门槛：

能够区分纯业务、平台适配、宿主装配和桌面专属能力，并能解释一个播放命令的完整调用路径。

### 19.3 阶段 1：最小切片与跨平台运行时验证

从一个足够小、但包含异步和状态的业务切片开始，例如：

```text
播放会话命令
最小队列规则
Fake AudioPort
Fake SessionStore
```

分别在：

```text
现有桌面宿主
Android 最小宿主
iOS 最小宿主
```

中验证相同结果。

门槛：

```text
可以创建、执行异步命令、接收事件、关闭与重建。
运行时线程和任务驱动方式明确。
不存在必须由 Node 提供的隐藏运行依赖。
```

这一阶段不要求完整 UI，也不要求全部音频功能。

### 19.4 阶段 2：逐模块迁出 Node 实现

建议按风险递增推进：

```text
配置、时钟、日志
设置与会话持久化
资源和元信息访问
网络与 Provider 能力
数据库和扫描
音频绑定
插件运行时
其他桌面专属能力
```

实际顺序要依据依赖图调整，不机械照搬列表。

每次迁移：

```text
先写或补行为测试
定义最小 Port
迁出 Node 实现
在 Desktop Host 注入
删除 Core 中对应直接依赖
收紧边界检查
```

门槛：

桌面行为保持一致，Core 依赖清单持续缩小，而不是以临时兼容层把 Node 再塞回来。

### 19.5 阶段 3：原生引擎移动端构建验证

可以与阶段 2 并行推进，避免最后才暴露原生依赖问题。

工作：

```text
确认不依赖 N-API 的构建入口
拆清 Android / Linux / iOS / macOS 条件
构建目标平台所需依赖
新增或接入移动端输出后端
建立基础 JNI / C Bridge
```

门槛：

Android 与 iOS 至少都有真实的原生构建与基础运行记录。仅“编译通过”不代替输出、释放和错误路径验证。

### 19.6 阶段 4：建立完整播放闭环

Android：

```text
最小 UI / 测试客户端
-> 系统播放宿主
-> Music Core
-> Audio Port
-> C++ 引擎
-> 输出
-> 状态回传
```

iOS 同时维持最小验证宿主，不必同步开发完整页面。

门槛：

```text
真实资源加载与播放
播放、暂停、seek、结束、错误
UI 重连不重复创建引擎
系统中断能正确反映到 Core
关闭不会留下悬空回调或资源泄漏
```

### 19.7 阶段 5：正式独立打包与跨仓消费

工作：

```text
Core 独立构建入口
Music Core bundle
基础音频 SDK
契约生成或共享分发
版本锁定与兼容清单
移动仓从真实发布方式消费
```

门槛：

移动仓不复制 Core 源码进行修改，也不依赖桌面应用先完成构建。

### 19.8 阶段 6：Android 第一版产品化

优先：

```text
本地播放
播放队列
歌词
基础曲库
设置
后台与系统媒体控制
```

之后再逐步恢复：

```text
网络 Provider
EQ / DSP
AutoMix
更完整的音质诊断
高级设备能力
插件
```

每项能力以平台实际支持为准，不以桌面 UI 中是否已有开关为准。

### 19.9 阶段 7：iOS 产品化与生态扩展

沿用已经稳定的：

```text
共享 Music Core
共享 Audio Core
Host API
协议与公共测试
发布机制
```

在 iOS 仓实现原生 UI、系统宿主与平台适配。

若 iOS 与 Android 出现差异，优先检查 Host 契约与平台能力，不立即复制修改共享业务逻辑。

### 19.10 每个阶段的退出条件

发生下列情况时应暂停扩大重构范围：

```text
关键桌面行为回归但无法定位
Core 新增更多隐式平台依赖
宿主关闭语义未定义
运行时桥接依赖 UI 活着
只能通过复制业务代码绕过边界
跨平台状态不同但没有契约解释
```

这里的“暂停”是先修正当前阶段边界，不是否定长期跨平台目标。

---

<a id="20-ai"></a>
## 20. AI 辅助开发的约束

### 20.1 AI 更适合在明确边界内完成小闭环

用户选择 Compose 的理由之一，是 AI 可以降低原生 UI 的开发和维护难度。

可以利用 AI：

```text
梳理依赖
生成适配层骨架
补充测试
实现页面
生成协议类型
审查导入方向
编写迁移文档
定位回归
```

但不要让 AI 自行推断未写明的业务语义、线程规则和平台权限要求。

### 20.2 建议写进仓库的规则

```text
Core 不得导入平台模块。
平台能力必须经批准的 Port 注入。
UI 不得直接创建或持有原生播放引擎。
共享业务逻辑不得在 Kotlin / Swift 重复实现。
音频回调不得调用 JS 或阻塞等待 UI。
新增协议字段必须更新兼容说明与测试。
新增依赖必须检查目标运行时和传递依赖。
迁移不得静默改变业务行为。
无法确认的平台能力必须标注待验证，不得假设已经支持。
```

这些规则应尽量转成自动检查，而不是只写在说明文件里。

### 20.3 单次任务模板

```text
目标：
从 Core 中迁出某一项明确的平台依赖。

范围：
允许修改的模块、接口和测试。

保持不变：
现有业务行为、对外协议或明确列出的兼容要求。

交付：
Port、Node Adapter、Host 装配、测试、迁移说明。

验收：
列出的测试通过；Core 不再直接或间接引入该平台依赖。

禁止：
批量改名、无关重构、引入第二套状态机、静默改变错误语义。
```

### 20.4 提交与审查建议

把大重构拆成可解释的提交：

```text
补测试
提契约
迁实现
改装配
删旧入口
收紧边界
```

避免一个提交同时替换播放器实现、改变 UI、迁移数据库、重构协议和更换构建系统。

---

<a id="21-open-items"></a>
## 21. 待决事项与架构决策记录

### 21.1 已决与未决分开管理

| 事项 | 状态 | 下一步 |
|---|---|---|
| 主仓维护 Core + Desktop | 已确定 | 写入架构文档与依赖规则 |
| Android 独立仓库 | 已确定 | 选择初始化时机与依赖接入方式 |
| Kotlin + Compose | 已确定 | 建立最小 UI 与宿主客户端 |
| iOS 独立仓库 | 已确定 | 提前建立最小宿主验证 |
| Node 从 Core 拆出 | 已确定 | 依赖审计与渐进迁移 |
| TS Music Core 保留并跨平台复用 | 推荐主路线 | 通过运行时 POC 验证 |
| iOS Swift + SwiftUI | 推荐 | 在 iOS 仓正式建项前确认 |
| JavaScript 引擎 | 未决 | 双平台 POC 与维护成本评估 |
| 一种引擎还是两种引擎 | 未决 | 依据契约与验证结果决定 |
| Host API 形态 | 未决 | 从实际能力切片提炼 |
| Schema / 代码生成工具 | 未决 | 比较现有协议与跨语言需求 |
| SDK 打包边界 | 未决 | 区分 Audio、Music、Runtime |
| 数据库物理实现 | 平台侧未决 | 先确定共享业务与事务语义 |
| 插件跨平台范围 | 未决 | 最小播放稳定后单独评估 |
| 移动端特殊 HiFi 能力 | 未验证 | 用实际设备与输出路径验证 |
| 分发与许可证要求 | 待审查 | 按实际依赖和发布渠道核验 |

### 21.2 建议保留的 ADR

ADR 是架构决策记录，用于解释“为什么如此”，不只是记录“现在用了什么”。

建议主题：

```text
ADR-001 主仓维护共享核心与桌面，移动端独立仓库
ADR-002 Music Core 与 Audio Core 的职责边界
ADR-003 Node 作为平台适配而非 Core 依赖
ADR-004 原生 UI 与共享 JavaScript 业务运行时
ADR-005 状态所有权与系统中断协调
ADR-006 Core Host API 与异步线程模型
ADR-007 协议、ABI 与发布兼容性
ADR-008 插件运行时及安全边界
```

每份记录至少包含：

```text
背景
备选方案
决定
理由
代价
验证结果
何时需要重新评估
```

### 21.3 暂不需要增加的复杂度

当前没有必要因为未来跨平台而立即引入：

```text
微服务
容器编排
远程 RPC 服务
完整插件市场
几十个 Gradle / Swift / TypeScript 子模块
全量业务重写
为了统一语言而引入新语言
跨平台统一 UI
```

当前要解决的是本地应用中的可移植核心和宿主边界，不是分布式服务平台。

---

<a id="22-next"></a>
## 22. 下一步最小执行清单

以下清单适合作为重构起始任务，而不是宣称已经完成。

### 第一组：确认基线

- [ ] 固定要迁移的主仓提交。
- [ ] 核对 `src/core`、Core Host、协议和原生引擎的真实结构。
- [ ] 运行并记录现有测试。
- [ ] 输出直接依赖、传递依赖与隐式宿主全局清单。
- [ ] 画出当前播放命令、状态和资源读取的真实路径。

### 第二组：确定边界

- [ ] 写清 Music Core、Audio Core、Host、Adapter、Bridge、UI 的职责。
- [ ] 确定每类状态的唯一所有者。
- [ ] 标出必需 Port、可选 Port 和桌面专属能力。
- [ ] 明确 Core 创建、关闭、异步回调与错误语义。
- [ ] 添加或收紧自动依赖边界检查。

### 第三组：最小双平台验证

- [ ] 抽取一个不依赖 Node 的业务切片。
- [ ] 在桌面宿主继续跑通。
- [ ] 在 Android 的候选 JS Runtime 中跑通。
- [ ] 在 iOS 的候选 JS Runtime 中跑通。
- [ ] 验证异步任务、事件、取消、关闭与重建，而不只是纯计算。
- [ ] 同时确认 C++ 音频核心的 Android / iOS 构建路径。

### 第四组：建立可持续迁移方式

- [ ] 每次只迁移一个清晰能力。
- [ ] Node 实现进入 Adapter，Core 保留业务语义。
- [ ] 移动端锁定上游版本，不复制长期修改。
- [ ] 共享行为测试进入 CI。
- [ ] 在真实播放闭环稳定前，不承诺完整桌面插件和所有高级音频能力。

### 最终验收问题

> 在不启动 Electron、不要求 Node 运行时、也没有任何 UI 页面存活的条件下，同一份 Music Core 能否由原生宿主驱动，通过注入的能力完成代表性的业务闭环？

再进一步：

> Android 与 iOS 是否都已经用实际宿主验证过这件事，而不仅是理论上可以？

这两个问题，比目录是否叫 `core`、是否新建仓库、是否使用某个架构缩写更重要。

---

<a id="23-appendix"></a>
## 23. 附录：完整议题索引与核验入口

### 23.1 本轮对话的完整议题索引

| 用户阶段 | 核心诉求 | 本文对应位置 |
|---|---|---|
| 发送 GitHub 地址 | 了解项目 | 第 2 节及本附录 |
| 询问是否实时、Star / Fork | 核实仓库动态数据 | 本附录 23.2 |
| 提出 Android 移植与核桥分离 | 选择长期架构 | 第 4、5、7、11 节 |
| 提出 Kotlin + Compose | 原生 Android UI | 第 1、3、11 节 |
| 提出 Android 独立仓库与复用 | 仓库与共享策略 | 第 6、17 节 |
| 说明最新版本已合并 Core | 基于现有成果，不推倒重来 | 第 2、3、19 节 |
| 提出未来 iOS 与独立仓库 | 三端规划 | 第 6、12、17 节 |
| 确定主仓维护 Core + Desktop | 不再单拆 Core 仓库 | 第 1、6、16 节 |
| 决定将 Node 从 Core 拆出 | 真正可移植的业务核心 | 第 7、8、10、18、19 节 |
| 请求完整整理为 Markdown | 形成可执行、可维护的架构文档 | 全文 |

### 23.2 前文项目数据与功能介绍的处理

前面的回答曾给出：

```text
Stars：386
Forks：22
Watchers：1
Commits：1,057
Open Issues：8
Pull Requests：6
```

还曾提及：

```text
10 月 24 日 378 Stars，之后增长 8。
package.json 为 1.4.0-perview。
README 主要介绍 1.3.1。
```

**这些均为前文回答中的说法，本次未核验，不代表当前实时数据，也不作为本方案的依据。** “当前分支”“最新提交”“已发布版本”需要分别核实，不能互相替代。

初始项目介绍曾列出：

```text
FLAC、DSD、WAV 等格式
WASAPI 独占输出
32 段参数均衡器与 DSP
AutoMix / DJ 能力
在线音源与插件
歌词、主题与桌面跨平台构建
Apache 2.0 许可证
```

这些内容在本文中仅作为原对话涉及范围的记录。正式技术规划、平台支持表、许可证和发布说明，应以实际源码、构建配置、测试结果与许可证文件为准。

前文曾提出每日关注 Star / Fork，但用户已明确表示“不用”；本次没有建立任何自动检查或持续监控。

### 23.3 源码核验入口

以下是前面对话提及的入口，供固定提交后核对，不保证当前分支仍保留相同路径。

```text
package.json
README.md

src/core/application.ts
src/core/playback/session.ts

src/main/coreProcess/entry.ts
src/main/coreProcess/supervisor.ts
src/main/coreProcess/windowBridge.ts

src/shared/coreProtocol.ts
src/shared/corePlatform.ts

src/renderer/src/stores/player/corePlayerStore.ts

audio-engine/CMakeLists.txt
audio-engine/include/twilight_audio_engine.h
audio-engine/output/IOutputBackend.h

scripts/core-boundaries.test.cjs
scripts/core-production-runtime.test.cjs

docs/twilight-echo-plugin-spec.md
```

检查顺序建议：

```text
入口与装配
-> 公共协议
-> 业务状态所有权
-> 平台依赖
-> 原生边界
-> 测试与发布
```

### 23.4 官方资料与后续查证入口

以下仅为对话相关的技术资料入口；本次整理没有重新检索，也不代表已核对最新版本。

| 主题 | 入口 |
|---|---|
| 项目仓库 | `https://github.com/Px-asen/Twilight_Echo` |
| Android 架构建议 | `https://developer.android.com/topic/architecture/recommendations` |
| Media3 后台播放 | `https://developer.android.com/media/media3/session/background-playback` |
| Media3 自定义播放器 | `https://developer.android.com/media/media3/session/player` |
| Android 原生音频 | `https://developer.android.com/ndk/guides/audio` |
| Oboe 项目 | `https://github.com/google/oboe` |
| Android 共享媒体访问 | `https://developer.android.com/training/data-storage/shared/media` |
| Apple 音频会话 | `https://developer.apple.com/documentation/avfaudio/avaudiosession` |
| Apple 系统媒体控制 | `https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter` |
| Apple 二进制 Framework 分发 | `https://developer.apple.com/documentation/xcode/distributing-binary-frameworks-as-swift-packages` |

运行时版本、平台政策、系统 API 和依赖支持状态，应在实际选型与发布时重新核对。

---

## 最终结论

Twilight Echo 的目标不是“桌面程序加两个移动端壳”，也不是“把目录改名为 Core”。

更准确的方向是：

> **在当前主仓维护一份真正可移植的 Music Core 和 Audio Core；把 Node.js 留在桌面适配与宿主层；Android、iOS 各自维护原生 UI 和原生宿主，通过受控的运行时、Port 与 Bridge 复用共享核心。**

实施上应遵循：

```text
先核对现状
-> 明确所有权
-> 提取最小 Port
-> 尽早验证双移动平台
-> 渐进迁出 Node
-> 保持桌面回归
-> 稳定 SDK 与跨仓发布
-> 逐步扩展产品能力
```

最需要保留的已有成果，是业务从 UI 转移到 Core 的所有权边界，以及已有的命令、状态和恢复机制。

最需要新增的能力，是明确的宿主契约、真正无 Node 的运行验证，以及三端共享的行为测试。

**核心只维护一份，平台能力各自实现，应用可以独立发布，架构通过测试而不是口头承诺保持独立。**
