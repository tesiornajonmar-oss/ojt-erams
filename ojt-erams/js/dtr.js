/* =====================================================================
   OJT-ERAMS — dtr.js : printable Daily Time Record (use the browser's
   "Save as PDF" to export).   DTR.print({ name, sid, program, company, supervisors, rows, target })
   rows = attendance rows (any status; only APPROVED rows are counted in the total).
   ===================================================================== */
const DTR = (() => {
  function print(d) {
    const rows = (d.rows || []).filter(r => r.status === 'APPROVED').sort((a, b) => a.date.localeCompare(b.date));
    const total = rows.reduce((a, r) => a + (r.computed_hours || 0), 0);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>DTR — ${esc(d.name)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px}
        h1{font-size:20px;margin:0}h2{font-size:14px;margin:2px 0 16px;color:#555;font-weight:normal}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;font-size:13px;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}
        .tot{margin-top:12px;font-size:14px}.sig{display:flex;justify-content:space-between;margin-top:56px;font-size:12px}
        .sig div{width:44%;border-top:1px solid #333;text-align:center;padding-top:4px}
      </style></head><body>
      <h1>City of Malabon University</h1><h2>Daily Time Record — On-the-Job Training</h2>
      <div class="meta"><div><b>Name:</b> ${esc(d.name)}</div><div><b>Student ID:</b> ${esc(d.sid)}</div>
        <div><b>Program:</b> ${esc(d.program || '')}</div><div><b>Company:</b> ${esc(d.company || '')}</div>
        <div><b>Supervisor:</b> ${esc((d.supervisors || []).join(', ') || '—')}</div><div><b>Printed:</b> ${esc(new Date().toLocaleString())}</div></div>
      <table><thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Hours</th><th>Verified by</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(U.fmtDateLong(r.date))}</td><td>${esc(U.fmtTime(r.time_in))}</td><td>${esc(U.fmtTime(r.time_out))}</td><td>${r.computed_hours}</td><td>${esc(r.verified_by || '')}${r.approval_method === 'AUTO' ? ' (auto)' : ''}</td></tr>`).join('') || '<tr><td colspan="5">No approved attendance yet.</td></tr>'}
      </tbody></table>
      <p class="tot"><b>Total approved hours:</b> ${+total.toFixed(2)}${d.target ? ` of ${d.target}` : ''}</p>
      <div class="sig"><div>Trainee signature</div><div>Company supervisor signature</div></div>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Your browser blocked the pop-up. Allow pop-ups for this site to print the DTR.', 'warn', 5000); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  return { print };
})();
