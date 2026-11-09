/* ==========================================================
   YOUR BOARDS: the starting list of board colours.
   Keep each name in quotes, with a comma after it.
   (Only used the very first time the shared list is set up.
   After that, add or rename colours in the app.)
   ========================================================== */
const DEFAULT_BOARDS = [
  'White',
  'Cashmere',
  'Light Grey',
  'Dust Grey',
  'Graphite',
  'Indigo Blue',
  'Sage Green',
  'Natural Oak',
];

/* Firebase project (these settings are meant to be public; the team login
   and the database rules are what keep the list private) */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBVH9DjzohJfKCLYg7UwzuvUZvJllO-sno",
  authDomain: "board-tracker-fdaed.firebaseapp.com",
  projectId: "board-tracker-fdaed",
  storageBucket: "board-tracker-fdaed.firebasestorage.app",
  messagingSenderId: "259275023295",
  appId: "1:259275023295:web:9aba7943b7340c393af70a"
};
const FIREBASE_VERSION = '10.12.2';

const LOCAL_KEY = 'boardTracker.v4';
const $ = id => document.getElementById(id);
/* Which page is this? index.html has the board list, orders.html has the order requests. */
const HAS_BOARDS = !!$('boards');
const HAS_REQS = !!$('req-form');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => Math.max(0, parseInt(v, 10) || 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const chevron = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
function todayISO(){ const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
const fmtDate = s => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});

/* ---------- The data ----------
   boards = [{ id, name, order, spare, customers: [{id, name, need, have, ordered, onorder, date, notDelivered}] }]
   need    = boards the customer needs (fixed when added)
   have    = boards you've got for them
   onorder = boards ordered for them that haven't arrived yet
   Shared mode: each board is one document "boards/<id>" in the artifact's shared store,
   so every phone and PC sees changes live. Local mode (opened from a file or GitHub Pages
   without sharing): saved in this browser only. */
let boards = [];
let open = null;          // id of the board whose drop-down is open
let db = null;            // shared store, or null in local mode
let readOnly = false;
let firstSnap = true;

const byId = id => boards.find(B => B.id === id);
const sorted = () => boards.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
const tidyCust = c => ({id: c.id || uid(), name: c.name || 'Customer', need: num(c.need), have: num(c.have),
  ordered: !!c.ordered, onorder: num(c.onorder), date: c.date || '', ...(c.notDelivered ? {notDelivered: c.notDelivered} : {})});
const tidyBoard = (B, i) => ({id: B.id || uid(), name: String(B.name || 'Board'), order: Number.isFinite(B.order) ? B.order : i,
  spare: num(B.spare), halves: num(B.halves), customers: (B.customers || []).map(tidyCust)});

/* What this browser had saved before (older versions included), or the starting list */
function loadLocal(){
  try{ const d = JSON.parse(localStorage.getItem(LOCAL_KEY)); if(Array.isArray(d) && d.length) return d.map(tidyBoard); }catch(e){}
  try{
    const v3 = JSON.parse(localStorage.getItem('boardTracker.v3'));
    if(v3 && v3.boards){
      const names = Array.isArray(v3.list) && v3.list.length ? v3.list : Object.keys(v3.boards);
      return names.map((name, i) => {
        const B = v3.boards[name] || {};
        const customers = (B.customers || []).map(c => ({...c,
          onorder: c.onorder ?? (c.ordered ? Math.max(0, num(c.need) - num(c.have)) : 0)}));
        return tidyBoard({id: uid(), name, order: i, spare: B.spare, customers}, i);
      });
    }
  }catch(e){}
  return DEFAULT_BOARDS.map((name, i) => tidyBoard({name, order: i}, i));
}
function saveLocal(){ try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(boards)); }catch(e){ toast('Could not save on this device'); } }

/* ---------- Saving a change ----------
   Shared mode writes one board at a time, newest state last, so quick taps don't clash. */
const writing = new Map();   // board id -> {dirty}
function saveBoard(id){
  if(!db){ saveLocal(); return; }
  const st = writing.get(id);
  if(st){ st.dirty = true; return; }
  const me = {dirty: true}; writing.set(id, me);
  setSync('saving');
  (async () => {
    try{
      while(me.dirty){
        me.dirty = false;
        const B = byId(id), ref = db.doc('boards/' + id);
        if(B){ const {id: _, ...body} = tidyBoard(B, 0); body.order = B.order; await ref.set(body); }
        else await ref.delete();
      }
      writing.delete(id);
      if(!writing.size) setSync('live');
    }catch(e){
      writing.delete(id);
      if(e && e.code === 'invalid_argument'){ readOnly = true; document.body.classList.add('readonly'); setSync('readonly'); toast("You can look but not change this list. Ask Paul for edit access."); }
      else { setSync('error'); toast("Couldn't save that change. Check your signal and try again."); }
    }
  })();
}

/* ---------- Sync status (top right) ---------- */
function setSync(state){
  const el = $('sync'); if(!el) return;
  const map = {
    connecting: ['', 'Connecting…'],
    live:       ['on', 'Live: changes show on every device'],
    saving:     ['on', 'Saving…'],
    local:      ['', 'This device only'],
    readonly:   ['', 'View only'],
    offline:    ['bad', "Can't reach the shared list"],
    error:      ['bad', 'Not saved, try again'],
  };
  const [cls, text] = map[state] || map.local;
  el.className = 'sync ' + cls; el.querySelector('span').textContent = text;
}

/* ---------- The sums ---------- */
const stillNeed = c => Math.max(0, num(c.need) - num(c.have));               // not got yet
const gap = c => Math.max(0, stillNeed(c) - (c.ordered ? num(c.onorder) : 0)); // not got and not on order
/* An order is due once its expected delivery date arrives */
const isDue = c => c.ordered && num(c.onorder) > 0 && c.date && c.date <= todayISO() && stillNeed(c) > 0;

