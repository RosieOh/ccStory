import { describe, expect, it } from 'vitest'
import { extractTemplateVariables, renderTemplate } from '../shared/templates'

describe('extractTemplateVariables', () => {
  it('returns unique names in first-seen order', () => {
    expect(extractTemplateVariables('Hi {{name}}, review {{repo}} for {{name}}')).toEqual([
      'name',
      'repo',
    ])
  })

  it('tolerates whitespace inside braces', () => {
    expect(extractTemplateVariables('{{  goal }} and {{ lang}}')).toEqual(['goal', 'lang'])
  })

  it('returns empty when there are no placeholders', () => {
    expect(extractTemplateVariables('plain prompt')).toEqual([])
  })
})

describe('renderTemplate', () => {
  it('substitutes provided values', () => {
    expect(renderTemplate('Refactor {{file}} in {{lang}}', { file: 'App.tsx', lang: 'TS' })).toBe(
      'Refactor App.tsx in TS',
    )
  })

  it('leaves placeholders for missing or empty values', () => {
    expect(renderTemplate('Hi {{name}}', {})).toBe('Hi {{name}}')
    expect(renderTemplate('Hi {{name}}', { name: '' })).toBe('Hi {{name}}')
  })
})
