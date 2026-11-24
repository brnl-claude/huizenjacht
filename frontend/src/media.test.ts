import { describe, expect, it } from 'vitest'
import { formatDuration, kindOf } from './media'
import { likelyHouse } from './SharePage'
import type { House } from './house'

describe('media', () => {
  it('knows photos, videos and sound', () => {
    expect(kindOf('image/heic')).toBe('foto')
    expect(kindOf('video/mp4')).toBe('video')
    expect(kindOf('audio/webm;codecs=opus')).toBe('audio')
    expect(kindOf('application/pdf')).toBeNull()
  })

  it('shows durations as minutes and seconds', () => {
    expect(formatDuration(5.4)).toBe('0:05')
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(null)).toBe('')
  })
})

describe('likelyHouse', () => {
  const house = (id: string, bezichtiging?: string, status = 'bezichtiging') =>
    ({ id, status, mine: { bezichtiging } }) as unknown as House
  const now = Date.parse('2026-11-24T15:00:00')

  it('picks the viewing that is now or just was', () => {
    const houses = [
      house('gisteren', '2026-11-23T10:00:00'),
      house('vanmiddag', '2026-11-24T14:00:00'),
      house('volgende-week', '2026-12-01T10:00:00'),
      house('afgevallen', '2026-11-24T14:30:00', 'afgevallen'),
    ]
    expect(likelyHouse(houses, now)?.id).toBe('vanmiddag')
  })

  it('picks none without a viewing', () => {
    expect(likelyHouse([house('a')], now)).toBeUndefined()
  })
})
