import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, shallowRef, nextTick } from 'vue'
import { useAlbumReleaseDate } from './albumReleaseDate.ts'
import type { GridItem } from './types.ts'

test('album display uses file dates first and withdraws expiring metadata without a page refresh', async () => {
  const scope = effectScope()
  const album = shallowRef<GridItem>({ name: 'Album', releaseDate: '2019', metadataReleaseDate: {
    value: '2020-05-12', attribution: { provider: 'platform.ncm', externalId: '42', url: 'https://music.163.com/#/album?id=42',
      revision: '', attribution: '网易云音乐', license: '', licenseUrl: '', retrievedAt: 1 },
    usage: { display: true, cache: true, crossSource: true, export: false, expiresAt: Date.now() + 200 }
  } })
  const value = scope.run(() => useAlbumReleaseDate(() => album.value))!
  try {
    assert.equal(value.value, '2019')
    album.value = { ...album.value, releaseDate: undefined }
    await nextTick()
    assert.equal(value.value, '2020-05-12')
    await new Promise(resolve => setTimeout(resolve, 220))
    assert.equal(value.value, undefined)
    album.value = { name: 'Another album', releaseDate: '2021-01' }
    await nextTick()
    assert.equal(value.value, '2021-01')
  } finally { scope.stop() }
})
