import fetch from 'node-fetch'
import dotenv from 'dotenv'
dotenv.config()

const API_VER = '2025-01' // matches your store response
const STORE = process.env.SHOPIFY_STORE
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN
const MOCK = !STORE || !TOKEN

export async function fetchActiveVariants() {
  if (MOCK) {
    console.warn('[MOCK MODE] Missing SHOPIFY_STORE or SHOPIFY_ADMIN_TOKEN. Returning sample data.')
    return [
      // mock chain product
      {
        product_id: 1, product_title: 'Bracelet Aurora En Or 18K', handle: 'aurora',
        product_tags: 'jewelry', product_option_names: ['Chain Variants'],
        variant_id: 11, variant_title: 'Forsat S', position: 1, sku: 'A-S', price: 1500, compare_at_price: 1550
      },
      {
        product_id: 1, product_title: 'Bracelet Aurora En Or 18K', handle: 'aurora',
        product_tags: 'jewelry', product_option_names: ['Chain Variants'],
        variant_id: 12, variant_title: 'Forsat M', position: 2, sku: 'A-M', price: 1650, compare_at_price: 1550
      }
    ]
  }

  const base = `https://${STORE}/admin/api/${API_VER}`
  let url = `${base}/products.json?status=active&limit=250&fields=id,title,handle,tags,options,variants`
  const out = []

  while (url) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    })
    if (!res.ok) throw new Error(`Shopify fetch failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    for (const p of (data.products || [])) {
      const optionNames = (p.options || []).map(o => o.name)
      const tags = p.tags || ''
      for (const v of (p.variants || [])) {
        out.push({
          product_id: p.id,
          product_title: p.title,
          handle: p.handle,
          product_tags: tags,
          product_option_names: optionNames,
          variant_id: v.id,
          variant_title: v.title,
          position: v.position,
          sku: v.sku,
          price: Number(v.price),
          compare_at_price: v.compare_at_price != null ? Number(v.compare_at_price) : null
        })
      }
    }
    const link = res.headers.get('link')
    url = parseNext(link)
  }
  return out
}

export async function updateVariantPrice(variantId, { price, compare_at_price }) {
  if (MOCK) return
  const base = `https://${STORE}/admin/api/${API_VER}`
  const body = { variant: { id: variantId } }
  if (price != null) body.variant.price = String(price)
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