/* Work out each board: spare boards cover customers' gaps in list order. */
function calc(B){
  let spareLeft = num(B.spare);
  const per = {};
  let toOrder = 0;
  B.customers.forEach(c => {
    const g = gap(c), fromSpare = Math.min(g, spareLeft);
    spareLeft -= fromSpare;
    per[c.id] = {fromSpare, short: g - fromSpare};
    toOrder += g - fromSpare;
  });
  const have = num(B.spare) + B.customers.reduce((s, c) => s + num(c.have), 0);
  const need = B.customers.reduce((s, c) => s + num(c.need), 0);
  const dates = B.customers.filter(c => c.ordered && c.date && stillNeed(c)).map(c => c.date).sort();
  const due = B.customers.filter(isDue).length;
  let cls, text;
  if(toOrder) { cls = 's-short'; text = toOrder + ' short'; }
  else if(due) { cls = 's-spare'; text = 'Delivery due'; }
  else if(spareLeft) { cls = 's-spare'; text = spareLeft + ' spare'; }
  else if(B.customers.length) { cls = 's-ok'; text = 'Covered'; }
  else { cls = 's-none'; text = 'None'; }
  // Half boards (cut-offs) are shown in the chip but never change the colour or the shortfall
  const h = num(B.halves);
  if(h){ if(cls === 's-none'){ cls = 's-spare'; text = h + ' half'; } else text += ` · ${h} half`; }
  return {per, toOrder, spareLeft, have, need, next: dates[0] || '', due, cls, text};
}

function custState(c, p){
  const left = stillNeed(c);
  if(!left) return {cls:'s-ok', text:'All got'};
  if(isDue(c)){
    const n = Math.min(num(c.onorder), left), late = c.date < todayISO();
    if(c.notDelivered === c.date) return {cls:'s-short', text:`${n} not delivered yet, chase it or change the date`};
    return {cls: late ? 's-short' : 's-spare', text:`${n} due ${late ? 'since ' + fmtDate(c.date) : 'today'}: delivered?`};
  }
  if(p.short) return {cls:'s-short', text:`${p.short} short, needs ordering`};
  const bits = [];
  if(c.ordered && num(c.onorder)) bits.push(`${Math.min(num(c.onorder), left)} on order`);
  if(p.fromSpare) bits.push(`${p.fromSpare} from spare`);
  return {cls: p.fromSpare ? 's-spare' : 's-ok', text: bits.join(' · ')};
}

/* ---------- Drawing ---------- */
function drawBoards(){
  if(!HAS_BOARDS){ updateSummary(); return; }
  // Keep anything half-typed (and where the cursor was) when the list redraws,
  // e.g. when someone else's change arrives while you're typing a customer name.
  const keep = {};
  $('boards').querySelectorAll('.add-form input').forEach(el => { if(el.value) keep[el.id] = el.value; });
  const focusId = document.activeElement && $('boards').contains(document.activeElement) ? document.activeElement.id : '';

  const list = sorted();
  $('boards').innerHTML = list.length ? list.map(B => {
    const k = calc(B), isOpen = open === B.id;
    const sub = B.customers.length
      ? `Needed ${k.need} · ${plural(B.customers.length, 'customer')}${k.due ? ` · <b class="due-flag">delivery due, check it</b>` : k.next ? ` · next delivery <b>${fmtDate(k.next)}</b>` : ''}`
      : (num(B.spare) || num(B.halves) ? 'Spare only' : 'No customers');
    return `<div class="brd ${isOpen ? 'open' : ''}" id="brd-${B.id}">
      <div class="brd-head">
        <button class="brd-toggle" data-toggle="${B.id}" aria-expanded="${isOpen}">
          ${chevron}<span><span class="name">${esc(B.name)}</span><span class="sub">${sub}</span></span>
        </button>
        <div class="head-meta">
          <span class="chip ${k.cls}">${k.text}</span>
          ${isOpen ? `<button class="btn ghost edit-btn can-edit" data-edit="${B.id}" aria-label="Edit ${esc(B.name)}">Edit colour</button>` : ''}
        </div>
        <div class="qty ${k.cls}" aria-label="${k.have} ${esc(B.name)} boards${num(B.halves) ? ', plus ' + num(B.halves) + ' half' : ''}">${k.have}</div>
      </div>
      ${isOpen ? drawBody(B, k) : ''}
    </div>`;
  }).join('') : '<div class="empty">No board colours yet. Add your first one below.</div>';

  Object.entries(keep).forEach(([id, v]) => { const el = $(id); if(el) el.value = v; });
  if(focusId && $(focusId)) $(focusId).focus({preventScroll: true});
  updateSummary();
}

function stepper(bid, id, field, val, cls, minusOff, plusOff){
  return `<div class="stepper ${cls}">
    <button data-step="-1" data-f="${field}" data-b="${bid}" data-c="${id}" ${minusOff ? 'disabled' : ''} aria-label="One less">−</button>
    <span class="val">${val}</span>
    <button data-step="1" data-f="${field}" data-b="${bid}" data-c="${id}" ${plusOff ? 'disabled' : ''} aria-label="One more">+</button>
  </div>`;
}

