// Round a positive number (no cents) to the NEAREST value ending with ...00 or ...90.
// Ties go UP.
export function roundTo00or90(n) {
  if (n <= 0) return 0
  const x = Math.round(Number(n)) // drop any cents early

  const base = Math.floor(x / 100) * 100
  const cand = []

  // candidates around x that end with 00 or 90
  const lower00 = base
  const lower90 = base - 10
  const upper90 = base + 90
  const upper00 = base + 100

  if (lower90 > 0) cand.push(lower90)
  cand.push(lower00, upper90, upper00)

  // choose nearest; ties up
  let best = cand[0]
  let bestD = Math.abs(x - cand[0])
  for (let i = 1; i < cand.length; i++) {
    const d = Math.abs(x - cand[i])
    if (d < bestD || (d === bestD && cand[i] > best)) {
      best = cand[i]
      bestD = d
    }
  }
  return best
}

// Apply ±% to price and compareAt (if present), then round both to ...00 / ...90
export function computeNewPrices({ price, compare_at_price }, pct) {
  const factor = 1 + (pct / 100)
  const rawPrice = Number(price) * factor
  const newPrice = roundTo00or90(rawPrice)

  let newCompare = null
  if (compare_at_price != null && compare_at_price !== '') {
    const rawCompare = Number(compare_at_price) * factor
    newCompare = roundTo00or90(rawCompare)
    // Ensure compare_at stays >= price
    if (newCompare <= newPrice) {
      // push compare_at to next valid tier above price
      newCompare = roundTo00or90(newPrice + 1)
    }
  }
  return { newPrice, newCompare }
}
