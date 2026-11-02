import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

export class AssociationStore {
  constructor(directory) {
    this.directory = directory
    this.file = join(directory, 'associations.json')
    this.entries = new Map()
    this.writes = Promise.resolve()
  }
  async load() {
    try {
      const document = JSON.parse(await readFile(this.file, 'utf8'))
      if (document.version !== 1 || !Array.isArray(document.entries))
        throw new Error('不支持的关联格式')
      this.entries = new Map(
        document.entries.filter(
          ([id, value]) =>
            typeof id === 'string' && value && ['manual', 'auto', 'paused'].includes(value.kind)
        )
      )
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('插件关联数据无法读取，请备份后检查 associations.json', { cause: error })
    }
  }
  get(id) {
    return this.entries.get(id)
  }
  set(id, value) {
    const save = async () => {
      const next = new Map(this.entries)
      next.set(id, value)
      await mkdir(this.directory, { recursive: true })
      const temporary = this.file + '.tmp'
      await writeFile(temporary, JSON.stringify({ version: 1, entries: [...next] }), 'utf8')
      await rename(temporary, this.file)
      this.entries = next
    }
    const pending = this.writes.then(save)
    this.writes = pending.catch(() => {})
    return pending
  }
}
