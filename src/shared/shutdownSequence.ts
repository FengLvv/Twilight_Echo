export interface ShutdownStep {
  name: string
  close(): void | Promise<unknown>
}

/** A failed owner retains its dependants. Repeated close joins or resumes that same step. */
export class ShutdownSequence {
  private cursor = 0
  private pending: Promise<void> | null = null
  private readonly steps: readonly ShutdownStep[]
  constructor(steps: readonly ShutdownStep[]) {
    this.steps = steps
  }
  get current(): string | null {
    return this.steps[this.cursor]?.name ?? null
  }
  close(): Promise<void> {
    return (this.pending ??= this.run().finally(() => {
      this.pending = null
    }))
  }
  private async run(): Promise<void> {
    while (this.cursor < this.steps.length) {
      await this.steps[this.cursor].close()
      this.cursor++
    }
  }
}
