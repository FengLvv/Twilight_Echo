# 桌面歌词局部描边变粗修复

日期：2026-11-02。版本：1.4.0-preview.3。

用户截图中的《汪洋与浩渺》「无垠空间回声万千那句呼唤仍在耳边」在简谱模式下出现粗黑边，部分休止符 `0` 也变粗，而改写后的音符数字仍是细边。

根因是 LilyPond 把歌词和休止符包在 SVG `tspan` 中。已有 `text` 样式设定 `vector-effect: non-scaling-stroke`，但该属性默认不继承，子层把 1px 描边按 SVG 比例放大。可发声音符在前端改写时移除了 `tspan`，造成同一行局部差异。不是字体字重或用户设置发生变化。

在 `LyricRhythmicScore.vue` 与 `VocalStaffScore.vue` 中让 `tspan` 继承父级的矢量效果，保留既有字体、配色、描边开关、谱面与音符时间。

验证：

- 将真实休止符／歌词的嵌套 `tspan` 加入 Electron 回归，修复前稳定失败：`SVG outline scales with the score: tspan 0`。
- 修复后 14 项回归通过，包括桌面主题、翻译颜色、描边开关、横竖排／任务栏、简谱／五线谱及 AMLL 主唱映射。
- 只读提取同一真实谱面，在同尺寸、字体、配色下进行修复前后截图。18 个子文字层从默认缩放变为不缩放，粗黑边消失；无需重分析或重排已有谱面。证据：`.local/desktop-outline-fix-20261102/before.png`、`after.png`、`styles-before.json`、`styles-after.json`。
- Impeccable 扫描仅提示已有 Inter 字体的通用审美警告；按本次范围保留原字体。没有新增设计警告或 UI 控件。
- 生产构建、renderer 预算、品牌与 255 包依赖闭包检查通过，并从最终 `app.asar` 核对两类谱面均带修复样式。
- 未改写日常设置或重启用户正在使用的程序；验证使用隔离 Electron 页面，非用户桌面原窗口。

最新安装器：`.local/desktop-outline-fix-20261102/package/TwilightEcho-1.4.0-preview.3-setup.exe`，133,478,652 字节，SHA-256 `ceb43b56ada9e0278dbb99fe7a1a35a43ebf7cffd843df8b3b164d51e17af1ba`。包含上一轮日语长音修复，不含完整模型；旧完整离线 ZIP 未更新。更新并重启后现有谱面直接使用新样式。
