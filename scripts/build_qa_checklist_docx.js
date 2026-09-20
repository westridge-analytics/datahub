/**
 * Render docs/EXPERT_QA_CHECKLIST.md as a Word document for an external reviewer.
 *
 * Parses the subset of Markdown the checklist actually uses: H2/H3 headings,
 * paragraphs, bullet lists, pipe tables, and inline **bold** / `code`.
 */
const fs = require('fs')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, PageOrientation, Footer, PageNumber, TabStopType,
} = require('docx')

const SRC = '/Users/jmart/claude/westridge/datahub/docs/EXPERT_QA_CHECKLIST.md'
const OUT = process.argv[2] || 'Westridge-990-Expert-QA-Checklist.docx'

const INK = '10232B'
const INK2 = '3D5A63'
const ACCENT = '5580B0'
const RULE = 'BDD3DC'
const WASH = 'EAEEEC'
const HEAD = 'D7E8EE'

// US Letter, 1" margins
const PAGE = { size: { width: 12240, height: 15840 }, orientation: PageOrientation.PORTRAIT }
const MARGIN = { top: 1440, right: 1440, bottom: 1440, left: 1440 }
const CONTENT_W = 12240 - 2880

// ── inline markdown → TextRuns ──────────────────────────────────────────────
function runs(text, base = {}) {
  const out = []
  // split on **bold**, `code`, and *italic*
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }))
    const tok = m[0]
    if (tok.startsWith('**')) {
      out.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }))
    } else if (tok.startsWith('`')) {
      out.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas', size: 19, ...base }))
    } else {
      out.push(new TextRun({ text: tok.slice(1, -1), italics: true, ...base }))
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }))
  return out.length ? out : [new TextRun({ text: '', ...base })]
}

function para(text, opts = {}) {
  const { spacing, ...rest } = opts
  return new Paragraph({
    children: runs(text),
    spacing: spacing ?? { after: 140, line: 276 },
    ...rest,
  })
}

// ── table ───────────────────────────────────────────────────────────────────
function pipeTable(lines) {
  const rows = lines
    .filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  const nCols = Math.max(...rows.map((r) => r.length))
  const colW = Math.floor(CONTENT_W / nCols)
  const widths = Array(nCols).fill(colW)
  widths[0] = CONTENT_W - colW * (nCols - 1)

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: rows.map((cells, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: nCols }, (_, ci) => new TableCell({
        width: { size: widths[ci], type: WidthType.DXA },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: HEAD, color: 'auto' } : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: runs(cells[ci] ?? '', ri === 0 ? { bold: true, size: 19 } : { size: 19 }),
          alignment: ci === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
          spacing: { after: 0 },
        })],
      })),
    })),
  })
}

// ── parse ───────────────────────────────────────────────────────────────────
const src = fs.readFileSync(SRC, 'utf8').split('\n')
const body = []
let i = 0

// Title block
body.push(new Paragraph({
  children: [new TextRun({ text: 'Expert QA Checklist', bold: true, size: 44, color: INK })],
  spacing: { after: 60 },
}))
body.push(new Paragraph({
  children: [new TextRun({
    text: 'IRS e-file ingestion  ·  Westridge 990 Research Platform',
    size: 24, color: INK2,
  })],
  spacing: { after: 40 },
}))
body.push(new Paragraph({
  children: [new TextRun({ text: '4 September 2026', size: 20, color: INK2 })],
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 8 } },
  spacing: { after: 320 },
}))

while (i < src.length) {
  const line = src[i]
  const t = line.trim()

  if (t === '' || t === '---') { i++; continue }
  if (t.startsWith('# ')) { i++; continue }          // title handled above

  if (t.startsWith('## ')) {
    body.push(new Paragraph({
      children: [new TextRun({ text: t.slice(3), bold: true, size: 30, color: INK })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 160 },
    }))
    i++; continue
  }

  if (t.startsWith('### ')) {
    // "A1 `[ ]` Title" → status box + title
    const raw = t.slice(4)
    const m = /^([A-D]\d)\s+`\[( |x|!)\]`\s+(.*)$/.exec(raw)
    const kids = m
      ? [
          new TextRun({ text: `${m[1]}  `, bold: true, size: 24, color: ACCENT }),
          new TextRun({
            text: m[2] === 'x' ? '☑  ' : m[2] === '!' ? '⚠  ' : '☐  ',
            size: 24, color: m[2] === 'x' ? '3F7358' : m[2] === '!' ? 'B83228' : INK2,
          }),
          ...runs(m[3], { bold: true, size: 24, color: INK }),
        ]
      : runs(raw, { bold: true, size: 24, color: INK })
    body.push(new Paragraph({
      children: kids,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 120 },
      keepNext: true,
    }))
    i++; continue
  }

  if (t.startsWith('|')) {
    const tbl = []
    while (i < src.length && src[i].trim().startsWith('|')) { tbl.push(src[i]); i++ }
    body.push(pipeTable(tbl))
    body.push(new Paragraph({ text: '', spacing: { after: 160 } }))
    continue
  }

  if (t.startsWith('- ')) {
    while (i < src.length && (src[i].trim().startsWith('- ') || /^\s{2,}\S/.test(src[i]))) {
      let item = src[i].trim().replace(/^- /, '')
      i++
      while (i < src.length && /^\s{2,}\S/.test(src[i]) && !src[i].trim().startsWith('- ')) {
        item += ' ' + src[i].trim(); i++
      }
      body.push(new Paragraph({
        children: runs(item),
        numbering: { reference: 'bullets', level: 0 },
        spacing: { after: 80, line: 276 },
      }))
    }
    body.push(new Paragraph({ text: '', spacing: { after: 80 } }))
    continue
  }

  // paragraph: join continuation lines
  let text = t
  i++
  while (i < src.length) {
    const n = src[i].trim()
    if (n === '' || n.startsWith('#') || n.startsWith('|') || n.startsWith('- ') || n === '---') break
    text += ' ' + n
    i++
  }
  body.push(para(text))
}

const doc = new Document({
  creator: 'Westridge Analytics',
  title: 'Expert QA Checklist — IRS e-file ingestion',
  description: 'Domain-review checklist for the IRS e-file XML ingestion work',
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 400, hanging: 220 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: INK } },
    },
  },
  sections: [{
    properties: { page: { ...PAGE, margin: MARGIN } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
          children: [
            new TextRun({ text: 'Westridge 990 Research Platform', size: 16, color: INK2 }),
            new TextRun({ text: '\t', size: 16 }),
            new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16, color: INK2 }),
          ],
        })],
      }),
    },
    children: body,
  }],
})

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf)
  console.log(`wrote ${OUT} (${(buf.length / 1024).toFixed(0)} KB, ${body.length} blocks)`)
})
