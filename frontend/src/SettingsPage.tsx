import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  Bookmark,
  ArrowUp,
  ChevronRight,
  CircleCheck,
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
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { BookmarkletPanel } from './Bookmarklet'
import { api, type Health, type ImportResult, type ImportStatus, type Me, type NightlyBackups, type StorageUsage } from './api'
import { countText, filesBytes, formatBytes, STORAGE_CATEGORIES, storageShares } from './storage'
import { applyUpdate, checkForUpdate, useUpdateReady } from './appUpdate'
import { CHANGELOG, currentVersion, formatReleaseDate, latestAndroidRelease, markChangelogSeen } from './changelog'
import { AndroidChanges } from './WhatsNew'
import { Devices } from './Pairing'
import { DEFAULT_CHECKLIST, newId, type ChecklistCategory } from './checklist'
import { LogoMark } from './Logo'
import { errorText, useStore } from './store'
import { FONT_SIZES, fontSizeLabel, rememberedFontSize, setFontSize, type FontSize } from './fontSize'
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
    {
      id: 'weergave',
      title: 'Weergave',
      icon: Palette,
      summary: `${THEMES.find((t) => t.id === rememberedTheme())!.label}, tekst ${fontSizeLabel(rememberedFontSize()).toLowerCase()}`,
    },
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
      {shown.id === 'gegevens' && <Data admin={me?.admin ?? false} loaded={me != null} />}
      {shown.id === 'account' && me && <Account me={me} />}
      {shown.id === 'account' && me && <Devices />}
      {shown.id === 'over' && <About health={health} />}
    </div>
  )
}

function Display() {
  const [theme, setThemeState] = useState<Theme>(rememberedTheme)
  const [fontSize, setFontSizeState] = useState<FontSize>(rememberedFontSize)
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
      <h2 className="display-heading">Lettergrootte</h2>
      <div className="font-size-row">
        <div className="segmented font-sizes" role="radiogroup" aria-label="Lettergrootte">
          {FONT_SIZES.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={fontSize === f.id}
              aria-label={f.label}
              title={f.label}
              className={fontSize === f.id ? 'on' : ''}
              style={{ fontSize: `${Math.round(16 * f.scale)}px` }}
              onClick={() => {
                setFontSize(f.id)
                setFontSizeState(f.id)
              }}
            >
              A
            </button>
          ))}
        </div>
        <span className="muted">{fontSizeLabel(fontSize)}</span>
      </div>
      <p className="muted small">Geldt voor dit apparaat. De middelste is de standaard.</p>
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

function Storage() {
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [failed, setFailed] = useState(false)
  const [device, setDevice] = useState<number | null>(null)
  useEffect(() => {
    api.storage().then(setUsage, () => setFailed(true))
    navigator.storage
      ?.estimate?.()
      .then((e) => setDevice(e.usage ?? null))
      .catch(() => undefined)
  }, [])
  return (
    <section className="panel">
      <h2>Opslag</h2>
      {failed && <p className="muted small">Het gebruik kon niet worden opgehaald.</p>}
      {!usage && !failed && <p className="muted small">Even tellen…</p>}
      {usage && (
        <>
          <p className="storage-total">
            <b>{formatBytes(usage.total)}</b>
            <span className="muted small">
              {usage.disk
                ? ` in gebruik · ${formatBytes(usage.disk.free)} vrij van ${formatBytes(usage.disk.total)} op de server`
                : ' in gebruik op de server'}
            </span>
          </p>
          <div className="storage-bar" aria-hidden="true">
            {storageShares(usage).map((s) => (
              <span key={s.id} className={`storage-${s.id}`} style={{ flexGrow: s.percent }} />
            ))}
          </div>
          <ul className="storage-list">
            {STORAGE_CATEGORIES.map((c) => {
              const entry = usage.categories[c.id]
              return (
                <li key={c.id}>
                  <span className={`storage-dot storage-${c.id}`} />
                  <span className="storage-label">
                    {c.label}
                    <span className="muted small"> · {countText(entry.count, c.unit)}</span>
                  </span>
                  <span className="storage-bytes">{formatBytes(entry.bytes)}</span>
                </li>
              )
            })}
          </ul>
          <p className="muted small">
            Documenten komen uit de rapporten-repo, advertenties zijn de bewaarde Funda-pagina’s met foto’s, en
            gegevens is de database met checklists, cijfers en notities.
            {device != null && device > 0 && ` Op dit apparaat staat ${formatBytes(device)} offline bewaard.`}
          </p>
        </>
      )}
    </section>
  )
}

