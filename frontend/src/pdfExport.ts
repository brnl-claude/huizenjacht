/**
 * The house as a PDF: the assessment (report verdict, grades, ratings, notes) and the whole
 * checklist with every note, with the main photo and a small map at the top. Always in the light
 * colours, compact enough to print.
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
import { icon, type IconName } from './pdfIcons'
import { houseMap, housePhoto, type Picture } from './pdfImages'
import { personColor } from './ui'

// The light theme of the app.
const C = {
  brand: '#f7a100',
  brandStrong: '#e08e00',
  brandSoft: '#fff4dd',
  lens: '#0a3d73',
  text: '#2b2b2b',
  muted: '#666d75',
  faint: '#a3a8ae',
  line: '#e6e6e6',
  surface2: '#f6f6f6',
  link: '#0071b3',
  linkSoft: '#e6f1f8',
  purple: '#6b4fa1',
  purpleSoft: '#efeaf8',
}
const STATE: Record<CheckState, { label: string; color: string; soft: string; icon: IconName }> = {
  ok: { label: 'In orde', color: '#2e8540', soft: '#e7f4ea', icon: 'check' },
  twijfel: { label: 'Twijfel', color: '#b57200', soft: '#fff3d6', icon: 'circleQuestionMark' },
  probleem: { label: 'Probleem', color: '#c8322b', soft: '#fde9e7', icon: 'triangleAlert' },
}
const TONES: Record<string, [string, string]> = {
  neutral: [C.surface2, C.text],
  blue: [C.linkSoft, C.link],
  orange: [C.brand, '#ffffff'],
  purple: [C.purpleSoft, C.purple],
  green: [STATE.ok.soft, STATE.ok.color],
  muted: [C.surface2, C.muted],
}
const ENERGY: Record<string, string> = {
  A: '#009a3e',
  B: '#52b153',
  C: '#b7cf33',
  D: '#f2e600',
  E: '#f6b100',
  F: '#e8601d',
  G: '#d81f26',
}
const ASPECT_ICONS: Record<string, IconName> = {
  Locatie: 'mapPin',
  'Ruimte en indeling': 'layoutPanelLeft',
  'Staat van onderhoud': 'wrench',
  Licht: 'sun',
  Buitenruimte: 'trees',
  'Prijs/kwaliteit': 'scale',
}
const CATEGORY_ICONS: Record<string, IconName> = {
  omgeving: 'mapPinned',
  buiten: 'house',
  binnen: 'sofa',
  installaties: 'plugZap',
  keuken: 'cookingPot',
  energie: 'leaf',
  vragen: 'messageCircleQuestionMark',
}
const PAGE_WIDTH = 595.28
const MARGIN_X = 36
const WIDTH = PAGE_WIDTH - 2 * MARGIN_X
const GAP = 10
/** The photo and the map side by side under the address. */
export const PICTURES = {
  height: 178,
  photoWidth: Math.round((WIDTH - GAP) * 0.62),
  mapWidth: Math.round((WIDTH - GAP) * 0.38),
  fullWidth: Math.round(WIDTH),
}

export type Pictures = { photo?: Picture | null; map?: Picture | null }
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

/** An icon in a soft rounded square, like the app's icon buttons. */
function badgeIcon(name: IconName, size = 18, color = C.brandStrong, soft = C.brandSoft): Content {
  const inner = Math.round(size * 0.58)
  return {
    width: size,
    stack: [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: size, h: size, r: size * 0.28, color: soft }] },
      { ...(icon(name, color, inner) as object), relativePosition: { x: (size - inner) / 2, y: -size + (size - inner) / 2 } } as Content,
    ],
  }
}

/** Text after an icon, both on one line. */
function withIcon(name: IconName, color: string, text: Content, size = 9, gap = 4): Content {
  return {
    columns: [{ ...(icon(name, color, size) as object), margin: [0, 1, 0, 0] } as Content, { ...(text as object), width: '*' } as unknown as Content],
    columnGap: gap,
  }
}

