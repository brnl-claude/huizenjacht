/**
 * The house as a PDF: the assessment (report verdict, grades, ratings, notes) and the whole
 * checklist with every note. Always in the light colours, compact enough to print.
 */

import type { Content, ContentTable, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces'
import { progress, type ChecklistCategory } from './checklist'
import {
  ASPECTS,
  displayAddress,
  formatDateTime,
  formatEuro,
  formatNumber,
  personInfo,
  place,
  statusInfo,
  type CheckState,
  type House,
  type Person,
  type Personal,
} from './house'
import { personColor } from './ui'

// The light theme of the app.
const C = {
  brand: '#f7a100',
  brandStrong: '#e08e00',
  brandSoft: '#fff4dd',
  text: '#2b2b2b',
  muted: '#666d75',
  faint: '#a3a8ae',
  line: '#e1e1e1',
  surface2: '#f6f6f6',
  link: '#0071b3',
}
const STATE: Record<CheckState, { label: string; color: string; soft: string }> = {
  ok: { label: 'In orde', color: '#2e8540', soft: '#e7f4ea' },
  twijfel: { label: 'Twijfel', color: '#b57200', soft: '#fff3d6' },
  probleem: { label: 'Probleem', color: '#c8322b', soft: '#fde9e7' },
}
const PAGE_WIDTH = 595.28
const MARGIN_X = 36
const WIDTH = PAGE_WIDTH - 2 * MARGIN_X

type Answers = { person: Person; data: Personal; you: boolean }

/** You first, then everyone else who answered something. */
export function answersOf(house: House, people: Person[], me: string): Answers[] {
  const mine: Personal = {
    cijfer: house.mine.cijfer,
    aspecten: house.mine.aspecten,
    notities: house.mine.notities,
    checklist: house.mine.checklist,
  }
  return [
    { person: personInfo(people, me), data: mine, you: true },
    ...house.others.map((o) => ({ person: o as Person, data: o.data, you: false })),
  ]
}

function clean(text: string | undefined): string {
  return (text ?? '').replace(/\r\n/g, '\n').trim()
}

function dot(color: string, size = 7): Content {
  return {
    canvas: [{ type: 'ellipse', x: size / 2, y: size / 2 + 1.5, r1: size / 2, r2: size / 2, color }],
    width: size + 3,
  }
}

function personLabel(a: Answers, bold = true): Content {
  return {
    columns: [dot(personColor(a.person)), { text: a.person.naam, bold, color: C.text, width: 'auto' }],
    columnGap: 0,
  }
}

/** Five small circles, the first `value` filled. */
function rating(value: number | undefined): Content {
  if (!value) return { text: '–', color: C.faint }
  return {
    canvas: [1, 2, 3, 4, 5].map((n) => ({
      type: 'ellipse' as const,
      x: 4 + (n - 1) * 10,
      y: 6,
      r1: 3.6,
      r2: 3.6,
      color: n <= value ? C.brand : '#ffffff',
      lineColor: n <= value ? C.brand : '#c9ccd0',
      lineWidth: 0.8,
    })),
  }
}

function sectionTitle(text: string, extra?: string): Content {
  return {
    stack: [
      {
        text: [
          { text, fontSize: 13, bold: true, color: C.text },
          ...(extra ? [{ text: `   ${extra}`, fontSize: 9, color: C.muted, bold: false }] : []),
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 3, x2: WIDTH, y2: 3, lineWidth: 1.2, lineColor: C.brand }] },
    ],
    margin: [0, 14, 0, 8],
    headlineLevel: 1,
  }
}

const thinLines = {
  hLineWidth: (i: number, node: ContentTable) => (i === 0 || i === node.table.body.length ? 0 : 0.6),
  vLineWidth: () => 0,
  hLineColor: () => C.line,
  paddingLeft: (i: number) => (i === 0 ? 0 : 6),
  paddingRight: () => 0,
  paddingTop: () => 3.5,
  paddingBottom: () => 3.5,
}

