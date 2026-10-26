import { describe, expect, it } from 'vitest'
import { codexSessionCwd, createCodexLineParser } from '../shared/codexParse'

const rec = (type: string, payload: Record<string, unknown>) =>
  JSON.stringify({ timestamp: '2026-08-31T08:51:50.000Z', type, payload })

describe('Codex rollout parser', () => {
  it('extracts real conversation from response_item records', () => {
    const parse = createCodexLineParser()
    parse(rec('session_meta', { cwd: '/work/app' }))
    parse(rec('turn_context', { cwd: '/work/app', model: 'gpt-5-codex' }))
    const user = parse(
      rec('response_item', { type: 'message', id: 'm1', role: 'user', content: [{ type: 'input_text', text: 'add tests' }] }),
    )!
    expect(user.role).toBe('user')
    expect(user.messageClass).toBe('dialog')
    expect(user.isPrompt).toBe(true)
    expect(user.uuid).toBe('m1')
    expect(user.cwd).toBe('/work/app')
    expect(user.tsMs).toBe(Date.parse('2026-08-31T08:51:50.000Z'))

    const reply = parse(
      rec('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }),
    )!
    expect(reply.role).toBe('assistant')
    expect(reply.text).toBe('done')
    expect(reply.model).toBe('gpt-5-codex')
  })

  it('hides Codex-injected context and developer instructions', () => {
    const parse = createCodexLineParser()
    const env = parse(
      rec('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>\n<cwd>/x</cwd>' }],
      }),
    )!
    expect(env.messageClass).toBe('meta')
    expect(env.isPrompt).toBe(false)
    const dev = parse(rec('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] }))!
    expect(dev.messageClass).toBe('meta')
  })

  it('reads tool calls, patch file paths, and tool output', () => {
    const parse = createCodexLineParser()
    const call = parse(
      rec('response_item', {
        type: 'custom_tool_call',
        name: 'apply_patch',
        input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** End Patch',
      }),
    )!
    expect(call.contentKinds).toEqual(['tool_use'])
    expect(call.filePaths).toEqual(['src/app.ts'])
    const out = parse(
      rec('response_item', { type: 'function_call_output', output: JSON.stringify({ output: 'ok', metadata: {} }) }),
    )!
    expect(out.role).toBe('tool')
    expect(out.text).toBe('ok')
  })

  it('takes usage from token_usage_record once per response, with cached input split out', () => {
    const parse = createCodexLineParser()
    parse(rec('turn_context', { model: 'gpt-5-codex' }))
    const u = parse(
      rec('token_usage_record', {
        response_id: 'resp_1',
        usage: { input_tokens: 1000, cached_input_tokens: 800, cache_write_input_tokens: 0, output_tokens: 50 },
      }),
    )!
    expect(u.usage).toEqual({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 800,
      cacheCreationTokens: 0,
      cacheCreation1hTokens: null,
    })
    expect(u.apiMessageId).toBe('resp_1')
    expect(u.model).toBe('gpt-5-codex')
    // token_count events repeat the same numbers and must not count again.
    expect(parse(rec('event_msg', { type: 'token_count', info: {} }))!.usage).toBeNull()
  })

  it('groups sessions by the session_meta working directory', () => {
    expect(codexSessionCwd(rec('session_meta', { cwd: '/work/app' }))).toBe('/work/app')
    expect(codexSessionCwd(rec('turn_context', { cwd: '/work/app' }))).toBeNull()
    expect(codexSessionCwd('{bad')).toBeNull()
  })
})
