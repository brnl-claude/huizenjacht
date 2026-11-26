import { describe, expect, it } from 'vitest'
import { checklistFor, DEFAULT_CHECKLIST } from './checklist'
import { toHouse, type HouseRecord, type Person } from './house'
import { makePdf, pdfDocument, pdfFileName } from './pdfExport'

const people: Person[] = [
  { key: 'bram', naam: 'Bram', kleur: 0 },
  { key: 'sam', naam: 'Sam', kleur: 1 },
]

const record: HouseRecord = {
  id: 'kade-2',
  source: 'manual',
  sourcePath: null,
  report: { adres: 'Kade 2', plaats: 'Delft', vraagprijs: 425000, score: 7.5, advies: 'Bezichtigen' },
  reportBody: '',
  mine: {
    bod: 410000,
    personen: {
      bram: { cijfer: 8, aspecten: { Locatie: 4 }, notities: 'Mooi licht.', checklist: { 'binnen-1': { s: 'probleem', n: 'Vocht in de kelder' } } },
      sam: { cijfer: 7, checklist: { 'binnen-1': { s: 'twijfel', n: 'Muffe geur' } } },
    },
  },
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

function text(node: unknown): string {
  return JSON.stringify(node)
}

describe('pdf export', () => {
  const house = toHouse(record, 'bram', people)
  const categories = checklistFor(house, DEFAULT_CHECKLIST)
  const doc = pdfDocument(house, categories, people, 'bram', new Date('2026-11-25T12:00:00Z'))

  it('has the assessment and every note of everyone', () => {
    const all = text(doc.content)
    expect(all).toContain('Kade 2')
    expect(all).toContain('Mooi licht.')
    expect(all).toContain('Vocht in de kelder')
    expect(all).toContain('Muffe geur')
    expect(all).toContain('Sam')
    expect(all).toContain('onder de vraagprijs')
    for (const category of DEFAULT_CHECKLIST) expect(all).toContain(category.titel)
  })

  it('puts the photo and the map side by side under the address', () => {
    const picture = (w: number) => ({ data: 'data:image/jpeg;base64,AAAA', width: w, height: 100 })
    const withPictures = pdfDocument(house, categories, people, 'bram', new Date(), { photo: picture(300), map: picture(200) })
    expect(text(withPictures.content).match(/data:image\/jpeg/g)).toHaveLength(2)
    expect(text(doc.content)).not.toContain('data:image')
  })

  it('names the file after the house', () => {
    expect(pdfFileName(house)).toBe('Huizenjacht - Kade 2 Delft.pdf')
  })

  it('renders to a PDF', async () => {
    const blob = await makePdf(doc)
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
  }, 30_000)
})
