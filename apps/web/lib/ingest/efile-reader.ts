/**
 * Streaming reader for an IRS e-file archive.
 *
 * The largest monthly archive is 521 MB compressed and ~2.7 GB uncompressed
 * across 168,344 returns, so nothing here may hold the archive — or its
 * expansion — in memory. fflate's Unzip streams entries as the file's bytes
 * arrive, and each entry (26 KB median, 1 MB worst case) is buffered only for
 * as long as it takes to parse and map it.
 *
 * The XML parser is injectable. Production passes the browser's native
 * DOMParser, which is C++ and materially faster over 2.7 GB; tests inject
 * @xmldom/xmldom and exercise this exact streaming path against a real ZIP.
 */

import { Unzip, UnzipInflate } from 'fflate'
import {
  mapEfileReturn,
  objectIdFromEntryName,
  stripXmlBom,
  type EfileMapResult,
  type EfileRow,
  type EfileSkipReason,
} from './efile-map.ts'

/** Yield to the event loop this often, so the tab stays responsive. */
const YIELD_EVERY = 250

/**
 * Bytes fed to the unzipper per push.
 *
 * fflate's `Unzip.push` recurses once per entry boundary contained in the
 * chunk it is given, so the chunk size sets the recursion depth. We slice the
 * Blob ourselves rather than trusting `stream()`: Node handed the whole 68 MB
 * archive over as a single chunk, which recursed ~12,000 deep and threw
 * "Maximum call stack size exceeded", and browser chunk sizes are not
 * guaranteed either. At 256 KB the depth stays in the tens even for an archive
 * of unusually small returns.
 */
export const CHUNK_BYTES = 256 * 1024

export interface ReadStats {
  entries: number
  mapped: number
  skipped: number
  /** Skips broken down by cause — a load must never report a silent zero. */
  byReason: Record<EfileSkipReason, number>
  /** Return types seen but not supported, e.g. { '990T': 321 }. */
  unsupportedTypes: Record<string, number>
  bytesRead: number
}

export type XmlParse = (text: string) => Document

export interface ReadOptions {
  sourceFile: string
  /** Override the push size; tests use a tiny value to prove chunking works. */
  chunkBytes?: number
  /** Injected in tests; defaults to the browser's native DOMParser. */
  parseXml?: XmlParse
  /** Return true to abort mid-stream. */
  cancelled?: () => boolean
  /** Called with every successfully mapped return, in archive order. */
  onRow?: (row: EfileRow) => void | Promise<void>
  /** Called with each rejected return, so callers can report by cause. */
  onSkip?: (reason: EfileSkipReason, returnType: string | null, entry: string) => void
  /** Progress ticks, roughly every YIELD_EVERY entries. */
  onProgress?: (stats: ReadStats) => void
}

function emptyStats(): ReadStats {
  return {
    entries: 0,
    mapped: 0,
    skipped: 0,
    byReason: { unsupported_form: 0, missing_ein: 0, bad_tax_period: 0, malformed: 0 },
    unsupportedTypes: {},
    bytesRead: 0,
  }
}

function defaultParse(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml')
}

/**
 * Stream every return out of `file`, mapping each one.
 *
 * Resolves when the archive is exhausted or `cancelled()` returns true.
 * Rejects only on a corrupt archive; an individual unreadable return is a
 * counted skip, not a failure — one bad entry must not lose the other 168,343.
 */
export async function readEfileArchive(
  file: Blob,
  opts: ReadOptions,
): Promise<ReadStats> {
  const parseXml = opts.parseXml ?? defaultParse
  const stats = emptyStats()
  const decoder = new TextDecoder('utf-8')

  // Entries complete asynchronously as bytes arrive, so mapping work is queued
  // and drained between reads rather than racing the stream.
  const pending: { entry: string; text: string }[] = []

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (entry) => {
    if (!entry.name.endsWith('.xml')) return
    const chunks: Uint8Array[] = []
    entry.ondata = (err, chunk, final) => {
      if (err) {
        // A single corrupt entry is a skip, not the end of the load.
        stats.entries++
        stats.skipped++
        stats.byReason.malformed++
        opts.onSkip?.('malformed', null, entry.name)
        return
      }
      if (chunk.length) chunks.push(chunk)
      if (final) {
        let total = 0
        for (const c of chunks) total += c.length
        const joined = new Uint8Array(total)
        let at = 0
        for (const c of chunks) {
          joined.set(c, at)
          at += c.length
        }
        chunks.length = 0
        pending.push({ entry: entry.name, text: decoder.decode(joined) })
      }
    }
    entry.start()
  }

  const drain = async () => {
    while (pending.length > 0) {
      const { entry, text } = pending.shift()!
      stats.entries++
      let result: EfileMapResult
      try {
        result = mapEfileReturn(parseXml(stripXmlBom(text)), {
          sourceFile: opts.sourceFile,
          objectId: objectIdFromEntryName(entry),
        })
      } catch {
        result = { ok: false, reason: 'malformed', returnType: null }
      }
      if (result.ok) {
        stats.mapped++
        await opts.onRow?.(result.row)
      } else {
        stats.skipped++
        stats.byReason[result.reason]++
        if (result.reason === 'unsupported_form' && result.returnType) {
          stats.unsupportedTypes[result.returnType] =
            (stats.unsupportedTypes[result.returnType] ?? 0) + 1
        }
        opts.onSkip?.(result.reason, result.returnType, entry)
      }
      if (stats.entries % YIELD_EVERY === 0) {
        opts.onProgress?.(stats)
        // Hand the event loop back so the UI can paint and stay clickable.
        await new Promise((r) => setTimeout(r, 0))
        if (opts.cancelled?.()) return
      }
    }
  }

  // Explicit slicing, not stream chunking — see CHUNK_BYTES.
  const chunk = opts.chunkBytes ?? CHUNK_BYTES
  for (let at = 0; at < file.size; at += chunk) {
    if (opts.cancelled?.()) break
    const bytes = new Uint8Array(await file.slice(at, at + chunk).arrayBuffer())
    stats.bytesRead += bytes.byteLength
    unzip.push(bytes, at + chunk >= file.size)
    await drain()
  }
  if (!opts.cancelled?.() && file.size === 0) unzip.push(new Uint8Array(0), true)

  opts.onProgress?.(stats)
  return stats
}

/**
 * Keys only, for the conflict check. Deliberately a separate pass rather than
 * buffering 168,344 mapped rows: keys cost ~40 bytes each (about 7 MB for the
 * largest archive) where the rows would be well over 100 MB. The archive is
 * streamed twice — once to see what a load will collide with, once to load it —
 * which mirrors how the CSV path already behaves.
 */
export async function readEfileKeys(
  file: Blob,
  opts: Omit<ReadOptions, 'onRow'>,
): Promise<{ keys: { ein: string; tax_period: string }[]; stats: ReadStats }> {
  const keys: { ein: string; tax_period: string }[] = []
  const stats = await readEfileArchive(file, {
    ...opts,
    onRow: (row) => {
      keys.push({ ein: row.ein, tax_period: row.tax_period })
    },
  })
  return { keys, stats }
}
