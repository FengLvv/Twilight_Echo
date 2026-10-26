/**
 * Portable runtime ambient extensions for WinterCG / JS engine hosts
 * where timer handles may be either numeric IDs or objects with optional
 * `.unref()` / `.ref()` lifecycle hooks.
 */
interface Number {
  unref?(): this
  ref?(): this
}
