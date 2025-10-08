import { useEffect, useMemo, useState } from 'react'

async function postJSON(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
  return res.json()
}

function Button({ children, className = '', variant = 'primary', ...props }) {
  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
    warn: 'bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600',
    subtle: 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 focus-visible:ring-gray-400',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600'
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props}>{children}</button>
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

function Modal({ open, title, children, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="mt-3 text-sm text-gray-600">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" onClick={onCancel}>Cancel</Button>
          <Button variant="success" onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [pct, setPct] = useState(10)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [log, setLog] = useState([])
  const [backupId, setBackupId] = useState(null)
  const [toast, setToast] = useState({ kind: 'info', msg: '' })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })

  const hasPreview = rows.length > 0

  const totals = useMemo(() => {
    if (!rows.length) return null
    let count = 0, oldSum = 0, newSum = 0
    for (const r of rows) {
      count++
      oldSum += Number(r.price)
      newSum += Number(r.newPrice)
    }
    return { count, oldSum, newSum, delta: newSum - oldSum }
  }, [rows])

  function pushLog(line) {
    setLog(l => [line, ...l].slice(0, 1000))
  }

  async function handlePreview() {
    setLoading(true)
    setSummary(null); setBackupId(null); setToast({ kind: 'info', msg: '' })
    setProgress({ current: 0, total: 0 })
    try {
      const res = await postJSON('/run/preview', { pct: Number(pct) })
      setRows(res.rows || [])
      setToast({ kind: 'success', msg: `Preview ready for ${res.rows?.length || 0} variants.` })
    } catch (e) {
      setToast({ kind: 'error', msg: e.message })
    } finally { setLoading(false) }
  }

  async function handleBackup() {
    if (!hasPreview) return setToast({ kind: 'warn', msg: 'Run a preview first.' })
    setLoading(true)
    try {
      const res = await postJSON('/run/backup', { pct: Number(pct) })
      setBackupId(res.backupId)
      pushLog(`Backup created: ${res.backupId} (${res.items} variants)`)
      setToast({ kind: 'success', msg: `Backup created: ${res.backupId}` })
    } catch (e) {
      setToast({ kind: 'error', msg: e.message })
    } finally { setLoading(false) }
  }

  async function applyNow() {
    setConfirmOpen(false)
    if (!backupId) return setToast({ kind: 'warn', msg: 'Create a backup first.' })
    setLoading(true); setSummary(null)
    setToast({ kind: 'info', msg: 'Applying updates…' })
    setProgress({ current: 0, total: rows.length })
    try {
      const tick = setInterval(() => {
        setProgress(p => p.total ? { ...p, current: Math.min(p.current + Math.ceil(p.total * 0.02), p.total - 1) } : p)
      }, 600)
      const res = await postJSON('/run/apply', { pct: Number(pct), backupId })
      clearInterval(tick)
      setSummary(res.summary)
      res.log?.forEach(line => pushLog(line))
      setProgress({ current: rows.length, total: rows.length })
      setToast({ kind: res.summary?.errors ? 'warn' : 'success', msg: `Done. Updated ${res.summary?.updated || 0} variants.` })
    } catch (e) {
      setToast({ kind: 'error', msg: e.message })
    } finally { setLoading(false) }
  }

  function handleApply() {
    if (!backupId) return setToast({ kind: 'warn', msg: 'Create a backup first.' })
    setConfirmOpen(true)
  }

  async function handleRollback() {
    if (!backupId) return setToast({ kind: 'warn', msg: 'No backup to restore.' })
    setLoading(true); setToast({ kind: 'info', msg: 'Rolling back…' })
    try {
      const res = await postJSON('/run/rollback', { backupId })
      res.log?.forEach(line => pushLog(line))
      setSummary(res.summary)
      setToast({ kind: res.summary?.errors ? 'warn' : 'success', msg: `Rollback complete. Restored ${res.summary?.updated || 0} variants.` })
    } catch (e) {
      setToast({ kind: 'error', msg: e.message })
    } finally { setLoading(false) }
  }

  useEffect(() => { setRows([]); setSummary(null); setBackupId(null) }, [pct])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sticky actions */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white p-3 shadow-sm sm:hidden">
        <div className="flex items-center gap-2">
          <Button variant="subtle" onClick={handlePreview} className="flex-1">Preview</Button>
          <Button variant="warn" onClick={handleBackup} disabled={!hasPreview} className="flex-1">Backup</Button>
          <Button variant="success" onClick={handleApply} disabled={!backupId} className="flex-1">Apply</Button>
        </div>
      </div>

      <header className="bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold sm:text-xl">Shopify Price Tool</h1>
            <div className="hidden sm:flex items-center gap-2">
              <Button variant="subtle" onClick={handlePreview}>Preview</Button>
              <Button variant="warn" onClick={handleBackup} disabled={!hasPreview}>Backup</Button>
              <Button variant="success" onClick={handleApply} disabled={!backupId}>Apply</Button>
              <Button variant="danger" onClick={handleRollback} disabled={!backupId}>Rollback</Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pb-10">
        {/* Controls */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <label htmlFor="pct" className="block text-sm font-medium">Percentage change (±)</label>
            <input
              id="pct" type="number" value={pct} onChange={(e) => setPct(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              placeholder="e.g., 10 or -12" aria-describedby="pct-help"
            />
            <p id="pct-help" className="mt-2 text-xs text-gray-500">
              Applies the same % to <b>price</b> and <b>compare_at_price</b>, then rounds both to …00 / …90.
            </p>
            {progress.total > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Progress</span>
                  <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-blue-600 transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <Stat label="Backup" value={backupId ? 'Ready' : 'Missing'} highlight={backupId ? 'text-emerald-600' : 'text-rose-600'} />
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Variants" value={totals ? totals.count.toLocaleString() : '—'} />
            <Stat label="Old total" value={totals ? totals.oldSum.toLocaleString() : '—'} />
            <Stat label="New total" value={totals ? <span className={totals.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{totals.newSum.toLocaleString()}</span> : '—'} />
          </div>
        </section>

        {/* Preview */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Preview</h2>
            {!hasPreview && <Button variant="subtle" onClick={handlePreview}>Run Preview</Button>}
          </div>

          {!hasPreview && !loading && (
            <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              Run a preview to see how prices will change on active variants.
            </div>
          )}
          {loading && (
            <div className="mt-4 grid gap-2">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          )}

          {hasPreview && (
            <>
              {/* Mobile cards */}
              <div className="mt-4 grid gap-3 sm:hidden">
                {rows.slice(0, 500).map(r => (
                  <div key={r.variant_id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{r.product_title}</div>
                      <div className="text-xs text-gray-500">#{r.variant_id}</div>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{r.variant_title || 'Default'}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-gray-500">Old</div>
                        <div className="font-medium">{r.price}</div>
                        {r.compare_at_price != null && <div className="text-xs text-gray-500">Compare: {r.compare_at_price}</div>}
                      </div>
                      <div className="text-right">
                        <div className="text-gray-500">New</div>
                        <div className="font-semibold">{r.newPrice}</div>
                        {r.newCompare != null && <div className="text-xs text-gray-600">Compare: <b>{r.newCompare}</b></div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="mt-4 hidden max-h-[520px] overflow-auto rounded-lg border sm:block">
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
                    {rows.slice(0, 1000).map(r => (
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

              {rows.length > 1000 && (
                <p className="mt-3 text-xs text-gray-500">
                  Showing first 1,000 rows for performance. Apply affects all {rows.length.toLocaleString()} variants.
                </p>
              )}
            </>
          )}
        </section>

        {/* Log */}
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Activity Log</h2>
            <Button
              variant="subtle"
              onClick={() => {
                const blob = new Blob([log.join('\n')], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `run-log-${Date.now()}.txt`
                a.click()
                URL.revokeObjectURL(url)
              }}
              disabled={!log.length}
              aria-label="Download log"
            >
              Download
            </Button>
          </div>

          {summary && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat label="Updated" value={summary.updated} highlight="text-emerald-600" />
              <Stat label="Skipped" value={summary.skipped} />
              <Stat label="Errors" value={summary.errors} highlight={summary.errors ? 'text-rose-600' : ''} />
            </div>
          )}

          <div className="mt-3 h-60 overflow-auto rounded-lg border bg-gray-50 p-3">
            {!log.length ? (
              <div className="text-sm text-gray-500">No log yet. Actions will appear here.</div>
            ) : (
              <ul className="space-y-1 text-xs font-mono text-gray-700">
                {log.map((line, i) => (<li key={i}>{line}</li>))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <Toast {...toast} onClose={() => setToast({ kind: 'info', msg: '' })} />
      <Modal open={confirmOpen} title="Apply price updates?" onCancel={() => setConfirmOpen(false)} onConfirm={applyNow}>
        This will update variant prices (and compare-at) for all previewed active products.
        Make sure you have a recent backup. Proceed?
      </Modal>
    </div>
  )
}
