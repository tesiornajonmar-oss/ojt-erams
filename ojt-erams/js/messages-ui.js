/* =====================================================================
   OJT-ERAMS — messages-ui.js : conversations between faculty and company
   supervisors, one conversation = one trainee. Used by admin/messages.html and
   supervisor/messages.html:   Messages.mount(document.getElementById('msgRoot'))
   ===================================================================== */
const Messages = (() => {
  function mount(root) {
    root.innerHTML = `<div class="msg-layout">
        <div class="msg-list">
          <div class="msg-list-head"><input class="input" id="mSearch" type="search" placeholder="Search…"><button class="btn btn-navy btn-sm" id="mNew" type="button">+ New</button></div>
          <div class="msg-scroll" id="mThreads"></div>
        </div>
        <div class="msg-pane" id="mPane"><div class="msg-empty">Select a conversation, or press <b>+ New</b> to message about a trainee.</div></div>
      </div>`;
    const $ = id => root.querySelector('#' + id);
    let threads = [], current = null, me = null;

    function renderList() {
      const q = $('mSearch').value.trim().toLowerCase();
      const list = threads.filter(t => !q || `${t.student_name} ${t.subject} ${t.company}`.toLowerCase().includes(q));
      $('mThreads').innerHTML = list.length ? list.map(t => `
        <div class="thread-item ${t.unread ? 'unread' : ''} ${t.id === current ? 'active' : ''}" data-id="${esc(t.id)}">
          <div><b>${esc(t.student_name)}</b> <span class="small muted" style="float:right">${esc(U.ago(t.last_at))}</span></div>
          <div class="small">${esc(t.subject)}</div>
          <div class="t-sub">${esc(t.last_sender)}: ${esc(t.last_snippet)}</div>
        </div>`).join('') : '<div class="msg-empty">No conversations yet.</div>';
      $('mThreads').querySelectorAll('.thread-item').forEach(el => el.onclick = () => open(el.dataset.id));
    }

    async function loadList() { threads = await API.messages.threads(); renderList(); }

    async function open(id, quiet) {
      current = id;
      const data = await API.messages.get({ id });
      me = data.me;
      const t = data.thread;
      const pane = $('mPane');
      const keepText = quiet && pane.querySelector('#mText') ? pane.querySelector('#mText').value : '';
      pane.innerHTML = `
        <div class="msg-head"><b>${esc(t.subject)}</b><div class="small muted">About ${esc(t.student_name)} • ${esc(t.company)}</div></div>
        <div class="msg-body" id="mBody">${data.messages.map(m => `
          <div class="bubble ${m.sender === me ? 'mine' : ''}"><div class="who">${esc(m.sender_name)} • ${esc(U.fmtWhen(m.at))}</div><div class="txt">${esc(m.body)}</div></div>`).join('')}</div>
        <div class="msg-compose"><textarea class="input" id="mText" rows="2" maxlength="2000" placeholder="Write a message… (Ctrl+Enter to send)"></textarea>
          <button class="btn btn-navy" id="mSend" type="button">Send</button></div>`;
      const body = pane.querySelector('#mBody'); body.scrollTop = body.scrollHeight;
      const txt = pane.querySelector('#mText'); txt.value = keepText;
      const send = async () => {
        const v = txt.value.trim(); if (!v) return;
        const btn = pane.querySelector('#mSend'); btn.disabled = true;
        try { await API.messages.send({ id, body: v }); await open(id); await loadList(); }
        catch (e) { toast(e.message, 'err'); btn.disabled = false; }
      };
      pane.querySelector('#mSend').onclick = send;
      txt.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
      if (!quiet) { await loadList(); if (window.Shell) Shell.refresh(); }
    }

    $('mNew').onclick = async () => {
      let trainees = [];
      try { trainees = await API.messages.trainees(); } catch (e) { return toast(e.message, 'err'); }
      if (!trainees.length) return toast('You have no trainees to message about yet.', 'warn');
      Modal.open({
        title: 'New conversation',
        body: `<div class="form-grid">
          <div class="field full"><label>About which trainee? *</label><select id="nSid">${trainees.map(t => `<option value="${esc(t.sid)}">${esc(t.name)} — ${esc(t.company)}</option>`).join('')}</select></div>
          <div class="field full"><label>Subject *</label><input id="nSubject" maxlength="120" placeholder="e.g., Saturday event — count the hours?"></div>
          <div class="field full"><label>Message *</label><textarea id="nBody" rows="5" maxlength="2000"></textarea></div></div>
          <p class="small muted" style="margin-top:8px">Everyone responsible for this trainee (their adviser and company supervisor) will be notified.</p><p class="error" id="nErr"></p>`,
        footer: '<button class="btn btn-outline" id="nCancel" type="button">Cancel</button><button class="btn btn-navy" id="nSend" type="button">Send</button>'
      });
      document.getElementById('nCancel').onclick = () => Modal.close();
      guarded(document.getElementById('nSend'), async () => {
        const g = id => document.getElementById(id).value.trim();
        if (!g('nSubject') || !g('nBody')) { document.getElementById('nErr').textContent = 'Please add a subject and a message.'; return; }
        const r = await API.messages.start({ student_id: g('nSid'), subject: g('nSubject'), body: g('nBody') });
        Modal.close(); toast('Message sent.'); await loadList(); await open(r.id);
      });
    };
    $('mSearch').addEventListener('input', renderList);

    (async () => {
      try {
        await loadList();
        const want = new URLSearchParams(location.search).get('thread');
        if (want && threads.some(t => t.id === want)) await open(want);
      } catch (e) { toast(e.message, 'err'); }
    })();
    setInterval(async () => {
      if (document.hidden) return;
      try { await loadList(); if (current && !document.activeElement.matches('#mText, #nBody, #nSubject')) await open(current, true); } catch (e) { /* ignore */ }
    }, 20000);
  }
  return { mount };
})();
