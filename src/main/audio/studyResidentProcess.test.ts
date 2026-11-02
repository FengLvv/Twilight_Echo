import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { StudyResidentProcess } from './studyResidentProcess.ts'

test('uncooperative inference is joined and terminated before the next runtime starts', { timeout: 35000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'study-supervision-'))
  const script = join(directory, 'runtime.py')
  await writeFile(script, `import sys,os,time,subprocess\nsys.path.insert(0,${JSON.stringify(resolve('resources/music-study'))})\nfrom resident_protocol import serve\nfrom runtime_context import emit\ndef handler(method,params):\n if method=='ignore':\n  child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(600)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)\n  emit(dict(kind='childStarted',pid=child.pid))\n  emit(dict(kind='progress',stage='native call',progress=0))\n  while True: time.sleep(.1)\n return dict(pid=os.getpid())\nserve(handler)\n`)
  const runtime = new StudyResidentProcess(() => process.env.TWILIGHT_TEST_PYTHON || 'python', script)
  try {
    const first = await runtime.call('pid', {})
    assert.equal((await runtime.call('pid', {})).pid, first.pid)
    const controller = new AbortController()
    let childPid = 0
    const request = runtime.call('ignore', {}, controller.signal, event => { if (event.kind === 'childStarted') childPid = event.pid; if (event.kind === 'progress') controller.abort() })
    await assert.rejects(request, error => (error as { code: string }).code === 'RUNTIME_INTERRUPTED')
    assert.equal(runtime.pid, null)
    assert.equal(runtime.recoveryBlocked, false)
    assert.throws(() => process.kill(first.pid, 0))
    assert.ok(childPid > 0)
    assert.throws(() => process.kill(childPid, 0))
    const next = await runtime.call('pid', {})
    assert.notEqual(next.pid, first.pid)
  } finally {
    await runtime.close()
    assert(directory.startsWith(join(tmpdir(), 'study-supervision-')))
    await rm(directory, { recursive: true, force: true })
  }
})
