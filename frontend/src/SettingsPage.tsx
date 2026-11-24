import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Bookmark,
  ArrowUp,
  ChevronRight,
  Database,
  Download,
  FileUp,
  Info,
  LogOut,
  UserRound,
  ListChecks,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { BookmarkletPanel } from './Bookmarklet'
import { api, type Health, type ImportResult, type ImportStatus, type Me } from './api'
import { applyUpdate, checkForUpdate, useUpdateReady } from './appUpdate'
import { CHANGELOG, currentVersion, formatReleaseDate, markChangelogSeen } from './changelog'
import { DEFAULT_CHECKLIST, newId, type ChecklistCategory } from './checklist'
import { LogoMark } from './Logo'
import { errorText, useStore } from './store'
import { rememberedTheme, setTheme, THEMES, type Theme } from './theme'

type Section = { id: string; title: string; icon: LucideIcon; summary: string }

export function SettingsPage({ section, health }: { section: string | null; health: Health | null }) {
  const { template, houses } = useStore()
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => {
    api.me().then(setMe).catch(() => undefined)
  }, [])
  const items = template.reduce((n, c) => n + c.items.length, 0)
  const sections: Section[] = [
    { id: 'weergave', title: 'Weergave', icon: Palette, summary: THEMES.find((t) => t.id === rememberedTheme())!.label },
    { id: 'checklist', title: 'Checklist', icon: ListChecks, summary: `${template.length} onderdelen, ${items} punten` },
    { id: 'rapporten', title: 'Rapporten importeren', icon: FileUp, summary: 'Uit de rapporten-repo of uploaden' },
    { id: 'bladwijzer', title: 'Bladwijzer voor Funda', icon: Bookmark, summary: 'Advertenties met foto\'s naar de app sturen' },
    { id: 'gegevens', title: 'Gegevens en back-up', icon: Database, summary: `${houses.length} huizen` },
    ...(me?.mode === 'oidc'
      ? [{ id: 'account', title: 'Account', icon: UserRound, summary: me.user?.name || me.user?.email || 'Ingelogd' }]
      : []),
    { id: 'over', title: 'Over Huizenjacht', icon: Info, summary: `Versie ${currentVersion()}` },
  ]
  const shown = sections.find((s) => s.id === section)

  if (!shown) {
    return (
      <div className="page settings">
        <h1>Instellingen</h1>
        <ul className="settings-list">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#/instellingen/${s.id}`}>
                <span className="settings-icon">
                  <s.icon size={20} />
                </span>
                <span className="settings-text">
                  <b>{s.title}</b>
                  <span className="muted small">{s.summary}</span>
                </span>
                <ChevronRight size={18} className="muted" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="page settings">
      <a href="#/instellingen" className="back">
        <ArrowLeft size={18} /> Instellingen
      </a>
      <h1>{shown.title}</h1>
      {shown.id === 'weergave' && <Display />}
      {shown.id === 'checklist' && <ChecklistEditor />}
      {shown.id === 'rapporten' && <Reports />}
      {shown.id === 'bladwijzer' && <BookmarkletPanel />}
      {shown.id === 'gegevens' && <Data />}
      {shown.id === 'account' && me && <Account me={me} />}
      {shown.id === 'over' && <About health={health} />}
    </div>
  )
}

