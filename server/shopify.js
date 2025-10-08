import fetch from 'node-fetch'
import dotenv from 'dotenv'
dotenv.config()

const API_VER = '2024-10'
const BASE = `https://${process.env.SHOPIFY_STORE}/admin/api/${API_VER}`

function headers() {
  return {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
    'Content-Type': 'application/json'
  }
}

// Fetch ACTIVE products and their variants, paginated
export async function fetchActiveVariants() {
  const all = []
  let url = `${BASE}/products.json?status=active&limit=250&fields=id,title,handle,variants`
  while (url) {
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw new Error(`Shopify fetch failed: ${res.status}`)
    const data = await res.json()
    for (const p of data.products || []) {
      for (const v of p.variants || []) {
        all.push({
          product_id: p.id,
          product_title: p.title,
          handle: p.handle,
          variant_id: v.id,
          variant_title: v.title,
          sku: v.sku,
          price: Number(v.price),
          compare_at_price: v.compare_at_price != null ? Number(v.compare_at_price) : null,
        })
      }
    }
    // pagination via Link header
    const link = res.headers.get('link')
    const next = parseNext(link)
    url = next
  }
  return all
}

function parseNext(linkHeader) {
  if (!linkHeader) return null
  // Look for rel="next"
  const parts = linkHeader.split(',')
  for (const part of parts) {
    const [urlPart, relPart] = part.split(';').map(s => s.trim())
    if (relPart === 'rel="next"') {
      return urlPart.slice(1, -1) // remove <>
    }
  }
  return null
}

// Update a single variant price (and compare_at if provided)
export async function updateVariantPrice(variantId, { price, compare_at_price }) {
  const body = {
    variant: {
      id: variantId,
      price: String(price)
    }
  }
  if (compare_at_price != null) {
    body.variant.compare_at_price = String(compare_at_price)
  }
  const res = await fetch(`${BASE}/variants/${variantId}.json`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Update ${variantId} failed: ${res.status} ${t}`)
  }
}
