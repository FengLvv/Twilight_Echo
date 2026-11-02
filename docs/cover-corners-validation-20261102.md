# 播放页封面圆角闪变修复

日期：2026-11-02；版本：1.4.0-preview.3。

播放页曾直接把 `CoverImg` 作为分轨／封面 `Transition` 的子节点。异步解析、默认图替换或图片恢复会更换组件内部的根 `img`，也触发 `analysis-view` 动画；宽泛的离场选择器还可能临时取消父容器裁切，图片本身又没有默认圆角，产生短暂直角。

## 修复

- 用稳定的 `.cover-artwork` 包装层承接界面切换动画，图片加载和内部节点替换留在包装层内，不再触发分轨切换动画。
- 包装层与图片继承当前封面的圆角；父容器在分轨离场时允许溢出，图片自身仍保持圆角。保留主题自定义与用户 0px 直角设置。
- 临时取消裁切的选择器仅匹配直接离场的 `.song-analysis-panel`。
- 检查装饰封面时发现四组 `:global(... :deep(...))` 编译后残留无效伪类，整组 CSS 规则被浏览器忽略；改为合法的全局图片选择器，使玻璃、拍立得、唱片及旋转样式可正常应用。

## 验证

- 从真实 `PlayingMusic.vue` 提取封面模板与完整样式，使用真实 `CoverImg` 和可控异步图片解析器运行 Electron 回归。修复前稳定失败：`Bitmap resolution incorrectly triggers the analysis transition`。
- 修复后 32 项封面回退、播放页、分析控件回归通过；Web 类型检查通过。
- 检查首次图片解析、切歌、分轨打开／关闭，覆盖 full／reduced／off 动效。首次加载采样 23 帧，圆角保持，图片加载不含分析动画。
- 默认正方形比例、32px 自定义圆角、玻璃 24px／拍立得 22px 内圆角和唱片 999px 均通过浏览器计算样式检查，用户 0px 设置保留。最终截图已检查。
- Impeccable 仅报告两个原有 spring easing 建议；本轮保留原动效曲线。
- 生产构建、renderer 预算、NSIS、品牌及 255 包依赖闭包检查通过；最终 `app.asar` 已核对稳定包装层与有效裁切样式。验证通过隔离 Electron 页面进行，没有重启用户当前程序。

证据：`.local/cover-corners-20261102/`，包含 `regression-before.log`、`regression-after.log`、`typecheck-web.log`、`package-verification.json` 与 `visual/`。

安装器：`.local/cover-corners-20261102/package/TwilightEcho-1.4.0-preview.3-setup.exe`，133,479,718 字节，SHA-256 `c2414269527cc5c7bd31fb4fc1c28c175b51b41c4739d4090702488862546b35`。包含此前歌单收藏、桌面谱面描边、日语发音修复；没有刷新完整离线 ZIP，也没有 commit／push／GitHub 发布。
