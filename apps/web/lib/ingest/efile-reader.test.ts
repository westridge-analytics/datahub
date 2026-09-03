/**
 * Streaming-archive reader tests.
 *
 *   cd apps/web && npm run test:unit
 *
 * Runs against __fixtures__/efile-archive.zip — a real ZIP built from real
 * returns lifted out of 2026_TEOS_XML_01A.zip, deliberately including two of
 * each form type, an unsupported 990-T, a non-Return XML document, and a
 * non-XML file. Production injects the browser's native DOMParser; these tests
 * inject @xmldom/xmldom and drive the same streaming path.
 *
 * Pure Node: no browser needed, because Blob and ReadableStream are global.
 */

import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOMParser } from '@xmldom/xmldom'
import { readEfileArchive, readEfileKeys } from './efile-reader.ts'
import type { EfileRow } from './efile-map.ts'

const parseXml = (text: string) =>
  new DOMParser().parseFromString(text, 'text/xml') as unknown as Document

function archive(): Blob {
  const buf = readFileSync(new URL('./__fixtures__/efile-archive.zip', import.meta.url))
  return new Blob([buf])
}

describe('readEfileArchive', () => {
  let rows: EfileRow[] = []
  let skips: { reason: string; returnType: string | null }[] = []
  let stats: Awaited<ReturnType<typeof readEfileArchive>>

  before(async () => {
    rows = []
    skips = []
    stats = await readEfileArchive(archive(), {
      sourceFile: 'efile-archive.zip',
      parseXml,
      onRow: (r) => { rows.push(r) },
      onSkip: (reason, returnType) => { skips.push({ reason, returnType }) },
    })
  })

  test('streams every XML entry and ignores non-XML files', () => {
    // 8 real returns + 1 non-Return XML = 9; readme.txt must not be counted
    assert.equal(stats.entries, 9, 'readme.txt should never enter the pipeline')
  })

  test('maps the supported forms and rejects the rest', () => {
    assert.equal(stats.mapped, 6, 'two each of 990, 990EZ, 990PF')
    assert.equal(stats.skipped, 3, 'two 990-T plus one non-Return document')
    assert.equal(rows.length, stats.mapped)
  })

  test('reports skips by cause, never as an unexplained total', () => {
    assert.equal(stats.byReason.unsupported_form, 2)
    assert.equal(stats.byReason.malformed, 1)
    assert.equal(stats.byReason.missing_ein, 0)
    assert.equal(stats.byReason.bad_tax_period, 0)
  })

  test('names the unsupported return types so the operator sees what was dropped', () => {
    assert.deepEqual(stats.unsupportedTypes, { '990T': 2 })
  })

  test('every mapped row carries e-file provenance', () => {
    for (const r of rows) {
      assert.equal(r.data_source, 'efile_xml')
      assert.equal(r.source_file, 'efile-archive.zip')
      assert.match(String(r.object_id), /^\d{12,}$/, 'object_id comes from the entry name')
      assert.match(r.ein, /^\d{2}-\d{7}$/)
      assert.match(r.tax_period, /^\d{4}-\d{2}-01$/)
    }
  })

  test('covers all three supported form types', () => {
    const forms = [...new Set(rows.map((r) => r.form_type))].sort()
    assert.deepEqual(forms, ['990', '990EZ', '990PF'])
  })

  test('organization name and state come through for the org upsert', () => {
    // The whole point of the e-file path being able to create organizations the
    // BMF lacks. State may legitimately be null for a foreign filer.
    assert.ok(rows.every((r) => typeof r.name === 'string' && String(r.name).length > 1),
      'every return must yield a usable organization name')
  })

  test('reads the whole archive', () => {
    assert.ok(stats.bytesRead > 0)
  })

  test('one unreadable entry does not abort the load', () => {
    // The non-Return document is skipped while all 6 real returns still map.
    assert.equal(stats.mapped, 6)
    assert.ok(skips.some((s) => s.reason === 'malformed'))
  })
})

describe('readEfileKeys', () => {
  test('returns just the conflict-check keys, matching the mapped rows', async () => {
    const { keys, stats } = await readEfileKeys(archive(), {
      sourceFile: 'efile-archive.zip',
      parseXml,
    })
    assert.equal(keys.length, stats.mapped)
    for (const k of keys) {
      assert.match(k.ein, /^\d{2}-\d{7}$/)
      assert.match(k.tax_period, /^\d{4}-\d{2}-01$/,
        'keys must be in the same format the preflight route matches on')
    }
  })

  test('key format is identical to what the full read produces', async () => {
    const { keys } = await readEfileKeys(archive(), { sourceFile: 'x', parseXml })
    const rows: EfileRow[] = []
    await readEfileArchive(archive(), {
      sourceFile: 'x', parseXml, onRow: (r) => { rows.push(r) },
    })
    assert.deepEqual(
      keys.map((k) => `${k.ein}|${k.tax_period}`).sort(),
      rows.map((r) => `${r.ein}|${r.tax_period}`).sort(),
      'the two passes must agree, or the conflict check describes a different load',
    )
  })
})

describe('cancellation', () => {
  test('stops early when asked', async () => {
    let seen = 0
    const stats = await readEfileArchive(archive(), {
      sourceFile: 'x',
      parseXml,
      onRow: () => { seen++ },
      cancelled: () => seen >= 1,
    })
    assert.ok(stats.entries <= 9)
  })
})
