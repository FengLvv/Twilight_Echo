# 网易云完整音源与试听

音乐源 `1.1.2` 修复把试听或匹配短片段当成整首播放的问题。

- 按已有音质回退顺序查询官方接口。高音质只有试听时继续查找可授权播放的完整音质；例如优先使用完整无损，而非 Hi-Res 试听。
- 全部官方接口都仅提供试听时，明确报告 `NCM_PLAYBACK_TRIAL_ONLY`。试听地址不进入播放器整曲播放、自动混音准备或后台歌曲缓存。
- 官方返回发行版本授权不足（包括 `-110`）时，报告 `NCM_PLAYBACK_AUTH_REQUIRED`。此时不再查询匹配音源，避免把无授权版本的短片段缓存成整首。
- Core 使用既有 `SOURCE_ACCESS_DENIED` 路径向界面保留可操作的说明，避免错误被吞成一个没有原因的空地址。
- 不自动替换同名的其他发行版本。会员、单曲和数字专辑的具体授权以当前登录账号的官方结果为准。
- 重新登录仍会清空音源内存缓存；应用启动同步内置音乐源时保留独立的账号数据目录。旧缓存无需作为有权播放的证明，正常播放仍会向音源所有者解析当前授权。

验证命令：

```powershell
node --test resources/plugins/ncm-provider/index.test.mjs
node --experimental-strip-types --test --import ./scripts/register-renderer-aliases.mjs src/core/playback/sourceResolver.test.ts src/core/playback/sourceRecovery.test.ts
```

覆盖完整音质优先、仅试听报错、拒绝付费版本匹配回退、不缓存试听、不把试听交给自动混音、字符串 `null` 标记兼容、会员升级、登录切换、取消请求及跨 RPC 的错误说明。
