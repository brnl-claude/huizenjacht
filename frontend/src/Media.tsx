import { useModalDialog } from './nav'
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  ImageUp,
  Mic,
  Play,
  RotateCw,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { api } from './api'
import type { ChecklistCategory } from './checklist'
import { personInfo, type House } from './house'
import {
  addFiles,
  addRecording,
  canRecord,
  discard,
  formatDuration,
  mediaUrl,
  recorderType,
  retry,
  thumbUrl,
  usePending,
  type Media,
  type Pending,
} from './media'
import { errorText, useStore } from './store'
import { PersonDot } from './ui'

/** Photos, videos and memos of one checklist item, or of the house in general (item null). */
export function MediaTiles({
  house,
  item,
  categories,
}: {
  house: House
  item: string | null
  categories: ChecklistCategory[]
}) {
  const known = new Set(categories.flatMap((c) => c.items.map((i) => i.id)))
  // In general: also what belongs to a point that is no longer on the list.
  const media = (house.record.media ?? []).filter((m) =>
    item === null ? m.item === null || !known.has(m.item) : m.item === item,
  )
  const waiting = usePending(house.id).filter((p) => p.item === item)
  const [open, setOpen] = useState<number | null>(null)
  if (!media.length && !waiting.length) return null
  return (
    <>
      <ul className="media-tiles">
        {media.map((m, i) => (
          <li key={m.id}>
            <MediaTile house={house} media={m} onOpen={() => setOpen(i)} />
          </li>
        ))}
        {waiting.map((p) => (
          <li key={p.id}>
            <PendingTile pending={p} />
          </li>
        ))}
      </ul>
      {open !== null && media[open] && (
        <MediaViewer house={house} list={media} index={open} onIndex={setOpen} categories={categories} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

function MediaTile({ house, media, onOpen }: { house: House; media: Media; onOpen: () => void }) {
  const { people } = useStore()
  const [broken, setBroken] = useState(false)
  const label = media.kind === 'audio' ? 'Spraakmemo' : media.kind === 'video' ? 'Video' : 'Foto'
  return (
    <button
      type="button"
      className={`media-tile kind-${media.kind}`}
      onClick={onOpen}
      aria-label={`${label}${media.duration ? ` van ${formatDuration(media.duration)}` : ''}${media.note ? `: ${media.note}` : ''}`}
    >
      {media.kind === 'audio' ? (
        <span className="media-tile-icon">
          <Mic size={22} />
        </span>
      ) : media.thumb && !broken ? (
        <img src={thumbUrl(media.id)} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : media.kind === 'foto' ? (
        <img src={mediaUrl(media.id)} alt="" loading="lazy" />
      ) : (
        <span className="media-tile-icon">
          <Video size={22} />
        </span>
      )}
      {media.kind === 'video' && (
        <span className="media-tile-play" aria-hidden="true">
          <Play size={16} fill="currentColor" />
        </span>
      )}
      {media.duration ? <span className="media-tile-time">{formatDuration(media.duration)}</span> : null}
      {house.others.length > 0 && media.person && (
        <span className="media-tile-person">
          <PersonDot person={personInfo(people, media.person)} />
        </span>
      )}
      {media.note && <span className="media-tile-note" aria-hidden="true" />}
    </button>
  )
}

function PendingTile({ pending }: { pending: Pending }) {
  const [url] = useState(() => (pending.thumb ? URL.createObjectURL(pending.thumb) : null))
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  const tip =
    pending.state === 'fout'
      ? `${pending.error ?? 'Uploaden mislukt.'} Tik om opnieuw te proberen.`
      : pending.state === 'bezig'
        ? `Uploaden… ${Math.round((pending.progress ?? 0) * 100)}%`
        : 'Wacht op verbinding; gaat vanzelf naar de server'
  return (
    <div className={`media-tile pending is-${pending.state}`} data-tip={tip}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="media-tile-icon">{pending.kind === 'audio' ? <Mic size={22} /> : <Video size={22} />}</span>
      )}
      <span className="media-tile-status">
        {pending.state === 'bezig' ? (
          <span className="media-progress" style={{ ['--p' as string]: `${Math.round((pending.progress ?? 0) * 100)}%` }} />
        ) : pending.state === 'fout' ? (
          <AlertTriangle size={18} />
        ) : (
          <CloudOff size={18} />
        )}
      </span>
      {pending.state === 'fout' && (
        <span className="media-tile-actions">
          <button type="button" className="icon-btn" aria-label="Opnieuw proberen" onClick={() => retry(pending.id)}>
            <RotateCw size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Weggooien"
            onClick={() => confirm('Dit bestand weggooien?') && void discard(pending.id)}
          >
            <X size={16} />
          </button>
        </span>
      )}
    </div>
  )
}

type Action = 'foto' | 'video' | 'memo' | 'upload'

/** Buttons that add a photo, video, file or memo. Compact: only icons, for a checklist row. */
export function MediaActions({
  houseId,
  item,
  compact = false,
  show = ['foto', 'video', 'memo', 'upload'],
}: {
  houseId: string
  item: string | null
  compact?: boolean
  show?: Action[]
}) {
  const { notify } = useStore()
  const photo = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)

  async function take(list: FileList | null, input: HTMLInputElement | null) {
    const picked = [...(list ?? [])]
    if (input) input.value = ''
    if (!picked.length) return
    const refused = await addFiles(houseId, item, picked)
    if (refused.length) notify(`Geen foto, video of geluid: ${refused.join(', ')}`, 'error')
  }

  const cls = compact ? 'check-btn media-btn' : 'btn btn-small btn-ghost'
  return (
    <>
      {show.includes('foto') && (
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void take(e.target.files, e.target)} />
      )}
      {show.includes('video') && (
        <input ref={video} type="file" accept="video/*" capture="environment" hidden onChange={(e) => void take(e.target.files, e.target)} />
      )}
      {show.includes('upload') && (
        <input
          ref={files}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          hidden
          onChange={(e) => void take(e.target.files, e.target)}
        />
      )}
      {show.includes('foto') && (
      <button type="button" className={cls} aria-label={compact ? 'Foto maken' : undefined} data-tip={compact ? undefined : 'Maak een foto met de camera'} onClick={() => photo.current?.click()}>
        <Camera size={compact ? 18 : 16} />
        {!compact && ' Foto'}
      </button>
      )}
      {show.includes('video') && (
        <button type="button" className={cls} aria-label={compact ? 'Video opnemen' : undefined} data-tip={compact ? undefined : 'Neem een video op'} onClick={() => video.current?.click()}>
          <Video size={compact ? 18 : 16} />
          {!compact && ' Video'}
        </button>
      )}
      {show.includes('memo') && <VoiceButton houseId={houseId} item={item} compact={compact} />}
      {show.includes('upload') && (
        <button
          type="button"
          className={cls}
          aria-label={compact ? "Foto's, video's of geluid uploaden" : undefined}
          data-tip={compact ? undefined : "Kies foto's, video's of geluid op je toestel"}
          onClick={() => files.current?.click()}
        >
          <ImageUp size={compact ? 18 : 16} />
          {!compact && ' Uploaden'}
        </button>
      )}
    </>
  )
}

/** Records a voice memo; a second tap stops and saves it. */
function VoiceButton({ houseId, item, compact }: { houseId: string; item: string | null; compact: boolean }) {
  const { notify } = useStore()
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; start: number } | null>(null)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [recording])
  if (!canRecord()) return null

  async function start() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      notify('Geen toegang tot de microfoon. Sta die toe in je browser of app-instellingen.', 'error')
      return
    }
    const type = recorderType()
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    const began = Date.now()
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      setRecording(null)
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' })
      if (blob.size) void addRecording(houseId, item, blob, (Date.now() - began) / 1000)
    }
    recorder.start(1000)
    setNow(began)
    setRecording({ recorder, start: began })
  }

  const seconds = recording ? Math.max(0, (now - recording.start) / 1000) : 0
  const cls = compact ? 'check-btn media-btn' : 'btn btn-small btn-ghost'
  return (
    <button
      type="button"
      className={`${cls}${recording ? ' recording' : ''}`}
      aria-pressed={Boolean(recording)}
      aria-label={compact ? (recording ? 'Opname stoppen' : 'Spraakmemo opnemen') : undefined}
      data-tip={compact ? undefined : recording ? 'Stop en bewaar de memo' : 'Neem een spraakmemo op'}
      onClick={() => (recording ? recording.recorder.stop() : void start().catch((e) => notify(errorText(e), 'error')))}
    >
      {recording ? <Square size={compact ? 16 : 14} fill="currentColor" /> : <Mic size={compact ? 18 : 16} />}
      {recording ? <span className="rec-time">{formatDuration(seconds)}</span> : !compact && ' Spraakmemo'}
    </button>
  )
}

