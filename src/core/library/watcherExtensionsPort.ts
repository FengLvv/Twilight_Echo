export declare const LIBRARY_WATCH_EXTENSIONS: Set<string>
export declare function isWatchableFileExtension(ext: string): boolean
/**
 * Directory move/rename events often arrive without a media extension.
 * Treat non-audio paths as directory-level churn so the root reconciles.
 */
export declare function looksLikeDirectoryEvent(filename: string, fullPath: string): boolean