function formatNightlyDate(name: string): string {
  const day = /(\d{4}-\d{2}-\d{2})/.exec(name)?.[1]
  if (!day) return name
  return new Date(`${day}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
}

function Nightly() {
  const { refresh, notify } = useStore()
  const [data, setData] = useState<NightlyBackups | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    api.nightly().then(setData, () => undefined)
  }, [])
  if (!data) return null
  return (
    <section className="panel">
      <h2>Nachtelijke back-ups</h2>
      {!data.enabled ? (
        <p className="muted small">Staat uit op deze server (Helm: backups.enabled).</p>
      ) : (
        <>
          <p className="muted small">
            Elke nacht om {data.time} maakt de server een volledige back-up. Die blijft {data.keepDays} dagen
            bewaard.
          </p>
          {data.backups.length === 0 ? (
            <p className="muted small">Er is nog geen back-up gemaakt.</p>
          ) : (
            <ul className="nightly-list">
              {data.backups.map((b) => (
                <li key={b.name}>
                  <span className="nightly-name">
                    {formatNightlyDate(b.name)}
                    <span className="muted small"> · {formatBytes(b.size)}</span>
                  </span>
                  <span className="nightly-actions">
                    <a className="btn btn-ghost btn-small" href={`/api/backups/${encodeURIComponent(b.name)}`} download>
                      <Download size={16} /> Downloaden
                    </a>
                    <button
                      className="btn btn-ghost btn-small"
                      disabled={busy != null}
                      onClick={async () => {
                        if (!confirm(`Alles vervangen door de back-up van ${formatNightlyDate(b.name)}?`)) return
                        setBusy(b.name)
                        try {
                          const r = await api.restoreNightly(b.name)
                          await refresh()
                          notify(`${r.houses} huizen en ${r.media} bestanden teruggezet.`)
                        } catch (err) {
                          notify(errorText(err), 'error')
                        } finally {
                          setBusy(null)
                        }
                      }}
                    >
                      <RotateCcw size={16} className={busy === b.name ? 'spin' : ''} /> Terugzetten
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function Data({ admin, loaded }: { admin: boolean; loaded: boolean }) {
  const { refresh, notify } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const [withFiles, setWithFiles] = useState(true)
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [restoring, setRestoring] = useState(false)
  useEffect(() => {
    api.storage().then(setUsage, () => undefined)
  }, [])
  const extra = usage ? filesBytes(usage) : null
  if (!loaded) return <Storage />
  if (!admin) {
    return (
      <>
        <Storage />
        <section className="panel">
          <h2>Back-up</h2>
          <p className="muted small">Back-ups maken en terugzetten kan alleen een beheerder.</p>
        </section>
      </>
    )
  }
  return (
    <>
      <Storage />
      <section className="panel">
        <h2>Back-up downloaden</h2>
        <div className="backup-choice" role="radiogroup" aria-label="Wat zit er in de back-up">
          <label className={withFiles ? 'chosen' : ''}>
            <input type="radio" name="backup" checked={withFiles} onChange={() => setWithFiles(true)} />
            <span>
              <b>Alles</b>
              <span className="muted small">
                Huizen, checklists, cijfers en notities, plus alle foto’s, video’s, spraakmemo’s, documenten en
                advertenties. Eén ZIP-bestand{extra != null && <>, ongeveer {formatBytes(extra)}</>}.
              </span>
            </span>
          </label>
          <label className={withFiles ? '' : 'chosen'}>
            <input type="radio" name="backup" checked={!withFiles} onChange={() => setWithFiles(false)} />
            <span>
              <b>Alleen gegevens</b>
              <span className="muted small">
                Huizen, checklists, cijfers, notities en je checklist-sjabloon in één klein JSON-bestand.
              </span>
            </span>
          </label>
        </div>
        <p className="muted small">Bewaar de back-up niet in de publieke repo: hij bevat de rapporten.</p>
        <a className="btn btn-primary" href={withFiles ? '/api/backup/volledig' : '/api/backup'} download>
          <Download size={18} /> {withFiles ? 'Alles downloaden' : 'Gegevens downloaden'}
        </a>
      </section>
      <Nightly />
      <section className="panel">
        <h2>Back-up terugzetten</h2>
        <p className="muted small">
          Vervangt alle huizen en instellingen door die uit de back-up. Met een ZIP komen ook de foto’s, video’s,
          spraakmemo’s en advertenties terug. Documenten haalt de app weer uit de rapporten-repo.
        </p>
        <button className="btn btn-ghost" disabled={restoring} onClick={() => input.current?.click()}>
          <Upload size={16} className={restoring ? 'spin' : ''} /> {restoring ? 'Bezig met terugzetten…' : 'Back-up kiezen'}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".json,.zip,application/json,application/zip"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
                if (!confirm(`Alles vervangen door de volledige back-up ${file.name} (${formatBytes(file.size)})?`)) return
                setRestoring(true)
                const r = await api.restoreFull(file)
                await refresh()
                notify(`${r.houses} huizen en ${r.media} bestanden teruggezet.`)
                return
              }
              const backup = JSON.parse(await file.text())
              if (!confirm(`Alles vervangen door de back-up met ${backup.houses?.length ?? 0} huizen?`)) return
              const r = await api.restore(backup)
              await refresh()
              notify(`${r.houses} huizen teruggezet.`)
            } catch (err) {
              notify(err instanceof SyntaxError ? 'Dit is geen geldig JSON-bestand.' : errorText(err), 'error')
            } finally {
              setRestoring(false)
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
          // The offline copy of the houses stays on this device otherwise (a shared tablet).
          await Promise.all(['houses', 'media-thumbs'].map((name) => caches?.delete(name))).catch(() => undefined)
          location.assign('/api/auth/start')
        }}
      >
        <LogOut size={16} /> Uitloggen
      </button>
    </section>
  )
}

/** Inside the web app's block: is this the newest version, and a button to look again. */
function UpdateRow() {
  const updateReady = useUpdateReady()
  const [state, setState] = useState<'idle' | 'checking' | 'newest' | 'failed'>('idle')
  if (updateReady) {
    return (
      <div className="update-row ready">
        <span className="update-status">
          <Sparkles size={18} /> Er staat een nieuwe versie klaar.
        </span>
        <button className="btn btn-primary btn-small" onClick={applyUpdate}>
          <RefreshCw size={16} /> Nu laden
        </button>
      </div>
    )
  }
  const status = {
    idle: 'Nieuwe versies laden vanzelf als je de app opent.',
    checking: 'Zoeken naar een nieuwe versie…',
    newest: 'Je hebt de nieuwste versie.',
    failed: 'Zoeken lukte niet. Ben je online?',
  }[state]
  return (
    <div className="update-row">
      <span className="update-status" role="status">
        {state === 'newest' ? <CircleCheck size={18} className="ok" /> : <RefreshCw size={18} />} {status}
      </span>
      <button
        className="btn btn-ghost btn-small"
        disabled={state === 'checking'}
        onClick={async () => {
          setState('checking')
          const started = Date.now()
          let failed = false
          await checkForUpdate().catch(() => (failed = true))
          // A new version announces itself a moment after the check; give it that moment.
          await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (Date.now() - started))))
          setState(failed || !navigator.onLine ? 'failed' : 'newest')
        }}
      >
        <RefreshCw size={16} className={state === 'checking' ? 'spin' : ''} /> Zoeken naar updates
      </button>
    </div>
  )
}

function About({ health }: { health: Health | null }) {
  useEffect(() => markChangelogSeen(), [])
  const server = health?.version
  // The app's own WebView says so in its user agent (android/, WebViewActivity).
  const androidApp = /HuizenjachtAndroid\/(\S+)/.exec(navigator.userAgent)?.[1]
  const androidRelease = latestAndroidRelease()
  return (
    <>
      <section className="panel about-app">
        <div className="about">
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
        </div>
        <UpdateRow />
      </section>
      <section className="panel">
        <h2>Android-app</h2>
        {androidApp ? (
          <p className="small">
            Je gebruikt de Android-app {androidApp}. Nieuwe functies krijg je vanzelf. De app zelf hoef je alleen bij
            te werken als Obtainium of F-Droid dat aanbiedt.
          </p>
        ) : (
          <p className="small">
            Installeer Huizenjacht op je telefoon met{' '}
            <a href="https://obtainium.imranr.dev/" target="_blank" rel="noreferrer">
              Obtainium
            </a>{' '}
            (link <code>github.com/brnl-claude/huizenjacht</code>), via{' '}
            <a href="https://brnl-claude.github.io/huizenjacht/" target="_blank" rel="noreferrer">
              F-Droid
            </a>{' '}
            of als{' '}
            <a
              href={
                androidRelease
                  ? `https://github.com/brnl-claude/huizenjacht/releases/download/v${androidRelease.version}/huizenjacht.apk`
                  : 'https://github.com/brnl-claude/huizenjacht/releases'
              }
            >
              APK
            </a>
            .
          </p>
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
              <AndroidChanges release={r} />
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
