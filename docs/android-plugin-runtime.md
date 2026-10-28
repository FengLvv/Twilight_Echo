# Android 插件入口

Android 使用与桌面相同的 `plugins.json`、`.tep`、Provider 方法名和 NCM 源码。默认桌面 `main` 不变；移动端入口是可选字段：

```json
{
  "androidRuntime": {
    "apiVersion": 1,
    "entry": "android.js",
    "permissions": ["network", "settings"],
    "networkHosts": ["music.163.com", "interface.music.163.com", "interface3.music.163.com"]
  }
}
```

第一版面向独立 JavaScript Provider。入口是预打包的 ES2015 IIFE，无 Node／Electron、动态模块或下载后原生代码。桌面不读取这个入口，也不会因此改变既有 `main` 加载方式。

共享的仓库兼容性、清单校验、更新判断与包身份／权限核对在 `src/core/plugins/mobileRepository.ts`。Android 的 ZIP、安全 IO、Keystore、隔离进程和 HTTP 属于宿主适配层，不进入共享 Core。

NCM 继续由 `resources/plugins/ncm-provider/index.mjs` 实现。`sdk/plugins/ncm-entry.js` 将它适配到 Android serial ABI v1；`scripts/build-android-plugins.mjs` 复用锁定版本的上游端点模块生成移动包、许可文件、包完整性索引和共享仓库脚本。

```powershell
node scripts/build-android-plugins.mjs
node --experimental-strip-types --test src/core/plugins/mobileRepository.test.ts
```

生成结果在 `dist/android-plugins/`。Android 仓的 `syncAndroidPlugins` 复制 `repository.js`、`catalog.json` 和 `ncm.tep` 到资产目录。修改打包内容时需要更新插件版本；ZIP 时间元数据固定，避免无意义的包校验变化。

Android 的实际入口、运行限制、使用与验收见同级 Android 仓库的 `PLUGINS.md`。发布到远端仓库仍是独立操作；本次没有发布或改变桌面插件索引排除内置 NCM 的规则。
