// Snapshot approved visual tokens from this checkout; no runtime host imports.
import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const result = await build({
  stdin: {
    resolveDir: root,
    contents: `
    import { BUILT_IN_THEME_PRESETS, TWILIGHT_DEFAULT_THEME, themeTokensToCssVariables } from '../../src/shared/theme.ts';
    export default Object.fromEntries(BUILT_IN_THEME_PRESETS.map(preset => [preset.id,
      Object.fromEntries(Object.entries(TWILIGHT_DEFAULT_THEME.variants).map(([tone,variant])=> {
        const v=themeTokensToCssVariables({...variant.tokens,...preset.overrides[tone]});
        return [tone,{background:v['--te-player-bg']||v['--te-app-bg'],surface:v['--te-subtle-bg'],hover:v['--te-hover-bg'],text:v['--te-neutral-900'],muted:v['--te-neutral-500'],border:v['--te-card-border'],accent:v['--te-primary-500'],font:v['--te-font-sans'],fontSize:v['--te-font-size-body'],radius:v['--te-card-radius'],lyric:v['--te-playback-lyric-active-text']}];
      }))]));`
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const { default: themes } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
).catch((error) => {
  console.error(error.message)
  process.exit(1)
})
await writeFile(
  new URL('../lib/native-themes.json', import.meta.url),
  JSON.stringify(themes, null, 2) + '\n'
)
console.log(`Copied visual tokens for ${Object.keys(themes).length} native presets into the plugin`)