function drawBody(B, k){
  const bid = B.id, spare = num(B.spare), halves = num(B.halves);
  const spareCard = `<div class="cust spare-card ${spare || halves ? 's-spare' : 's-none'}">
      <div class="cust-top"><div class="cname">Spare<span class="state" style="color:var(--ink-soft);font-weight:400">Boards not for a customer yet. Half boards are cut-offs${k.spareLeft !== spare ? ` · ${spare - k.spareLeft} earmarked below` : ''}</span></div></div>
      <div class="cust-fields spare-fields">
        <div class="fld"><span class="lbl">Full boards</span>${stepper(bid, 'spare', 'spare', spare, spare ? 's-spare' : 's-none', spare <= 0, false)}</div>
        <div class="fld"><span class="lbl">Half boards</span>${stepper(bid, 'spare', 'halves', halves, halves ? 's-spare' : 's-none', halves <= 0, false)}</div>
      </div>
    </div>`;

  const cards = B.customers.map(c => {
    const p = k.per[c.id], st = custState(c, p), left = stillNeed(c);
    const have = num(c.have), need = num(c.need), onorder = num(c.onorder);
    return `<div class="cust ${st.cls}">
      <div class="cust-top">
        <div class="cname">${esc(c.name)}<span class="state"><span class="needs">Needs ${need}</span> · ${st.text}</span></div>
        ${c.ordered ? `<div class="cust-date"><label class="lbl fld-lbl" for="cd-${c.id}" style="font-size:11px;color:var(--ink-soft);margin-bottom:4px;font-family:var(--font-mono);letter-spacing:.04em;text-transform:uppercase">Expected delivery</label>
          <input id="cd-${c.id}" data-date="${c.id}" data-b="${bid}" type="date" value="${esc(c.date)}"></div>` : ''}
        <button class="x" data-del="${c.id}" data-b="${bid}" title="Remove ${esc(c.name)}" aria-label="Remove ${esc(c.name)}">×</button>
      </div>
      <div class="cust-fields">
        <div class="fld"><span class="lbl">Got</span>${stepper(bid, c.id, 'have', have, left ? 's-short' : 's-ok', have <= 0, have >= need)}</div>
        ${isDue(c) ? `<div class="fld"><span class="lbl">Delivered?</span>
          <div class="seg due" role="group" aria-label="Delivered?">
            <button data-dlv="yes" data-b="${bid}" data-c="${c.id}">Yes</button>
            <button data-dlv="no" data-b="${bid}" data-c="${c.id}" class="${c.notDelivered === c.date ? 'on-no' : ''}" aria-pressed="${c.notDelivered === c.date}">No</button>
          </div></div>` : `<div class="fld"><span class="lbl">Ordered?</span>
          <div class="seg" role="group" aria-label="Ordered?">
            <button data-ord="yes" data-b="${bid}" data-c="${c.id}" class="${c.ordered ? 'on-yes' : ''}" aria-pressed="${!!c.ordered}">Yes</button>
            <button data-ord="no" data-b="${bid}" data-c="${c.id}" class="${c.ordered ? '' : 'on-no'}" aria-pressed="${!c.ordered}">No</button>
          </div></div>`}
        ${c.ordered ? `<div class="fld"><span class="lbl">How many ordered</span>${stepper(bid, c.id, 'onorder', onorder, 's-ok', onorder <= 0, onorder >= left)}</div>
        <div class="fld phone-date"><label class="lbl" for="cdp-${c.id}">Expected delivery</label>
          <input id="cdp-${c.id}" data-date="${c.id}" data-b="${bid}" type="date" value="${esc(c.date)}"></div>` : ''}
        ${p.fromSpare ? `<button class="btn amber sm" data-take="${c.id}" data-b="${bid}">Take ${p.fromSpare} from spare</button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="brd-body">
    ${spareCard}${cards}
    <div class="add-form">
      <div class="field f-name"><label for="an-${bid}">New customer</label><input id="an-${bid}" type="text" placeholder="e.g. Coyne" autocomplete="off"></div>
      <div class="field"><label for="aq-${bid}">Boards needed</label><input id="aq-${bid}" type="number" min="1" inputmode="numeric" placeholder="0"></div>
      <button class="btn primary sm" data-add="${bid}">Add customer</button>
    </div>
    <p class="hint" style="margin:0">Boards needed is fixed once added. When ordered boards arrive, press + on Got and the ordered count goes down by itself.</p>
  </div>`;
}

function updateSummary(){
  const all = sorted().map(B => ({B, k: calc(B)}));
  if($('n-boards')) $('n-boards').textContent = plural(all.reduce((s, x) => s + x.k.have, 0), 'board') + ' in stock';

  drawToOrder();

  const dated = [];
  all.forEach(({B}) => B.customers.forEach(c => {
    if(c.ordered && c.date && num(c.onorder) && stillNeed(c)) dated.push({B, c});
  }));
  const rows = dated.map(({B, c}) => ({date: c.date, due: isDue(c),
    html: `${esc(B.name)} × ${Math.min(num(c.onorder), stillNeed(c))}<span class="who">${esc(c.name)}</span>`}));
  (typeof reqs !== 'undefined' ? reqs : []).filter(r => r.status === 'ordered' && r.date).forEach(r =>
    rows.push({date: r.date, due: reqDue(r), html: `${esc(r.text)}<span class="who">Stock order</span>`}));
  rows.sort((x, y) => x.date.localeCompare(y.date));
  $('deliveries').innerHTML = rows.length ? rows.slice(0, 8).map(x => `
    <div class="li"><span>${x.html}</span><span class="amt ${x.due ? 'bad' : ''}">${x.due ? (x.date < todayISO() ? 'Late' : 'Today') : fmtDate(x.date)}</span></div>`).join('')
    : '<div class="hint" style="padding:6px 0">Nothing on its way. Add an expected date when you mark boards or stock as ordered.</div>';

  const spares = all.filter(x => num(x.B.spare) || num(x.B.halves));
  if($('spares')) $('spares').innerHTML = spares.length ? spares.map(({B, k}) => {
    const s = num(B.spare), h = num(B.halves), used = s - k.spareLeft;
    const notes = [h ? `${h} half board${h === 1 ? '' : 's'} / cut-off${h === 1 ? '' : 's'}` : '', used ? `${used} earmarked for customers` : ''].filter(Boolean).join(' · ');
    return `<div class="li"><span>${esc(B.name)}${notes ? `<span class="who">${notes}</span>` : ''}</span><span class="amt spare">${s}${h ? ` + ${h} half` : ''}</span></div>`;
  }).join('') : '<div class="hint" style="padding:6px 0">No spare boards.</div>';
}

/* ---------- Pop-up box ---------- */
const dlg = $('dlg');
let dlgOk = null;
/* title, inside HTML, OK label, what OK does (return false to keep it open) */
function openBox(title, body, okLabel, onOk, danger){
  $('dlg-title').textContent = title;
  $('dlg-body').innerHTML = body;
  const ok = $('dlg-yes'); ok.textContent = okLabel; ok.className = 'btn ' + (danger ? 'danger' : 'primary');
  dlgOk = onOk;
  dlg.showModal();
  const first = dlg.querySelector('#dlg-body input'); if(first){ first.focus(); first.select(); }
}
$('dlg-form').addEventListener('submit', e => {
  e.preventDefault();
  if(dlgOk && dlgOk() === false) return;
  dlg.close();
});
$('dlg-no').onclick = () => dlg.close();

/* ---------- Board colours ---------- */
function nameProblem(name, exceptId){
  if(!name) return 'Type a colour name';
  if(boards.some(B => B.name.toLowerCase() === name.toLowerCase() && B.id !== exceptId)) return name + ' is already on the list';
  return '';
}
function editBoard(bid){
  const B = byId(bid); if(!B) return;
  const k = calc(B), empty = !B.customers.length && !num(B.spare);
  openBox('Edit board colour', `
    <div class="field"><label for="ed-name">Colour name</label><input id="ed-name" type="text" value="${esc(B.name)}" autocomplete="off"></div>
    <p class="hint" style="margin:6px 0 0">Customers and counts stay with the board when you rename it.</p>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
      <button type="button" class="btn danger sm" id="ed-remove" ${empty ? '' : 'disabled'}>Remove this colour</button>
      ${empty ? '' : `<p class="hint" style="margin:6px 0 0">To remove it, first clear its ${plural(k.have, 'board')} and ${plural(B.customers.length, 'customer')}.</p>`}
    </div>`,
    'Save', () => {
      const cur = byId(bid); if(!cur) return;
      const name = $('ed-name').value.trim(), bad = nameProblem(name, bid);
      if(bad){ toast(bad); return false; }
      if(name !== cur.name){ cur.name = name; saveBoard(bid); drawBoards(); toast(`Renamed to ${name}`); }
    });
  const rm = $('ed-remove');
  if(rm && empty) rm.onclick = () => {
    const name = B.name;
    boards = boards.filter(x => x.id !== bid); if(open === bid) open = null;
    saveBoard(bid); drawBoards(); dlg.close(); toast(name + ' removed');
  };
}
if($('add-board')) $('add-board').onclick = () => {
  if(readOnly) return;
  openBox('Add board colour', `
    <div class="field"><label for="nb-name">Colour name</label><input id="nb-name" type="text" placeholder="e.g. Egger W1100 Alpine White" autocomplete="off"></div>
    <p class="hint" style="margin:6px 0 0">It's added to the bottom of the list.</p>`,
    'Add colour', () => {
      const name = $('nb-name').value.trim(), bad = nameProblem(name);
      if(bad){ toast(bad); return false; }
      const order = boards.reduce((m, B) => Math.max(m, B.order ?? 0), -1) + 1;
      const B = {id: uid(), name, order, spare: 0, customers: []};
      boards.push(B); open = B.id;
      saveBoard(B.id); drawBoards(); toast(name + ' added');
      $('brd-' + B.id)?.scrollIntoView({block:'nearest', behavior:'smooth'});
    });
};

/* ---------- Clicks inside the board list ---------- */
$('boards')?.addEventListener('click', e => {
  const t = e.target.closest('button'); if(!t || t.disabled) return;

  if(t.dataset.toggle !== undefined){
    open = open === t.dataset.toggle ? null : t.dataset.toggle;
    drawBoards();
    if(open) $('brd-' + open)?.scrollIntoView({block:'nearest', behavior:'smooth'});
    return;
  }
  if(readOnly){ toast("You can look but not change this list."); return; }
  if(t.dataset.edit !== undefined){ editBoard(t.dataset.edit); return; }

  const bid = t.dataset.b || t.dataset.add, B = byId(bid); if(!B) return;
  const cust = id => B.customers.find(x => x.id === id);
  const done = msg => { saveBoard(bid); drawBoards(); if(msg) toast(msg); };

  if(t.dataset.step){
    const d = Number(t.dataset.step), f = t.dataset.f;
    if(f === 'spare') B.spare = Math.max(0, num(B.spare) + d);
    else if(f === 'halves') B.halves = Math.max(0, num(B.halves) + d);
    else {
      const c = cust(t.dataset.c); if(!c) return;
      if(f === 'have'){
        c.have = Math.min(num(c.need), Math.max(0, num(c.have) + d));
        // A board arriving off an order: count it off the order
        if(d > 0 && c.ordered && num(c.onorder) > 0) c.onorder = num(c.onorder) - 1;
      } else if(f === 'onorder'){
        c.onorder = Math.min(stillNeed(c), Math.max(0, num(c.onorder) + d));
      }
      if(c.onorder > stillNeed(c)) c.onorder = stillNeed(c);
    }
    return done();
  }
  if(t.dataset.ord){
    const c = cust(t.dataset.c); if(!c) return;
    const yes = t.dataset.ord === 'yes';
    if(yes && !c.ordered){ const sh = calc(B).per[c.id].short; c.ordered = true; c.onorder = Math.min(stillNeed(c), sh || 1); }
    if(!yes){ c.ordered = false; c.onorder = 0; }
    return done();
  }
  if(t.dataset.dlv){
    const c = cust(t.dataset.c); if(!c) return;
    if(t.dataset.dlv === 'yes'){
      const n = Math.min(num(c.onorder), stillNeed(c));
      c.have = num(c.have) + n; c.onorder = 0; c.ordered = false; c.date = ''; delete c.notDelivered;
      return done(`${n} ${B.name} delivered for ${c.name}, added to Got`);
    }
    c.notDelivered = c.date;
    return done('Marked not delivered. Change the expected date when you know it.');
  }
  if(t.dataset.take){
    const c = cust(t.dataset.take); if(!c) return;
    const n = calc(B).per[c.id].fromSpare;
    B.spare = num(B.spare) - n; c.have = num(c.have) + n;
    return done(`Moved ${n} from spare to ${c.name}`);
  }
  if(t.dataset.add !== undefined){
    const nameEl = $('an-' + bid), qtyEl = $('aq-' + bid);
    const name = nameEl.value.trim(), need = num(qtyEl.value);
    if(!name){ toast('Type the customer name'); nameEl.focus(); return; }
    if(!need){ toast('Enter how many boards they need'); qtyEl.focus(); return; }
    B.customers.push({id: uid(), name, need, have:0, ordered:false, onorder:0, date:''});
    nameEl.value = ''; qtyEl.value = '';
    done(`${name} added: needs ${need} ${B.name}`);
    $('an-' + bid)?.focus();
    return;
  }
  if(t.dataset.del){
    const c = cust(t.dataset.del); if(!c) return;
    openBox('Remove customer?', `<p>Remove <b>${esc(c.name)}</b> from ${esc(B.name)}?` +
      (num(c.have) ? ` Their ${plural(num(c.have), 'board')} will move to Spare.` : '') + '</p>',
      'Remove', () => {
        const cur = byId(bid); if(!cur) return;
        const cc = cur.customers.find(x => x.id === c.id); if(!cc) return;
        cur.spare = num(cur.spare) + num(cc.have);
        cur.customers = cur.customers.filter(x => x.id !== c.id);
        saveBoard(bid); drawBoards(); toast(c.name + ' removed');
      }, true);
  }
});

/* Delivery dates */
$('boards')?.addEventListener('change', e => {
  const t = e.target; if(!t.dataset.date || readOnly) return;
  const B = byId(t.dataset.b), c = B && B.customers.find(x => x.id === t.dataset.date); if(!c) return;
  c.date = t.value; delete c.notDelivered; saveBoard(B.id); drawBoards();
});
/* Enter in the add form adds the customer */
$('boards')?.addEventListener('keydown', e => {
  if(e.key !== 'Enter') return;
  const m = (e.target.id || '').match(/^a([nq])-(.+)$/); if(!m) return;
  e.preventDefault();
  if(m[1] === 'n') $('aq-' + m[2]).focus();
  else document.querySelector(`[data-add="${m[2]}"]`).click();
});

$('copy').onclick = () => {
  const lines = sorted().map(B => ({B, n: calc(B).toOrder})).filter(x => x.n).map(x => `${x.B.name} x ${x.n}`);
  const extra = activeReqs().filter(r => r.status === 'requested').map(r => `${r.text}${r.level === 'out' ? ' (out of stock)' : ''}`);
  if(!lines.length && !extra.length){ toast('Nothing to order'); return; }
  let text = `Order list (${new Date().toLocaleDateString('en-GB')})`;
  if(lines.length) text += '\n\nBoards:\n' + lines.join('\n');
  if(extra.length) text += '\n\nOther items:\n' + extra.map(t => '- ' + t).join('\n');
  copyText(text);
};

/* ==========================================================
   ORDER REQUESTS
   Each request is one document "meta/req-<id>" (the meta collection
   is already allowed by the database rules, so no rule change needed).
   status: requested -> ordered -> delivered (then kept 30 days as history)
   ========================================================== */
let reqs = [];
let newLevel = 'low';
const KEEP_DAYS = 30;
const tidyReq = r => ({id: r.id, text: String(r.text || '').slice(0, 1000), level: r.level === 'out' ? 'out' : 'low',
  status: ['requested','ordered','delivered'].includes(r.status) ? r.status : 'requested',
  date: r.date || '', createdAt: r.createdAt || '', orderedAt: r.orderedAt || '', deliveredAt: r.deliveredAt || ''});
const reqById = id => reqs.find(r => r.id === id);
const activeReqs = () => reqs.filter(r => r.status !== 'delivered').sort((a, b) => {
  const rank = r => r.status === 'requested' ? (r.level === 'out' ? 0 : 1) : 2;
  return rank(a) - rank(b) || (a.status === 'ordered' ? (a.date || '9999').localeCompare(b.date || '9999') : 0)
    || (a.createdAt || '').localeCompare(b.createdAt || '');
});
const dayOf = iso => iso ? iso.slice(0, 10) : '';
const daysAgo = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 0;
const reqDue = r => r.status === 'ordered' && r.date && r.date <= todayISO();

const reqWriting = new Map();
function saveReq(id){
  if(!db) return;
  const st = reqWriting.get(id);
  if(st){ st.dirty = true; return; }
  const me = {dirty: true}; reqWriting.set(id, me);
  setSync('saving');
  (async () => {
    try{
      while(me.dirty){
        me.dirty = false;
        const r = reqById(id), ref = db.doc('meta/' + id);
        if(r){ const {id: _, ...body} = tidyReq(r); body.kind = 'request'; await ref.set(body); }
        else await ref.delete();
      }
      reqWriting.delete(id);
      if(!reqWriting.size && !writing.size) setSync('live');
    }catch(e){
      reqWriting.delete(id);
      setSync('error'); toast("Couldn't save that request. Check your signal and try again.");
    }
  })();
}

function reqState(r){
  if(r.status === 'ordered'){
    if(reqDue(r)){
      const late = r.date < todayISO();
      return {cls: late ? 's-short' : 's-spare', chip: late ? 'Delivery late' : 'Due today'};
    }
    return {cls: 's-ok', chip: 'Ordered'};
  }
  return r.level === 'out' ? {cls: 's-short', chip: 'Out of stock'} : {cls: 's-spare', chip: 'Running low'};
}

/* Right-hand panel: stock orders waiting to be placed. Goes red when there are any. */
function drawToOrder(){
  const pending = (typeof reqs !== 'undefined' ? reqs : []).filter(r => r.status === 'requested')
    .sort((a, b) => (a.level === 'out' ? 0 : 1) - (b.level === 'out' ? 0 : 1) || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const n = pending.length;
  $('shorts').innerHTML = n ? pending.map(r => `
    <div class="li"><button class="to-req" data-goto="${r.id}">${esc(r.text)}<span class="who">Requested ${fmtDate(dayOf(r.createdAt))}</span></button>
      <span class="chip ${r.level === 'out' ? 's-short' : 's-spare'}">${r.level === 'out' ? 'Out' : 'Low'}</span></div>`).join('')
    : '<div class="empty">No orders waiting. Requests appear here until they\'re ordered.</div>';
  $('short-total').textContent = n;
  $('short-total').classList.toggle('bad', n > 0);
  $('m-short').textContent = n;
  $('slip-head').classList.toggle('alert', n > 0);
  $('mbar').classList.toggle('alert', n > 0);
  $('slip-title').textContent = n ? 'Orders to place' : 'To order';
  const badge = $('nav-badge');
  if(badge){ badge.hidden = !n; badge.textContent = n; }
}

function drawRequests(){
  drawToOrder();
  if(typeof updateSummary === 'function') updateSummary();
  if(!HAS_REQS) return;
  const list = activeReqs();
  $('n-reqs').textContent = list.length ? plural(list.length, 'request') : '';
  $('req-list').innerHTML = list.length ? list.map(r => {
    const st = reqState(r);
    const meta = [`Requested ${fmtDate(dayOf(r.createdAt))}`,
      r.status === 'ordered' ? `ordered ${fmtDate(dayOf(r.orderedAt))}` : '',
      r.status === 'ordered' && r.date ? `expected ${fmtDate(r.date)}` : ''].filter(Boolean).join(' · ');
    const actions = r.status === 'requested' ? `
        <div class="fld wide"><span class="lbl">How urgent?</span>
          <div class="seg lvl" role="group" aria-label="How urgent?">
            <button data-lvl="low" data-r="${r.id}" class="${r.level === 'low' ? 'on-low' : ''}" aria-pressed="${r.level === 'low'}">Running low</button>
            <button data-lvl="out" data-r="${r.id}" class="${r.level === 'out' ? 'on-no' : ''}" aria-pressed="${r.level === 'out'}">Out of stock</button>
          </div></div>
        <button class="btn primary sm wide" data-rordered="${r.id}">Mark as ordered</button>` : `
        <div class="fld"><label class="lbl" for="rd-${r.id}">Expected delivery</label>
          <input id="rd-${r.id}" type="date" data-rdate="${r.id}" value="${esc(r.date)}"></div>
        <button class="btn primary sm" data-rdelivered="${r.id}">Delivered</button>
        <button class="btn ghost sm wide" data-rundo="${r.id}">Not ordered yet</button>`;
    return `<div class="req ${st.cls}" id="card-${r.id}">
      <div class="req-top">
        <div class="req-text">${esc(r.text)}<span class="req-meta">${meta}</span></div>
        <span class="chip ${st.cls}">${st.chip}</span>
        <button class="x" data-rdel="${r.id}" title="Remove request" aria-label="Remove request">×</button>
      </div>
      <div class="req-actions">${actions}</div>
    </div>`;
  }).join('') : '<div class="empty">No order requests. Type one above when something is running low.</div>';

  const hist = reqs.filter(r => r.status === 'delivered').sort((a, b) => (b.deliveredAt || '').localeCompare(a.deliveredAt || ''));
  $('n-hist').textContent = hist.length ? '· ' + hist.length : '';
  $('hist-list').innerHTML = hist.length ? hist.map(r => `
    <div class="li"><span>${esc(r.text)}<span class="who">Requested ${fmtDate(dayOf(r.createdAt))}${r.orderedAt ? ' · ordered ' + fmtDate(dayOf(r.orderedAt)) : ''}</span></span>
      <span class="amt">Delivered ${fmtDate(dayOf(r.deliveredAt))}</span></div>`).join('')
    : '<div class="hint" style="padding:6px 0">Nothing delivered in the last 30 days.</div>';
}

/* New request form */
$('req-form')?.addEventListener('click', e => {
  const b = e.target.closest('[data-newlvl]'); if(!b) return;
  newLevel = b.dataset.newlvl;
  $('req-form').querySelectorAll('[data-newlvl]').forEach(x => {
    const on = x.dataset.newlvl === newLevel;
    x.className = on ? (newLevel === 'out' ? 'on-no' : 'on-low') : '';
    x.setAttribute('aria-pressed', on);
  });
});
$('req-form')?.addEventListener('submit', e => {
  e.preventDefault();
  if(readOnly || !db) return;
  const text = $('req-text').value.trim();
  if(!text){ toast('Type what you need first'); $('req-text').focus(); return; }
  const r = {id: 'req-' + uid(), text, level: newLevel, status: 'requested', date: '', createdAt: new Date().toISOString(), orderedAt: '', deliveredAt: ''};
  reqs.push(r); saveReq(r.id); drawRequests();
  $('req-text').value = '';
  $('req-form').querySelector('[data-newlvl=low]').click();
  toast('Request added');
});

/* Buttons on each request */
$('req-list')?.addEventListener('click', e => {
  const t = e.target.closest('button'); if(!t || readOnly) return;
  const d = t.dataset;
  if(d.lvl){ const r = reqById(d.r); if(!r) return; r.level = d.lvl; saveReq(r.id); drawRequests(); return; }
  if(d.rordered){
    const r = reqById(d.rordered); if(!r) return;
    openBox('Mark as ordered', `
      <p style="margin-bottom:14px"><b>${esc(r.text)}</b></p>
      <div class="field"><label for="ro-date">Expected delivery date (optional)</label><input id="ro-date" type="date" style="height:52px"></div>`,
      'Mark as ordered', () => {
        const cur = reqById(r.id); if(!cur) return;
        cur.status = 'ordered'; cur.orderedAt = new Date().toISOString(); cur.date = $('ro-date').value || '';
        saveReq(cur.id); drawRequests(); toast('Marked as ordered');
      });
    return;
  }
  if(d.rdelivered){
    const r = reqById(d.rdelivered); if(!r) return;
    r.status = 'delivered'; r.deliveredAt = new Date().toISOString();
    saveReq(r.id); drawRequests(); toast('Delivered. Moved to order history.');
    return;
  }
  if(d.rundo){
    const r = reqById(d.rundo); if(!r) return;
    r.status = 'requested'; r.orderedAt = ''; r.date = '';
    saveReq(r.id); drawRequests();
    return;
  }
  if(d.rdel){
    const r = reqById(d.rdel); if(!r) return;
    openBox('Remove request?', `<p>Remove <b>${esc(r.text)}</b>? It won't go into the order history.</p>`, 'Remove', () => {
      reqs = reqs.filter(x => x.id !== r.id); saveReq(r.id); drawRequests(); toast('Request removed');
    }, true);
  }
});
$('req-list')?.addEventListener('change', e => {
  const t = e.target; if(!t.dataset.rdate || readOnly) return;
  const r = reqById(t.dataset.rdate); if(!r) return;
  r.date = t.value; saveReq(r.id); drawRequests();
});

/* Live updates, plus tidy-up of history older than 30 days */
let prunedOnce = false;
function startRequests(){
  drawRequests();
  if(!HAS_BOARDS) reqSlow = setTimeout(() => setSync('offline'), 10000);
  db.collection('meta').onSnapshot(snap => {
    const incoming = snap.docs.filter(d => d.exists && d.id.startsWith('req-')).map(d => tidyReq({...d.data(), id: d.id}));
    const mine = reqs.filter(r => reqWriting.has(r.id));
    reqs = incoming.filter(r => !reqWriting.has(r.id)).concat(mine);
    // a request this device just removed shouldn't reappear while the delete is saving
    reqs = reqs.filter(r => !(reqWriting.has(r.id) && !mine.some(m => m.id === r.id)));
    if(!prunedOnce && !snap.metadata.fromCache && !readOnly){
      prunedOnce = true;
      reqs.filter(r => r.status === 'delivered' && daysAgo(r.deliveredAt) >= KEEP_DAYS).forEach(r => {
        reqs = reqs.filter(x => x.id !== r.id); saveReq(r.id);
      });
    }
    clearTimeout(reqSlow);
    if(!HAS_BOARDS && !reqWriting.size && !readOnly) setSync('live');
    drawRequests();
    if(!jumped && location.hash.startsWith('#card-')){
      jumped = true;
      const card = document.querySelector(location.hash);
      if(card){ card.scrollIntoView({block:'center'}); card.classList.add('flash'); }
    }
  }, () => { clearTimeout(reqSlow); setSync('offline'); });
}
let jumped = false, reqSlow = null;
if(!HAS_REQS) $('m-show').textContent = 'Open orders';
$('m-show').onclick = () => {
  if(HAS_REQS) $('req-list').scrollIntoView({behavior:'smooth', block:'start'});
  else location.href = 'orders.html';
};
$('shorts').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]'); if(!b) return;
  const card = $('card-' + b.dataset.goto);
  if(!card){ location.href = 'orders.html#card-' + b.dataset.goto; return; }
  card.scrollIntoView({behavior:'smooth', block:'center'});
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
});

