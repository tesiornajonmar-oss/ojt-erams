(async () => {
  const me = await Shell.init('approvals');
  if (!me) return;
  const $ = id => document.getElementById(id);
  let q = null, tab = 'pending';

  async function load() { q = await API.supervisor.queue(); render(); Shell.refresh(); }

  async function pendingHandler(act, s, hrs) {
    if (act === 'ok') { await API.supervisor.approveShift({ id: s.id, hours: hrs === '' ? null : hrs }); toast('Attendance approved.'); return load(); }
    if (act === 'no') {
      const note = await Widgets.askNote({ title: 'Reject attendance', label: 'Reason (the trainee will see this)', placeholder: 'e.g., Not present at the office that day.', confirmText: 'Reject', required: true, danger: true });
      if (note == null) return; await API.supervisor.rejectShift({ id: s.id, note }); toast('Attendance rejected.', 'warn'); return load();
    }
    const note = await Widgets.askNote({ title: 'Escalate to faculty adviser', label: 'Note for the adviser (optional)', placeholder: 'e.g., I cannot confirm this — please check with the student.', confirmText: 'Escalate' });
    if (note == null) return; await API.supervisor.escalateShift({ id: s.id, note }); toast('Sent to the faculty adviser.'); return load();
  }
  async function spotHandler(act, s) {
    if (act === 'confirm') { await API.supervisor.confirmSpot({ id: s.id }); toast('Confirmed.'); return load(); }
    const note = await Widgets.askNote({ title: 'Dispute this shift', label: 'What looks wrong? *', placeholder: 'e.g., This trainee was on leave that day.', confirmText: 'Dispute & send to adviser', required: true, danger: true });
    if (note == null) return; await API.supervisor.disputeSpot({ id: s.id, note }); toast('Disputed — sent back for review.', 'warn'); return load();
  }

  function render() {
    $('cPending').textContent = q.pending.length ? `(${q.pending.length})` : '';
    $('cSpot').textContent = q.spot.length ? `(${q.spot.length})` : '';
    $('countNote').textContent = `${q.total} record${q.total === 1 ? '' : 's'} to review • ${q.spot.length} spot-check${q.spot.length === 1 ? '' : 's'}`;
    $('bulkBtn').hidden = tab !== 'pending';
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const panel = $('panel');
    if (tab === 'pending') {
      if (!q.pending.length) { panel.innerHTML = '<p class="muted center">🎉 Nothing to review. Everything clean was verified automatically.</p>'; return; }
      const actions = [{ act: 'ok', label: '✓ Approve', cls: 'btn-green' }, { act: 'no', label: '✕ Reject', cls: 'btn-outline danger' }, { act: 'esc', label: '↗ Escalate', cls: 'btn-outline' }];
      panel.innerHTML = '<div class="bulk-bar"><button class="btn btn-outline btn-sm" id="selSafe" type="button">Select all low &amp; medium risk</button><span class="small muted">High-risk items always need a one-by-one decision.</span></div>' +
        q.pending.map(s => Widgets.slipCard(s, { actions, pick: true })).join('');
      Widgets.bindSlips(panel, q.pending, pendingHandler);
      $('selSafe').onclick = () => panel.querySelectorAll('[data-pick]:not(:disabled)').forEach(c => { c.checked = true; });
    } else {
      if (!q.spot.length) { panel.innerHTML = '<p class="muted center">No spot-checks right now.</p>'; return; }
      const actions = [{ act: 'confirm', label: '✓ Looks right', cls: 'btn-green' }, { act: 'dispute', label: '⚑ Dispute', cls: 'btn-outline danger' }];
      panel.innerHTML = '<div class="spot-note">🎲 These were approved automatically. A random sample is shown here so a person keeps an eye on the system. Confirm if the shift is genuine, or dispute it.</div>' +
        q.spot.map(s => Widgets.slipCard(s, { actions, hours: false, note: '<div class="small muted" style="margin-top:6px">Auto-approved</div>' })).join('');
      Widgets.bindSlips(panel, q.spot, spotHandler);
    }
  }

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => { tab = t.dataset.tab; render(); });
  guarded($('bulkBtn'), async () => {
    const ids = Widgets.picked($('panel'));
    if (!ids.length) return toast('Tick the records you want to approve first.', 'warn');
    if (!confirm(`Approve ${ids.length} record(s) with their recorded hours?`)) return;
    const r = await API.supervisor.bulkApprove({ ids });
    toast(`${r.approved} approved${r.skipped ? `, ${r.skipped} skipped (high risk)` : ''}.`, r.skipped ? 'warn' : 'ok', 5000);
    await load();
  });
  try { await load(); } catch (e) { toast(e.message, 'err'); }
})();
