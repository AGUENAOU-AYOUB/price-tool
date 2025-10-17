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

/* ======================= Helpers ======================= */

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

function buildPercentPreviewRows(allVariants, pct) {
  const factor = 1 + pct / 100
  return allVariants.map(v => {
    const newPrice = roundTo00or90(v.price * factor)
    let newCompare = null
    if (v.compare_at_price != null) {
      newCompare = roundTo00or90(v.compare_at_price * factor)
      if (newCompare <= newPrice) newCompare = roundTo00or90(newPrice + 1)
    }
    return { ...v, newPrice, newCompare }
  })
}

/* ========== Chain Variants Fix qualification & compute ========== */

const CHAIN_NAMES = [
  'forsat s', 'forsat m', 'forsat l',
  'gourmette s', 'gourmette m',
  'chopard s', 'chopard m'
]

// group rows by product_id
function groupByProduct(rows) {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, [])
    map.get(r.product_id).push(r)
  }
  return map
}

// STRICT: product must have option named "Chain Variants" (case-insensitive) and >=3 of our known chain names
function productQualifies(productVariants) {
  if (!productVariants.length) return false
  const opts = (productVariants[0].product_option_names || []).map(s => (s || '').trim().toLowerCase())
  const hasChainOption = opts.some(n => n === 'chain variants')
  if (!hasChainOption) return false

  const titles = new Set(productVariants.map(v => (v.variant_title || '').trim().toLowerCase()))
  let hits = 0
  for (const n of CHAIN_NAMES) if (titles.has(n)) hits++
  return hits >= 3
}

// compute new compare-at based on baseline (position 1)
function computeChainFixForProduct(variants) {
  const vcopy = [...variants].sort((a, b) => a.position - b.position)
  const baseline = vcopy.find(v => v.position === 1) || vcopy[0]
  if (!baseline || baseline.compare_at_price == null) {
    return vcopy.map(v => ({ ...v, chain_new_compare: null, chain_reason: 'no-baseline-compare' }))
  }
  const basePrice = Number(baseline.price)
  const baseCompare = Number(baseline.compare_at_price)

  return vcopy.map(v => {
    const delta = Number(v.price) - basePrice
    let target = baseCompare + delta
    target = roundTo00or90(target)
    if (target <= Number(v.price)) target = roundTo00or90(Number(v.price) + 1)
    return { ...v, chain_new_compare: target, chain_reason: 'ok' }
  })
}

/* ======================= % BULK ROUTES ======================= */

// Preview % change (active variants)
app.post('/api/run/preview', async (req, res) => {
  try {
    const pct = Number(req.body.pct || 0)
    const all = await fetchActiveVariants()
    const rows = buildPercentPreviewRows(all, pct)
    res.json({ rows })
  } catch (e) {
    console.error('Preview error:', e)
    res.status(500).send(e.message || 'Server error')
  }
})

// Backup current values BEFORE applying % change
app.post('/api/run/backup', async (req, res) => {
  try {
    const pct = Number(req.body.pct || 0) // stored for context
    const all = await fetchActiveVariants()

    const items = all.map(v => ({
      product_id: v.product_id,
      product_title: v.product_title,
      variant_id: v.variant_id,
      variant_title: v.variant_title,
      price: v.price,
      compare_at_price: v.compare_at_price
    }))

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupId = `pct-backup-${ts}.json`
    const backupPath = path.join(BACKUP_DIR, backupId)
    fs.writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), pct, items }, null, 2))

    res.json({ backupId, items: items.length })
  } catch (e) {
    console.error('Backup error:', e)
    res.status(500).send(e.message || 'Backup failed')
  }
})

