import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { fetchActiveVariants, updateVariantPrice } from './shopify.js'

dotenv.config()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 4000
const DATA_DIR = path.join(__dirname, 'data')
const BACKUP_DIR = path.join(DATA_DIR, 'backups')
const LOG_DIR = path.join(DATA_DIR, 'logs')
for (const dir of [DATA_DIR, BACKUP_DIR, LOG_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// --- rounding logic
function roundTo00or90(n) {
  if (n <= 0) return 0
  const x = Math.round(Number(n))
  const base = Math.floor(x / 100) * 100
  const cand = []
  const lower00 = base
  const lower90 = base - 10
  const upper90 = base + 90
  const upper00 = base + 100
  if (lower90 > 0) cand.push(lower90)
  cand.push(lower00, upper90, upper00)
  let best = cand[0], bestD = Math.abs(x - cand[0])
  for (let i = 1; i < cand.length; i++) {
    const d = Math.abs(x - cand[i])
    if (d < bestD || (d === bestD && cand[i] > best)) { best = cand[i]; bestD = d }
  }
  return best
}
function computeNew(p, pct) {
  const factor = 1 + pct / 100
  const rawPrice = Number(p.price) * factor
  const newPrice = roundTo00or90(rawPrice)
  let newCompare = null
  if (p.compare_at_price != null) {
    const rawCompare = Number(p.compare_at_price) * factor
    newCompare = roundTo00or90(rawCompare)
    if (newCompare <= newPrice) newCompare = roundTo00or90(newPrice + 1)
  }
  return { newPrice, newCompare }
}

// PREVIEW
app.post('/api/run/preview', async (req, res) => {
  try {
    const pct = Number(req.body.pct || 0)
    const variants = await fetchActiveVariants() // mock or live
    const rows = variants.map(v => ({ ...v, ...computeNew(v, pct) }))
    res.json({ rows })
  } catch (e) {
    console.error('Preview error:', e)
    res.status(500).send(e.message || 'Server error')
  }
})

// BACKUP (uses last preview from live fetch each time for safety)
let lastPreview = []
app.post('/api/run/backup', async (req, res) => {
  try {
    const pct = Number(req.body.pct || 0)
    const variants = await fetchActiveVariants()
    lastPreview = variants.map(v => ({ ...v, ...computeNew(v, pct) }))
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupId = `backup-${ts}.json`
    const backupPath = path.join(BACKUP_DIR, backupId)
    const minimal = variants.map(r => ({
      product_id: r.product_id,
      product_title: r.product_title,
      variant_id: r.variant_id,
      sku: r.sku,
      price: r.price,
      compare_at_price: r.compare_at_price
    }))
    fs.writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), items: minimal }, null, 2))
    res.json({ backupId, items: minimal.length })
  } catch (e) {
    res.status(500).send(e.message || 'Backup failed')
  }
})

// APPLY
app.post('/api/run/apply', async (req, res) => {
  const pct = Number(req.body.pct || 0)
  const { backupId } = req.body
  const log = []
  if (!backupId) return res.status(400).send('backupId required.')

  let updated = 0, skipped = 0, errors = 0
  try {
    if (!lastPreview.length) {
      // safety: recompute if preview cache is empty
      const variants = await fetchActiveVariants()
      lastPreview = variants.map(v => ({ ...v, ...computeNew(v, pct) }))
    }
    for (const r of lastPreview) {
      try {
        if (r.price <= 0) { skipped++; log.push(`Skip ${r.variant_id}: non-positive price`); continue }
        await updateVariantPrice(r.variant_id, { price: r.newPrice, compare_at_price: r.newCompare })
        updated++
        log.push(`OK ${r.variant_id}: ${r.price}→${r.newPrice}` + (r.compare_at_price != null ? ` | compare ${r.compare_at_price}→${r.newCompare}` : ''))
        await new Promise(s => setTimeout(s, 120)) // respect rate limits
      } catch (e) {
        errors++; log.push(`ERR ${r.variant_id}: ${e.message}`)
      }
    }
  } catch (e) {
    return res.status(500).send(e.message || 'Apply failed')
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(LOG_DIR, `run-${ts}.log.json`)
  fs.writeFileSync(logPath, JSON.stringify({ started_at: ts, pct, backupId, updated, skipped, errors, lines: log }, null, 2))
  res.json({ summary: { updated, skipped, errors }, log })
})

// ROLLBACK
app.post('/api/run/rollback', async (req, res) => {
  const { backupId } = req.body
  if (!backupId) return res.status(400).send('backupId required.')
  const backupPath = path.join(BACKUP_DIR, backupId)
  if (!fs.existsSync(backupPath)) return res.status(400).send('Backup not found.')

  const { items } = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
  const log = []
  let updated = 0, errors = 0
  for (const r of items) {
    try {
      await updateVariantPrice(r.variant_id, { price: r.price, compare_at_price: r.compare_at_price ?? null })
      updated++; log.push(`RESTORE ${r.variant_id}: price=${r.price}` + (r.compare_at_price != null ? `, compare=${r.compare_at_price}` : ''))
      await new Promise(s => setTimeout(s, 120))
    } catch (e) {
      errors++; log.push(`ERR RESTORE ${r.variant_id}: ${e.message}`)
    }
  }
  res.json({ summary: { updated, errors }, log })
})

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
