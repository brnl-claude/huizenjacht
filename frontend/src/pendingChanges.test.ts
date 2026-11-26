import { describe, expect, it } from 'vitest'
import { addPending, settlePending, withPending } from './pendingChanges'
import type { HouseRecord } from './house'

const record = { id: 'a', mine: { status: 'nieuw', personen: { me: { cijfer: 6 } } } } as unknown as HouseRecord

describe('pending changes', () => {
  it('keeps a change made while an older one was on its way', () => {
    let all = addPending({}, 'a', { checklist: { x: { s: 'ok' } } })
    const sent = { ...all.a }
    all = addPending(all, 'a', { checklist: { x: { s: 'ok' }, y: { s: 'probleem' } } })
    all = settlePending(all, 'a', sent)
    expect(all.a.checklist).toEqual({ x: { s: 'ok' }, y: { s: 'probleem' } })
    expect(settlePending(all, 'a', all.a)).toEqual({})
  })

  it('shows waiting changes on top of what the server sent', () => {
    const shown = withPending(record, { cijfer: 8, status: 'bezichtigd', favoriet: null }, 'me')
    expect(shown.mine.status).toBe('bezichtigd')
    expect(shown.mine.personen?.me).toEqual({ cijfer: 8 })
  })
})