function header(house: House, exported: Date): Content[] {
  const sub = [place(house), house.wijk && house.wijk !== house.plaats ? house.wijk : undefined].filter(Boolean).join(' · ')
  const facts: [string, string][] = (
    [
      ['Vraagprijs', house.vraagprijs ? formatEuro(house.vraagprijs) : ''],
      ['Per m²', house.prijsPerM2 ? formatEuro(house.prijsPerM2) : ''],
      ['Wonen', house.woonoppervlakte ? formatNumber(house.woonoppervlakte, 'm²') : ''],
      ['Perceel', house.perceel ? formatNumber(house.perceel, 'm²') : ''],
      ['Kamers', house.kamers ? formatNumber(house.kamers) : ''],
      ['Bouwjaar', house.bouwjaar ? String(house.bouwjaar) : ''],
      ['Energielabel', house.energielabel ?? ''],
      ['Status', statusInfo(house.status).label],
    ] as [string, string][]
  ).filter(([, v]) => v)
  return [
    {
      columns: [
        { text: 'HUIZENJACHT', color: C.brandStrong, bold: true, fontSize: 8, characterSpacing: 1.2 },
        {
          text: `Gemaakt op ${exported.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          alignment: 'right',
          color: C.muted,
          fontSize: 8,
        },
      ],
    },
    { text: displayAddress(house), fontSize: 20, bold: true, margin: [0, 6, 0, 0], color: C.text },
    ...(sub ? [{ text: sub, color: C.muted, fontSize: 10, margin: [0, 1, 0, 0] } as Content] : []),
    ...(facts.length
      ? [
          {
            margin: [0, 10, 0, 0],
            table: {
              widths: facts.map(() => '*'),
              body: [
                facts.map(([k]) => ({ text: k.toUpperCase(), fontSize: 6.5, color: C.muted, characterSpacing: 0.5 })),
                facts.map(([, v]) => ({ text: v, fontSize: 10, bold: true, color: C.text })),
              ],
            },
            layout: {
              fillColor: () => C.surface2,
              hLineWidth: () => 0,
              vLineWidth: () => 0,
              paddingLeft: () => 7,
              paddingRight: () => 4,
              paddingTop: (i: number) => (i === 0 ? 6 : 0),
              paddingBottom: (i: number) => (i === 0 ? 1 : 6),
            },
          } as Content,
        ]
      : []),
  ]
}

function verdict(house: House): Content[] {
  const out: Content[] = []
  const line: Content[] = []
  if (house.score !== undefined) {
    line.push({ text: [{ text: 'Score ', color: C.muted }, { text: house.score.toLocaleString('nl-NL'), bold: true }] })
  }
  if (house.advies) line.push({ text: [{ text: 'Advies ', color: C.muted }, { text: house.advies, bold: true }] })
  if (!line.length && !house.samenvatting && !house.pluspunten?.length && !house.minpunten?.length) return out
  const body: Content[] = [{ text: 'Uit het rapport', bold: true, fontSize: 10, margin: [0, 0, 0, 3] }]
  if (line.length) body.push({ columns: line.map((l) => ({ ...(l as object), width: 'auto' }) as unknown as Content), columnGap: 16 })
  if (house.samenvatting) body.push({ text: clean(house.samenvatting), margin: [0, 4, 0, 0] })
  const list = (title: string, color: string, items: string[]): Content => ({
    stack: [
      { text: title, bold: true, color, margin: [0, 0, 0, 2] },
      { ul: items.map((t) => ({ text: t })), markerColor: color },
    ],
  })
  if (house.pluspunten?.length || house.minpunten?.length) {
    body.push({
      columns: [
        house.pluspunten?.length ? list('Pluspunten', STATE.ok.color, house.pluspunten) : { text: '' },
        house.minpunten?.length ? list('Minpunten', STATE.probleem.color, house.minpunten) : { text: '' },
      ],
      columnGap: 16,
      margin: [0, 6, 0, 0],
    })
  }
  out.push({
    table: { widths: ['*'], body: [[{ stack: body }]] },
    layout: {
      fillColor: () => C.brandSoft,
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 3 : 0),
      vLineColor: () => C.brand,
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 8,
      paddingBottom: () => 8,
    },
    margin: [0, 0, 0, 10],
  })
  return out
}

function assessment(house: House, answers: Answers[]): Content[] {
  const several = answers.length > 1
  const rated = answers.filter((a) => a.data.cijfer || Object.keys(a.data.aspecten ?? {}).length)
  const out: Content[] = [sectionTitle('Beoordeling'), ...verdict(house)]

  if (rated.length) {
    const cols = several ? answers : rated
    const average = (a: Answers) => {
      const values = Object.values(a.data.aspecten ?? {})
      return values.length ? values.reduce((x, y) => x + y, 0) / values.length : undefined
    }
    const body: TableCell[][] = []
    if (several) body.push([{ text: '' }, ...cols.map((a) => personLabel(a))])
    body.push([
      { text: 'Cijfer', bold: true },
      ...cols.map((a) =>
        a.data.cijfer
          ? { text: String(a.data.cijfer), bold: true, fontSize: 12, color: a.data.cijfer >= 8 ? STATE.ok.color : a.data.cijfer >= 6 ? C.text : STATE.probleem.color }
          : { text: '–', color: C.faint },
      ),
    ])
    for (const aspect of ASPECTS) body.push([{ text: aspect }, ...cols.map((a) => rating(a.data.aspecten?.[aspect]))])
    body.push([
      { text: 'Gemiddeld', color: C.muted },
      ...cols.map((a) => {
        const avg = average(a)
        return { text: avg ? `${avg.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} / 5` : '–', color: C.muted }
      }),
    ])
    out.push({
      table: { headerRows: several ? 1 : 0, widths: [130, ...cols.map(() => 80)], body },
      layout: thinLines,
    })
  }

  const facts: string[] = []
  if (house.mine.bezichtiging) facts.push(`Bezichtiging: ${formatDateTime(house.mine.bezichtiging)}`)
  if (house.mine.bod) {
    let offer = `Bod: ${formatEuro(house.mine.bod)}`
    if (house.vraagprijs) {
      const diff = house.mine.bod - house.vraagprijs
      offer += diff >= 0 ? ` (${formatEuro(diff)} boven de vraagprijs)` : ` (${formatEuro(-diff)} onder de vraagprijs)`
    }
    facts.push(offer)
  }
  if (facts.length) out.push({ text: facts.join('     '), margin: [0, 8, 0, 0] })

  const notes = answers.filter((a) => clean(a.data.notities))
  for (const a of notes) {
    out.push({
      margin: [0, 10, 0, 0],
      unbreakable: clean(a.data.notities).length < 600,
      stack: [
        several ? { ...(personLabel(a) as object), margin: [0, 0, 0, 2] } : { text: 'Notities', bold: true, margin: [0, 0, 0, 2] },
        { text: clean(a.data.notities), color: C.text },
      ],
    } as Content)
  }
  if (!rated.length && !notes.length && !facts.length && out.length === 1) {
    out.push({ text: 'Nog geen cijfer, beoordeling of notities.', color: C.muted, italics: true })
  }
  return out
}

function pill(state: CheckState | undefined): Content {
  if (!state) return { text: '–', color: C.faint, alignment: 'center' }
  const s = STATE[state]
  return { text: ` ${s.label} `, color: s.color, background: s.soft, bold: true, fontSize: 8, alignment: 'center' }
}

function progressBar(done: { ok: number; twijfel: number; probleem: number; total: number }): Content {
  if (!done.total) return { text: '' }
  let x = 0
  const parts = (['ok', 'twijfel', 'probleem'] as const).map((k) => {
    const w = (done[k] / done.total) * WIDTH
    const rect = { type: 'rect' as const, x, y: 0, w, h: 5, color: STATE[k].color }
    x += w
    return rect
  })
  return {
    canvas: [{ type: 'rect', x: 0, y: 0, w: WIDTH, h: 5, r: 2.5, color: '#ececec' }, ...parts.filter((p) => p.w > 0)],
    margin: [0, 0, 0, 4],
  }
}

function checklist(categories: ChecklistCategory[], answers: Answers[]): Content[] {
  const several = answers.length > 1
  const mine = answers[0].data.checklist ?? {}
  const p = progress(categories, mine)
  const open = p.total - p.done
  const out: Content[] = [
    sectionTitle('Checklist', several ? undefined : `${p.done} van ${p.total} punten bekeken`),
  ]
  if (several) {
    out.push({
      text: answers.map((a) => {
        const q = progress(categories, a.data.checklist ?? {})
        return `${a.person.naam}: ${q.done} van ${q.total}`
      }).join('   ·   '),
      color: C.muted,
      margin: [0, 0, 0, 4],
    })
  }
  out.push(progressBar(p))
  out.push({
    text: [
      { text: `${p.ok} in orde`, color: STATE.ok.color, bold: true },
      { text: '   ·   ', color: C.faint },
      { text: `${p.twijfel} twijfel`, color: STATE.twijfel.color, bold: true },
      { text: '   ·   ', color: C.faint },
      { text: `${p.probleem} probleem`, color: STATE.probleem.color, bold: true },
      { text: '   ·   ', color: C.faint },
      { text: `${open} open`, color: C.muted },
      ...(several ? [{ text: '   (jouw antwoorden)', color: C.faint }] : []),
    ],
    fontSize: 8.5,
    margin: [0, 0, 0, 4],
  })

  for (const category of categories) {
    if (!category.items.length) continue
    const cp = progress([category], mine)
    const badge = category.fromReport ? 'RAPPORT' : category.fromDocuments ? 'DOCUMENTEN' : ''
    // The category's title shares its row with the names above the answer columns.
    const body: TableCell[][] = [
      [
        {
          text: [
            { text: category.titel, bold: true, fontSize: 10.5 },
            ...(badge
              ? [{ text: `  ${badge}`, fontSize: 6.5, color: category.fromReport ? C.link : '#6b4fa1', bold: true, characterSpacing: 0.5 }]
              : []),
            { text: `   ${cp.done}/${cp.total}`, color: C.muted, fontSize: 8.5 },
          ],
        },
        ...answers.map((a) =>
          several ? ({ ...(personLabel(a) as object), fontSize: 8 } as TableCell) : ({ text: '' } as TableCell),
        ),
      ],
    ]
    for (const item of category.items) {
      const notes: Content[] = []
      for (const a of answers) {
        const n = clean(a.data.checklist?.[item.id]?.n)
        if (!n) continue
        notes.push({
          text: several ? [{ text: `${a.person.naam}: `, bold: true, color: personColor(a.person) }, { text: n }] : n,
          color: '#4a4f55',
          fontSize: 8.5,
          margin: [0, 2, 0, 0],
        })
      }
      const pre = item.vooraf
      const taken = answers.some((a) => a.data.checklist?.[item.id]?.v)
      if (pre && !taken && (pre.oordeel || pre.antwoord)) {
        notes.push({
          text: [
            { text: 'Uit de documenten: ', bold: true, color: C.muted },
            ...(pre.oordeel ? [{ text: `${STATE[pre.oordeel].label.toLowerCase()}. `, color: STATE[pre.oordeel].color }] : []),
            { text: clean(pre.antwoord) },
            ...(pre.bron ? [{ text: ` (bron: ${pre.bron})`, color: C.faint }] : []),
          ],
          color: C.muted,
          italics: true,
          fontSize: 8,
          margin: [0, 2, 0, 0],
        })
      }
      body.push([
        { stack: [{ text: item.tekst, color: C.text }, ...notes] },
        ...answers.map((a) => pill(a.data.checklist?.[item.id]?.s)),
      ])
    }
    out.push({
      margin: [0, 8, 0, 0],
      table: {
        headerRows: 1,
        keepWithHeaderRows: 1,
        dontBreakRows: true,
        widths: ['*', ...answers.map(() => 56)],
        body,
      },
      layout: {
        ...thinLines,
        hLineWidth: (i: number, node: ContentTable) => (i === 0 || i === node.table.body.length ? 0 : i === 1 ? 0.9 : 0.6),
        hLineColor: (i: number) => (i === 1 ? '#c4c8cd' : C.line),
      },
    })
  }
  return out
}

export function pdfDocument(
  house: House,
  categories: ChecklistCategory[],
  people: Person[],
  me: string,
  exported = new Date(),
): TDocumentDefinitions {
  const answers = answersOf(house, people, me)
  const title = [displayAddress(house), house.plaats].filter(Boolean).join(', ')
  return {
    pageSize: 'A4',
    pageMargins: [MARGIN_X, 34, MARGIN_X, 40],
    info: { title: `${title} – Huizenjacht`, creator: 'Huizenjacht' },
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.22, color: C.text },
    content: [...header(house, exported), ...assessment(house, answers), ...checklist(categories, answers)],
    footer: (page, pages) => ({
      columns: [
        { text: title, color: C.faint, fontSize: 7.5 },
        { text: `${page} / ${pages}`, alignment: 'right', color: C.faint, fontSize: 7.5 },
      ],
      margin: [MARGIN_X, 14, MARGIN_X, 0],
    }),
    // A heading never ends up alone at the bottom of a page.
    pageBreakBefore: (node, rest) =>
      Boolean(node.headlineLevel) && rest.getFollowingNodesOnPage().length < (node.headlineLevel === 1 ? 4 : 2),
  }
}

export function pdfFileName(house: House): string {
  const name = [displayAddress(house), house.plaats].filter(Boolean).join(' ')
  return `Huizenjacht - ${name.replace(/[\\/:*?"<>|]+/g, '').trim()}.pdf`
}

/** Android's own WebView cannot save a blob: the server hands the file back as a download. */
function inAndroidWebView(): boolean {
  return /; wv\)/.test(navigator.userAgent)
}

type PdfMake = {
  addVirtualFileSystem: (vfs: unknown) => void
  createPdf: (doc: TDocumentDefinitions) => { getBlob: () => Promise<Blob> }
}

export async function makePdf(doc: TDocumentDefinitions): Promise<Blob> {
  const [lib, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  const pdfMake = ((lib as unknown as { default?: PdfMake }).default ?? lib) as unknown as PdfMake
  pdfMake.addVirtualFileSystem((fonts as unknown as { default?: unknown }).default ?? fonts)
  return pdfMake.createPdf(doc).getBlob()
}

export async function exportPdf(
  house: House,
  categories: ChecklistCategory[],
  people: Person[],
  me: string,
): Promise<void> {
  const blob = await makePdf(pdfDocument(house, categories, people, me))
  const name = pdfFileName(house)
  if (inAndroidWebView()) {
    const response = await fetch(`/api/export?naam=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: blob,
    })
    if (!response.ok) throw new Error(`Downloaden mislukt (${response.status}).`)
    const { url } = (await response.json()) as { url: string }
    location.href = url
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
