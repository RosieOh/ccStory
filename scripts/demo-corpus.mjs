#!/usr/bin/env node
/**
 * Writes a synthetic Claude Code + Codex history for screenshots and demos:
 *   node scripts/demo-corpus.mjs <outDir>
 * creates <outDir>/claude/{projects,plans} and <outDir>/codex/sessions. Every project,
 * prompt and file name is made up — never point screenshots at a real ~/.claude, since
 * the README is public. Seeded, so the same corpus comes out each time; timestamps are
 * relative to today so the Stats tab shows recent activity.
 */
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/demo-corpus.mjs <outDir>')
  process.exit(1)
}

// mulberry32: tiny seeded PRNG, so the corpus (and the screenshots) are reproducible.
let seed = 20261027
const rand = () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)]
const int = (a, b) => a + Math.floor(rand() * (b - a + 1))
let n = 0
const uid = (p) => `${p}-${(++n).toString(16).padStart(8, '0')}-demo`

const DAY = 86_400_000
const now = Date.now()

const projects = [
  {
    cwd: '/work/acme-storefront',
    files: ['src/cart/CartDrawer.tsx', 'src/checkout/useCheckout.ts', 'src/api/client.ts', 'tests/cart.spec.ts'],
    prompts: [
      'The cart drawer flickers when an item is removed. Find out why and fix it',
      'Add a retry with exponential backoff to the checkout API client',
      'Why does the coupon field accept expired codes?',
      'Refactor useCheckout so the address step can be skipped for digital goods',
      'Write a Playwright test for adding and removing cart items',
    ],
  },
  {
    cwd: '/work/payments-api',
    files: ['internal/ledger/ledger.go', 'internal/webhooks/handler.go', 'cmd/server/main.go', 'internal/ledger/ledger_test.go'],
    prompts: [
      'Webhook deliveries are processed twice under load. Make the handler idempotent',
      'Explain how ledger entries are reconciled at the end of the day',
      'Add a migration that backfills the currency column',
      'Make the retry policy for failed payouts configurable',
    ],
  },
  {
    cwd: '/work/data-pipeline',
    files: ['pipeline/extract.py', 'pipeline/transform.py', 'dags/daily_sales.py', 'tests/test_transform.py'],
    prompts: [
      'The daily_sales DAG is slow. Profile the transform step and suggest fixes',
      'Deduplicate orders that arrive from two sources with different ids',
      'Add schema validation before loading into the warehouse',
    ],
  },
  {
    cwd: '/work/mobile-app',
    files: ['app/screens/Home.tsx', 'app/hooks/useOfflineQueue.ts', 'app/navigation/index.tsx'],
    prompts: [
      'Queue actions while offline and replay them when the network is back',
      'The home screen jumps when the banner loads. Reserve its space',
      '오프라인 큐가 앱을 다시 켜도 남아 있게 저장해 줘',
    ],
  },
  {
    cwd: '/work/infra',
    files: ['modules/db/main.tf', 'envs/staging/main.tf', 'modules/db/variables.tf'],
    prompts: [
      'Plan the move of the staging database to the new subnet without downtime',
      'Why does terraform plan want to recreate the parameter group?',
    ],
  },
  {
    cwd: '/work/docs-site',
    files: ['content/guides/getting-started.md', 'astro.config.mjs'],
    prompts: ['Rewrite the getting-started guide for someone who has never used the CLI', 'Add a dark mode toggle to the docs site'],
  },
]

// Prompts people type again and again: they show up as "used N times" in My prompts.
const habits = ['Run the tests and fix any failures', 'Explain this diff before I commit it', 'Summarize what we changed today']

