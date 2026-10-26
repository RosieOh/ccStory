#!/usr/bin/env node
/**
 * End-to-end smoke test of the built app (`dist/`, `dist-electron/` — run `vite build`
 * first). Launches Electron with Playwright against a temporary copy of
 * `tests/e2e/fixtures`, drives the UI, and checks the promises unit tests cannot:
 * the window starts, the workers index, search / prompts / stats / plans / Codex work,
 * live updates and archiving react to file changes, the daily backup runs, the renderer
 * logs no errors, and the app writes nothing into the transcript folders.
 *
 *   npm run test:e2e            (Linux CI: xvfb-run -a npm run test:e2e)
 *
 * On failure a screenshot and the main-process log go to `e2e-artifacts/`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)
const artifacts = path.join(root, 'e2e-artifacts')

if (!fs.existsSync(path.join(root, 'dist-electron', 'main.cjs')) || !fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('Build the app first: npx vite build')
  process.exit(1)
}

// Fixtures are copied so the run can append to / delete transcripts like Claude Code does.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-e2e-'))
const claudeHome = path.join(tmp, 'claude')
const codexHome = path.join(tmp, 'codex')
const userData = path.join(tmp, 'user')
fs.cpSync(path.join(root, 'tests', 'e2e', 'fixtures'), tmp, { recursive: true })
const projectDir = path.join(claudeHome, 'projects', '-work-demo')
const sessionA = path.join(projectDir, '0e2e0000-0000-4000-8000-00000000000a.jsonl')
const sessionB = path.join(projectDir, '0e2e0000-0000-4000-8000-00000000000b.jsonl')
const planFile = path.join(claudeHome, 'plans', 'login-validation.md')

/** relPath → size:mtime for every file and directory under the transcript roots. */
function snapshotTree(dirs) {
  const out = new Map()
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      const st = fs.statSync(p)
      out.set(path.relative(tmp, p), e.isDirectory() ? 'dir' : `${st.size}:${st.mtimeMs}`)
      if (e.isDirectory()) walk(p)
    }
  }
  for (const d of dirs) walk(d)
  return out
}
const before = snapshotTree([claudeHome, codexHome])

const env = { ...process.env, CLAUDE_HOME: claudeHome, CODEX_HOME: codexHome, VAULT_USER_DATA: userData, VAULT_DISABLE_UPDATER: '1' }
// VS Code's extension host exports this; with it set Electron starts as plain Node.
delete env.ELECTRON_RUN_AS_NODE
// GitHub's Ubuntu runners cannot set up Chromium's sandbox (unprivileged user namespaces).
const args = process.platform === 'linux' && process.env.CI ? ['--no-sandbox', root] : [root]

const results = []
let app
let page
const mainLog = []
const rendererErrors = []

async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t })
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`)
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t })
    console.log(`  ✗ ${name}\n    ${String(err?.stack ?? err).split('\n').slice(0, 6).join('\n    ')}`)
    throw err
  }
}

/** Polls `fn` until it returns a truthy value. */
async function until(fn, { timeout = 20_000, interval = 200, what = 'condition' } = {}) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${what} (last: ${JSON.stringify(last)})`)
}

const vault = (fn, arg) => page.evaluate(fn, arg)
const nav = (re) => page.getByRole('button', { name: re }).first().click()