function copyText(text){
  const ok = () => toast('Order list copied. Paste it into a text or email.');
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); ok(); }catch(e){ toast('Could not copy'); }
    ta.remove();
  };
  if(navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback);
  else fallback();
}

function toast(msg){
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- Starting up ---------- */
function startLocal(){
  db = null; boards = loadLocal(); setSync('local'); drawBoards();
}

/* First time the shared list is used: fill it from this device (or the starting list).
   A short lease stops two phones doing it at the same moment. */
async function seedShared(){
  try{
    const meta = db.doc('meta/setup');
    const lease = await meta.acquire({holder: uid(), ttlMs: 20000});
    if(!lease.acquired) return;
    const m = await meta.get();
    if(m.exists && m.data().seeded) return;
    const start = loadLocal();
    for(const B of start){ const {id, ...body} = B; await db.doc('boards/' + id).set(body); }
    await meta.set({seeded: true, at: new Date().toISOString()});
  }catch(e){
    if(e && e.code === 'invalid_argument'){ readOnly = true; document.body.classList.add('readonly'); setSync('readonly'); }
  }
}

async function startShared(){
  setSync('connecting');
  if(!HAS_BOARDS){ startRequests(); return; }
  $('boards').innerHTML = '<div class="empty">Loading the shared board list…</div>';
  const slow = setTimeout(() => {
    setSync('offline');
    if(firstSnap && HAS_BOARDS) $('boards').innerHTML = '<div class="empty">Can\'t reach the shared list yet. Check your signal; it will load by itself.</div>';
  }, 10000);


  db.collection('boards').onSnapshot(snap => {
    if(!snap.metadata.fromCache) clearTimeout(slow);
    if(snap.empty && !snap.metadata.fromCache && firstSnap){ firstSnap = false; seedShared(); return; }
    if(snap.empty && snap.metadata.fromCache) return;
    firstSnap = false;
    const incoming = snap.docs.filter(d => d.exists).map((d, i) => tidyBoard({...d.data(), id: d.id}, i));
    // Boards this device is still saving keep their local version so taps don't flicker back
    const mine = boards.filter(B => writing.has(B.id));
    boards = incoming.filter(B => !writing.has(B.id)).concat(mine.filter(B => !incoming.some(x => x.id === B.id) || writing.has(B.id)));
    if(open && !byId(open)) open = null;
    if(!writing.size && !readOnly) setSync('live');
    if(readOnly) setSync('readonly');
    // Don't redraw under an open pop-up; it redraws when the pop-up closes
    if(dlg.open) pendingDraw = true; else drawBoards();
  }, err => {
    clearTimeout(slow);
    setSync('offline');
    toast("Lost the connection to the shared list. Reopen the page to try again.");
  });
  startRequests();
}
let pendingDraw = false;
dlg.addEventListener('close', () => { if(pendingDraw){ pendingDraw = false; drawBoards(); } });

$('slip-date').textContent = new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}).toUpperCase();

