// Replays scripts/fixtures/portable-core-scenarios.json against the built
// embedded Core. Android replays the same file through QuickJS and its Kotlin
// port bridge (PortableCoreScenarioTest); keep both runners' step semantics equal.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { PortError, createEmbeddedHarness, createFakePlatform } = require('./portable-embedded-harness.cjs')

const CORPUS_PATH = path.join(__dirname, 'fixtures', 'portable-core-scenarios.json')
const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'))

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function expandTracks(value) {
  if (Array.isArray(value)) return value.map(expandTracks)
  if (!isObject(value)) return value
  if (typeof value.$track === 'string') {
    const track = corpus.tracks[value.$track]
    assert.ok(track, `unknown $track ${value.$track}`)
    return structuredClone(track)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandTracks(item)]))
}

function expandSteps(steps) {
  return steps.flatMap((step) => (step.$fragment ? expandSteps(corpus.fragments[step.$fragment]) : [step]))
}

function lookup(context, dotted) {
  return dotted.split('.').reduce((value, key) => (value == null ? undefined : value[key]), context)
}

/** Replaces `{"$from": "snapshot.queue.revision", "$add"?: n}` with values from earlier steps. */
function resolve(value, context) {
  if (Array.isArray(value)) return value.map((item) => resolve(item, context))
  if (!isObject(value)) return value
  if (typeof value.$from === 'string') {
    const found = lookup(context, value.$from)
    assert.notEqual(found, undefined, `$from ${value.$from} is not available`)
    return typeof value.$add === 'number' ? found + value.$add : found
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, context)]))
}

/** Subset match: objects compare listed keys, arrays compare length and each element. */
function mismatch(expected, actual, at = '$') {
  if (isObject(expected) && typeof expected.$approx === 'number') {
    const tolerance = expected.$tolerance ?? 0
    return typeof actual === 'number' && Math.abs(actual - expected.$approx) <= tolerance
      ? null
      : `${at}: expected ${expected.$approx}±${tolerance}, got ${JSON.stringify(actual)}`
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${at}: expected an array, got ${JSON.stringify(actual)}`
    if (actual.length !== expected.length) return `${at}: expected ${expected.length} items, got ${actual.length}`
    for (let i = 0; i < expected.length; i++) {
      const problem = mismatch(expected[i], actual[i], `${at}[${i}]`)
      if (problem) return problem
    }
    return null
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return `${at}: expected an object, got ${JSON.stringify(actual)}`
    for (const [key, item] of Object.entries(expected)) {
      const problem = mismatch(item, actual[key], `${at}.${key}`)
      if (problem) return problem
    }
    return null
  }
  return Object.is(expected, actual) ? null : `${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
}

function assertMatches(expected, actual, label) {
  const problem = mismatch(expected, actual)
  assert.equal(problem, null, `${label}: ${problem}\nactual: ${JSON.stringify(actual).slice(0, 2000)}`)
}

function createPlatform(scenario, context) {
  const platform = createFakePlatform()
  Object.assign(platform.audio, structuredClone(corpus.audio))
  platform.route = structuredClone(corpus.route)
  if (scenario.stored) {
    platform.revision = Number(scenario.stored.revision)
    platform.stored = scenario.stored.raw ?? JSON.stringify(expandTracks(scenario.stored.payload))
  }
  let canned = { statusCode: 404, headers: {}, bodyUtf8: '' }
  platform.setNetwork = (response) => {
    canned = response
  }
  platform.network = ({ url }) => {
    context.lastNetworkUrl = url
    if (canned.fail) throw new PortError(canned.fail.code, canned.fail.message, canned.fail.retryable)
    return canned
  }
  return platform
}

for (const scenario of corpus.scenarios) {
  test(`scenario: ${scenario.name}`, async () => {
    const context = { snapshot: null, value: null, lastNetworkUrl: null }
    const platform = createPlatform(scenario, context)
    let restarts = 0
    const boot = async () => {
      const harness = createEmbeddedHarness({ platform })
      const booted = await harness.boot({ epoch: `scenario-${restarts++}` })
      assert.equal(booted.boot.ok, true, `boot failed: ${booted.boot.error}`)
      return harness
    }
    let h = await boot()

    for (const [index, step] of expandSteps(scenario.steps).entries()) {
      const label = `step ${index} ${JSON.stringify(step).slice(0, 120)}`
      if (step.request) {
        const extra = {}
        for (const key of ['epoch', 'commandId', 'protocolVersion', 'expectedRevision']) {
          if (step[key] !== undefined) extra[key] = resolve(step[key], context)
        }
        const payload = resolve(expandTracks(step.payload ?? {}), context)
        const response = await h.request(step.request, payload, step.kind ?? 'command', extra)
        if (step.expect) assertMatches(step.expect, response, label)
        if (response.ok) {
          context.value = response.value
          if (step.request === 'core.getSnapshot') context.snapshot = response.value
          else if (isObject(response.value?.snapshot)) context.snapshot = response.value.snapshot
        }
      } else if (step.expectSnapshot) {
        context.snapshot = await h.snapshot()
        assertMatches(step.expectSnapshot, context.snapshot, label)
      } else if (step.expectAudio) {
        assertMatches(step.expectAudio, platform.audio, label)
      } else if (step.expectStored) {
        assertMatches(step.expectStored, JSON.parse(platform.stored), label)
      } else if (step.expectNetworkUrl) {
        assert.match(context.lastNetworkUrl ?? '', new RegExp(step.expectNetworkUrl), label)
      } else if (step.platformAudio) {
        Object.assign(platform.audio, step.platformAudio)
      } else if (step.audioEvent) {
        const event = step.audioEvent.type === 'snapshot' && !step.audioEvent.snapshot
          ? { type: 'snapshot', snapshot: { ...platform.audio } }
          : step.audioEvent
        await h.audioEvent(event)
      } else if (step.revoke) {
        for (const resourceId of step.revoke) platform.revoked.add(resourceId)
      } else if (step.network) {
        platform.setNetwork(step.network)
      } else if (step.wait !== undefined) {
        await h.settle({ timersUpToMs: step.wait })
      } else if (step.restart) {
        await h.settle({ timersUpToMs: 50 })
        const stopped = await h.shutdown()
        assert.equal(stopped.ok, true, `shutdown failed: ${stopped.error}`)
        h = await boot()
      } else {
        assert.fail(`${label}: unknown step`)
      }
    }
  })
}
