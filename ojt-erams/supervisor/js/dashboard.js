(async () => {
  const me = await Shell.init('dashboard');
  if (!me) return;
  const $ = id => document.getElementById(id);
  let d;
  try { d = await API.supervisor.dashboard(); } catch (e) { return toast(e.message, 'err'); }
  const c = d.counts, co = d.company;

  $('welcome').textContent = `Welcome, ${me.name}${co ? ' — ' + co.name : ''}.`;
  $('sTrainees').textContent = c.trainees; $('sAvgSub').textContent = `${c.avg}% average progress`;
  $('sPending').textContent = c.pending; $('sSpot').textContent = c.spot; $('sDuty').textContent = c.on_duty;
  $('dutyNames').textContent = d.onDuty.map(x => x.name).join(', ');

  $('companyCard').innerHTML = co ? `<div class="card-head-row"><h3 class="left">🏢 ${esc(co.name)}</h3>${moaChip(co.moa_effective)}</div>
      <div class="kv"><span>Address</span><b>${esc(co.address)}</b></div>
      <div class="kv"><span>Geofence</span><b>${co.geofence_radius} m ${co.lat == null ? '<span class="chip chip-warn">no coordinates — ask the faculty to set them</span>' : ''}</b></div>
      <p class="small muted" style="margin-top:10px">Records that wait more than <b>${d.escalate_days} days</b> are escalated to the trainee's faculty adviser automatically.</p>` : '';

  $('oldestList').innerHTML = d.oldest.length ? d.oldest.map(s => `
    <a class="list-row" href="approvals.html"><div><b>${esc(s.studentName)}</b> — ${U.fmtShortDate(s.date)} • ${s.computed_hours} h
      <div class="small">${riskChip(s.risk)} ${flagChips(s.flags)}</div></div><span class="${s.age_days >= d.escalate_days - 1 ? 'late' : 'small muted'}">${s.age_days <= 0 ? 'Today' : s.age_days + 'd'}</span></a>`).join('')
    : '<p class="muted">🎉 Nothing is waiting for you. Clean records are approved automatically.</p>';
  $('attnList').innerHTML = d.attention.length ? d.attention.map(r => `
    <a class="list-row" href="trainees.html?sid=${encodeURIComponent(r.sid)}"><div><b>${esc(r.name)}</b><div class="small muted">${esc(r.flags.join(' • '))}</div></div><span class="chev">›</span></a>`).join('')
    : '<p class="muted">No trainees are flagged right now.</p>';
})();
