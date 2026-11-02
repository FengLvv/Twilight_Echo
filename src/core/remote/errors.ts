/** Transport-neutral command failure; HTTP hosts translate status at their boundary. */
export class RemoteCommandError extends Error {
  readonly status: number
  constructor(message: string, status = 503) {
    super(message)
    this.status = status
  }
}
