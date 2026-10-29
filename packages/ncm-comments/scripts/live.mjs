import assert from 'node:assert/strict'
import { NcmClient } from '../lib/client.mjs'
const client = new NcmClient()
try {
  const search = await client.search('晴天 周杰伦')
  assert.ok(search.length)
  const song = await client.detail('186016')
  const hot = await client.comments(song.id, 'hot', 0)
  const latest = await client.comments(song.id, 'latest', 0)
  const next = await client.comments(song.id, 'latest', latest.nextOffset)
  assert.ok(hot.items.length && latest.items.length && next.items.length)
  assert.ok(next.nextOffset > latest.nextOffset)
  const avatar = latest.items.find((item) => item.avatarUrl)
  const image = avatar ? await client.image(avatar.avatarUrl) : null
  assert.ok(!avatar || image?.startsWith('data:image/'))
  console.log(
    JSON.stringify(
      {
        date: new Date().toISOString(),
        song: song.id,
        searchCandidates: search.length,
        hot: hot.items.length,
        latest: latest.items.length,
        page2: next.items.length,
        avatar: !!image,
        anonymous: true
      },
      null,
      2
    )
  )
} finally {
  client.close()
}
