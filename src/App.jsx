import { useEffect, useMemo, useState, useRef } from 'react'

async function postJSON(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}
async function getJSON(path) {
  const res = await fetch(`/api${path}`)
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}

function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent ${className}`}
      aria-hidden="true"
    />
  )
}

function Button({ children, className = '', variant = 'primary', loading = false, ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
    warn: 'bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600',
    subtle: 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 focus-visible:ring-gray-400',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600'
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <Spinner />}
      <span>{children}</span>
    </button>
  )
}

function Stat({ label, value, highlight }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${highlight || ''}`}>{value}</div>
    </div>
  )
}

function Toast({ kind = 'info', msg, onClose }) {
  const styles = { info: 'bg-blue-600', success: 'bg-emerald-600', warn: 'bg-amber-600', error: 'bg-rose-600' }
  if (!msg) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[92%] max-w-lg -translate-x-1/2">
      <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-white shadow-lg ${styles[kind]}`}>
        <div className="text-sm">{msg}</div>
        <button aria-label="Close toast" onClick={onClose} className="ml-auto opacity-80 hover:opacity-100">✕</button>
      </div>
    </div>
  )
}

function useLock() {
  const lockRef = useRef(false)
  return async (fn) => {
    if (lockRef.current) return
    lockRef.current = true
    try { return await fn() } finally { lockRef.current = false }
  }
}

export default function App() {
  // % update tool
  const [pct, setPct] = useState(10)
  const [rows, setRows] = useState([])
  const [backupId, setBackupId] = useState(null)
  const [pctSummary, setPctSummary] = useState(null)

  // Chain fix
  const [chainRows, setChainRows] = useState([])
  const [chainBackupId, setChainBackupId] = useState(null)
  const [chainSummary, setChainSummary] = useState(null)

  // Loaders
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loadingBackup, setLoadingBackup] = useState(false)
  const [loadingApply, setLoadingApply] = useState(false)
  const [loadingChainPreview, setLoadingChainPreview] = useState(false)
  const [loadingChainBackup, setLoadingChainBackup] = useState(false)
  const [loadingChainApply, setLoadingChainApply] = useState(false)

  const [toast, setToast] = useState({ kind: 'info', msg: '' })
  const hasPreview = rows.length > 0
  const hasChainPreview = chainRows.length > 0

  const totals = useMemo(() => {
    if (!rows.length) return null
    let count = 0, oldSum = 0, newSum = 0
    for (const r of rows) { count++; oldSum += Number(r.price); newSum += Number(r.newPrice) }
    return { count, oldSum, newSum, delta: newSum - oldSum }
  }, [rows])

  const guardPreview = useLock()
  const guardBackup = useLock()
  const guardApply = useLock()
  const guardChainPreview = useLock()
  const guardChainBackup = useLock()
  const guardChainApply = useLock()

  // ---------- % tool actions ----------
  async function handlePreview() {
    await guardPreview(async () => {
      setLoadingPreview(true); setPctSummary(null); setBackupId(null); setToast({ kind: 'info', msg: '' })
      try {
        const res = await postJSON('/run/preview', { pct: Number(pct) })
        setRows(res.rows || [])
        setToast({ kind: 'success', msg: `Preview ready for ${res.rows?.length || 0} variants.` })
      } catch (e) { setToast({ kind: 'error', msg: e.message }) }
      finally { setLoadingPreview(false) }
    })
  }

  async function handleBackup() {
    await guardBackup(async () => {
      if (!hasPreview) return setToast({ kind: 'warn', msg: 'Run a preview first.' })
      setLoadingBackup(true)
      try {
        const res = await postJSON('/run/backup', { pct: Number(pct) })
        setBackupId(res.backupId)
        setToast({ kind: 'success', msg: `Backup created: ${res.backupId}` })
      } catch (e) { setToast({ kind: 'error', msg: e.message }) }
      finally { setLoadingBackup(false) }
    })
  }

  async function handleApply() {
    await guardApply(async () => {
      if (!hasPreview) return setToast({ kind: 'warn', msg: 'Run a preview first.' })
      if (!backupId) return setToast({ kind: 'warn', msg: 'Create a backup first.' })
      setLoadingApply(true)
      try {
        const res = await postJSON('/run/apply', { pct: Number(pct), backupId })
        setPctSummary(res.summary)
        setToast({ kind: res.summary?.errors ? 'warn' : 'success', msg: `Applied to ${res.summary?.updated || 0} variants.` })
      } catch (e) { setToast({ kind: 'error', msg: e.message }) }
      finally { setLoadingApply(false) }
    })
  }

  // ---------- Chain fix actions ----------
  async function chainPreview() {
    await guardChainPreview(async () => {
      setLoadingChainPreview(true); setChainSummary(null); setChainBackupId(null)
      try {
        const res = await getJSON('/chain/preview')
        setChainRows(res.rows || [])
        setToast({ kind: 'success', msg: `Chain preview: ${res.rows?.length || 0} variants.` })
      } catch (e) { setToast({ kind: 'error', msg: e.message }) }
      finally { setLoadingChainPreview(false) }
    })
  }

  async function chainBackup() {
    await guardChainBackup(async () => {
      if (!hasChainPreview) return setToast({ kind: 'warn', msg: 'Run chain preview first.' })
      setLoadingChainBackup(true)
      try {
        const res = await postJSON('/chain/backup', {})
        setChainBackupId(res.backupId)
        setToast({ kind: 'success', msg: `Chain backup: ${res.backupId}` })
      } catch (e) { setToast({ kind: 'error', msg: e.message }) }
      finally { setLoadingChainBackup(false) }
    })
  }

  async function chainApply() {
    await guardChainApply(async () => {
      if (!hasChainPreview) return setToast({ kind: 'warn', msg: 'Run chain preview first.' })
      if (!chainBackupId) return setToast({ kind: 'warn', msg: 'Create chain backup first.' })
      setLoadingChainApply(true)
      try {
        const res = await postJSON('/chain/apply', { backupId: chainBackupId })
        setChainSummary(res.summary)
        setToast({ kind: res.summary?.errors ? 'warn' : 'success', msg: `Chain apply done. Updated ${res.summary?.updated || 0}.` })
      } catch (e) { setToast({ kind: 'error', msg: e.message }) }
      finally { setLoadingChainApply(false) }
    })
  }

  // Reset % preview when pct changes
  useEffect(() => { setRows([]); setPctSummary(null); setBackupId(null) }, [pct])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold sm:text-xl">Shopify Price Tool</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* ===== Section 1: % Price Update ===== */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Bulk % Update (active products)</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="pct" className="block text-sm font-medium">Percentage change (±)</label>
              <input
                id="pct" type="number" value={pct} onChange={(e) => setPct(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                placeholder="e.g., 10 or -12"
              />
              <p className="mt-2 text-xs text-gray-500">
                Applies the same % to <b>price</b> and <b>compare_at_price</b>, then rounds both to …00 / …90.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="subtle" onClick={handlePreview} loading={loadingPreview}>Preview</Button>
                <Button variant="warn" onClick={handleBackup} loading={loadingBackup} disabled={!hasPreview}>Backup</Button>
                <Button variant="success" onClick={handleApply} loading={loadingApply} disabled={!hasPreview || !backupId}>Apply</Button>
              </div>
              {backupId && (
                <p className="mt-2 text-xs text-gray-500">
                  Backup: <span className="font-mono">{backupId}</span>
                </p>
              )}
            </div>

            <Stat label="Variants (previewed)" value={totals ? totals.count.toLocaleString() : '—'} />
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Old total" value={totals ? totals.oldSum.toLocaleString() : '—'} />
              <Stat label="New total" value={totals ? totals.newSum.toLocaleString() : '—'} highlight={totals ? (totals.delta >= 0 ? 'text-emerald-600' : 'text-rose-600') : ''} />
            </div>
          </div>

          {hasPreview && (
            <div className="mt-4 max-h-[420px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-100 text-gray-700">
                  <tr>
                    <th className="p-2 text-left">Product</th>
                    <th className="p-2 text-left">Variant</th>
                    <th className="p-2 text-right">Old Price</th>
                    <th className="p-2 text-right">New Price</th>
                    <th className="p-2 text-right">Old Compare</th>
                    <th className="p-2 text-right">New Compare</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 800).map(r => (
                    <tr key={r.variant_id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2">{r.product_title}</td>
                      <td className="p-2">{r.variant_title || 'Default'}</td>
                      <td className="p-2 text-right">{r.price}</td>
                      <td className="p-2 text-right font-semibold">{r.newPrice}</td>
                      <td className="p-2 text-right">{r.compare_at_price ?? ''}</td>
                      <td className="p-2 text-right font-semibold">{r.newCompare ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pctSummary && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat label="Updated" value={pctSummary.updated} highlight="text-emerald-600" />
              <Stat label="Skipped" value={pctSummary.skipped} />
              <Stat label="Errors" value={pctSummary.errors} highlight={pctSummary.errors ? 'text-rose-600' : ''} />
            </div>
          )}
        </section>

        {/* ===== Section 2: Chain Variants Fix ===== */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Chain Variants Fix (ONLY products with option “Chain Variants” + chain names)</h2>
          <p className="mt-1 text-sm text-gray-600">
            Baseline is variant at position=1 (e.g., Forsat S). Each sibling’s compare-at becomes: <code>baseline_compare + (variant_price − baseline_price)</code>, rounded to …00/…90 and kept ≥ its price.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="subtle" onClick={chainPreview} loading={loadingChainPreview}>Preview chain products</Button>
            <Button variant="warn" onClick={chainBackup} loading={loadingChainBackup} disabled={!hasChainPreview}>Backup chain compare-at</Button>
            <Button variant="success" onClick={chainApply} loading={loadingChainApply} disabled={!hasChainPreview || !chainBackupId}>Apply chain fix</Button>
          </div>

          {chainBackupId && <p className="mt-2 text-sm text-gray-600">Chain backup: <span className="font-mono">{chainBackupId}</span></p>}

          {hasChainPreview ? (
            <div className="mt-4 max-h-[460px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-100 text-gray-700">
                  <tr>
                    <th className="p-2 text-left">Product</th>
                    <th className="p-2 text-left">Variant</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Old Compare</th>
                    <th className="p-2 text-right">New Compare</th>
                    <th className="p-2 text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {chainRows.slice(0, 1200).map(r => (
                    <tr key={r.variant_id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2">{r.product_title}</td>
                      <td className="p-2">{r.variant_title}</td>
                      <td className="p-2 text-right">{r.price}</td>
                      <td className="p-2 text-right">{r.old_compare ?? ''}</td>
                      <td className="p-2 text-right font-semibold">{r.new_compare ?? ''}</td>
                      <td className="p-2 text-left text-xs text-gray-500">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">Run the chain preview to see proposed compare-at corrections.</p>
          )}

          {chainSummary && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat label="Updated" value={chainSummary.updated} highlight="text-emerald-600" />
              <Stat label="Skipped" value={chainSummary.skipped} />
              <Stat label="Errors" value={chainSummary.errors} highlight={chainSummary.errors ? 'text-rose-600' : ''} />
            </div>
          )}
        </section>
      </main>

      <Toast {...toast} onClose={() => setToast({ kind: 'info', msg: '' })} />
    </div>
  )
}