const replies = [
  'Found it: the list re-renders on every store update because the selector returns a new array. Memoizing it removes the flicker.',
  'Here is the change. The client now retries idempotent requests up to three times with exponential backoff and jitter.',
  'The validation only checks the format, not the expiry date. I added the date check and a test for an expired code.',
  'Done. The handler stores the delivery id in a unique index and returns early when it has already been processed.',
  'The slow part is a row-by-row merge. Switching to a vectorized join brings the step from 14 minutes to under one.',
  'I reserved the banner height with a skeleton, so the content no longer shifts when the image arrives.',
  'All 48 tests pass now. Two were failing because of a timezone assumption in the fixtures.',
  'This diff renames the retry option, adds a migration and updates three call sites. Nothing else changes behaviour.',
]
const models = ['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

const write = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

let sessions = 0
for (const p of projects) {
  const slug = p.cwd.replace(/[/.]/g, '-')
  const count = int(4, 9)
  for (let s = 0; s < count; s++) {
    const sessionId = uid('s')
    // Weighted toward recent weeks; weekends quieter.
    let start = now - Math.floor(Math.pow(rand(), 1.6) * 40 * DAY) - int(0, 8) * 3_600_000
    const dow = new Date(start).getDay()
    if ((dow === 0 || dow === 6) && rand() < 0.6) start -= 2 * DAY
    let t = start
    const lines = []
    const turns = int(3, 8)
    for (let i = 0; i < turns; i++) {
      t += int(2, 25) * 60_000
      const prompt = rand() < 0.25 ? pick(habits) : pick(p.prompts)
      const base = { cwd: p.cwd, sessionId, gitBranch: pick(['main', 'main', 'fix/retry', 'feat/offline']) }
      lines.push({ ...base, type: 'user', uuid: uid('u'), timestamp: new Date(t).toISOString(), message: { role: 'user', content: [{ type: 'text', text: prompt }] } })
      const model = pick(models)
      const msgId = uid('msg')
      const requestId = uid('req')
      const usage = (out) => ({
        input_tokens: int(8, 40),
        output_tokens: out,
        cache_read_input_tokens: int(8_000, 60_000),
        cache_creation_input_tokens: int(500, 6_000),
      })
      if (rand() < 0.7) {
        const toolId = uid('toolu')
        const file = `${p.cwd}/${pick(p.files)}`
        t += 4_000
        lines.push({ ...base, type: 'assistant', uuid: uid('a'), requestId, timestamp: new Date(t).toISOString(), message: { id: msgId, role: 'assistant', model, content: [{ type: 'tool_use', id: toolId, name: pick(['Edit', 'Read', 'Edit']), input: { file_path: file, old_string: 'a', new_string: 'b' } }], usage: usage(int(40, 300)) } })
        t += 2_000
        lines.push({ ...base, type: 'user', uuid: uid('u'), timestamp: new Date(t).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'The file has been updated successfully.' }] } })
      }
      t += int(5, 40) * 1_000
      lines.push({ ...base, type: 'assistant', uuid: uid('a'), requestId: uid('req'), timestamp: new Date(t).toISOString(), message: { id: uid('msg'), role: 'assistant', model, content: [{ type: 'text', text: pick(replies) }], usage: usage(int(120, 900)) } })
    }
    write(path.join(out, 'claude', 'projects', slug, `${sessionId}.jsonl`), lines)
    sessions += 1
  }
}

const plans = {
  'storefront-checkout-retries.md': '# Checkout retries\n\n1. Retry idempotent calls with backoff and jitter.\n2. Surface a single error after the last attempt.\n3. Add tests for timeouts and 503s.\n',
  'payments-idempotent-webhooks.md': '# Idempotent webhooks\n\n- Store delivery ids in a unique index.\n- Return 200 for duplicates without re-processing.\n- Alert when the duplicate rate passes 5%.\n',
  'mobile-offline-queue.md': '# Offline queue\n\nPersist queued actions, replay them in order when online, and drop ones the server rejects.\n',
}
for (const [name, body] of Object.entries(plans)) {
  fs.mkdirSync(path.join(out, 'claude', 'plans'), { recursive: true })
  fs.writeFileSync(path.join(out, 'claude', 'plans', name), body)
}

// Codex CLI: two rollouts in the payments project.
for (let i = 0; i < 2; i++) {
  const ts = new Date(now - int(1, 20) * DAY)
  const rec = (type, payload) => ({ timestamp: ts.toISOString(), type, payload })
  const day = ts.toISOString().slice(0, 10).split('-')
  const file = path.join(out, 'codex', 'sessions', ...day, `rollout-${ts.toISOString().slice(0, 19).replace(/:/g, '-')}-demo${i}.jsonl`)
  write(file, [
    rec('session_meta', { id: uid('codex'), cwd: '/work/payments-api' }),
    rec('turn_context', { cwd: '/work/payments-api', model: 'gpt-5.6-sol' }),
    rec('response_item', { type: 'message', id: uid('cm'), role: 'user', content: [{ type: 'input_text', text: pick(['Add structured logging to the payout worker', 'Find dead code in internal/ledger']) }] }),
    rec('response_item', { type: 'message', id: uid('cm'), role: 'assistant', content: [{ type: 'output_text', text: 'Done — see the patch above.' }] }),
    rec('token_usage_record', { response_id: uid('resp'), usage: { input_tokens: 24_000, cached_input_tokens: 18_000, output_tokens: 1_200 } }),
  ])
}

console.log(`demo corpus: ${projects.length} projects, ${sessions} Claude sessions, ${Object.keys(plans).length} plans, 2 Codex sessions → ${out}`)
