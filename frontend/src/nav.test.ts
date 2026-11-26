import { describe, expect, it } from 'vitest'
import { chainOf, normalise, parentOf, plan } from './nav'

describe('hierarchical navigation', () => {
  it('knows the parent of each page', () => {
    expect(parentOf('#/huis/laan-1/checklist')).toBe('#/huis/laan-1')
    expect(parentOf('#/huis/laan-1/overzicht')).toBe('#/')
    expect(parentOf('#/instellingen/checklist')).toBe('#/instellingen')
    expect(parentOf('#/instellingen')).toBe('#/')
    expect(parentOf('')).toBeNull()
    expect(normalise('#/huis/laan-1/overzicht')).toBe('#/huis/laan-1')
    expect(chainOf('#/huis/laan-1/rapport')).toEqual(['#/', '#/huis/laan-1', '#/huis/laan-1/rapport'])
  })

  it('replaces between tabs and goes back to the overview', () => {
    expect(plan('#/huis/a', '#/huis/a/checklist', '#/')).toEqual({ kind: 'push', hashes: ['#/huis/a/checklist'] })
    expect(plan('#/huis/a/checklist', '#/huis/a/rapport', '#/huis/a')).toEqual({ kind: 'replace' })
    expect(plan('#/huis/a/rapport', '#/huis/a/overzicht', '#/huis/a')).toEqual({ kind: 'back' })
    expect(plan('#/vergelijk', '#/instellingen', '#/')).toEqual({ kind: 'replace' })
    expect(plan('#/instellingen', '#/', '#/')).toEqual({ kind: 'back' })
  })

  it('puts the overview under a tab opened from elsewhere', () => {
    expect(plan('#/', '#/huis/a/checklist', null)).toEqual({ kind: 'push', hashes: ['#/huis/a', '#/huis/a/checklist'] })
    expect(plan('#/instellingen', '#/huis/a/checklist', '#/')).toEqual({
      kind: 'push',
      hashes: ['#/huis/a', '#/huis/a/checklist'],
    })
  })

  it('goes up to all houses from a page that came from somewhere else', () => {
    expect(plan('#/instellingen', '#/', '#/huis/a')).toEqual({ kind: 'push', hashes: ['#/'] })
    expect(plan('#/vergelijk', '#/', '#/huis/a/checklist')).toEqual({ kind: 'push', hashes: ['#/'] })
    expect(plan('#/huis/a/checklist', '#/', '#/huis/a')).toEqual({ kind: 'push', hashes: ['#/'] })
  })
})
