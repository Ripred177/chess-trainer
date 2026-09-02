/**
 * Profile rules that are easy to get subtly wrong and painful to notice: the
 * daily streak, and restarting a Woodpecker set without losing its history.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ProfileStore only touches electron to find userData, and the tests supply a
// path of their own, so a stub is enough to import the module.
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { ProfileStore } = await import('./profile')

let dir: string
let store: InstanceType<typeof ProfileStore>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chess-profile-'))
  store = new ProfileStore(join(dir, 'profile.json'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function play(date: string, solved: boolean): ReturnType<typeof store.recordDaily> {
  return store.recordDaily({ date, puzzleId: `p_${date}`, solved, ms: 1000, hints: 0 })
}

describe('daily streak', () => {
  it('counts a day you played but did not solve', () => {
    // The point of the change: turning up is the habit being tracked, so a
    // hard puzzle you got wrong must not cost you the run.
    const streak = play('2026-03-01', false)
    expect(streak.current).toBe(1)
  })

  it('extends across consecutive days regardless of the result', () => {
    play('2026-03-01', true)
    play('2026-03-02', false)
    const streak = play('2026-03-03', false)
    expect(streak.current).toBe(3)
    expect(streak.longest).toBe(3)
  })

  it('resets after a missed day', () => {
    play('2026-03-01', true)
    play('2026-03-02', true)
    const streak = play('2026-03-04', true)
    expect(streak.current).toBe(1)
    // The best run so far survives the reset.
    expect(streak.longest).toBe(2)
  })

  it('does not inflate when the same day is recorded twice', () => {
    play('2026-03-01', false)
    // Replaying the day should update the record but never the streak.
    const streak = play('2026-03-01', true)
    expect(streak.current).toBe(1)
    expect(store.get().daily['2026-03-01'].solved).toBe(true)
  })

  it('keeps solved days distinguishable from played ones', () => {
    play('2026-03-01', true)
    play('2026-03-02', false)
    const daily = store.get().daily
    expect(Object.values(daily).filter((d) => d.solved)).toHaveLength(1)
    expect(Object.keys(daily)).toHaveLength(2)
  })
})

describe('profile durability', () => {
  // These exist because a profile really was lost: the file went missing and
  // the app started fresh over the top of it, which made the loss permanent.
  const path = () => join(dir, 'profile.json')

  it('keeps a backup alongside the profile', () => {
    play('2026-03-01', true)
    store.saveNow()
    play('2026-03-02', true)
    store.saveNow()
    expect(existsSync(`${path()}.bak`)).toBe(true)
  })

  it('recovers history when the profile file disappears', () => {
    play('2026-03-01', true)
    store.saveNow()
    play('2026-03-02', true)
    store.saveNow()

    // Losing the live file must not mean losing the player's history.
    rmSync(path())
    const reopened = new ProfileStore(path())
    expect(Object.keys(reopened.get().daily).length).toBeGreaterThan(0)
    expect(reopened.get().streak.current).toBeGreaterThan(0)
  })

  it('recovers from the backup when the profile is unreadable', () => {
    play('2026-03-01', true)
    store.saveNow()
    play('2026-03-02', true)
    store.saveNow()

    writeFileSync(path(), '{ not json at all', 'utf8')
    const reopened = new ProfileStore(path())
    expect(reopened.get().streak.current).toBeGreaterThan(0)
    // The unreadable file is kept rather than silently dropped.
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('reads a profile written with a byte-order mark', () => {
    play('2026-03-01', true)
    store.saveNow()
    const text = readFileSync(path(), 'utf8')
    // A BOM is what PowerShell's `Set-Content -Encoding utf8` produces, and
    // JSON.parse rejects it outright.
    writeFileSync(path(), '﻿' + text, 'utf8')

    const reopened = new ProfileStore(path())
    expect(reopened.get().streak.current).toBe(1)
  })

  it('starts fresh only when there is genuinely nothing to read', () => {
    const empty = new ProfileStore(join(dir, 'nothing-here.json'))
    expect(empty.get().attempts).toEqual([])
    expect(empty.get().streak.current).toBe(0)
  })
})

describe('woodpecker', () => {
  const seed = {
    label: 'test set',
    puzzleIds: ['a', 'b', 'c'],
    minRating: 1200,
    maxRating: 1600,
    themes: ['fork']
  }

  it('keeps progress so a set can be resumed', () => {
    store.startWoodpecker(seed)
    store.recordWoodpecker({ solved: true, ms: 500 })

    // A fresh store over the same file is what reopening the app looks like.
    store.saveNow()
    const reopened = new ProfileStore(join(dir, 'profile.json'))
    const set = reopened.get().training.woodpecker

    expect(set).not.toBeNull()
    expect(set!.cursor).toBe(1)
    expect(set!.cycles[0].solved).toBe(1)
  })

  it('restarts the same puzzles from cycle one', () => {
    const original = store.startWoodpecker(seed)
    store.recordWoodpecker({ solved: true, ms: 500 })
    store.recordWoodpecker({ solved: false, ms: 500 })

    const restarted = store.restartWoodpecker()

    expect(restarted).not.toBeNull()
    // Same material, in the same order — that is the whole method.
    expect(restarted!.puzzleIds).toEqual(original.puzzleIds)
    expect(restarted!.cursor).toBe(0)
    expect(restarted!.cycles).toHaveLength(1)
    expect(restarted!.cycles[0].solved).toBe(0)
    expect(restarted!.id).not.toBe(original.id)
  })

  it('archives the abandoned run rather than dropping its times', () => {
    store.startWoodpecker(seed)
    store.recordWoodpecker({ solved: true, ms: 500 })
    store.restartWoodpecker()

    const archive = store.get().training.woodpeckerArchive
    expect(archive).toHaveLength(1)
    expect(archive[0].cycles[0].solved).toBe(1)
  })

  it('does nothing when no set is running', () => {
    expect(store.restartWoodpecker()).toBeNull()
  })
})
