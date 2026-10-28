export type AudioRecoveryKind = 'engine' | 'windows-services'
export type AudioRecoveryPhase =
  | 'idle'
  | 'confirming'
  | 'restarting-engine'
  | 'restarting-services'
  | 'succeeded'
  | 'cancelled'
  | 'failed'

export interface AudioRecoveryState {
  kind: AudioRecoveryKind | null
  phase: AudioRecoveryPhase
  engineAvailable: boolean
  windowsServicesAvailable: boolean
  error: string | null
}

export function audioRecoveryBusy(state: Pick<AudioRecoveryState, 'phase'>): boolean {
  return ['confirming', 'restarting-engine', 'restarting-services'].includes(state.phase)
}

export function validAudioRecoveryPayload(name: string, value: Record<string, unknown>): boolean {
  if (name === 'audio.recovery') return Object.keys(value).length === 0
  return (
    name === 'audio.recovery.start' &&
    Object.keys(value).length === 1 &&
    (value.kind === 'engine' || value.kind === 'windows-services')
  )
}