function Display() {
  const [theme, setThemeState] = useState<Theme>(rememberedTheme)
  return (
    <section className="panel">
      <h2>Thema</h2>
      <div className="segmented" role="radiogroup" aria-label="Thema">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === t.id}
            className={theme === t.id ? 'on' : ''}
            onClick={() => {
              setTheme(t.id)
              setThemeState(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function ChecklistEditor() {
  const { template, saveTemplate } = useStore()
  const [draft, setDraft] = useState<ChecklistCategory[]>(template)
  useEffect(() => setDraft(template), [template])
  const save = (next: ChecklistCategory[]) => {
    setDraft(next)
    void saveTemplate(next)
  }
  const move = <T,>(list: T[], i: number, d: number): T[] => {
    const next = [...list]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    return next
  }

  return (
    <>
      <p className="muted">
        Deze punten staan bij elk huis. Heeft het rapport van een huis een eigen afvinklijst (regels met
        "- [ ]") of open punten, dan komen die er per huis bovenop. Zonder afvinklijst gebruikt de app de
        aandachtspunten voor de bezichtiging uit het rapport. Een punt verwijderen haalt ook de antwoorden
        daarop uit beeld.
      </p>
      {draft.map((cat, ci) => (
        <section key={cat.id} className="panel edit-category">
          <div className="edit-row">
            <input
              className="edit-title"
              aria-label="Naam van het onderdeel"
              value={cat.titel}
              onChange={(e) => setDraft(draft.map((c, i) => (i === ci ? { ...c, titel: e.target.value } : c)))}
              onBlur={() => save(draft)}
            />
            <button className="icon-btn" aria-label="Omhoog" disabled={ci === 0} onClick={() => save(move(draft, ci, -1))}>
              <ArrowUp size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label="Omlaag"
              disabled={ci === draft.length - 1}
              onClick={() => save(move(draft, ci, 1))}
            >
              <ArrowDown size={16} />
            </button>
            <button
              className="icon-btn danger"
              aria-label={`${cat.titel} verwijderen`}
              onClick={() => confirm(`Onderdeel “${cat.titel}” verwijderen?`) && save(draft.filter((_, i) => i !== ci))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <ul className="edit-items">
            {cat.items.map((item, ii) => (
              <li key={item.id} className="edit-row">
                <input
                  aria-label="Punt"
                  value={item.tekst}
                  onChange={(e) =>
                    setDraft(
                      draft.map((c, i) =>
                        i === ci
                          ? { ...c, items: c.items.map((it, j) => (j === ii ? { ...it, tekst: e.target.value } : it)) }
                          : c,
                      ),
                    )
                  }
                  onBlur={() => save(draft)}
                />
                <button
                  className="icon-btn danger"
                  aria-label="Punt verwijderen"
                  onClick={() =>
                    save(draft.map((c, i) => (i === ci ? { ...c, items: c.items.filter((_, j) => j !== ii) } : c)))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn btn-ghost btn-small"
            onClick={() =>
              save(
                draft.map((c, i) =>
                  i === ci ? { ...c, items: [...c.items, { id: newId(c.id), tekst: 'Nieuw punt' }] } : c,
                ),
              )
            }
          >
            <Plus size={16} /> Punt toevoegen
          </button>
        </section>
      ))}
      <div className="row">
        <button
          className="btn btn-primary"
          onClick={() => save([...draft, { id: newId('cat'), titel: 'Nieuw onderdeel', items: [] }])}
        >
          <Plus size={18} /> Onderdeel toevoegen
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => confirm('De standaardchecklist terugzetten?') && save(DEFAULT_CHECKLIST)}
        >
          <RotateCcw size={16} /> Standaard terugzetten
        </button>
      </div>
    </>
  )
}

function resultText(r: ImportResult): string {
  const parts = [
    r.created && `${r.created} nieuw`,
    r.updated && `${r.updated} bijgewerkt`,
    r.unchanged && `${r.unchanged} ongewijzigd`,
    r.errors.length && `${r.errors.length} met fouten`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Geen rapporten gevonden'
}

function Reports() {
  const { refresh, notify } = useStore()
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = () => api.importStatus().then(setStatus).catch(() => undefined)
  useEffect(() => {
    void load()
  }, [])

  async function run(job: () => Promise<ImportResult>) {
    setBusy(true)
    try {
      const r = await job()
      setResult(r)
      await refresh()
      void load()
      notify(resultText(r))
    } catch (e) {
      notify(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="panel">
        <h2>Rapporten-repo</h2>
        {!status ? (
          <p className="muted">Laden…</p>
        ) : status.folderAvailable ? (
          <>
            <p>
              <span className="dot dot-ok" /> Gekoppeld: {status.fileCount} rapport
              {status.fileCount === 1 ? '' : 'en'} gevonden.
            </p>
            <p className="muted small">
              Nieuwe en gewijzigde rapporten komen vanzelf binnen
              {status.scanInterval > 0 ? `, minstens elke ${Math.round(status.scanInterval / 60)} minuten` : ''}.
              {status.lastScan && ` Laatst gekeken: ${new Date(status.lastScan).toLocaleString('nl-NL')}.`}
            </p>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void run(api.importScan)}>
              <RefreshCw size={16} className={busy ? 'spin' : ''} /> Nu synchroniseren
            </button>
          </>
        ) : (
          <>
            <p>
              <span className="dot dot-off" /> Niet gekoppeld.
            </p>
            <p className="muted small">
              Zet in de Helm chart <code>reports.git.enabled</code> aan met de private rapporten-repo en
              een read-only token. De rapporten komen dan alleen op je cluster terecht, nooit in de
              publieke code.
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Uploaden</h2>
        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const files = [...e.dataTransfer.files]
            if (files.length) void run(() => api.importUpload(files))
          }}
        >
          <Upload size={28} />
          <p>
            Sleep rapporten hierheen, of{' '}
            <button className="link" onClick={() => input.current?.click()}>
              kies bestanden
            </button>
          </p>
          <p className="muted small">Markdown (.md) of JSON. Hetzelfde bestand opnieuw uploaden werkt het huis bij.</p>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept=".md,.markdown,.json,text/markdown,application/json"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) void run(() => api.importUpload(files))
            }}
          />
        </div>
        {result && (
          <div className="import-result">
            <p>
              <b>{resultText(result)}</b>
            </p>
            {result.errors.length > 0 && (
              <ul className="errors">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <code>{e.file}</code>: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Formaat</h2>
        <p className="muted small">
          Eén Markdown-bestand per huis met bovenaan YAML-gegevens. Je eigen checklist, cijfer en
          notities blijven staan als een rapport wordt bijgewerkt.
        </p>
        <pre className="code">{`---
adres: Dorpsstraat 12
plaats: Utrecht
vraagprijs: 450000
woonoppervlakte: 120
energielabel: C
score: 7.5
pluspunten: [Veel licht, Rustige straat]
minpunten: [Fundering onbekend]
aandachtspunten_bezichtiging:
  - Vraag naar het funderingsrapport
---
# Dorpsstraat 12, Utrecht
Het volledige rapport…`}</pre>
      </section>
    </>
  )
}

function Data() {
  const { refresh, notify } = useStore()
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <section className="panel">
        <h2>Back-up downloaden</h2>
        <p className="muted small">
          Alle huizen met je checklists, cijfers en notities, en je checklist-sjabloon, in één
          JSON-bestand. Bewaar het niet in de publieke repo: het bevat de rapporten.
        </p>
        <a className="btn btn-primary" href="/api/backup" download>
          <Download size={18} /> Back-up downloaden
        </a>
      </section>
      <section className="panel">
        <h2>Back-up terugzetten</h2>
        <p className="muted small">Vervangt alle huizen en instellingen door die uit de back-up.</p>
        <button className="btn btn-ghost" onClick={() => input.current?.click()}>
          <Upload size={16} /> Back-up kiezen
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              const backup = JSON.parse(await file.text())
              if (!confirm(`Alles vervangen door de back-up met ${backup.houses?.length ?? 0} huizen?`)) return
              const r = await api.restore(backup)
              await refresh()
              notify(`${r.houses} huizen teruggezet.`)
            } catch (err) {
              notify(err instanceof SyntaxError ? 'Dit is geen geldig JSON-bestand.' : errorText(err), 'error')
            }
          }}
        />
      </section>
    </>
  )
}

function Account({ me }: { me: Me }) {
  return (
    <section className="panel">
      <h2>Ingelogd</h2>
      <p>
        <b>{me.user?.name || 'Onbekend'}</b>
        {me.user?.email && <span className="muted"> · {me.user.email}</span>}
      </p>
      <p className="muted small">Je blijft ingelogd tot je uitlogt, en hoogstens 30 dagen. Daarna log je opnieuw in.</p>
      <button
        className="btn btn-ghost"
        onClick={async () => {
          await api.logout().catch(() => undefined)
          location.assign('/api/auth/login')
        }}
      >
        <LogOut size={16} /> Uitloggen
      </button>
    </section>
  )
}

function About({ health }: { health: Health | null }) {
  const updateReady = useUpdateReady()
  const [checking, setChecking] = useState(false)
  useEffect(() => markChangelogSeen(), [])
  const server = health?.version
  return (
    <>
      <section className="panel about">
        <LogoMark size={56} />
        <div>
          <h2>Huizenjacht</h2>
          <p className="muted small">
            App {currentVersion()}
            {server && server !== currentVersion() && (
              <>
                {' · server '}
                {health?.commitUrl ? (
                  <a href={health.commitUrl} target="_blank" rel="noreferrer">
                    {server}
                  </a>
                ) : (
                  server
                )}
              </>
            )}
          </p>
          <p className="small">
            Overzicht, bezichtigingschecklists en vergelijkingen voor je zoektocht naar een huis.{' '}
            <a href="https://github.com/brnl-claude/huizenjacht" target="_blank" rel="noreferrer">
              Broncode op GitHub
            </a>
          </p>
        </div>
      </section>
      <section className="panel">
        {updateReady ? (
          <button className="btn btn-primary" onClick={applyUpdate}>
            Nieuwe versie laden
          </button>
        ) : (
          <button
            className="btn btn-ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              await checkForUpdate().catch(() => undefined)
              setTimeout(() => setChecking(false), 1500)
            }}
          >
            <RefreshCw size={16} className={checking ? 'spin' : ''} /> Zoeken naar updates
          </button>
        )}
      </section>
      <section className="panel">
        <h2>Wat is er nieuw</h2>
        <ol className="changelog">
          {CHANGELOG.map((r) => (
            <li key={r.version}>
              <div className="changelog-head">
                <span className="version">{r.version}</span>
                <b>{r.title}</b>
                <span className="muted small">{formatReleaseDate(r.date)}</span>
              </div>
              <ul>
                {r.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
