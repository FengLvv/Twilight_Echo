import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlayerBarExtensions, pluginPanelIdentity } from './playerBarExtensions.ts'
import type { UiContribution } from './registry.ts'
import type { InstalledExperience } from '../../../shared/pluginExperience.ts'

const button = (pluginId: string, id: string, command?: string): UiContribution => ({
  pluginId,
  id,
  kind: 'playerBarButton',
  title: id,
  command
})
const panel: InstalledExperience = {
  id: 'comments',
  name: 'Comments',
  pluginId: 'comments.plugin',
  version: '0.1.2',
  entry: 'ui/index.html',
  bridgeVersion: 2,
  launch: 'panel',
  url: 'plugin-ui://comments.plugin/0.1.2/ui/index.html',
  permissions: ['network', 'ui:inject']
}

test('panel buttons are inline while command-only extensions remain in the menu', () => {
  const comment = button('comments.plugin', 'comments')
  const legacy = button('old.plugin', 'action', 'old.action')
  const sidebar = { ...button('comments.plugin', 'page'), kind: 'sidebarPage' as const }
  assert.deepEqual(resolvePlayerBarExtensions([comment, legacy, sidebar], [panel], true), {
    inline: [comment],
    menu: [legacy]
  })
})

test('small layouts keep all extensions in their existing menu', () => {
  const comment = button('comments.plugin', 'comments')
  assert.deepEqual(resolvePlayerBarExtensions([comment], [panel], false), {
    inline: [],
    menu: [comment]
  })
})

test('a page belonging to another plugin cannot become a panel button', () => {
  const other = button('other.plugin', 'comments')
  assert.deepEqual(resolvePlayerBarExtensions([other], [panel], true).inline, [])
  assert.deepEqual(
    resolvePlayerBarExtensions(
      [other],
      [{ ...panel, pluginId: 'other.plugin', launch: 'page' }],
      true
    ).inline,
    []
  )
})

test('registry object copies and permission reordering preserve the mounted bridge', () => {
  assert.equal(
    pluginPanelIdentity(panel),
    pluginPanelIdentity({ ...panel, permissions: [...panel.permissions].reverse() })
  )
  assert.notEqual(
    pluginPanelIdentity(panel),
    pluginPanelIdentity({ ...panel, url: panel.url.replace('0.1.2', '0.1.3') })
  )
  assert.notEqual(
    pluginPanelIdentity(panel),
    pluginPanelIdentity({ ...panel, permissions: ['ui:inject'] })
  )
  assert.equal(pluginPanelIdentity(null), '')
})