/* ---------- Firebase ---------- */
async function loadFirebase(){
  if(window.__fbMock) return window.__fbMock();   // used only for testing
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [appM, authM, fsM] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  return {appM, authM, fsM};
}

/* Wrap Firestore so the rest of the app can talk to it simply */
function makeStore(fsM, fdb){
  const wrap = d => ({id: d.id, exists: d.exists(), data: () => d.data(), metadata: d.metadata});
  const errCode = e => (e && e.code === 'permission-denied') ? 'invalid_argument' : 'unavailable';
  return {
    doc(path){
      const ref = fsM.doc(fdb, path);
      return {
        id: ref.id,
        get: async () => wrap(await fsM.getDoc(ref)),
        set: body => fsM.setDoc(ref, body).catch(e => { throw {code: errCode(e), message: e.message}; }),
        delete: () => fsM.deleteDoc(ref).catch(e => { throw {code: errCode(e), message: e.message}; }),
        acquire: async () => ({acquired: true}),
      };
    },
    collection(path){
      return {
        onSnapshot: (next, err) => fsM.onSnapshot(fsM.collection(fdb, path),
          snap => next({docs: snap.docs.map(wrap), empty: snap.empty, size: snap.size, metadata: snap.metadata}),
          e => err && err({code: errCode(e), message: e.message})),
      };
    },
  };
}

