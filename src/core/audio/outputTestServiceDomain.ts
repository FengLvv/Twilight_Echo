import type { CoreOutputTestState } from '../../shared/coreAudio.ts'
import type { OutputTest, OutputTestDependencies } from './outputTestPort.ts'

import type { CoreAudioOutputService } from './outputService.ts'
import type * as Contract from './outputTestServiceContract.ts'

export interface OutputTestServiceCapabilities {
  OutputTest: typeof import('./outputTestPort.ts').OutputTest
}

export function createOutputTestServiceDomain(capabilities: OutputTestServiceCapabilities): {
  CoreOutputTestService: typeof Contract.CoreOutputTestService
} {
  /** Test audio has its own supervised service, never the music queue or history. */
  class CoreOutputTestService {
    private pending = Promise.resolve()
    private active: Promise<{
      cancelled: boolean
    }> | null = null
    private readonly options: OutputTestDependencies & {
      configuration: CoreAudioOutputService
    }
    private current: OutputTest | null = null
    constructor(options: CoreOutputTestService['options']) {
      this.options = options
    }
    state(): CoreOutputTestState {
      return { revision: this.options.configuration.getRevision(), active: this.active !== null }
    }
    private serialize<T>(action: () => Promise<T>): Promise<T> {
      const task = this.pending.then(action)
      this.pending = task.then(
        () => {},
        () => {}
      )
      return task
    }
    async play(revision: number, exclusive: boolean, signal: AbortSignal) {
      let task!: Promise<{
        cancelled: boolean
      }>
      await this.options.configuration.run(revision, signal, () =>
        this.serialize(async () => {
          signal.throwIfAborted()
          if (this.active) throw new Error('测试音正在播放，请稍后再试')
          // Capture the route while native transport is excluded. Do not hold either
          // lane for the note's duration; Pause/Stop must be able to cancel it.
          const context = await this.options.context(exclusive)
          signal.throwIfAborted()
          const test = new capabilities.OutputTest({
            ...this.options,
            context: async () => context
          })
          this.current = test
          task = test.play(exclusive)
          this.active = task
          void task.then(
            () => this.settled(task),
            () => this.settled(task)
          )
        })
      )
      return task
    }
    private settled(
      task: Promise<{
        cancelled: boolean
      }>
    ): void {
      if (this.active === task) this.active = null
      this.options.configuration.changed()
    }
    /** Every accepted native transport finishes test-service exit before dispatch. */
    withTransport<T>(action: () => Promise<T>): Promise<T> {
      return this.serialize(async () => {
        await this.current?.stop()
        return action()
      })
    }
    async stop(): Promise<void> {
      await this.serialize(async () => this.current?.stop())
    }
  }
  return { CoreOutputTestService }
}
