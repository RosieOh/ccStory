import { describe, expect, it } from 'vitest'
import { extractPromptText, parseJsonlLine } from '../shared/jsonlParse'

const userLine = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'user',
    uuid: 'u-1',
    message: { role: 'user', content: [{ type: 'text', text }] },
    ...extra,
  })

describe('stable keys and response identity', () => {
  it('carries the line uuid so user data can key on it', () => {
    expect(parseJsonlLine(userLine('hi'))!.uuid).toBe('u-1')
  })

  it('records message.id + requestId only on lines that carry usage', () => {
    const p = parseJsonlLine(
      JSON.stringify({
        type: 'assistant',
        uuid: 'a-1',
        requestId: 'req_1',
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_creation_input_tokens: 30,
            cache_creation: { ephemeral_1h_input_tokens: 20, ephemeral_5m_input_tokens: 10 },
          },
        },
      }),
    )!
    expect(p.apiMessageId).toBe('msg_1')
    expect(p.requestId).toBe('req_1')
    expect(p.usage?.cacheCreation1hTokens).toBe(20)
    expect(parseJsonlLine(userLine('hi'))!.apiMessageId).toBeNull()
  })
})

describe('non-conversation lines', () => {
  it('files a typed bookkeeping line that carries a message under meta', () => {
    const p = parseJsonlLine(
      JSON.stringify({
        type: 'api-request-blob',
        hash: 'h',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'internal side request' },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/a.ts' } },
          ],
          usage: { input_tokens: 999 },
        },
      }),
    )!
    expect(p.messageClass).toBe('meta')
    expect(p.role).toBe('unknown')
    expect(p.text.startsWith('[api-request-blob]')).toBe(true)
    // A copy of a request must never count as billable usage or as a file touch.
    expect(p.usage).toBeNull()
    expect(p.filePaths).toEqual([])
    expect(p.isPrompt).toBe(false)
  })

  it('treats isMeta user lines (skill bodies, caveats) as meta, not prompts', () => {
    const p = parseJsonlLine(userLine('Base directory for this skill: …', { isMeta: true }))!
    expect(p.messageClass).toBe('meta')
    expect(p.isPrompt).toBe(false)
  })

  it('keeps untyped legacy lines classified by content', () => {
    const p = parseJsonlLine(JSON.stringify({ role: 'user', message: { content: 'legacy prompt' } }))!
    expect(p.messageClass).toBe('dialog')
    expect(p.isPrompt).toBe(true)
  })
})

describe('human prompts', () => {
  it('marks what the user typed', () => {
    const p = parseJsonlLine(userLine('Fix the login bug'))!
    expect(p.isPrompt).toBe(true)
    expect(p.promptText).toBe('Fix the login bug')
  })

  it('trusts turnOrigin: notifications and peer messages are not the human', () => {
    expect(parseJsonlLine(userLine('looks typed', { turnOrigin: 'task_notification' }))!.isPrompt).toBe(false)
    expect(parseJsonlLine(userLine('looks typed', { turnOrigin: 'peer' }))!.isPrompt).toBe(false)
    expect(parseJsonlLine(userLine('my answer', { turnOrigin: 'sdk' }))!.isPrompt).toBe(true)
    expect(parseJsonlLine(userLine('typed', { turnOrigin: 'human' }))!.isPrompt).toBe(true)
  })

  it('never treats tool results or subagent prompts as the user', () => {
    const tool = parseJsonlLine(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
      }),
    )!
    expect(tool.isPrompt).toBe(false)
    expect(parseJsonlLine(userLine('do the subtask', { isSidechain: true }))!.isPrompt).toBe(false)
  })

  it('strips IDE context blocks and keeps the typed text', () => {
    expect(
      extractPromptText('<ide_opened_file>The user opened a.ts</ide_opened_file>\nexplain this file'),
    ).toBe('explain this file')
    expect(extractPromptText('<ide_selection>x</ide_selection>')).toBeNull()
  })

  it('unwraps pasted content', () => {
    expect(extractPromptText('<pasted_content id="c29e">\nstack trace here\n</pasted_content>\nwhy?')).toBe(
      'stack trace here\n\nwhy?',
    )
  })

  it('drops harness-written user turns', () => {
    for (const t of [
      '<task-notification>\n<task-id>1</task-id>',
      '[Request interrupted by user]',
      '[Workflow harness — computed task] …',
      'This session is being continued from a previous conversation that ran out of context.',
      '<local-command-stdout>ok</local-command-stdout>',
    ]) {
      expect(extractPromptText(t)).toBeNull()
    }
  })

  it('renders slash commands and shell inputs the way they were typed', () => {
    expect(
      extractPromptText(
        '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>PR 12</command-args>',
      ),
    ).toBe('/review PR 12')
    expect(extractPromptText('<command-name>clear</command-name>')).toBe('/clear')
    expect(extractPromptText('<bash-input>git status</bash-input>')).toBe('!git status')
  })
})