// Apply % change (price + compare), with small delay to help rate limits
app.post('/api/run/apply', async (req, res) => {
  const { pct, backupId } = req.body || {}
  let updated = 0, skipped = 0, errors = 0
  const log = []

  try {
    const all = await fetchActiveVariants()
    const rows = buildPercentPreviewRows(all, Number(pct || 0))

    for (const r of rows) {
      try {
        await updateVariantPrice(r.variant_id, {
          price: r.newPrice,
          compare_at_price: r.newCompare
        })
        updated++
        log.push(`OK ${r.variant_id}: price ${r.price}→${r.newPrice}, compare ${r.compare_at_price ?? 'null'}→${r.newCompare ?? 'null'}`)
        await new Promise(s => setTimeout(s, 120)) // throttle
      } catch (e) {
        errors++; skipped++
        log.push(`ERR ${r.variant_id}: ${e.message}`)
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const logPath = path.join(LOG_DIR, `pct-run-${ts}.log.json`)
    fs.writeFileSync(logPath, JSON.stringify({ started_at: ts, pct, backupId: backupId || null, updated, skipped, errors, lines: log }, null, 2))

    res.json({ summary: { updated, skipped, errors }, log })
  } catch (e) {
    console.error('Apply error:', e)
    res.status(500).send(e.message || 'Apply failed')
  }
})

/* ======================= CHAIN FIX ROUTES ======================= */

// Preview chain compare-at corrections
app.get('/api/chain/preview', async (_req, res) => {
  try {
    const all = await fetchActiveVariants()
    const grouped = groupByProduct(all)
    const rows = []
    for (const [, list] of grouped) {
      if (!productQualifies(list)) continue
      const fixed = computeChainFixForProduct(list)
      for (const r of fixed) {
        rows.push({
          product_id: r.product_id,
          product_title: r.product_title,
          handle: r.handle,
          variant_id: r.variant_id,
          variant_title: r.variant_title,
          position: r.position,
          price: r.price,
          old_compare: r.compare_at_price,
          new_compare: r.chain_new_compare,
          reason: r.chain_reason
        })
      }
    }
    res.json({ rows })
  } catch (e) {
    console.error('Chain preview error:', e)
    res.status(500).send(e.message || 'Chain preview failed')
  }
})

// Backup current compare-at for chain products only
app.post('/api/chain/backup', async (_req, res) => {
  try {
    const all = await fetchActiveVariants()
    const grouped = groupByProduct(all)
    const chainItems = []
    for (const [, list] of grouped) {
      if (!productQualifies(list)) continue
      for (const v of list) {
        chainItems.push({
          product_id: v.product_id,
          product_title: v.product_title,
          variant_id: v.variant_id,
          position: v.position,
          price: v.price,
          compare_at_price: v.compare_at_price
        })
      }
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupId = `chain-backup-${ts}.json`
    const backupPath = path.join(BACKUP_DIR, backupId)
    fs.writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), items: chainItems }, null, 2))
    res.json({ backupId, items: chainItems.length })
  } catch (e) {
    console.error('Chain backup error:', e)
    res.status(500).send(e.message || 'Chain backup failed')
  }
})

// Apply chain compare-at corrections
app.post('/api/chain/apply', async (req, res) => {
  const { backupId } = req.body || {}
  const log = []
  let updated = 0, skipped = 0, errors = 0
  try {
    const all = await fetchActiveVariants()
    const grouped = groupByProduct(all)

    for (const [, list] of grouped) {
      if (!productQualifies(list)) continue
      const fixed = computeChainFixForProduct(list)
      for (const r of fixed) {
        if (r.chain_new_compare == null) { skipped++; log.push(`SKIP ${r.variant_id} no-baseline-compare`); continue }
        try {
          await updateVariantPrice(r.variant_id, { compare_at_price: r.chain_new_compare })
          updated++
          log.push(`OK ${r.variant_id}: ${r.compare_at_price ?? 'null'} -> ${r.chain_new_compare}`)
          await new Promise(s => setTimeout(s, 120))
        } catch (e) {
          errors++; log.push(`ERR ${r.variant_id}: ${e.message}`)
        }
      }
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const logPath = path.join(LOG_DIR, `chain-run-${ts}.log.json`)
    fs.writeFileSync(logPath, JSON.stringify({ started_at: ts, backupId: backupId || null, updated, skipped, errors, lines: log }, null, 2))
    res.json({ summary: { updated, skipped, errors }, log })
  } catch (e) {
    console.error('Chain apply error:', e)
    res.status(500).send(e.message || 'Chain apply failed')
  }
})

/* ======================= Start server ======================= */

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
