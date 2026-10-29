import { copyFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { AssociationStore } from '../../core/comments/store.mjs'

/** Copy legacy corrections once; never replace native data or modify the old file. */
export class NativeAssociationStore extends AssociationStore {
  private root: string
  constructor(root: string) {
    super(join(root, 'ncm-comments'))
    this.root = root
  }
  override async load(): Promise<void> {
    await mkdir(join(this.root, 'ncm-comments'), { recursive: true })
    try {
      await copyFile(
        join(this.root, 'plugin-data', 'com.twilightecho.tool.ncm-comments', 'associations.json'),
        join(this.root, 'ncm-comments', 'associations.json'),
        constants.COPYFILE_EXCL
      )
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
    await super.load()
  }
}
