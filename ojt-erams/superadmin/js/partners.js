(async () => {
  const me = await Shell.init('partners');
  if (!me) return;
  const $ = id => document.getElementById(id);
  let list = [];
  if (new URLSearchParams(location.search).get('filter') === 'issues') $('fMoa').value = 'issues';

  const isIssue = c => (c.moa_effective !== 'APPROVED' && c.moa_effective !== 'NOT_REQUIRED') || (c.moa_effective === 'APPROVED' && c.daysLeft !== null && c.daysLeft <= 60);
  function note(c) {
    if (c.daysLeft === null) return '<span class="small muted">No expiry set</span>';
    if (c.daysLeft < 0) return `<span class="co-warn small">Expired ${-c.daysLeft} day(s) ago</span>`;
    if (c.daysLeft <= 60) return `<span class="co-warn small">Expires in ${c.daysLeft} day(s)</span>`;
    return `<span class="small muted">Valid until ${U.fmtDateLong(c.moa_expiry)}</span>`;
  }

  async function render() {
    try { list = await API.staff.companies(); } catch (e) { return toast(e.message, 'err'); }
    const q = $('search').value.trim().toLowerCase(), f = $('fMoa').value;
    const shown = list.filter(c => (!q || `${c.name} ${c.industry} ${c.address}`.toLowerCase().includes(q)) && (!f || (f === 'issues' ? isIssue(c) : c.moa_effective === f)));
    $('tbody').innerHTML = shown.map(c => `<tr>
        <td><b>${esc(c.name)}</b><div class="small muted">${esc(c.industry || '')} • ${esc(c.address)}</div></td>
        <td>${c.is_partner ? '<span class="chip moa-approved">Partner</span>' : '<span class="chip moa-not_required">Non-partner</span>'}</td>
        <td>${moaChip(c.moa_effective)}</td><td>${note(c)}</td><td>${c.placed}</td><td class="small">${c.geofence_radius} m</td>
        <td style="white-space:nowrap"><button class="btn btn-outline btn-sm" data-edit="${esc(c.id)}" type="button">Edit MOA</button>
          <button class="btn btn-navy btn-sm" data-renew="${esc(c.id)}" type="button" style="margin-left:6px">Renew +1 yr</button></td></tr>`).join('');
    $('emptyNote').hidden = shown.length > 0;
    $('tbody').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEdit(b.dataset.edit));
    $('tbody').querySelectorAll('[data-renew]').forEach(b => guarded(b, async () => {
      const c = list.find(x => x.id === b.dataset.renew);
      if (!confirm(`Renew the MOA with ${c.name} for one more year and mark it as an approved partner?`)) return;
      await API.admin.renewMoa({ id: c.id }); toast(`MOA renewed for ${c.name}.`); render();
    }));
  }

  function openEdit(id) {
    const c = list.find(x => x.id === id); if (!c) return;
    const opt = (v, cur, lbl) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${lbl}</option>`;
    Modal.open({
      title: `MOA — ${esc(c.name)}`,
      body: `<div class="form-grid">
        <div class="field"><label>Official partner?</label><select id="eP">${opt('yes', c.is_partner ? 'yes' : 'no', 'Yes — active partner')}${opt('no', c.is_partner ? 'yes' : 'no', 'No')}</select></div>
        <div class="field"><label>MOA status</label><select id="eS">${opt('APPROVED', c.moa_status, 'Approved')}${opt('PENDING', c.moa_status, 'Pending')}${opt('EXPIRED', c.moa_status, 'Expired')}${opt('NOT_REQUIRED', c.moa_status, 'Not required')}</select></div>
        <div class="field"><label>MOA expiry date</label><input id="eX" type="date" value="${esc(c.moa_expiry || '')}"></div>
        <div class="field"><label>Trainees placed</label><input value="${c.placed}" disabled></div></div>
        <p class="small muted" style="margin-top:12px">Changing the MOA status also updates the MOA badge shown to every trainee placed here.</p>`,
      footer: '<button class="btn btn-outline" id="eCancel" type="button">Cancel</button><button class="btn btn-navy" id="eSave" type="button">Save</button>'
    });
    $('eCancel').onclick = () => Modal.close();
    guarded($('eSave'), async () => { await API.admin.saveMoa({ id, is_partner: $('eP').value === 'yes', moa_status: $('eS').value, moa_expiry: $('eX').value || null }); Modal.close(); toast('MOA updated.'); render(); });
  }

  $('exportBtn').onclick = () => {
    const rows = [['Company', 'Industry', 'Partner', 'MOA Status', 'MOA Expiry', 'Days Left', 'Trainees Placed', 'Geofence (m)', 'Contact', 'Email', 'Phone']];
    list.forEach(c => rows.push([c.name, c.industry, c.is_partner ? 'Yes' : 'No', c.moa_effective, c.moa_expiry || '', c.daysLeft === null ? '' : c.daysLeft, c.placed, c.geofence_radius, c.contact_person, c.contact_email, c.contact_phone]));
    downloadCsv(`OJT-partners-${U.dateStr()}.csv`, rows);
  };
  $('search').addEventListener('input', render); $('fMoa').addEventListener('change', render);
  render();
})();
