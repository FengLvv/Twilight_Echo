import type { UiContribution } from './registry.ts'
import type { InstalledExperience } from '../../../shared/pluginExperience.ts'

/** Panel contributions can use the bar itself; legacy commands keep their menu. */
export function resolvePlayerBarExtensions(
  contributions: readonly UiContribution[],
  experiences: readonly InstalledExperience[],
  inlineEnabled: boolean
): { inline: UiContribution[]; menu: UiContribution[] } {
  const buttons = contributions.filter((entry) => entry.kind === 'playerBarButton')
  const panelOwners = new Set(
    experiences.filter((entry) => entry.launch === 'panel').map((entry) => entry.pluginId)
  )
  const inline = inlineEnabled ? buttons.filter((entry) => panelOwners.has(entry.pluginId)) : []
  const inlineEntries = new Set(inline)
  return { inline, menu: buttons.filter((entry) => !inlineEntries.has(entry)) }
}

/** Descriptor refreshes must not dispose a still-mounted, unchanged panel port. */
export function pluginPanelIdentity(experience: InstalledExperience | null): string {
  return experience
    ? JSON.stringify([
        experience.pluginId,
        experience.url,
        experience.bridgeVersion,
        [...experience.permissions].sort()
      ])
    : ''
}
