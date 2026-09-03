/**
 * Field-mapping tests for the browser uploader.
 *
 *   cd apps/web && npm run test:unit
 *
 * The rows below use the REAL header spellings taken from the actual IRS
 * extracts, which is the whole point: the uploader silently filtered every row
 * of 24eoextract990.csv because that file leads with `efile,EIN,tax_pd,...`
 * while field-map.ts looked for `elf` and `ein`. Every row failed
 * isForm990Row, the conflict check reported 0 rows, and nothing loaded.
 *
 * Pure — no database, no network.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalHeader,
  isForm990Row,
  mapRow,
  normalizeEin,
  taxPeriodToDate,
  parseNumber,
} from './field-map.ts'

/** Apply canonicalHeader the way PapaParse's transformHeader does. */
function parseRow(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [canonicalHeader(k), v]))
}

// Header spellings verified against docs/990_data/file_data/24eoextract990.csv,
// whose first columns are literally: efile,EIN,tax_pd,subseccd,...
const CSV_ERA_ROW = {
  efile: 'E',
  EIN: '123456789',
  tax_pd: '202412',
  totrevenue: '4120556',
  totfuncexpns: '3980112',
  totassetsend: '9100000',
  totliabend: '1200000',
  totnetassetend: '7900000',
  totcntrbgfts: '3000000',
  totprgmrevnue: '900000',
  invstmntinc: '120556',
  nonintcashend: '450000',
  lndbldgsequipend: '2200000',
}

// The older extracts (py12–17eo) spell the indicator `elf` and lowercase the EIN.
const DAT_ERA_ROW = {
  elf: 'E',
  ein: '987654321',
  tax_pd: '201512',
  totrevenue: '1000',
}

describe('canonicalHeader', () => {
  test('lowercases, trims, and strips a BOM', () => {
    assert.equal(canonicalHeader('EIN'), 'ein')
    assert.equal(canonicalHeader('  tax_pd  '), 'tax_pd')
    assert.equal(canonicalHeader('﻿efile'), 'efile')
    assert.equal(canonicalHeader('totRevenue'), 'totrevenue')
  })
})

describe('isForm990Row', () => {
  test('accepts the CSV-era `efile` spelling', () => {
    assert.equal(isForm990Row(parseRow(CSV_ERA_ROW), 'csv'), true)
  })

  test('accepts the older `elf` spelling', () => {
    assert.equal(isForm990Row(parseRow(DAT_ERA_ROW), 'csv'), true)
  })

  test('accepts the hyphenated `e-file` spelling', () => {
    assert.equal(isForm990Row(parseRow({ 'e-file': 'E', EIN: '1', tax_pd: '202412' }), 'csv'), true)
  })

  test('rejects paper and non-990 filings', () => {
    assert.equal(isForm990Row(parseRow({ efile: 'P', EIN: '1' }), 'csv'), false)
    assert.equal(isForm990Row(parseRow({ efile: '', EIN: '1' }), 'csv'), false)
  })

  test('a row with no indicator column at all is rejected, not crashed on', () => {
    assert.equal(isForm990Row(parseRow({ EIN: '1' }), 'csv'), false)
  })
})

describe('mapRow with real header spellings', () => {
  test('maps a CSV-era row despite the uppercase EIN column', () => {
    const mapped = mapRow(parseRow(CSV_ERA_ROW), 'csv', '24eoextract990.csv')
    assert.ok(mapped, 'row must map — an uppercase EIN header used to return null')
    assert.equal(mapped.ein, '12-3456789')
    assert.equal(mapped.tax_period, '2024-12-01')
    assert.equal(mapped.fiscal_year, 2024)
    assert.equal(mapped.total_revenue, 4120556)
    assert.equal(mapped.total_assets, 9100000)
    assert.equal(mapped.source_file, '24eoextract990.csv')
  })

  test('derives other_revenue from the components', () => {
    const mapped = mapRow(parseRow(CSV_ERA_ROW), 'csv', 'x.csv')
    // 4120556 - 3000000 - 900000 - 120556
    assert.equal(mapped?.other_revenue, 100000)
  })

  test('returns null when the EIN is absent', () => {
    assert.equal(mapRow(parseRow({ efile: 'E', tax_pd: '202412' }), 'csv', 'x.csv'), null)
  })

  test('returns null when the tax period is unusable', () => {
    assert.equal(mapRow(parseRow({ efile: 'E', EIN: '1', tax_pd: '2024' }), 'csv', 'x.csv'), null)
    assert.equal(mapRow(parseRow({ efile: 'E', EIN: '1', tax_pd: '202413' }), 'csv', 'x.csv'), null)
  })
})

describe('helpers', () => {
  test('normalizeEin zero-pads and hyphenates', () => {
    assert.equal(normalizeEin('123456789'), '12-3456789')
    assert.equal(normalizeEin('12345678'), '01-2345678')
    assert.equal(normalizeEin('12-3456789'), '12-3456789')
  })

  test('taxPeriodToDate maps YYYYMM to the first of the month', () => {
    assert.equal(taxPeriodToDate('202412'), '2024-12-01')
    assert.equal(taxPeriodToDate('202406'), '2024-06-01')
    assert.equal(taxPeriodToDate(''), null)
    assert.equal(taxPeriodToDate('202400'), null)
  })

  test('parseNumber treats blanks as null, not zero', () => {
    assert.equal(parseNumber(''), null)
    assert.equal(parseNumber(undefined), null)
    assert.equal(parseNumber('0'), 0)
    assert.equal(parseNumber('4120556'), 4120556)
  })
})