let failed = false
try {
  console.log('Claude Vault e2e smoke test')

  await step('window opens', async () => {
    app = await _electron.launch({ executablePath: require('electron'), args, env, timeout: 60_000 })
    app.process().stdout?.on('data', (d) => mainLog.push(String(d)))
    app.process().stderr?.on('data', (d) => mainLog.push(String(d)))
    page = await app.firstWindow()
    page.on('console', (m) => m.type() === 'error' && rendererErrors.push(m.text()))
    page.on('pageerror', (e) => rendererErrors.push(`pageerror: ${e.message}`))
    await page.waitForLoadState('domcontentloaded')
    assert.equal(await page.title(), 'Claude Vault')
  })

  await step('initial index finishes on the workers', async () => {
    const stats = await until(
      async () => {
        const s = await vault(() => window.vault.stats())
        const busy = await vault(() => /색인 중|Indexing/.test(document.body.innerText))
        return !busy && s.totalPrompts >= 3 ? s : null
      },
      { timeout: 60_000, what: 'index' },
    )
    // Two typed prompts in Claude sessions + one in Codex; the tool result is not a prompt.
    assert.equal(stats.totalPrompts, 3)
  })

  await step('search from the UI finds a word that only an answer contains', async () => {
    await nav(/^(검색|Search)$/)
    // Recent-session previews show prompts, not answers: the word must not be on screen yet.
    assert.equal(await page.locator('main').getByText(/zephyrquartz/).count(), 0)
    const input = page.locator('.search-field input')
    await input.fill('zephyrquartz')
    await page.locator('main').getByText(/zephyrquartz/).first().waitFor({ timeout: 15_000 })
    const hits = await vault(() => window.vault.search({ query: '보라색여우', excludeMeta: true, excludeTools: true, limit: 20 }))
    assert.equal(hits?.length, 1, 'Korean token search')
  })

  await step('my prompts lists typed prompts, not tool results', async () => {
    await nav(/^(내 프롬프트|My prompts)$/)
    await page.locator('main').getByText('Explain why the login form rejects valid emails').waitFor({ timeout: 10_000 })
    const rows = await vault(() => window.vault.promptsList({ sort: 'recent', limit: 50 }))
    assert.equal(rows.length, 3)
    assert.ok(!rows.some((r) => /has been updated/.test(r.text)), 'tool result counted as a prompt')
  })

  await step('stats count tokens once per response and price the models', async () => {
    await nav(/^(통계|Stats)$/)
    await page.locator('main').getByText(/claude-opus-5-5/).first().waitFor({ timeout: 10_000 })
    const s = await vault(() => window.vault.stats())
    const opus = s.tokensByModel.find((m) => m.model === 'claude-opus-5-5')
    // Two responses, each one line here; a response repeated over lines would still count once.
    assert.equal(opus?.messages, 2)
    assert.equal(opus?.output, 65)
    // This launch counts as a day the app was opened (roadmap go/no-go measure).
    const p = (n) => String(n).padStart(2, '0')
    const now = new Date()
    assert.deepEqual(s.appOpenDays, [`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`])
    await page.locator('main').getByText(/Vault를 연 날|Days you opened Vault/).waitFor({ timeout: 5_000 })
  })

  await step('plans and Codex sessions are indexed', async () => {
    const plans = await vault(() => window.vault.search({ query: 'plumbagomarker', scope: 'plans', limit: 10 }))
    assert.equal(plans?.length, 1, 'plan hit')
    const projects = await vault(() => window.vault.projectsList())
    assert.ok(
      projects.some((p) => p.tool === 'codex' && /codex-demo/.test(p.displayName)),
      `codex project missing: ${JSON.stringify(projects.map((p) => [p.tool, p.displayName]))}`,
    )
  })

  await step('an appended line shows up live', async () => {
    const line = {
      type: 'user',
      uuid: 'e2e-u9',
      timestamp: '2026-10-04T10:00:00.000Z',
      cwd: '/work/demo',
      message: { role: 'user', content: [{ type: 'text', text: 'one more liveappendword question' }] },
    }
    fs.appendFileSync(sessionA, `${JSON.stringify(line)}\n`)
    await until(
      async () => (await vault(() => window.vault.search({ query: 'liveappendword', limit: 5 })))?.length === 1,
      { timeout: 30_000, what: 'live update' },
    )
  })

  await step('a deleted transcript and a deleted plan stay searchable as archived', async () => {
    fs.rmSync(sessionB)
    fs.rmSync(planFile)
    await until(
      async () => {
        const hits = await vault(() => window.vault.search({ query: 'archivedsentinel', limit: 5 }))
        return hits?.length === 1 && hits[0].archived === true
      },
      { timeout: 30_000, what: 'archived session hit' },
    )
    await until(
      async () => {
        const hits = await vault(() => window.vault.search({ query: 'plumbagomarker', scope: 'plans', limit: 5 }))
        return hits?.length === 1 && hits[0].archived === true
      },
      { timeout: 30_000, what: 'archived plan hit' },
    )
  })

  await step('the daily backup is written after the first scan', async () => {
    const info = await until(async () => {
      const b = await vault(() => window.vault.backupsList())
      return b.items.length ? b : null
    }, { what: 'backup' })
    assert.equal(info.items[0].reason, 'daily')
    assert.ok(info.dir.startsWith(userData), `backups outside userData: ${info.dir}`)
  })

  await step('settings and the other tabs render', async () => {
    for (const re of [/^(파일|Files)$/, /^(즐겨찾기|Favorites)$/, /^(템플릿|Templates)$/, /^(보내기|Export)$/, /^(설정|Settings)$/]) {
      await nav(re)
      await page.waitForTimeout(300)
    }
    await page.getByRole('heading', { name: /^(백업|Backups)$/ }).waitFor({ timeout: 5_000 })
    // The error boundary's fallback title (ErrorBoundary.tsx, `error.title`).
    const crashed = await vault(() => /화면을 그리지 못했어요|Could not render the screen/.test(document.body.innerText))
    assert.equal(crashed, false, 'error boundary visible')
  })

  await step('the renderer logged no errors', async () => {
    assert.deepEqual(rendererErrors, [])
  })

  await step('the app quits cleanly', async () => {
    await Promise.race([
      app.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('app did not quit within 15 s')), 15_000)),
    ])
    app = null
  })

  await step('nothing was written under the transcript roots', async () => {
    const after = snapshotTree([claudeHome, codexHome])
    const touched = new Set([sessionA, sessionB, planFile].map((p) => path.relative(tmp, p)))
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (k) => !touched.has(k) && before.get(k) !== after.get(k) && !(before.get(k) === 'dir' && after.get(k) === 'dir'),
    )
    assert.deepEqual(changed, [])
    // Directory mtimes change when *we* add/remove files; any new entry would be listed above.
  })
} catch {
  failed = true
  fs.mkdirSync(artifacts, { recursive: true })
  try {
    await page?.screenshot({ path: path.join(artifacts, 'failure.png') })
  } catch {
    /* window already gone */
  }
  fs.writeFileSync(path.join(artifacts, 'main.log'), mainLog.join(''))
  fs.writeFileSync(path.join(artifacts, 'renderer-errors.json'), JSON.stringify(rendererErrors, null, 2))
} finally {
  await app?.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} steps passed${failed ? ` — see ${path.relative(root, artifacts)}/` : ''}`)
process.exit(failed ? 1 : 0)
