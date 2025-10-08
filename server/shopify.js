import fetch from 'node-fetch'
import dotenv from 'dotenv'
dotenv.config()

const API_VER = '2024-10'
const STORE = process.env.SHOPIFY_STORE
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN

// If env missing, return mock data so UI works immediately.
const MOCK = !STORE || !TOKEN

export async function fetchActiveVariants() {
  if (MOCK) {
    console.warn('[MOCK MODE] Missing SHOPIFY_STORE or SHOPIFY_ADMIN_TOKEN. Returning sample data.')
    return [
      { product_id: 1, product_title: 'Sample A', handle: 'a', variant_id: 11, variant_title: 'Default', sku: 'A', price: 1500, compare_at_price: 1790 },
      { product_id: 2, product_title: 'Sample B', handle: 'b', variant_id: 22, variant_title: 'Large',   sku: 'B', price: 990,  compare_at_price: null }
    ]
  }
  const base = `https://${STORE}/admin/api/${API_VER}`
  let url = `${base}/products.json?status=active&limit=250&fields=id,title,handle,variants`
  const out = []
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error(`Shopify fetch failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    for (const p of data.products || []) {
      for (const v of p.variants || []) {
        out.push({
          product_id: p.id, product_title: p.title, handle: p.handle,
          variant_id: v.id, variant_title: v.title, sku: v.sku,
          price: Number(v.price),
          compare_at_price: v.compare_at_price != null ? Number(v.compare_at_price) : null,
        })
      }
    }
    const link = res.headers.get('link')
    url = parseNext(link)
  }
  return out
}

export async function updateVariantPrice(variantId, { price, compare_at_price }) {
  if (MOCK) {
    // mock update (no-op) so Apply/Rollback work without a token
    return
  }
  const base = `https://${STORE}/admin/api/${API_VER}`
  const body = { variant: { id: variantId, price: String(price) } }
  if (compare_at_price != null) body.variant.compare_at_price = String(compare_at_price)

  const res = await fetch(`${base}/variants/${variantId}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Update ${variantId} failed: ${res.status} ${await res.text()}`)
}

function parseNext(linkHeader) {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const [u, rel] = part.split(';').map(s => s.trim())
    if (rel === 'rel="next"') return u.slice(1, -1)
  }
  return null
}
