import assert from 'node:assert/strict'
import test from 'node:test'

const { searchRadioBrowserStations } = (await import(
  new URL('./radioBrowserClient.ts', import.meta.url).href
)) as typeof import('./radioBrowserClient.ts')

test('searchRadioBrowserStations maps directory rows and skips broken urls', async () => {
  const rows = [
    {
      stationuuid: 'uuid-1',
      name: '  Jazz FM ',
      url: 'http://stream.example/jazz',
      url_resolved: 'https://cdn.example/jazz',
      homepage: 'https://jazz.example',
      favicon: 'https://jazz.example/icon.png',
      tags: 'jazz,smooth',
      countrycode: 'US',
      bitrate: 128,
      codec: 'MP3',
      votes: 42
    },
    {
      stationuuid: 'uuid-2',
      name: 'Broken',
      url: 'ftp://nope',
      url_resolved: '',
      tags: ''
    }
  ]
  const result = await searchRadioBrowserStations({
    query: 'jazz',
    fetchJson: async () => rows
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'Jazz FM')
  assert.equal(result[0].urlResolved, 'https://cdn.example/jazz')
  assert.deepEqual(result[0].tags, ['jazz', 'smooth'])
  assert.equal(result[0].countryCode, 'US')
})

test('searchRadioBrowserStations returns empty for blank query', async () => {
  const result = await searchRadioBrowserStations({
    query: '   ',
    fetchJson: async () => {
      throw new Error('should not fetch')
    }
  })
  assert.deepEqual(result, [])
})

test('searchRadioBrowserStations tries next mirror after failure', async () => {
  let calls = 0
  const result = await searchRadioBrowserStations({
    query: 'news',
    fetchJson: async () => {
      calls += 1
      if (calls === 1) throw new Error('mirror down')
      return [
        {
          stationuuid: 'u',
          name: 'News',
          url: 'https://news.example/live',
          url_resolved: 'https://news.example/live',
          tags: ''
        }
      ]
    }
  })
  assert.equal(calls, 2)
  assert.equal(result[0].name, 'News')
})
