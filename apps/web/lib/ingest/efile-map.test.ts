/**
 * e-file XML mapping tests.
 *
 *   cd apps/web && npm run test:unit
 *
 * Fixtures in __fixtures__/ are REAL returns lifted unmodified from
 * 2026_TEOS_XML_01A.zip — the same principle as field-map.test.ts. Inventing
 * XML would only test my assumptions about the schema, which is exactly the
 * mistake that let the efile/EIN header bug survive.
 *
 * Production parses with the browser's native DOMParser; these tests inject
 * @xmldom/xmldom so the same readPath/mapEfileReturn code is exercised.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOMParser } from '@xmldom/xmldom'
import {
  mapEfileReturn,
  readPath,
  parseAmount,
  normalizeEfileEin,
  taxPeriodFromEndDate,
  submissionDateFromTs,
  objectIdFromEntryName,
  stripXmlBom,
  SUPPORTED_FORMS,
} from './efile-map.ts'

function load(name: string): Document {
  const xml = stripXmlBom(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))
  // xmldom's Document is structurally compatible with the DOM subset used here
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
}

const OPTS = { sourceFile: '2026_TEOS_XML_01A.zip', objectId: '202503609349300405' }

describe('e-file concordance coverage', () => {
  test('supports exactly 990, 990EZ and 990PF', () => {
    assert.deepEqual(SUPPORTED_FORMS.sort(), ['990', '990EZ', '990PF'])
  })
})

describe('mapEfileReturn — Form 990', () => {
  const res = mapEfileReturn(load('efile-990.xml'), OPTS)

  test('maps successfully', () => {
    assert.equal(res.ok, true, res.ok ? '' : `skipped: ${res.reason}`)
  })

  test('identity matches the SOI key format exactly', () => {
    assert.ok(res.ok)
    assert.match(res.row.ein, /^\d{2}-\d{7}$/, 'EIN must be hyphenated like the SOI path')
    assert.match(res.row.tax_period, /^\d{4}-\d{2}-01$/,
      'tax_period must be first-of-month or it stops matching existing rows')
    assert.equal(res.row.fiscal_year, Number(res.row.tax_period.slice(0, 4)))
    assert.equal(res.row.form_type, '990')
  })

  test('carries the organization name and state the SOI extracts lack', () => {
    assert.ok(res.ok)
    assert.ok(res.row.name && String(res.row.name).length > 2, 'name must be populated')
    assert.match(String(res.row.state), /^[A-Z]{2}$/)
  })

  test('records provenance', () => {
    assert.ok(res.ok)
    assert.equal(res.row.data_source, 'efile_xml')
    assert.equal(res.row.object_id, '202503609349300405')
    assert.match(String(res.row.submission_date), /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(typeof res.row.is_amended, 'boolean')
    assert.equal(res.row.source_file, '2026_TEOS_XML_01A.zip')
  })

  test('reads Part I scalars', () => {
    assert.ok(res.ok)
    for (const c of ['total_revenue', 'total_expenses', 'total_assets',
                     'total_liabilities', 'total_net_assets', 'contributions']) {
      assert.equal(typeof res.row[c], 'number', `${c} should be a number`)
    }
  })

  test('reads through *Grp containers, not just flat tags', () => {
    assert.ok(res.ok)
    // TotalFunctionalExpensesGrp/ProgramServicesAmt and CashNonInterestBearingGrp/EOYAmt
    assert.equal(typeof res.row.program_expenses, 'number')
    assert.equal(typeof res.row.cash_equiv, 'number')
  })

  test('the balance sheet balances, which proves the paths are the right ones', () => {
    assert.ok(res.ok)
    const assets = res.row.total_assets as number
    const liabilities = res.row.total_liabilities as number
    const net = res.row.total_net_assets as number
    assert.equal(assets - liabilities, net,
      'assets - liabilities must equal net assets; a mismatch means a mismapped path')
  })

  test('revenue components sum to total revenue', () => {
    assert.ok(res.ok)
    const n = (v: unknown) => (typeof v === 'number' ? v : 0)
    const sum = n(res.row.contributions) + n(res.row.program_revenue) +
                n(res.row.investment_income) + n(res.row.other_revenue)
    assert.equal(sum, res.row.total_revenue,
      'Part I revenue lines must reconcile to CYTotalRevenueAmt')
  })

  // Reconciles on this fixture, but deliberately NOT asserted as a universal
  // invariant: measured across all 7,180 990s in 2026_TEOS_XML_01A.zip, the
  // three functional columns sum to the filer's own Part IX total in 93.8% of
  // returns. The other 6% are filers whose split does not add up — Part IX
  // total does match Part I total in 99.96% of cases, so total_expenses is
  // sound and the discrepancy is source data quality, not a mismapped path.
  test('functional expense split reconciles on this return', () => {
    assert.ok(res.ok)
    const n = (v: unknown) => (typeof v === 'number' ? v : 0)
    const sum = n(res.row.program_expenses) + n(res.row.ga_expenses) +
                n(res.row.fundraising_expenses)
    assert.equal(sum, res.row.total_expenses)
  })
})

describe('mapEfileReturn — Form 990-EZ', () => {
  const res = mapEfileReturn(load('efile-990ez.xml'), { sourceFile: 'x.zip' })

  test('maps successfully with its own vocabulary', () => {
    assert.ok(res.ok, res.ok ? '' : `skipped: ${res.reason}`)
    assert.equal(res.row.form_type, '990EZ')
    assert.equal(typeof res.row.total_revenue, 'number')
    assert.equal(typeof res.row.total_expenses, 'number')
  })

  test('reads assets and liabilities through EZ-specific containers', () => {
    assert.ok(res.ok)
    // Form990TotalAssetsGrp/EOYAmt and SumOfTotalLiabilitiesGrp/EOYAmt
    assert.equal(typeof res.row.total_assets, 'number')
    assert.equal(typeof res.row.total_liabilities, 'number')
  })

  test('other_revenue is derived, since the EZ has no such line', () => {
    assert.ok(res.ok)
    const n = (v: unknown) => (typeof v === 'number' ? v : 0)
    assert.equal(
      res.row.other_revenue,
      n(res.row.total_revenue) - n(res.row.contributions) -
        n(res.row.program_revenue) - n(res.row.investment_income),
    )
  })

  test('leaves the functional-expense split null rather than guessing at zero', () => {
    assert.ok(res.ok)
    assert.equal(res.row.ga_expenses, undefined, 'not in the EZ concordance at all')
    assert.equal(res.row.fundraising_expenses, undefined)
  })
})

describe('mapEfileReturn — Form 990-PF', () => {
  const res = mapEfileReturn(load('efile-990pf.xml'), { sourceFile: 'x.zip' })

  test('maps through two levels of nesting', () => {
    assert.ok(res.ok, res.ok ? '' : `skipped: ${res.reason}`)
    assert.equal(res.row.form_type, '990PF')
    // Form990PFBalanceSheetsGrp/TotalAssetsEOYAmt
    assert.equal(typeof res.row.total_assets, 'number')
    assert.ok((res.row.total_assets as number) > 1_000_000, 'fixture was chosen for real figures')
  })

  test('the PF balance sheet reconciles', () => {
    assert.ok(res.ok)
    const assets = res.row.total_assets as number
    const liabilities = res.row.total_liabilities as number
    assert.equal(assets - liabilities, res.row.total_net_assets)
  })

  test('program_revenue stays null — a foundation has no such line', () => {
    assert.ok(res.ok)
    assert.equal(res.row.program_revenue, undefined)
  })
})

describe('mapEfileReturn — rejections are explicit, never silent', () => {
  test('990-T is reported as unsupported, with its type', () => {
    const res = mapEfileReturn(load('efile-990t.xml'), { sourceFile: 'x.zip' })
    assert.equal(res.ok, false)
    assert.ok(!res.ok)
    assert.equal(res.reason, 'unsupported_form')
    assert.equal(res.returnType, '990T', 'the caller needs the type to report a breakdown')
  })

  test('a non-Return document is malformed, not a crash', () => {
    const doc = new DOMParser().parseFromString('<Foo/>', 'text/xml') as unknown as Document
    const res = mapEfileReturn(doc, { sourceFile: 'x.zip' })
    assert.ok(!res.ok)
    assert.equal(res.reason, 'malformed')
  })
})

describe('path resolution', () => {
  test('readPath only follows direct children, never descendants', () => {
    const doc = new DOMParser().parseFromString(
      `<Return xmlns="http://www.irs.gov/efile">
         <ReturnData><IRS990>
           <TotalFunctionalExpensesGrp><TotalAmt>100</TotalAmt></TotalFunctionalExpensesGrp>
           <Nested><TotalAmt>999</TotalAmt></Nested>
         </IRS990></ReturnData>
       </Return>`, 'text/xml') as unknown as Document
    const root = doc.documentElement
    assert.equal(readPath(root, 'ReturnData/IRS990/TotalFunctionalExpensesGrp/TotalAmt'), '100')
    assert.equal(readPath(root, 'ReturnData/IRS990/TotalAmt'), null,
      'a descendant search would wrongly return 999 or 100 here')
  })

  test('a missing path yields null rather than throwing', () => {
    const res = readPath(load('efile-990.xml').documentElement, 'ReturnData/IRS990/NoSuchThing')
    assert.equal(res, null)
  })
})

describe('value coercion', () => {
  test('stripXmlBom removes a leading BOM and leaves clean text alone', () => {
    assert.equal(stripXmlBom('\uFEFF<?xml version="1.0"?>'), '<?xml version="1.0"?>')
    assert.equal(stripXmlBom('<?xml version="1.0"?>'), '<?xml version="1.0"?>')
  })

  test('parseAmount handles blanks, zero and negatives', () => {
    assert.equal(parseAmount(null), null)
    assert.equal(parseAmount(''), null)
    assert.equal(parseAmount('0'), 0)
    assert.equal(parseAmount('-8582'), -8582)
    assert.equal(parseAmount('4120556'), 4120556)
  })

  test('normalizeEfileEin matches the SOI path byte for byte', () => {
    assert.equal(normalizeEfileEin('561388932'), '56-1388932')
    assert.equal(normalizeEfileEin('12345678'), '01-2345678')
  })

  test('taxPeriodFromEndDate collapses to first-of-month', () => {
    assert.equal(taxPeriodFromEndDate('2024-12-31'), '2024-12-01')
    assert.equal(taxPeriodFromEndDate('2025-06-30'), '2025-06-01')
    assert.equal(taxPeriodFromEndDate(null), null)
    assert.equal(taxPeriodFromEndDate('garbage'), null)
    assert.equal(taxPeriodFromEndDate('2024-13-01'), null)
  })

  test('submissionDateFromTs takes the date part of an ISO timestamp', () => {
    assert.equal(submissionDateFromTs('2025-12-26T11:27:30-05:00'), '2025-12-26')
    assert.equal(submissionDateFromTs(null), null)
  })

  test('objectIdFromEntryName reads the archive naming convention', () => {
    assert.equal(objectIdFromEntryName('202503609349100000_public.xml'), '202503609349100000')
    assert.equal(objectIdFromEntryName('nonsense.xml'), null)
  })
})