/** Five stars, the first `value` filled. */
function rating(value: number | undefined): Content {
  if (!value) return { text: '–', color: C.faint }
  return {
    columns: [1, 2, 3, 4, 5].map((n) => ({
      ...(icon('star', n <= value ? C.brand : '#cdd0d4', 9, 1.6, n <= value ? C.brand : 'none') as object),
      margin: [0, 1, 0, 0],
    })) as Content[],
    columnGap: 2,
  }
}

function sectionTitle(name: IconName, text: string, extra?: string): Content {
  return {
    stack: [
      {
        columns: [
          badgeIcon(name, 20),
          {
            width: '*',
            margin: [0, 3, 0, 0],
            text: [
              { text, fontSize: 13, bold: true, color: C.text },
              ...(extra ? [{ text: `   ${extra}`, fontSize: 9, color: C.muted, bold: false }] : []),
            ],
          },
        ],
        columnGap: 8,
      },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 5, x2: WIDTH, y2: 5, lineWidth: 0.8, lineColor: C.line },
          { type: 'line', x1: 0, y1: 5, x2: 48, y2: 5, lineWidth: 2, lineColor: C.brand },
        ],
      },
    ],
    margin: [0, 16, 0, 9],
    headlineLevel: 1,
  }
}

const thinLines = {
  hLineWidth: (i: number, node: ContentTable) => (i === 0 || i === node.table.body.length ? 0 : 0.6),
  vLineWidth: () => 0,
  hLineColor: () => C.line,
  paddingLeft: (i: number) => (i === 0 ? 0 : 6),
  paddingRight: () => 0,
  paddingTop: () => 4,
  paddingBottom: () => 4,
}

/** A soft box around content, with a coloured bar on the left. */
function card(content: Content, fill: string, bar?: string, padding = 10): Content {
  return {
    table: { widths: ['*'], body: [[content]] },
    layout: {
      fillColor: () => fill,
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 && bar ? 3 : 0),
      vLineColor: () => bar ?? fill,
      paddingLeft: () => padding,
      paddingRight: () => padding,
      paddingTop: () => padding - 2,
      paddingBottom: () => padding - 2,
    },
  }
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="${C.brand}"/><path d="M14 30 32 15l18 15" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 28v19a3 3 0 0 0 3 3h11" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="40" cy="39" r="7.5" fill="none" stroke="${C.lens}" stroke-width="5"/><path d="m45.5 44.5 6 6" stroke="${C.lens}" stroke-width="5.5" stroke-linecap="round"/></svg>`

