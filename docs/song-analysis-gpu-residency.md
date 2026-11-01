# 歌曲分析模型的显存驻留

2026-11-01 更新，已实现并完成 RTX 5080 / Windows 本机验证。

## 行为与所有权

- 六轨和和弦照常后台预热；预热、主分析及人声旋律任务结束后回收本进程未使用的 CUDA 缓存池，不删除模型权重。
- Core 仍是唯一任务调度器。队列有当前或待执行任务时，通过私有 `study.runtimeActivity` 保持 GPU 需求。平台另为模型请求、音源准备和导出持有运行时租约，避免阶段间隙误触发卸载。
- 队列、音源准备和运行时请求都空闲满 30 秒后，将和弦、Duet、BeatThis、TiFA、GAME 转为 CPU，六轨留在 CUDA。两个隔离环境的搬运与各自推理使用同一个串行执行器，不新增任务调度器。
- 新任务撤销尚未执行的卸载；搬运已经开始时完成该状态转换，后续识别按真实设备恢复。缓存读取、分轨播放和谱面显示不要求把和弦模型放回显卡。
- Torch 恢复只搬运同一对象的参数和缓冲，不重新导入 Python、加载权重文件或进行冷预热。ONNX 使用同一 Python 模型包装和 `set_providers` 重建 CPU / DirectML 原生会话；这一步仍有初始化和文件读取开销，不等同于 Torch 张量搬运。部分搬运失败标记 `mixed`，下次推理必须修复后才能使用。
- 统一权重预算为物理显存的一半、最多 4 GiB；另以物理显存四分之一、至少 2 GiB 作为激活空间回收目标。入场前按 LRU 将闲置模型转 CPU，六轨保留。单个权重集不能超过预算。主环境执行非旋律计算前停放人声环境；人声旋律开始前停放主环境的大型可选模型。
- 注册表只持有弱引用，缓存仍是模型的唯一所有者，压力淘汰不会留下注册表强引用。空闲查询不会启动此前未使用的人声环境。
- 不改权重精度、模型、整曲上下文或识别协议。MERT 的派生旋转位置缓存由其所属模块在设备变化时清理，避免遗留旧设备张量；本地源码完整性校验与修改说明同步更新。
- 关闭、切换环境和进程重建会撤销空闲计时并隔离旧回调，不允许旧卸载结果更新新运行时。

`study.runtime` 中 `loaded` 表示已经加载过的功能，可能位于内存；`devices` 显示 `six`、`chords`、`duet`、`beat`、`tifa`、`game` 的 `cpu` / `cuda` / `dml` / `mixed` 位置。`cudaAllocatedBytes` / `cudaReservedBytes` 汇总两个进程的 Torch 分配器；`estimatedDirectMLBytes` 是 ONNX 模型文件大小估计，不是 DirectML 分配器测量。`residentWeightBytes`、`modelBudgetBytes` 和 `activationReserveBytes` 供 Agent 检查预算。这不是整个 GPU 的硬限额，激活、原生提供器、驱动和其他程序仍会额外占用显存。

## 实测

真实歌曲驱动使用《My Friend》整曲，音源在本地。下列为本机单次结果，不是 P95。

| 项目 | 结果 |
|---|---:|
| 预热结束后 CUDA 保留量 | 2,873,098,240 字节，约 2.68 GiB |
| 空闲后 CUDA 实际分配／保留 | 120,172,544 / 182,452,224 字节 |
| 空闲后整卡显存增加量 | 490 MiB，约 0.48 GiB |
| CPU 搬运耗时 | 937 毫秒 |
| 30 秒计时到搬运完成并被观察到 | 约 31.04 秒 |
| CPU → GPU 恢复耗时 | 380 毫秒 |
| 打包应用中再次恢复 | 397 毫秒 |

此前完整常驻策略额外占约 4.34 GiB；释放空闲池后约 3 GiB；空闲 CPU 驻留后约 0.5 GiB。后两者仍保留六轨及 CUDA 运行环境。实际识别时显存会增加。CPU 驻留以增加主内存占用换取空闲显存。

2026-11-01 扩展验证：完整《青花瓷》旋律后，所有可选模型空闲转 CPU，两个 Torch 分配器合计约 122.7 MiB 分配 / 198 MiB 保留，DirectML 权重估计归零；这两个数不代表整卡显存。Duet 入场时和弦自动转 CPU，驻留权重由约 2.62 GiB 转为 1.68 GiB，没有两者叠加；Duet CPU → CUDA 恢复 356 ms，固定噪声的两步去噪输出逐值一致。完整 100 步算法参数没有更改。

## 验证

- 《My Friend》和弦标签及时间边界与上一版完全一致；GPU → CPU → GPU 后重新识别结果完全一致。
- 取消恢复后的识别，再次完成识别正常；六轨和和弦各只加载一次，Python PID 不变。
- 打包应用的《My Friend》→《青花瓷》真实队列预分析通过，完成后自动转 CPU；缓存命中保持 CPU，明确重新识别再恢复 CUDA。
- 6 项虚拟时钟测试覆盖 30 秒阈值、Core 需求、下载／运行时租约、长任务、新任务撤销卸载、关闭代际与 CPU-only 行为。
- Core 回归确认连续阶段之间保持 GPU 需求，最后阶段完成后释放。
- 5 项模型驻留测试覆盖同一对象恢复、取消、搬运中需求变化、CPU fallback 及部分迁移失败后的恢复。
- MERT 派生缓存清理后逐值重建一致；现有原生播放、歌词、和弦与谱面回归通过。
- 正常退出、并发环境初始化与关闭后重新启动运行时通过；三套类型检查、资源闭包、渲染预算和 Windows 打包检查通过。

本机证据：

- `.local/study-residency-evidence/1793458731994/verification.json`
- `output/playwright/study-preload-1793459064833/verification.json`

复现入口为 `scripts/verify-study-residency.mjs` 与 `scripts/verify-study-preloading-ui.mjs`。后者可通过 `TWILIGHT_PRELOAD_VERIFY_EXE` 选择打包程序，并使用独立配置目录。

扩展证据见 [优化验证](song-analysis-optimization-validation.md)；复现入口为 `scripts/verify-study-optimizations.mjs`、`scripts/verify-study-duet-residency.py`。
