/**
 * 把元数据里的封面 MIME 归一化为受支持的扩展名。未知格式回退 jpg，
 * 保证写出的文件一定能被 readCoverDataUrl 读回。
 */
export declare function coverExtension(mime: string | undefined): string
/**
 * 读取 cover-cache 中按条目 id 命名的封面并返回 data URL。
 * entryId 必须是 64 位十六进制（条目稳定 id），防止路径穿越。
 */
export declare function readCoverDataUrl(
  entryId: string,
  coverCacheRoot: string
): Promise<string | null>
