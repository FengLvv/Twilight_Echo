import assert from 'node:assert/strict'
import test from 'node:test'

const { buildProviderHealthPresentation } = (await import(
  new URL('./providerHealthPresentation.ts', import.meta.url).href
)) as typeof import('./providerHealthPresentation.ts')

const healthy = {
  available: true,
  pluginStatus: 'enabled',
  totalCalls: 10,
  successfulCalls: 10,
  failedCalls: 0,
  successRate: 1,
  methodStats: {
    getPlaybackUrl: {
      totalCalls: 4,
      successfulCalls: 4,
      failedCalls: 0,
      successRate: 1,
      lastError: null,
      lastCheckedAt: '2026-07-02T12:00:00.000Z'
    }
  },
  lastError: null,
  lastCheckedAt: '2026-07-02T12:00:00.000Z'
}

test('provider health presentation reports missing host diagnostics', () => {
  const status = buildProviderHealthPresentation({
    health: undefined,
    loggedIn: true
  })

  assert.equal(status.state, 'warning')
  assert.equal(status.label, '未收到健康状态')
  assert.match(status.detail, /登录、API 和播放 URL 诊断/)
})

test('provider health presentation distinguishes login expiration from generic availability', () => {
  const status = buildProviderHealthPresentation({
    health: {
      ...healthy,
      available: false,
      failedCalls: 1,
      successRate: 0.5,
      lastError: 'login expired'
    },
    loggedIn: false
  })

  assert.equal(status.state, 'error')
  assert.equal(status.reason, 'login-expired')
  assert.equal(status.label, '登录已失效')
  assert.match(status.detail, /登录状态 未登录/)
  assert.match(status.detail, /最近错误 login expired/)
})

test('provider health presentation reports disabled plugins directly', () => {
  const status = buildProviderHealthPresentation({
    health: {
      ...healthy,
      pluginStatus: 'disabled',
      available: false
    },
    loggedIn: true
  })

  assert.equal(status.state, 'error')
  assert.equal(status.reason, 'plugin-disabled')
  assert.equal(status.label, '音源已停用')
})

test('provider health presentation reports plugin failure before call success rate', () => {
  const status = buildProviderHealthPresentation({
    health: {
      ...healthy,
      pluginStatus: 'failed',
      failedCalls: 1,
      successRate: 0.8
    },
    loggedIn: true
  })

  assert.equal(status.state, 'error')
  assert.equal(status.reason, 'plugin-failed')
  assert.equal(status.label, '插件运行失败')
})

test('provider health presentation warns when recent calls failed', () => {
  const status = buildProviderHealthPresentation({
    health: {
      ...healthy,
      totalCalls: 4,
      successfulCalls: 3,
      failedCalls: 1,
      successRate: 0.75,
      lastError: 'playback URL timeout'
    },
    loggedIn: true
  })

  assert.equal(status.state, 'warning')
  assert.equal(status.reason, 'api-degraded')
  assert.equal(status.label, '部分请求失败')
  assert.match(status.detail, /成功率 75%/)
  assert.match(status.detail, /播放 URL 成功率 100%/)
  assert.match(status.detail, /调用 3\/4/)
})

test('provider health presentation reports playback URL success rate separately', () => {
  const status = buildProviderHealthPresentation({
    health: {
      ...healthy,
      methodStats: {
        getPlaybackUrl: {
          totalCalls: 5,
          successfulCalls: 2,
          failedCalls: 3,
          successRate: 0.4,
          lastError: 'stream expired',
          lastCheckedAt: '2026-07-02T12:00:00.000Z'
        }
      }
    },
    loggedIn: true
  })

  assert.equal(status.state, 'warning')
  assert.equal(status.reason, 'playback-url-degraded')
  assert.equal(status.label, '播放 URL 不稳定')
  assert.match(status.detail, /播放 URL 成功率 40%/)
  assert.match(status.detail, /播放 URL 最近错误 stream expired/)
})

test('provider health presentation reports unavailable network or API failures', () => {
  const status = buildProviderHealthPresentation({
    health: {
      ...healthy,
      available: false,
      failedCalls: 3,
      successRate: 0,
      lastError: 'network timeout'
    },
    loggedIn: true
  })

  assert.equal(status.state, 'error')
  assert.equal(status.reason, 'network-or-api-failed')
  assert.equal(status.label, '网络或 API 不可用')
  assert.match(status.detail, /最近错误 network timeout/)
})

test('provider health presentation reports healthy logged in providers as available', () => {
  const status = buildProviderHealthPresentation({
    health: healthy,
    loggedIn: true
  })

  assert.equal(status.state, 'ok')
  assert.equal(status.reason, 'ok')
  assert.equal(status.label, '音源可用')
  assert.match(status.detail, /登录状态 已登录/)
})