function brandLine(exported: Date): Content {
  return {
    columns: [
      { svg: LOGO, width: 15, height: 15 },
      {
        width: 'auto',
        margin: [5, 1.5, 0, 0],
        text: [
          { text: 'huizen', color: C.text },
          { text: 'jacht', color: C.brandStrong, bold: true },
        ],
        fontSize: 11,
      },
      {
        width: '*',
        alignment: 'right',
        margin: [0, 3, 0, 0],
        color: C.muted,
        fontSize: 8,
        text: `Huisrapport  ·  ${exported.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      },
    ],
    columnGap: 0,
  }
}

/** A short label on a coloured background, as wide as its text. */
function chip(text: string, fill: string, color: string, fontSize = 8.5, margin = [0, 0, 0, 0]): Content {
  return {
    width: 'auto',
    margin,
    table: { body: [[{ text, bold: true, fontSize, color }]] },
    layout: {
      fillColor: () => fill,
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 3,
      paddingBottom: () => 2,
    },
  } as unknown as Content
}

function statusPill(house: House): Content {
  const s = statusInfo(house.status)
  const [fill, color] = TONES[s.tone] ?? TONES.neutral
  return chip(s.label, fill, color, 8.5, [0, 9, 0, 0])
}

function pictures({ photo, map }: Pictures): Content[] {
  const image = (p: Picture): Content => ({ image: p.data, width: p.width, height: p.height })
  if (photo && map) return [{ columns: [image(photo), image(map)], columnGap: GAP, margin: [0, 12, 0, 0] }]
  const one = photo ?? map
  return one ? [{ ...(image(one) as object), margin: [0, 12, 0, 0] } as Content] : []
}

function facts(house: House): Content[] {
  const label = house.energielabel?.trim().toUpperCase()
  const energy = label ? ENERGY[label[0]] : undefined
  const list: [IconName, string, Content | string][] = (
    [
      ['euro', 'Vraagprijs', house.vraagprijs ? formatEuro(house.vraagprijs) : ''],
      ['tag', 'Per m²', house.prijsPerM2 ? formatEuro(house.prijsPerM2) : ''],
      ['rulerDimensionLine', 'Wonen', house.woonoppervlakte ? formatNumber(house.woonoppervlakte, 'm²') : ''],
      ['landPlot', 'Perceel', house.perceel ? formatNumber(house.perceel, 'm²') : ''],
      ['doorOpen', 'Kamers', house.kamers ? formatNumber(house.kamers) : ''],
      ['bedDouble', 'Slaapkamers', house.slaapkamers ? formatNumber(house.slaapkamers) : ''],
      ['calendar', 'Bouwjaar', house.bouwjaar ? String(house.bouwjaar) : ''],
      [
        'zap',
        'Energielabel',
        label
          ? energy
            ? chip(label, energy, label[0] === 'D' ? C.text : '#ffffff', 9.5, [0, 1.5, 0, 0])
            : label
          : '',
      ],
    ] as [IconName, string, Content | string][]
  ).filter(([, , v]) => v)
  if (!list.length) return []
  const perRow = 4
  const cell = ([name, key, value]: [IconName, string, Content | string]): TableCell => ({
    columns: [
      { ...(badgeIcon(name, 22) as object), margin: [0, 1, 0, 0] } as Content,
      {
        width: '*',
        stack: [
          { text: key.toUpperCase(), fontSize: 6.5, color: C.muted, characterSpacing: 0.5 },
          typeof value === 'string' ? { text: value, fontSize: 10.5, bold: true, color: C.text } : value,
        ],
      },
    ],
    columnGap: 7,
  })
  const rows: TableCell[][] = []
  for (let i = 0; i < list.length; i += perRow) {
    const row = list.slice(i, i + perRow).map(cell)
    while (row.length < perRow) row.push({ text: '' })
    rows.push(row)
  }
  return [
    {
      margin: [0, 12, 0, 0],
      table: { widths: Array(perRow).fill('*'), body: rows },
      layout: {
        fillColor: () => C.surface2,
        hLineWidth: (i: number, node: ContentTable) => (i > 0 && i < node.table.body.length ? 0.6 : 0),
        hLineColor: () => '#ffffff',
        vLineWidth: () => 0,
        paddingLeft: () => 9,
        paddingRight: () => 4,
        paddingTop: () => 7,
        paddingBottom: () => 6,
      },
    },
  ]
}

function header(house: House, exported: Date, pics: Pictures): Content[] {
  const sub = [place(house), house.wijk && house.wijk !== house.plaats ? house.wijk : undefined].filter(Boolean).join(' · ')
  return [
    brandLine(exported),
    {
      margin: [0, 14, 0, 0],
      columns: [
        {
          width: '*',
          stack: [
            { text: displayAddress(house), fontSize: 22, bold: true, color: C.text, lineHeight: 1.05 },
            ...(sub ? [{ ...(withIcon('mapPin', C.brandStrong, { text: sub, color: C.muted, fontSize: 10 }, 10) as object), margin: [0, 4, 0, 0] } as Content] : []),
          ],
        },
        statusPill(house),
      ],
      columnGap: 12,
    },
    ...pictures(pics),
    ...facts(house),
  ]
}

function scoreBadge(score: number): Content {
  const r = 21
  return {
    width: r * 2,
    stack: [
      { canvas: [{ type: 'ellipse', x: r, y: r, r1: r, r2: r, color: C.brand }] },
      { text: score.toLocaleString('nl-NL'), color: '#ffffff', bold: true, fontSize: 15, alignment: 'center', relativePosition: { x: 0, y: -r * 2 + 8 } },
      { text: 'SCORE', color: '#ffffff', fontSize: 5.5, bold: true, characterSpacing: 0.6, alignment: 'center', relativePosition: { x: 0, y: -r * 2 + 27 } },
    ],
  }
}

function verdict(house: House): Content[] {
  if (house.score === undefined && !house.advies && !house.samenvatting && !house.pluspunten?.length && !house.minpunten?.length) {
    return []
  }
  const text: Content[] = [
    withIcon('fileText', C.brandStrong, { text: 'Uit het rapport', bold: true, fontSize: 10.5 }, 11, 5),
  ]
  if (house.advies) {
    text.push({ text: [{ text: 'Advies  ', color: C.muted }, { text: house.advies, bold: true }], margin: [0, 4, 0, 0] })
  }
  if (house.samenvatting) text.push({ text: clean(house.samenvatting), margin: [0, 4, 0, 0] })
  const top: Content =
    house.score !== undefined
      ? { columns: [scoreBadge(house.score), { width: '*', stack: text }], columnGap: 12 }
      : { stack: text }
  const list = (title: string, name: IconName, mark: IconName, color: string, items: string[]): Content => ({
    stack: [
      { ...(withIcon(name, color, { text: title, bold: true, color }, 10, 5) as object), margin: [0, 0, 0, 3] } as Content,
      ...items.map((t) => ({ ...(withIcon(mark, color, { text: t }, 8.5, 5) as object), margin: [0, 1.5, 0, 0] }) as Content),
    ],
  })
  const body: Content[] = [top]
  if (house.pluspunten?.length || house.minpunten?.length) {
    body.push({
      columns: [
        house.pluspunten?.length ? list('Pluspunten', 'thumbsUp', 'check', STATE.ok.color, house.pluspunten) : { text: '' },
        house.minpunten?.length ? list('Minpunten', 'thumbsDown', 'triangleAlert', STATE.probleem.color, house.minpunten) : { text: '' },
      ],
      columnGap: 18,
      margin: [0, 10, 0, 0],
    })
  }
  return [{ ...(card({ stack: body }, C.brandSoft, C.brand, 12) as object), margin: [0, 0, 0, 12] } as Content]
}

function gradeBadge(grade: number | undefined): Content {
  if (!grade) return { text: '–', color: C.faint }
  const color = grade >= 8 ? STATE.ok.color : grade >= 6 ? C.brandStrong : STATE.probleem.color
  return {
    columns: [
      {
        width: 22,
        stack: [
          { canvas: [{ type: 'ellipse', x: 11, y: 11, r1: 11, r2: 11, color }] },
          { text: String(grade), color: '#ffffff', bold: true, fontSize: 11, alignment: 'center', relativePosition: { x: 0, y: -18.5 } },
        ],
      },
    ],
  }
}

function infoTile(name: IconName, label: string, value: string, extra?: string): TableCell {
  return {
    columns: [
      { ...(badgeIcon(name, 22) as object), margin: [0, 1, 0, 0] } as Content,
      {
        width: '*',
        stack: [
          { text: label.toUpperCase(), fontSize: 6.5, color: C.muted, characterSpacing: 0.5 },
          { text: value, bold: true, fontSize: 10.5 },
          ...(extra ? [{ text: extra, color: C.muted, fontSize: 8 }] : []),
        ],
      },
    ],
    columnGap: 8,
  }
}

/** Tiles side by side, all as tall as the tallest. */
function tileRow(tiles: TableCell[]): Content {
  const cells: TableCell[] = []
  const widths: (number | string)[] = []
  tiles.forEach((t, i) => {
    if (i) {
      cells.push({ text: '' })
      widths.push(GAP)
    }
    cells.push(t)
    widths.push('*')
  })
  return {
    table: { widths, body: [cells] },
    layout: {
      fillColor: (_row: number, _node: unknown, col: number) => (col % 2 ? null : C.surface2),
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: (col: number) => (col % 2 ? 0 : 8),
      paddingRight: (col: number) => (col % 2 ? 0 : 8),
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
  } as unknown as Content
}

function assessment(house: House, answers: Answers[]): Content[] {
  const several = answers.length > 1
  const rated = answers.filter((a) => a.data.cijfer || Object.keys(a.data.aspecten ?? {}).length)
  const out: Content[] = [sectionTitle('star', 'Beoordeling'), ...verdict(house)]

  if (rated.length) {
    const cols = several ? answers : rated
    const average = (a: Answers) => {
      const values = Object.values(a.data.aspecten ?? {})
      return values.length ? values.reduce((x, y) => x + y, 0) / values.length : undefined
    }
    const body: TableCell[][] = []
    if (several) body.push([{ text: '' }, ...cols.map((a) => personLabel(a))])
    body.push([
      { ...(withIcon('award', C.muted, { text: 'Cijfer', bold: true }, 10, 7) as object), margin: [0, 5, 0, 0] } as TableCell,
      ...cols.map((a) => gradeBadge(a.data.cijfer) as TableCell),
    ])
    for (const aspect of ASPECTS) {
      body.push([
        withIcon(ASPECT_ICONS[aspect] ?? 'star', C.muted, { text: aspect }, 10, 7) as TableCell,
        ...cols.map((a) => rating(a.data.aspecten?.[aspect]) as TableCell),
      ])
    }
    body.push([
      { text: 'Gemiddeld', color: C.muted, margin: [17, 0, 0, 0] },
      ...cols.map((a) => {
        const avg = average(a)
        return { text: avg ? `${avg.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} / 5` : '–', color: C.muted }
      }),
    ])
    out.push({
      table: { headerRows: several ? 1 : 0, widths: [150, ...cols.map(() => 82)], body },
      layout: thinLines,
      unbreakable: true,
    })
  }

  const tiles: TableCell[] = []
  if (house.mine.bezichtiging) tiles.push(infoTile('calendarClock', 'Bezichtiging', formatDateTime(house.mine.bezichtiging)))
  if (house.mine.bod) {
    let extra: string | undefined
    if (house.vraagprijs) {
      const diff = house.mine.bod - house.vraagprijs
      extra = diff >= 0 ? `${formatEuro(diff)} boven de vraagprijs` : `${formatEuro(-diff)} onder de vraagprijs`
    }
    tiles.push(infoTile('handCoins', 'Bod', formatEuro(house.mine.bod), extra))
  }
  if (tiles.length) {
    while (tiles.length < 2) tiles.push({ text: '' })
    out.push({ ...(tileRow(tiles) as object), margin: [0, 12, 0, 0] } as Content)
  }

  const notes = answers.filter((a) => clean(a.data.notities))
  for (const a of notes) {
    const color = personColor(a.person)
    out.push({
      margin: [0, 10, 0, 0],
      unbreakable: clean(a.data.notities).length < 600,
      ...(card(
        {
          stack: [
            {
              columns: [
                { ...(icon('notebookPen', color, 10) as object), margin: [0, 1, 0, 0] } as Content,
                { text: several ? `Notities van ${a.person.naam}` : 'Notities', bold: true, color, width: '*' },
              ],
              columnGap: 5,
              margin: [0, 0, 0, 3],
            },
            { text: clean(a.data.notities), color: C.text },
          ],
        },
        '#fafafa',
        color,
      ) as object),
    } as Content)
  }
  if (!rated.length && !notes.length && !tiles.length && out.length === 1) {
    out.push({ text: 'Nog geen cijfer, beoordeling of notities.', color: C.muted, italics: true })
  }
  return out
}

/** The answer as a small coloured label with its icon; an open point is a dashed circle. */
function pill(state: CheckState | undefined): Content {
  if (!state) return { ...(icon('circleDashed', '#c9ccd0', 9) as object), margin: [2, 1, 0, 0] } as Content
  const s = STATE[state]
  return {
    table: {
      widths: [8, 'auto'],
      body: [[
        { ...(icon(s.icon, s.color, 8, 2.4) as object), margin: [0, 0.8, 0, 0] } as TableCell,
        { text: s.label, color: s.color, bold: true, fontSize: 7.5 },
      ]],
    },
    layout: {
      fillColor: () => s.soft,
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: (i: number) => (i === 0 ? 5 : 3),
      paddingRight: (i: number) => (i === 0 ? 0 : 6),
      paddingTop: () => 2,
      paddingBottom: () => 1.5,
    },
  }
}

function progressBar(done: { ok: number; twijfel: number; probleem: number; total: number }): Content {
  if (!done.total) return { text: '' }
  let x = 0
  const parts = (['ok', 'twijfel', 'probleem'] as const).map((k) => {
    const w = (done[k] / done.total) * WIDTH
    const rect = { type: 'rect' as const, x, y: 0, w, h: 7, color: STATE[k].color }
    x += w
    return rect
  })
  return {
    canvas: [{ type: 'rect', x: 0, y: 0, w: WIDTH, h: 7, r: 3.5, color: '#ececec' }, ...parts.filter((p) => p.w > 0)],
    margin: [0, 2, 0, 6],
  }
}

function legend(p: { ok: number; twijfel: number; probleem: number }, open: number, several: boolean): Content {
  const item = (name: IconName, color: string, text: string, bold = true): Content =>
    ({
      width: 'auto',
      columns: [{ ...(icon(name, color, 9, 2.2) as object), margin: [0, 0.5, 0, 0] }, { text, color, bold, width: 'auto' }],
      columnGap: 4,
    }) as unknown as Content
  return {
    columns: [
      item('check', STATE.ok.color, `${p.ok} in orde`),
      item('circleQuestionMark', STATE.twijfel.color, `${p.twijfel} twijfel`),
      item('triangleAlert', STATE.probleem.color, `${p.probleem} probleem`),
      item('circleDashed', C.muted, `${open} open`, false),
      ...(several ? [{ text: '(jouw antwoorden)', color: C.faint, width: 'auto' } as Content] : []),
    ],
    columnGap: 16,
    fontSize: 8.5,
    margin: [0, 0, 0, 4],
  }
}

function categoryIcon(category: ChecklistCategory): IconName {
  if (category.fromReport) return 'fileText'
  if (category.fromDocuments) return 'files'
  return CATEGORY_ICONS[category.id] ?? 'clipboardCheck'
}

function checklist(categories: ChecklistCategory[], answers: Answers[]): Content[] {
  const several = answers.length > 1
  const mine = answers[0].data.checklist ?? {}
  const p = progress(categories, mine)
  const open = p.total - p.done
  const out: Content[] = [
    sectionTitle('clipboardCheck', 'Checklist', several ? undefined : `${p.done} van ${p.total} punten bekeken`),
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
  out.push(legend(p, open, several))

  for (const category of categories) {
    if (!category.items.length) continue
    const cp = progress([category], mine)
    const badge = category.fromReport ? 'RAPPORT' : category.fromDocuments ? 'DOCUMENTEN' : ''
    const [soft, strong] = category.fromReport
      ? [C.linkSoft, C.link]
      : category.fromDocuments
        ? [C.purpleSoft, C.purple]
        : [C.brandSoft, C.brandStrong]
    // The category's title shares its row with the names above the answer columns.
    const body: TableCell[][] = [
      [
        {
          columns: [
            badgeIcon(categoryIcon(category), 18, strong, soft),
            {
              width: '*',
              margin: [0, 2.5, 0, 0],
              text: [
                { text: category.titel, bold: true, fontSize: 10.5 },
                ...(badge ? [{ text: `  ${badge}`, fontSize: 6.5, color: strong, bold: true, characterSpacing: 0.5 }] : []),
                { text: `   ${cp.done}/${cp.total}`, color: C.muted, fontSize: 8.5 },
              ],
            },
          ],
          columnGap: 7,
        },
        ...answers.map((a) =>
          several ? ({ ...(personLabel(a) as object), fontSize: 8, margin: [0, 4, 0, 0] } as TableCell) : ({ text: '' } as TableCell),
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
          ...(withIcon('files', C.purple, {
            text: [
              { text: 'Uit de documenten: ', bold: true, color: C.purple },
              ...(pre.oordeel ? [{ text: `${STATE[pre.oordeel].label.toLowerCase()}. `, color: STATE[pre.oordeel].color }] : []),
              { text: clean(pre.antwoord) },
              ...(pre.bron ? [{ text: ` (bron: ${pre.bron})`, color: C.faint }] : []),
            ],
            color: C.muted,
            italics: true,
            fontSize: 8,
          }, 8, 4) as object),
          margin: [0, 2, 0, 0],
        } as Content)
      }
      body.push([
        { stack: [{ text: item.tekst, color: C.text }, ...notes], margin: [25, 0, 0, 0] },
        ...answers.map((a) => pill(a.data.checklist?.[item.id]?.s) as TableCell),
      ])
    }
    out.push({
      margin: [0, 10, 0, 0],
      table: {
        headerRows: 1,
        keepWithHeaderRows: 1,
        dontBreakRows: true,
        widths: ['*', ...answers.map(() => 64)],
        body,
      },
      layout: {
        ...thinLines,
        hLineWidth: (i: number, node: ContentTable) => (i === 0 || i === node.table.body.length ? 0 : i === 1 ? 0.9 : 0.6),
        hLineColor: (i: number) => (i === 1 ? '#d5d8dc' : C.line),
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
  pics: Pictures = {},
): TDocumentDefinitions {
  const answers = answersOf(house, people, me)
  const title = [displayAddress(house), house.plaats].filter(Boolean).join(', ')
  return {
    pageSize: 'A4',
    pageMargins: [MARGIN_X, 32, MARGIN_X, 40],
    info: { title: `${title} – Huizenjacht`, creator: 'Huizenjacht' },
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.22, color: C.text },
    content: [...header(house, exported, pics), ...assessment(house, answers), ...checklist(categories, answers)],
    footer: (page, pages) =>
      ({
      margin: [MARGIN_X, 12, MARGIN_X, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 0.6, lineColor: C.line }] },
        {
          margin: [0, 5, 0, 0],
          columns: [
            { svg: LOGO, width: 8, height: 8, margin: [0, 0.5, 0, 0] },
            { text: title, color: C.faint, fontSize: 7.5, margin: [4, 0, 0, 0] },
            { text: `${page} / ${pages}`, alignment: 'right', color: C.faint, fontSize: 7.5, width: 40 },
          ],
          columnGap: 0,
        },
      ],
    }) as unknown as Content,
    // A heading never ends up alone at the bottom of a page.
    pageBreakBefore: (node, rest) =>
      Boolean(node.headlineLevel) && rest.getFollowingNodesOnPage().length < (node.headlineLevel === 1 ? 4 : 2),
  }
}

/** The photo and the map for the PDF, side by side, or one of them across the page. */
export async function pdfPictures(house: House): Promise<Pictures> {
  const { height, photoWidth, mapWidth, fullWidth } = PICTURES
  const [photo, map] = await Promise.all([housePhoto(house, photoWidth, height), houseMap(house, mapWidth, height)])
  if (photo && map) return { photo, map }
  if (photo) return { photo: await housePhoto(house, fullWidth, 230) }
  if (map) return { map: await houseMap(house, fullWidth, 150, { zoom: 15 }) }
  return {}
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
  const blob = await makePdf(pdfDocument(house, categories, people, me, new Date(), await pdfPictures(house)))
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
