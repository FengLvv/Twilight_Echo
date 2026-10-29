import themes from './native-themes.json' with { type: 'json' }
const defaultId = 'builtin:twilight-echo-default'
export function appearanceSettings(settings) {
  const theme = ['dark', 'pureWhite', 'system'].includes(settings.theme) ? settings.theme : 'system'
  const preset = themes[settings.activeTheme?.id] ?? themes[defaultId]
  const palettes = { dark: { ...preset.dark }, pureWhite: { ...preset.pureWhite } }
  const font =
    typeof settings.fontFamily === 'string' && settings.fontFamily !== 'system'
      ? settings.fontFamily.slice(0, 200)
      : null
  if (font) for (const palette of Object.values(palettes)) palette.font = font
  return {
    theme,
    accent: preset[theme === 'dark' ? 'dark' : 'pureWhite'].accent,
    palettes,
    motion:
      settings.motionPreference === 'off' || settings.motionPreference === 'reduced'
        ? 'reduced'
        : 'full'
  }
}
