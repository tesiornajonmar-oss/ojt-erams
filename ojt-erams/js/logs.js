(async () => {
  const me = await Shell.init('logs');
  if (!me) return;
  const $ = id => document.getElementById(id);
  let shifts = [], place = null;
  try { [shifts, place] = await Promise.all([API.student.shifts(), API.student.placement()]); } catch (e) { return toast(e.message, 'err'); }

  function render() {
    const f = $('fStatus').value, rows = f ? shifts.filter(s => s.status === f) : shifts;
    $('summaryNote').textContent = `${+place.hours.total.toFixed(2)} approved hours • ${shifts.length} log${shifts.length === 1 ? '' : 's'}`;
    $('tbody').innerHTML = rows.map(s => `<tr>
      <td>${U.fmtShortDate(s.date)}</td><td>${U.fmtTime(s.time_in)} – ${s.time_out ? U.fmtTime(s.time_out) : '—'}</td>
      <td class="small">${esc(s.company)}</td><td>${s.computed_hours || 0}</td><td>${gpsChip(s.gps_status)}</td>
      <td>${shiftStatusPill(s)}${s.status === 'REJECTED' && s.note ? `<div class="small muted">${esc(s.note)}</div>` : ''}${s.status === 'PENDING_VERIFICATION' && s.flags && s.flags.length ? `<div class="flag-list">${flagChips(s.flags)}</div>` : ''}</td>
      <td class="small">${esc(s.verified_by || '—')}</td></tr>`).join('');
    $('emptyNote').hidden = rows.length > 0;
  }
  $('fStatus').addEventListener('change', render);
  $('printBtn').onclick = () => DTR.print({
    name: `${place.user.first_name} ${place.user.last_name}`, sid: place.user.student_id, program: place.user.program,
    company: place.company ? place.company.name : '', supervisors: place.supervisors.map(s => s.name), rows: shifts, target: place.hours.target
  });
  render();
})();
