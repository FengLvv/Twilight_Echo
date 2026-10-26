# QQ 音乐曲尾报错与退出失败排查

## 结论

自动切歌的直接中断点是 FLAC 解码异常，不是正常播放结束。退出截图还显示了独立的 Core 最终保存超时，以及窗口关闭与应用退出两条保存流程发生重入的问题；现有日志不能确定该次 Core 超时卡在哪一步。

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

## 退出失败：最终保存没有确认，另一条关闭流程再次请求保存

截图中的中文弹窗来自 `src/main/app/lifecycle.ts` 的应用退出处理：等待 `core.shutdown()` 失败后保留进程并显示错误。`src/main/coreProcess/supervisor.ts` 的默认等待预算为 30 秒，超时提示就是 `Core did not confirm final persistence`。这表示未取得最终保存确认，不能据此判定磁盘已满、数据损坏或一定没有保存成功。

英文弹窗来自 `src/main/app/window.ts` 的窗口关闭保存流程。Core 退出开始后，`runtime.forceQuit=true`；这时再次关闭主窗口，会绕过普通 Core 窗口关闭分支，进入另一条 `requestApplicationPersistence()` 路径。它再次调用 Core flush，而 supervisor 在停止过程中拒绝公共请求，返回 `NOT_READY / Core is not ready`。这条可达的重入路径解释了两类弹窗为何可能同时出现。

英文弹窗的 `Quit without saving` 只绕过当前窗口的保存门禁；随后再次调用 `app.quit()` 时，应用级 `before-quit` 仍会要求 Core 完成 shutdown。它不是可靠的应用级强制退出出口。

## 优先处理方向

1. **统一 Core 应用退出的单一所有者。** 退出进行中重复关闭窗口，应合并到同一次退出，不再启动窗口级 Core flush。保存失败后保留重试、取消和明确提示风险的不保存退出；后者必须在应用级生效，同时回收本应用拥有的后台服务。
2. **沿用工作区已有的 FLAC 精确样本边界修复。** 当前 `FFmpegDecoder.cpp` 已有只在到达 STREAMINFO 声明样本末尾时容忍尾部无效数据的处理，未提交改动还覆盖 seek 后的位置追踪。`presentError.ts` 也已有原生解码错误分类。这些已有改动不能证明用户当前安装包包含修复，也不能证明录屏中的音源已通过验证。
3. **补取 10 月 26 日本次退出失败后的诊断包。** 需要同一次运行中的 Core 状态、服务退出和在途请求，才能确定最终保存阻塞的具体阶段。10 月 25 日的旧包不能回答这一点。

临时处理应先尝试保留窗口并导出本次日志。若必须结束进程且退出持续失败，可通过任务管理器结束 TwilightEcho；尚未保存的队列、歌单或设置改动可能丢失。