function gate(which){
  document.body.classList.toggle('gate', !!which);
  $('login').hidden = which !== 'login';
  $('noload').hidden = which !== 'noload';
  $('signout').hidden = !!which;
}

async function startFirebase(){
  setSync('connecting');
  let fb;
  try{ fb = await loadFirebase(); }
  catch(e){ setSync('offline'); gate('noload'); return; }
  const {appM, authM, fsM} = fb;
  const app = appM.initializeApp(FIREBASE_CONFIG);
  const auth = authM.getAuth(app);
  let fdb;
  // Keep a copy on the device so it still opens with a poor signal
  try{ fdb = fsM.initializeFirestore(app, {localCache: fsM.persistentLocalCache({tabManager: fsM.persistentMultipleTabManager()})}); }
  catch(e){ fdb = fsM.getFirestore(app); }

  let started = false;
  authM.onAuthStateChanged(auth, user => {
    if(user){
      gate(null);
      if(!started){ started = true; db = makeStore(fsM, fdb); startShared(); }
    } else {
      if(started){ location.reload(); return; }
      setSync('local'); $('sync').querySelector('span').textContent = 'Not signed in';
      gate('login');
      try{ $('li-email').value = localStorage.getItem('boardTracker.email') || ''; }catch(e){}
      ($('li-email').value ? $('li-pass') : $('li-email')).focus();
    }
  });

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('li-email').value.trim(), pass = $('li-pass').value;
    const err = $('login-err'); err.hidden = true;
    $('li-go').disabled = true; $('li-go').textContent = 'Signing in…';
    try{
      await authM.signInWithEmailAndPassword(auth, email, pass);
      try{ localStorage.setItem('boardTracker.email', email); }catch(x){}
      $('li-pass').value = '';
    }catch(x){
      const c = x && x.code || '';
      err.textContent = c.includes('network') ? 'No signal. Check your connection and try again.'
        : c.includes('too-many') ? 'Too many tries. Wait a few minutes, then try again.'
        : 'That email or password is wrong. Check them and try again.';
      err.hidden = false;
    }
    $('li-go').disabled = false; $('li-go').textContent = 'Sign in';
  });

  $('signout').onclick = () => openBox('Sign out?', '<p>You\'ll need the team login to get back in on this device.</p>', 'Sign out', () => { authM.signOut(auth); }, true);
}
$('retry').onclick = () => location.reload();

startFirebase();
