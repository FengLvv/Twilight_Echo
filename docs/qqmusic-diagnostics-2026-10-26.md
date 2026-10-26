# QQ 音乐曲尾报错与退出失败排查

## 结论

已修复 Core 退出流程重入、保存超时后重复启动清理，以及“不保存退出”再次被保存门禁拦截的问题。工作区已有的 FLAC 精确样本边界处理也已通过曲尾自动切歌回归，覆盖恢复播放、拖动进度和无缝播放开关。

旧诊断日志确认切歌被 FLAC 解码异常打断；退出截图显示 Core 最终保存未确认。缺少截图当天的日志，历史 Core 阻塞的具体阶段仍未知，但不影响修复已确认的退出流程缺陷。

输入证据：

- `C:/Users/XOS/Downloads/TwilightEcho-diagnostics-2026-10-25T15-11-04-590Z.zip`：环境快照报告已打包版本 `1.3.1`，统一事件截至北京时间 **10 月 25 日 23:11:16**。
- `C:/Users/XOS/Downloads/2026-10-26 22-55-49.mp4`：40.8 秒；歌曲《雪は何色（雪为何色）》停留在曲尾，最后显示“需要处理 / 发生未知错误”。最终画面进度为 `3:25/3:25`，播放按钮已回到停止后的状态。
- 退出截图：屏幕时间为 **10 月 26 日 23:06**；同时显示 `Core did not confirm final persistence` 和 `Core is not ready`。

诊断包早于录屏和退出截图一天，不能把它作为 10 月 26 日 Core 退出过程的日志。

## 切歌失败：异常结束没有进入正常 EOF 路径

诊断包最后一次会话中的两次明确失败如下，时间为北京时间：

| 时间 | 事件 | 结果 |
| --- | --- | --- |
| 10-25 23:07:16.624 | `audio.native / decode_read_failed`，streamToken=10 | 开始两次重连 |
| 10-25 23:07:20.778 | `audio.native / decode.failed` | 两次重连均失败 |
| 10-25 23:07:21.249 | `audio / end-file`、`engine-error` | `reason=error`；`Audio decoder receive failed, code: -1094995529` |
| 10-25 23:09:07.238 | `audio.native / decode_read_failed`，streamToken=20 | 开始两次重连 |
| 10-25 23:09:10.687 | `audio.native / decode.failed` | 两次重连均失败 |
| 10-25 23:09:11.184 | `audio / end-file`、`engine-error` | 同样以 `reason=error` 停止 |

`-1094995529` 是 FFmpeg 的 `AVERROR_INVALIDDATA`。随后渲染器明确记录：

```text
[error] unclassified failure: Audio decoder receive failed, code: -1094995529
[audio-engine] Playback error: Audio decoder receive failed, code: -1094995529
```

最后一次问题标记的缓存状态为：FLAC、源采样率 44,100 Hz、输出 48,000 Hz、`state=stopped`、`playMode=sequential`、位置 `194.7145625` 秒、标称时长 `194.70668934240362` 秒。因此“末尾报错，未自动切到下一首”与日志中的异常结束一致，不是设置成单曲循环。

原生解码错误会先等待有效 PCM 缓冲消耗完再上报。这解释了为什么听起来已经播完、进度也已到末尾，随后才报错。`src/main/audio/playbackController.ts` 将带有 `lastError` 的停止发为 `end-file(reason=error)`；自动续播只接受正常结束，不能直接把所有临近时长的解码异常强行转换为 EOF。

包中没有音频正文，尚不能区分尾部附加数据、损坏帧或解码兼容问题。QQ 插件的 HiRes 音源 404 回退、歌词业务错误和缺少 `isTrackLiked` 也有记录，但实际音频已成功开始播放；它们不是上述原生解码错误的同一条证据链。

## 修复前的退出失败：两条保存流程发生重入

截图中的中文弹窗来自 `src/main/app/lifecycle.ts` 的应用退出处理：等待 `core.shutdown()` 失败后保留进程并显示错误。`src/main/coreProcess/supervisor.ts` 的默认等待预算为 30 秒，超时提示就是 `Core did not confirm final persistence`。这表示未取得最终保存确认，不能据此判定磁盘已满、数据损坏或一定没有保存成功。

英文弹窗来自 `src/main/app/window.ts` 的窗口关闭保存流程。Core 退出开始后，`runtime.forceQuit=true`；这时再次关闭主窗口，会绕过普通 Core 窗口关闭分支，进入另一条 `requestApplicationPersistence()` 路径。它再次调用 Core flush，而 supervisor 在停止过程中拒绝公共请求，返回 `NOT_READY / Core is not ready`。这条可达的重入路径解释了两类弹窗为何可能同时出现。

英文弹窗的 `Quit without saving` 只绕过当前窗口的保存门禁；随后再次调用 `app.quit()` 时，应用级 `before-quit` 仍会要求 Core 完成 shutdown。它不是可靠的应用级强制退出出口。

## 本次修复

- `src/main/app/window.ts`：Core 模式下所有退出型窗口关闭均交给应用级退出处理。重复点击关闭不再启动独立的窗口保存；托盘和迷你播放器偏好保持原有行为。
- `src/main/app/lifecycle.ts`：同一退出操作只保留一个保存任务和一个失败选择框；支持重试、保留窗口、不保存退出。成功保存过的渲染器状态在同一次重试中不重复保存。
- `src/main/app/coreApplication.ts`、`src/main/coreProcess/supervisor.ts`：不保存退出跳过设置写入和最终保存确认，转而停止本应用拥有的 Core、音频、数据库等后台进程，并等待实际退出。未确认进程结束时仍显示可重试的清理错误，不把清理失败报成成功。
- supervisor 保留超时但尚未完成的保存确认任务。重试加入原任务，接受迟到的 ACK，不再次调用 Core shutdown。退出期间继续交付已发出请求的回复；新的公共请求仍被阻止。Core 在退出期间失败不会触发自动重启。
- 保存与清理失败使用共享的中英文提示；不保存退出的改动丢失风险出现在选择框内。真正的解码失败继续使用已有的音频错误分类，而非“未知错误”。

## 验证结果

- 85 项针对性测试通过，覆盖重复关闭、重试、取消、不保存退出、渲染器保存失败、迟到 ACK、Core 异常退出、后台服务退出确认、语言选择、托盘／迷你窗口行为和 Afterglow。
- Windows Electron 实进程冒烟通过：使用实际 `CoreSupervisor`、`CoreApplicationRuntime` 和窗口／应用关闭处理，令 Core 不回复保存确认，再模拟选择“不保存退出”。连续关闭后仅一次保存请求、一个失败选择框、零次旧窗口保存；Core、音频、数据库三个 utility 进程均已退出，主窗口关闭。结果：`tmp/qqmusic-native-quit-smoke/result.json`。
- `twilight_ffmpeg_decoder_unit` 通过，包含 FLAC 尾部附加无效数据、seek 后样本位置和缺失样本仍报错的检查。
- `twilight_audio_performance_gate --verify-flac-tail` 通过：正常／恢复／seek × gapless 开／关，FLAC 44.1 kHz → 共享输出 48 kHz，均自动进入下一首。
- Core、Node、Web 类型检查和本次修改文件的 ESLint 通过；主进程、预加载、渲染器构建通过。构建目录为 `tmp/qqmusic-repair-build/`，最终主进程又从当前源码重建并用于实进程冒烟。

用户现场音源没有提供，尚未对该首 QQ 音源做原字节复测。交付给用户时须重新打包，并一并包含更新的原生音频引擎；仅更新 JavaScript 不能交付 FLAC 解码修复。