/** One photo, video or memo full size, with what it belongs to, a note and delete. */
export function MediaViewer({
  house,
  list,
  index,
  onIndex,
  categories,
  onClose,
}: {
  house: House
  list: Media[]
  index: number
  onIndex: (i: number) => void
  categories: ChecklistCategory[]
  onClose: () => void
}) {
  const { people, replace, notify } = useStore()
  const media = list[index]
  const ref = useRef<HTMLDialogElement>(null)
  const [note, setNote] = useState(media.note)
  useEffect(() => setNote(media.note), [media.id, media.note])
  useModalDialog(ref)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < list.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, list.length, onIndex])

  async function change(changes: { item?: string | null; note?: string }) {
    try {
      await api.updateMedia(media.id, changes)
      replace(await api.house(house.id))
    } catch (e) {
      notify(`Niet opgeslagen: ${errorText(e)}`, 'error')
    }
  }

  async function remove() {
    if (!confirm('Dit bestand verwijderen? Ook voor de anderen.')) return
    try {
      await api.deleteMedia(media.id)
      onClose()
      replace(await api.house(house.id))
    } catch (e) {
      notify(errorText(e), 'error')
    }
  }

  const who = media.person ? personInfo(people, media.person) : null
  const when = new Date(media.createdAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <dialog ref={ref} className="media-viewer" onClose={onClose} onCancel={onClose}>
      <div className="media-viewer-head">
        <span className="media-viewer-who">
          {who && <PersonDot person={who} />}
          {who?.naam ?? ''} · {when}
        </span>
        <span className="media-viewer-count">
          {index + 1} / {list.length}
        </span>
        <button className="icon-btn" aria-label="Sluiten" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <div className="media-viewer-stage">
        {media.kind === 'foto' && <img key={media.id} src={mediaUrl(media.id)} alt={media.note || 'Foto'} />}
        {media.kind === 'video' && (
          <video key={media.id} src={mediaUrl(media.id)} poster={media.thumb ? thumbUrl(media.id) : undefined} controls playsInline />
        )}
        {media.kind === 'audio' && (
          <div className="media-viewer-audio">
            <Mic size={40} />
            <audio key={media.id} src={mediaUrl(media.id)} controls />
          </div>
        )}
        {index > 0 && (
          <button className="media-nav prev" aria-label="Vorige" onClick={() => onIndex(index - 1)}>
            <ChevronLeft size={26} />
          </button>
        )}
        {index < list.length - 1 && (
          <button className="media-nav next" aria-label="Volgende" onClick={() => onIndex(index + 1)}>
            <ChevronRight size={26} />
          </button>
        )}
      </div>
      <div className="media-viewer-foot">
        <label className="field">
          <span>Hoort bij</span>
          <select value={media.item ?? ''} onChange={(e) => void change({ item: e.target.value || null })}>
            <option value="">Het huis in het algemeen</option>
            {categories.map((c) => (
              <optgroup key={c.id} label={c.titel}>
                {c.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.tekst}
                  </option>
                ))}
              </optgroup>
            ))}
            {media.item && !categories.some((c) => c.items.some((i) => i.id === media.item)) && (
              <option value={media.item}>Een punt dat niet meer op de lijst staat</option>
            )}
          </select>
        </label>
        <label className="field">
          <span>Notitie</span>
          <input
            value={note}
            placeholder="Wat is hier te zien?"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== media.note && void change({ note })}
          />
        </label>
        <div className="row">
          <a className="btn btn-small btn-ghost" href={mediaUrl(media.id)} download={media.name ?? undefined}>
            Downloaden
          </a>
          <button className="btn btn-small btn-ghost danger" onClick={() => void remove()}>
            <Trash2 size={16} /> Verwijderen
          </button>
        </div>
      </div>
    </dialog>
  )
}

/** The house's photos, videos and memos that belong to no checklist item. */
export function GeneralMedia({ house, categories }: { house: House; categories: ChecklistCategory[] }) {
  const known = new Set(categories.flatMap((c) => c.items.map((i) => i.id)))
  const atItems = (house.record.media ?? []).filter((m) => m.item && known.has(m.item)).length
  return (
    <section className="panel general-media">
      <h2>Foto's en memo's</h2>
      <div className="media-actions">
        <MediaActions houseId={house.id} item={null} />
      </div>
      <MediaTiles house={house} item={null} categories={categories} />
      {atItems > 0 && (
        <p className="muted small">
          En {atItems} bij de punten hieronder.
        </p>
      )}
    </section>
  )
}
