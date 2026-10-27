(async () => {
  const me = await Shell.init('system');
  if (!me) return;
  const $ = id => document.getElementById(id);
  const timeRe = /^\d{1,2}:\d{2}\s?(AM|PM)$/i, SECS = ['policies', 'audit', 'data'];
  let counts, st, audit = [];
  try { [counts, st] = await Promise.all([API.admin.counts(), API.admin.settings()]); } catch (e) { return toast(e.message, 'err'); }

  function showSec(sec) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.sec === sec));
    SECS.forEach(s => { $('sec-' + s).hidden = s !== sec; });
    if (sec === 'audit') loadAudit();
  }
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => showSec(t.dataset.sec));
  const hash = location.hash.replace('#', '');
  showSec(SECS.includes(hash) ? hash : 'policies');

  /* ---- program + geofence ---- */
  $('pHours').value = st.required_hours; $('pStart').value = st.shift_start; $('pEnd').value = st.shift_end; $('pDays').value = st.work_days;
  $('applyNote').textContent = `Applies to all ${counts.students} trainees now, and becomes the default for trainees your advisers add later.`;
  $('radiusNote').textContent = `Applies to all ${counts.companies} companies. Trainees are marked "In-Range" when they clock in inside this radius.`;
  guarded($('applyProgramBtn'), async () => {
    const err = $('pErr'), hrs = parseInt($('pHours').value, 10), start = $('pStart').value.trim(), end = $('pEnd').value.trim(), days = $('pDays').value.trim();
    if (!(hrs >= 1 && hrs <= 2000)) { err.textContent = 'Required hours must be between 1 and 2000.'; return; }
    if (!timeRe.test(start) || !timeRe.test(end)) { err.textContent = 'Use a time like 8:00 AM for the shift start and end.'; return; }
    if (!days) { err.textContent = 'Please enter the work days.'; return; }
    err.textContent = '';
    if (!confirm(`Apply ${hrs} required hours and the ${start} – ${end} schedule to all ${counts.students} trainees?`)) return;
    try { const r = await API.admin.applyProgram({ required_hours: hrs, shift_start: start, shift_end: end, work_days: days }); toast(`Policy applied to ${r.updated} trainees.`); }
    catch (e) { err.textContent = e.message; }
  });
  guarded($('applyRadiusBtn'), async () => {
    const err = $('rErr'), r = parseInt($('rRadius').value, 10);
    if (!(r >= 50 && r <= 5000)) { err.textContent = 'Radius must be between 50 and 5000 meters.'; return; }
    err.textContent = '';
    if (!confirm(`Set the geofence radius to ${r} m for all ${counts.companies} companies?`)) return;
    try { const x = await API.admin.applyRadius({ radius: r }); toast(`Radius applied to ${x.updated} companies.`); } catch (e) { err.textContent = e.message; }
  });

  /* ---- approval rules ---- */
  $('rAuto').checked = !!st.auto_approve; $('rFace').checked = !!st.face_required; $('rSpot').value = st.spot_check_pct; $('rThr').value = st.face_threshold;
  $('rEsc').value = st.escalate_days; $('rMin').value = st.min_shift_hours; $('rMax').value = st.max_shift_hours;
  guarded($('saveRulesBtn'), async () => {
    try {
      await API.admin.saveApprovalPolicy({ auto_approve: $('rAuto').checked, face_required: $('rFace').checked, spot_check_pct: $('rSpot').value, face_threshold: $('rThr').value,
        escalate_days: $('rEsc').value, min_shift_hours: $('rMin').value, max_shift_hours: $('rMax').value });
      $('rulesErr').textContent = ''; toast('Approval rules saved.');
    } catch (e) { $('rulesErr').textContent = e.message; }
  });

  /* ---- password ---- */
  guarded($('pwBtn'), async () => {
    const err = $('pwErr'), o = $('pwOld').value, n = $('pwNew').value, n2 = $('pwNew2').value;
    if (n.length < 6) { err.textContent = 'New password must be at least 6 characters.'; return; }
    if (n !== n2) { err.textContent = 'The new passwords do not match.'; return; }
    try { await API.auth.changePassword({ old_password: o, new_password: n }); err.textContent = ''; $('pwOld').value = $('pwNew').value = $('pwNew2').value = ''; toast('Password changed.'); }
    catch (e) { err.textContent = e.message; }
  });

  /* ---- audit ---- */
  async function loadAudit() { try { audit = await API.admin.audit(); } catch (e) { return toast(e.message, 'err'); } renderAudit(); }
  function renderAudit() {
    const actors = [...new Set(audit.map(a => a.actor))], cur = $('aActor').value;
    $('aActor').innerHTML = '<option value="">All people</option>' + actors.map(x => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const q = $('aSearch').value.trim().toLowerCase(), who = $('aActor').value;
    const rows = audit.filter(a => (!who || a.actor === who) && (!q || `${a.action} ${a.target} ${a.detail}`.toLowerCase().includes(q)));
    $('aBody').innerHTML = rows.slice(0, 200).map(a => `<tr><td class="small" style="white-space:nowrap">${esc(U.fmtWhen(a.at))}</td><td>${esc(a.actor)}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.target)}</td><td class="small audit-detail">${esc(a.detail)}</td></tr>`).join('');
    $('aEmpty').hidden = rows.length > 0;
  }
  $('aSearch').addEventListener('input', renderAudit); $('aActor').addEventListener('change', renderAudit);
  $('auditExport').onclick = () => { const rows = [['When', 'Who', 'Action', 'Target', 'Details']]; audit.forEach(a => rows.push([a.at, a.actor, a.action, a.target, a.detail])); downloadCsv(`OJT-audit-log-${U.dateStr()}.csv`, rows); };

  /* ---- demo data tools (these only exist in the mock backend) ---- */
  if (!API.isMock) {
    $('backupBtn').closest('.card').hidden = true; $('resetBtn').closest('.card').hidden = true;
  } else {
    guarded($('backupBtn'), async () => { const r = await API.admin.exportBackup(); downloadBlob(`ojt-erams-backup-${U.dateStr()}.json`, new Blob([r.json], { type: 'application/json' })); toast('Backup downloaded.'); });
    $('restoreFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        if (!confirm('Replace ALL current data with this backup? This cannot be undone.')) { e.target.value = ''; return; }
        try { await API.admin.importBackup({ text: String(rd.result) }); toast('Backup restored. Reloading…'); setTimeout(() => location.reload(), 1200); }
        catch (err) { toast(err.message, 'err', 5000); e.target.value = ''; }
      };
      rd.readAsText(f);
    };
    $('resetConfirm').addEventListener('input', () => { $('resetBtn').disabled = $('resetConfirm').value.trim() !== 'RESET'; });
    guarded($('resetBtn'), async () => { await API.admin.resetDemo(); toast('Demo data reset. Reloading…', 'warn'); setTimeout(() => location.reload(), 1200); });
  }
})();
