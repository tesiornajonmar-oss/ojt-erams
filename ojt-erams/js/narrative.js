(async () => {
  const me = await Shell.init('narrative');
  if (!me) return;
  const $ = id => document.getElementById(id);
  const stl = { DRAFT: ['Draft', 'pill-pending'], PENDING: ['Waiting for review', 'pill-pending'], APPROVED: ['Approved', 'pill-approved'], REVISION: ['Needs revision', 'pill-revision'] };
  let list = [];

  async function render() {
    try { list = await API.student.reports(); } catch (e) { return toast(e.message, 'err'); }
    $('revBox').innerHTML = list.filter(r => r.status === 'REVISION').map(r => `
      <div class="revision-banner" style="margin-bottom:12px">
        <div><b>✏️ Revision requested — ${esc(r.title)}</b><p class="small" style="margin-top:4px">${esc(r.feedback)}</p></div>
        <button class="btn btn-outline btn-sm" data-edit="${esc(r.id)}" type="button">Revise now</button></div>`).join('');
    $('tbody').innerHTML = list.map(r => {
      const [txt, cls] = stl[r.status] || [r.status, ''];
      const editable = r.status === 'DRAFT' || r.status === 'REVISION';
      return `<tr><td>${U.fmtShortDate(r.date)}</td><td><b>${esc(r.title)}</b></td><td><span class="${cls}">${txt}</span></td><td class="small">${esc(r.feedback || '—')}</td>
        <td style="white-space:nowrap"><button class="btn btn-outline btn-sm" data-${editable ? 'edit' : 'view'}="${esc(r.id)}" type="button">${editable ? 'Edit' : 'View'}</button>
        ${r.status === 'DRAFT' ? `<button class="btn btn-outline danger btn-sm" data-del="${esc(r.id)}" type="button" style="margin-left:6px">Delete</button>` : ''}</td></tr>`;
    }).join('');
    $('emptyNote').hidden = list.length > 0;
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
    document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openView(b.dataset.view));
    document.querySelectorAll('[data-del]').forEach(b => guarded(b, async () => {
      if (!confirm('Delete this draft?')) return;
      await API.student.deleteReport({ id: b.dataset.del }); toast('Draft deleted.', 'warn'); render();
    }));
  }

  function openView(id) {
    const r = list.find(x => x.id === id); if (!r) return;
    Modal.open({ wide: true, title: esc(r.title), body: `<p class="small muted">${U.fmtDateLong(r.date)}</p><div class="report-body">${esc(r.body)}</div>`,
      footer: '<button class="btn btn-outline" id="vClose" type="button">Close</button>' });
    $('vClose').onclick = () => Modal.close();
  }

  function openEditor(id) {
    const r = id ? list.find(x => x.id === id) : null;
    Modal.open({
      wide: true, title: r ? 'Edit report' : 'New narrative report',
      body: `${r && r.status === 'REVISION' ? `<div class="revision-banner" style="margin-bottom:12px"><div><b>Adviser feedback</b><p class="small">${esc(r.feedback)}</p></div></div>` : ''}
        <div class="form-grid">
          <div class="field"><label>Date</label><input id="nDate" type="date" value="${esc(r ? r.date : U.dateStr())}"></div>
          <div class="field"><label>Title *</label><input id="nTitle" maxlength="90" value="${esc(r ? r.title : '')}" placeholder="e.g., Week 4 – Database Migration"></div>
          <div class="field full"><label>Narrative *</label><textarea id="nBody" rows="10" placeholder="What did you do, what tools did you use, and what did you learn?">${esc(r ? r.body : '')}</textarea></div>
        </div><p class="error" id="nErr"></p>`,
      footer: `<button class="btn btn-outline" id="nCancel" type="button">Cancel</button><button class="btn btn-outline" id="nDraft" type="button">Save draft</button><button class="btn btn-navy" id="nSubmit" type="button">Submit for review</button>`
    });
    const g = k => $(k).value.trim();
    $('nCancel').onclick = () => Modal.close();
    const save = submit => async () => {
      try {
        await API.student.saveReport({ id: r ? r.id : null, title: g('nTitle'), body: g('nBody'), date: g('nDate') || U.dateStr(), submit });
        Modal.close(); toast(submit ? 'Report submitted to your adviser.' : 'Draft saved.'); render();
      } catch (e) { $('nErr').textContent = e.message; }
    };
    guarded($('nDraft'), save(false)); guarded($('nSubmit'), save(true));
  }

  $('newBtn').onclick = () => openEditor(null);
  render();
})();
