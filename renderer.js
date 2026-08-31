/* Painel do Turno — renderer
 * Quadro OPERAÇÃO no Trello = fonte da verdade.
 * O app cria um cartão por turno ("Turno Manhã — 30/08/2026") com checklist,
 * lista as pendências (A FAZER / EM ANDAMENTO) e "Concluir" move para CONCLUÍDO.
 */
const $ = id => document.getElementById(id);

const DEFAULT_TEMPLATE = [
  "Passagem de turno: pegar todas as informações possíveis com a pessoa do turno anterior.",
  "Logar no Cloudbeds com a sua conta",
  "Abrir a Gaveta de Caixa no sistema (conferir dinheiro físico)",
  "Conferir se há check-ins e check-outs, e se preparar para isso.",
  "Conferir se as camas que terão check-ins estão arrumadas.",
  "Responder mensagens pendentes nas plataformas (Whatsapp, Booking, Airbnb)",
  "Conferir se tem café, e fazer se necessário. (Não é preciso no turno T4)",
  "Colocar música na recepção (Seguir os horários de silêncio).",
  "Dar uma volta no Hostel e ver se há algo fora do lugar, ou necessitando de limpeza. Caso sim, já ajustar."
].join("\n");

const DEFAULT_SHIFTS = [
  { name: "T1", start: 6, end: 12 },
  { name: "T2", start: 12, end: 18 },
  { name: "T3", start: 18, end: 0 },
  { name: "T4", start: 0, end: 6 }
];

const DEFAULT_PASSAGEM = [
  "Check-ins",
  "Check-outs",
  "WhatsApp",
  "Mensagens Booking/Airbnb",
  "Caixa",
  "Bounce/Day Use",
  "Encomendas/Entregas",
  "Cozinha",
  "Limpeza e Organização Geral",
  "Lavanderia/Enxoval",
  "Solicitações da Camila",
  "Extra"
].join("\n");

// ---------- configuração persistida (config.json em %APPDATA%\trello-float) ----------
const store = {};
const cfg = {
  get key() { return store.trello_key || ""; },
  get token() { return store.trello_token || ""; },
  get board() { return store.op_board || ""; },
  get manual() { return store.manual_board || ""; },
  get template() { return store.template || DEFAULT_TEMPLATE; },
  get shifts() { return Array.isArray(store.shifts) && store.shifts.length ? store.shifts : DEFAULT_SHIFTS; },
  get passFields() {
    const f = (store.passagem_fields || "").split("\n").map(s => s.trim()).filter(Boolean);
    return f.length ? f : DEFAULT_PASSAGEM.split("\n"); // lista vazia/apagada → volta pro padrão
  },
  set(k, v) { store[k] = v; window.desktop.setConfig({ [k]: v }); }
};
async function loadConfig() {
  Object.assign(store, await window.desktop.getConfig());
  // migração da v2.0 (localStorage) → config.json
  try {
    if (!store.trello_key && localStorage.getItem("trello_key")) {
      for (const k of ["trello_key", "trello_token", "op_board", "manual_board", "template", "last_who"]) {
        const v = localStorage.getItem(k); if (v) store[k] = v;
      }
      const sh = localStorage.getItem("shifts"); if (sh) store.shifts = JSON.parse(sh);
      await window.desktop.setConfig(store);
    }
  } catch {}
}

const state = {
  boards: [], lists: {}, members: [], cards: [],
  shiftCard: null, checkItems: [], boardUrl: "", manualUrl: "",
  lastPass: null, passBoxFields: [], editingPass: null, editingHeader: "",
  editingCard: null,
  notified: new Set()
};

// ---------- Trello API ----------
async function api(path, params = {}, method = "GET") {
  const u = new URL("https://api.trello.com/1" + path);
  u.searchParams.set("key", cfg.key);
  u.searchParams.set("token", cfg.token);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  const r = await fetch(u, { method });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// ---------- turno ----------
function currentShift(now = new Date()) {
  const h = now.getHours();
  const shifts = cfg.shifts;
  let s = shifts.find(x => x.start < x.end ? (h >= x.start && h < x.end) : (h >= x.start || h < x.end)) || shifts[0];
  // data do turno: madrugada depois da meia-noite pertence ao dia anterior
  const date = new Date(now);
  if (s.start > s.end && h < s.end) date.setDate(date.getDate() - 1);
  const startAt = new Date(date); startAt.setHours(s.start, 0, 0, 0);
  const endAt = new Date(date); endAt.setHours(s.end, 0, 0, 0);
  if (s.start > s.end) endAt.setDate(endAt.getDate() + 1);
  return { ...s, date, startAt, endAt };
}
const fmtDate = d => d.toLocaleDateString("pt-BR");
const fmtTime = d => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const shiftCardName = s => `Turno ${s.name} — ${fmtDate(s.date)}`;

function templateFor(shift) {
  return cfg.template.split("\n").map(t => t.trim()).filter(Boolean).filter(t => {
    const m = t.match(/\(n[ãa]o [ée] preciso no turno (?:d[aeo]\s+)?([^)]+)\)/i);
    return !(m && m[1].trim().toLowerCase() === shift.name.toLowerCase());
  });
}

// ---------- conexão ----------
async function connect() {
  $("loginMsg").textContent = "";
  try {
    state.boards = await api("/members/me/boards", { fields: "id,name,url", filter: "open" });
    cfg.set("trello_key", $("key").value.trim());
    cfg.set("trello_token", $("token").value.trim());
    fillBoardSelects();
    $("boardSetup").classList.remove("hidden");
    return true;
  } catch (e) {
    $("loginMsg").textContent = "Não foi possível conectar. Confira a Key e o Token.";
    $("boardSetup").classList.add("hidden");
    return false;
  }
}

function fillBoardSelects() {
  const opts = state.boards.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("board").innerHTML = `<option value="">— escolher —</option>` + opts;
  $("manualBoard").innerHTML = `<option value="">— nenhum —</option>` + opts;
  if (cfg.board) $("board").value = cfg.board;
  if (cfg.manual) $("manualBoard").value = cfg.manual;
}

async function createOperationBoard() {
  $("createBoard").disabled = true;
  $("createBoard").textContent = "Criando...";
  try {
    const b = await api("/boards/", { name: "🏠 Operação", defaultLists: "false", prefs_permissionLevel: "private" }, "POST");
    for (const [i, name] of ["A FAZER", "EM ANDAMENTO", "CONCLUÍDO"].entries())
      await api("/lists", { name, idBoard: b.id, pos: (i + 1) * 1000 }, "POST");
    state.boards.unshift(b);
    fillBoardSelects();
    $("board").value = b.id;
    $("createBoard").textContent = "Quadro criado ✓";
  } catch (e) {
    $("createBoard").textContent = "Erro ao criar quadro";
    console.error(e);
  }
}

// ---------- setup UI ----------
function renderShiftsEditor(shifts = cfg.shifts) {
  $("shifts").innerHTML = shifts.map(s => `
    <div class="shift-row">
      <input data-k="name" value="${esc(s.name)}" placeholder="Nome">
      <input data-k="start" type="number" min="0" max="23" value="${s.start}" title="Hora início">
      <input data-k="end" type="number" min="0" max="23" value="${s.end}" title="Hora fim">
      <button type="button" class="mini shift-del" title="Remover turno">×</button>
    </div>`).join("") +
    `<button type="button" class="mini" id="shiftAdd">+ adicionar turno</button>`;
}
function readShiftsEditor() {
  const hh = el => Math.min(23, Math.max(0, +el.value || 0));
  return [...$("shifts").querySelectorAll(".shift-row")].map((row, i) => ({
    name: row.querySelector("[data-k=name]").value.trim() || `T${i + 1}`,
    start: hh(row.querySelector("[data-k=start]")),
    end: hh(row.querySelector("[data-k=end]"))
  }));
}

async function showSetup() {
  $("app").classList.add("hidden");
  $("setup").classList.remove("hidden");
  $("key").value = cfg.key;
  $("token").value = cfg.token;
  $("template").value = cfg.template;
  $("passFields").value = store.passagem_fields || DEFAULT_PASSAGEM;
  renderShiftsEditor();
  $("autostart").checked = await window.desktop.getAutostart();
  if (cfg.key && cfg.token) await connect();
}

async function saveSetup() {
  const boardId = $("board").value;
  if (!boardId) { $("loginMsg").textContent = "Escolha ou crie o quadro de Operação."; return; }
  cfg.set("op_board", boardId);
  cfg.set("manual_board", $("manualBoard").value);
  cfg.set("template", $("template").value);
  cfg.set("passagem_fields", $("passFields").value);
  $("passBox").classList.add("hidden"); $("passBox").innerHTML = ""; // remonta com os campos novos
  const sh = readShiftsEditor();
  if (!sh.length) { $("loginMsg").textContent = "Adicione pelo menos um turno."; return; }
  cfg.set("shifts", sh);
  await window.desktop.setAutostart($("autostart").checked);
  await openPanel();
}

// ---------- painel ----------
async function openPanel() {
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("status").textContent = "Carregando...";
  try {
    const [lists, members, board] = await Promise.all([
      api(`/boards/${cfg.board}/lists`, { fields: "id,name" }),
      api(`/boards/${cfg.board}/members`, { fields: "fullName,initials" }),
      api(`/boards/${cfg.board}`, { fields: "url" })
    ]);
    state.boardUrl = board.url;
    state.members = members;
    state.lists = {};
    for (const l of lists) {
      const n = norm(l.name);
      if (n.startsWith("a fazer") || n === "todo" || n === "to do") state.lists.todo = l.id;
      else if (n.startsWith("em andamento") || n === "doing") state.lists.doing = l.id;
      else if (n.startsWith("concluido") || n === "done" || n.startsWith("feito")) state.lists.done = l.id;
    }
    if (!state.lists.todo || !state.lists.done) {
      $("status").textContent = "O quadro precisa das listas A FAZER, EM ANDAMENTO e CONCLUÍDO.";
      return;
    }
    const who = state.members.map(m => `<option value="${m.id}">${esc(m.fullName)}</option>`).join("");
    $("who").innerHTML = `<option value="">— escolher —</option>` + who;
    $("newWho").innerHTML = `<option value="">Responsável</option>` + who;
    if (cfg.manual) {
      const mb = state.boards.find(b => b.id === cfg.manual);
      state.manualUrl = mb ? mb.url : (await api(`/boards/${cfg.manual}`, { fields: "url" })).url;
    }
    await refresh();
  } catch (e) {
    console.error(e);
    $("status").textContent = "Erro ao abrir o quadro. Veja as configurações.";
  }
}

async function refresh() {
  $("status").textContent = "Atualizando...";
  try {
    const shift = currentShift();
    $("shiftLabel").textContent = `Turno ${shift.name} · ${String(shift.start).padStart(2, "0")}h–${String(shift.end).padStart(2, "0")}h`;

    state.cards = await api(`/boards/${cfg.board}/cards`, { fields: "name,due,dueComplete,shortUrl,idList,idMembers,dateLastActivity" });
    state.cards = state.cards.filter(c => c.idList !== state.lists.done);

    // cartão do turno: acha ou cria
    const name = shiftCardName(shift);
    let card = state.cards.find(c => c.name === name);
    if (!card) card = await createShiftCard(shift, name);
    state.shiftCard = card;

    const cls = await api(`/cards/${card.id}/checklists`, { fields: "name", checkItem_fields: "name,state,pos" });
    state.checkItems = cls.flatMap(cl => cl.checkItems).sort((a, b) => a.pos - b.pos);

    const assigned = card.idMembers?.[0] || "";
    $("who").value = assigned;

    render(shift);
    checkNotifications(shift);
    await loadLastPass();
    renderLastPass();
    maybeNagPassagem(shift);
    $("status").textContent = `Atualizado às ${fmtTime(new Date())}`;
  } catch (e) {
    console.error(e);
    $("status").textContent = "Erro ao atualizar o Trello.";
  }
}

async function createShiftCard(shift, name) {
  const who = store.last_who || "";
  const card = await api("/cards", {
    idList: state.lists.todo, name, pos: "top",
    due: shift.endAt.toISOString(), idMembers: who,
    desc: "Cartão criado automaticamente pelo Painel do Turno."
  }, "POST");
  const cl = await api("/checklists", { idCard: card.id, name: "Início do turno" }, "POST");
  for (const item of templateFor(shift)) await api(`/checklists/${cl.id}/checkItems`, { name: item }, "POST");
  state.cards.push(card);
  return card;
}

function render(shift) {
  const now = Date.now();
  const items = state.checkItems;
  const done = items.filter(i => i.state === "complete").length;
  $("doneCount").textContent = `${done}/${items.length}`;

  // barra: progresso do checklist x progresso do tempo do turno
  const elapsed = Math.min(1, Math.max(0, (now - shift.startAt) / (shift.endAt - shift.startAt)));
  const pct = items.length ? done / items.length : 1;
  const bar = $("bar");
  bar.style.width = `${Math.round(pct * 100)}%`;
  bar.className = pct >= 1 ? "" : elapsed > 0.6 ? "bad" : elapsed > 0.3 ? "warn" : "";

  $("checklist").innerHTML = items.length ? items.map(i => `
    <label class="item ${i.state === "complete" ? "done" : ""}">
      <input type="checkbox" data-id="${i.id}" ${i.state === "complete" ? "checked" : ""}>
      <span class="txt">${esc(i.name)}</span>
    </label>`).join("") : `<div class="empty">Sem checklist neste turno.</div>`;

  const pend = state.cards.filter(c => c.id !== state.shiftCard?.id);
  const isOver = c => c.due && !c.dueComplete && new Date(c.due).getTime() < now;
  $("pending").textContent = pend.length;
  $("overdue").textContent = pend.filter(isOver).length;
  $("cards").innerHTML = pend.length ? pend
    .sort((a, b) => (isOver(b) - isOver(a)) || (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity))
    .map(c => {
      if (c.id === state.editingCard) {
        const whoOpts = state.members.map(m => `<option value="${m.id}" ${c.idMembers?.includes(m.id) ? "selected" : ""}>${esc(m.fullName)}</option>`).join("");
        return `<article class="card doing">
          <input class="edit-name" value="${esc(c.name)}">
          <div class="row">
            <select class="edit-who"><option value="">— sem responsável —</option>${whoOpts}</select>
            <input class="edit-due" type="datetime-local" value="${c.due ? toLocalInput(c.due) : ""}">
          </div>
          <div class="card-actions">
            <button class="ok" data-act="editSave" data-id="${c.id}">💾 Salvar</button>
            <button data-act="editCancel" data-id="${c.id}">Cancelar</button>
          </div>
        </article>`;
      }
      const od = isOver(c);
      const who = state.members.filter(m => c.idMembers?.includes(m.id)).map(m => m.fullName.split(" ")[0]).join(", ");
      const due = c.due ? new Date(c.due).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      const doing = c.idList === state.lists.doing;
      return `<article class="card ${od ? "overdue" : ""} ${doing ? "doing" : ""}">
        <div class="card-title">${esc(c.name)}</div>
        <div class="card-meta">${who ? "👤 " + esc(who) : "sem responsável"} · ${od ? "🔴 ATRASADA " + due : due ? "⏰ " + due : "sem prazo"}${doing ? " · em andamento" : ""}</div>
        <div class="card-actions">
          ${!doing && state.lists.doing ? `<button data-act="doing" data-id="${c.id}">▶ Começar</button>` : ""}
          <button class="ok" data-act="done" data-id="${c.id}">✓ Concluir</button>
          <button data-act="edit" data-id="${c.id}" title="Editar">✏</button>
          <button data-act="del" data-id="${c.id}" title="Excluir">🗑</button>
          <button data-act="open" data-url="${esc(c.shortUrl)}">Abrir</button>
        </div>
      </article>`;
    }).join("") : `<div class="empty">🎉 Nenhuma pendência.</div>`;
}

// ---------- ações ----------
async function toggleItem(id, checked) {
  try {
    await api(`/cards/${state.shiftCard.id}/checkItem/${id}`, { state: checked ? "complete" : "incomplete" }, "PUT");
    const it = state.checkItems.find(i => i.id === id);
    if (it) it.state = checked ? "complete" : "incomplete";
    // checklist inteiro feito → cartão do turno vai para EM ANDAMENTO (fica visível até o fim do turno)
    if (state.checkItems.every(i => i.state === "complete") && state.lists.doing && state.shiftCard.idList !== state.lists.doing) {
      await api(`/cards/${state.shiftCard.id}`, { idList: state.lists.doing }, "PUT");
      state.shiftCard.idList = state.lists.doing;
    }
    render(currentShift());
  } catch (e) { $("status").textContent = "Não foi possível marcar o item."; }
}

function whoName() {
  const m = state.members.find(m => m.id === $("who").value);
  return m ? m.fullName : "(não informado)";
}
const comment = (cardId, text) => api(`/cards/${cardId}/actions/comments`, { text }, "POST").catch(() => {});

const toLocalInput = iso => {
  const d = new Date(iso), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function cardAction(act, id, url) {
  if (act === "open") return window.desktop.openExternal(url);
  if (act === "edit") { state.editingCard = id; return render(currentShift()); }
  if (act === "editCancel") { state.editingCard = null; return render(currentShift()); }
  try {
    if (act === "editSave") {
      const name = $("cards").querySelector(".edit-name").value.trim();
      const who = $("cards").querySelector(".edit-who").value;
      const dueRaw = $("cards").querySelector(".edit-due").value;
      const card = state.cards.find(c => c.id === id);
      const params = { due: dueRaw ? new Date(dueRaw).toISOString() : "null" };
      if (name) params.name = name;
      if (who) params.idMembers = who;
      await api(`/cards/${id}`, params, "PUT");
      // tirar o responsável: a API só remove membro por endpoint próprio
      if (!who) for (const m of card?.idMembers || []) await api(`/cards/${id}/idMembers/${m}`, {}, "DELETE").catch(() => {});
      await comment(id, `✏ Editada por ${whoName()} (painel)`);
      state.editingCard = null;
    }
    if (act === "del") {
      if (!confirm("Excluir esta pendência? Ela vai pro arquivo do Trello (dá pra recuperar por lá).")) return;
      await comment(id, `🗑 Excluída por ${whoName()} (painel)`);
      await api(`/cards/${id}`, { closed: "true" }, "PUT");
    }
    if (act === "done") {
      await api(`/cards/${id}`, { idList: state.lists.done, dueComplete: "true" }, "PUT");
      await comment(id, `✅ Concluída por ${whoName()} (painel)`);
    }
    if (act === "doing") {
      await api(`/cards/${id}`, { idList: state.lists.doing }, "PUT");
      await comment(id, `▶ Iniciada por ${whoName()} (painel)`);
    }
    await refresh();
  } catch (e) { $("status").textContent = "Não foi possível atualizar o cartão."; }
}

async function setWho(memberId) {
  cfg.set("last_who", memberId);
  if (!state.shiftCard) return;
  try { await api(`/cards/${state.shiftCard.id}`, { idMembers: memberId }, "PUT"); }
  catch { $("status").textContent = "Não foi possível definir o responsável."; }
}

async function createPending() {
  const name = $("newName").value.trim();
  if (!name) return;
  const due = $("newDue").value ? new Date($("newDue").value).toISOString() : "";
  try {
    const c = await api("/cards", { idList: state.lists.todo, name, pos: "top", due, idMembers: $("newWho").value }, "POST");
    await comment(c.id, `🆕 Criada por ${whoName()} (painel)`);
    $("newName").value = ""; $("newDue").value = ""; $("newWho").value = "";
    $("addBox").classList.add("hidden");
    await refresh();
  } catch { $("status").textContent = "Não foi possível criar a pendência."; }
}

// ---------- passagem de turno ----------
function buildPassBox() {
  // congela a lista de campos usada por ESTE formulário: mudar campos no ⚙
  // com o formulário aberto não desalinha mais rótulo × valor
  state.passBoxFields = cfg.passFields.slice();
  state.editingPass = null; state.editingHeader = ""; // formulário novo = passagem nova
  $("passBox").innerHTML = state.passBoxFields.map((f, i) => {
    const multi = /^extra/i.test(f);
    const ph = /caixa/i.test(f) ? "R$ 0,00" : multi ? "Observações livres..." : "";
    return `<label class="pass-label">${esc(f)}</label>` + (multi
      ? `<textarea data-pf="${i}" rows="3" placeholder="${ph}"></textarea>`
      : `<input data-pf="${i}" placeholder="${ph}">`);
  }).join("") + `
    <div class="row">
      <button type="button" class="mini primary" id="passSave">💾 Salvar</button>
      <button type="button" class="mini" id="passCopy">💾 Salvar + copiar p/ WhatsApp</button>
    </div>`;
  $("passSave").onclick = () => savePassagem(false);
  $("passCopy").onclick = () => savePassagem(true);
}

function passText(header) {
  const shift = currentShift();
  const parts = [];
  $("passBox").querySelectorAll("[data-pf]").forEach(el => {
    const f = state.passBoxFields[+el.dataset.pf];
    const v = el.value.trim();
    if (!f || !v) return;
    parts.push(el.tagName === "TEXTAREA" ? `${f}:\n${v}` : `${f}: ${v}`);
  });
  if (!parts.length) return "";
  // pendências em aberto entram sempre, geradas na hora (snapshot do quadro)
  const pend = state.cards.filter(c => c.id !== state.shiftCard?.id);
  if (pend.length) {
    const list = pend.map(c => {
      const who = state.members.filter(m => c.idMembers?.includes(m.id)).map(m => m.fullName.split(" ")[0]).join(", ");
      const due = c.due ? new Date(c.due).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      const od = c.due && !c.dueComplete && new Date(c.due) < new Date();
      return `- ${c.name}${who ? ` (${who})` : ""}${due ? ` — até ${due}` : ""}${od ? " ⚠ ATRASADA" : ""}`;
    }).join("\n");
    parts.push(`🚨 Pendências em aberto:\n${list}`);
  }
  const h = header || `📝 Passagem de turno: ${shift.name} - ${whoName()} - ${fmtDate(new Date())}`;
  return `${h}\n\n${parts.join("\n\n")}`;
}

// Texto salvo → campos do formulário (pra editar). Linha "Campo: valor" abre um
// campo; linhas seguintes sem rótulo conhecido continuam no mesmo campo.
function parsePass(text, fields) {
  const lines = String(text).split("\n").slice(1); // pula o cabeçalho 📝
  const map = {}; let cur = null;
  for (const line of lines) {
    if (/^🚨?\s*pend[êe]ncias em aberto:/i.test(line.trim())) break; // seção automática: regenerada ao salvar
    const m = line.match(/^(.+?):\s*(.*)$/);
    const f = m && fields.find(f => f.toLowerCase() === m[1].trim().toLowerCase());
    if (f) { cur = f; map[f] = m[2] ? [m[2]] : []; }
    else if (cur && line.trim() !== "") map[cur].push(line);
  }
  return map;
}

function startEditPass() {
  const a = state.lastPass;
  if (!a) return;
  buildPassBox();
  const map = parsePass(a.data.text, state.passBoxFields);
  $("passBox").querySelectorAll("[data-pf]").forEach(el => {
    const f = state.passBoxFields[+el.dataset.pf];
    const v = map[f] || [];
    el.value = el.tagName === "TEXTAREA" ? v.join("\n") : v.join(" ");
  });
  state.editingPass = a.id;
  state.editingHeader = (a.data.text.split("\n")[0] || "").trim();
  $("passBox").classList.remove("hidden");
  $("passBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function savePassagem(copy) {
  if (!state.shiftCard) return;
  const editing = state.editingPass;
  const text = passText(editing ? state.editingHeader : null);
  if (!text) { $("status").textContent = "Preencha pelo menos um campo da passagem."; return; }
  try {
    if (editing) await api(`/actions/${editing}`, { text }, "PUT");
    else await api(`/cards/${state.shiftCard.id}/actions/comments`, { text }, "POST");
    state.editingPass = null; state.editingHeader = "";
    if (copy) { try { await navigator.clipboard.writeText(text); } catch {} }
    $("passBox").classList.add("hidden");
    $("passBox").innerHTML = "";
    $("status").textContent = (editing ? "Passagem atualizada ✓" : "Passagem salva no Trello ✓") + (copy ? " e copiada — cole no WhatsApp" : "");
    await loadLastPass();
    renderLastPass();
  } catch { $("status").textContent = "Não foi possível salvar a passagem."; }
}

async function loadLastPass() {
  try {
    const acts = await api(`/boards/${cfg.board}/actions`, { filter: "commentCard", limit: 50 });
    state.lastPass = acts.find(a => (a.data?.text || "").startsWith("📝 Passagem de turno")) || null;
  } catch { state.lastPass = null; }
}

function renderLastPass() {
  const a = state.lastPass;
  const key = a ? a.id : "";
  const el = $("lastPass");
  if (el.dataset.key === key) return; // não fecha o <details> aberto a cada refresh
  el.dataset.key = key;
  if (!a) { el.innerHTML = `<div class="empty">Nenhuma passagem registrada ainda.</div>`; return; }
  const head = (a.data.text.split("\n")[0] || "").replace("📝 Passagem de turno: ", "");
  const when = new Date(a.date).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  el.innerHTML = `<details class="pass">
    <summary>📋 Última: ${esc(head)} · ${when}</summary>
    <pre>${esc(a.data.text)}</pre>
    <button type="button" class="mini" id="passEditBtn">✏ editar esta passagem</button>
  </details>`;
}

// Passagem já registrada neste turno? (fonte: comentário no Trello — vale entre PCs)
function passDone(shift) {
  return !!(state.lastPass && new Date(state.lastPass.date) >= shift.startAt);
}

// Faltando 30 min: abre o formulário sozinho + notificação. Não bloqueia nada,
// só reabre a cada atualização até salvarem (ou o turno acabar).
function maybeNagPassagem(shift) {
  const left = shift.endAt - Date.now();
  if (left > 30 * 60 * 1000 || left <= 0 || passDone(shift)) return;
  const box = $("passBox");
  if (box.classList.contains("hidden")) {
    if (!box.childElementCount) buildPassBox();
    box.classList.remove("hidden");
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const key = "pass:" + shiftCardName(shift);
  if (!state.notified.has(key)) {
    state.notified.add(key);
    window.desktop.notify("📝 Passagem de turno", "Faltam 30 min — escreva a passagem pro próximo turno.");
    if (window.desktop.show) window.desktop.show();
  }
}

// ---------- notificações ----------
function checkNotifications(shift) {
  const now = Date.now();
  const pend = state.cards.filter(c => c.id !== state.shiftCard?.id);
  for (const c of pend) {
    if (c.due && !c.dueComplete && new Date(c.due).getTime() < now && !state.notified.has("od:" + c.id)) {
      state.notified.add("od:" + c.id);
      window.desktop.notify("🔴 Tarefa atrasada", c.name);
    }
  }
  const left = state.checkItems.filter(i => i.state !== "complete").length;
  const elapsed = (now - shift.startAt) / (shift.endAt - shift.startAt);
  const key = shiftCardName(shift);
  if (left && elapsed > 0.5 && !state.notified.has("half:" + key)) {
    state.notified.add("half:" + key);
    window.desktop.notify("⏳ Metade do turno", `${left} item(ns) do checklist ainda pendente(s).`);
  }
  if (left && shift.endAt - now < 30 * 60 * 1000 && !state.notified.has("end:" + key)) {
    state.notified.add("end:" + key);
    window.desktop.notify("⚠️ Turno acabando", `${left} item(ns) do checklist não foram feitos.`);
  }
}


// ---------- relatório ----------
async function fetchActions(since) {
  const all = []; let before = "";
  for (let i = 0; i < 6; i++) {
    const page = await api(`/boards/${cfg.board}/actions`, {
      filter: "createCard,updateCard:idList,commentCard,updateCheckItemStateOnCard",
      limit: 1000, since: since.toISOString(), before, memberCreator: "true", memberCreator_fields: "fullName"
    });
    all.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].date;
  }
  return all;
}

async function openReport() {
  $("status").textContent = "Gerando relatório...";
  try {
    const since = new Date(); since.setDate(since.getDate() - 31); since.setHours(0, 0, 0, 0);
    const [cards, actions] = await Promise.all([
      api(`/boards/${cfg.board}/cards/all`, { fields: "name,idList,idMembers,due,dueComplete,closed,dateLastActivity", checklists: "all", checkItem_fields: "name,state" }),
      fetchActions(since)
    ]);
    const memberName = id => (state.members.find(m => m.id === id) || {}).fullName || "";
    const byCard = {};
    for (const a of actions) {
      const id = a.data?.card?.id; if (!id) continue;
      (byCard[id] = byCard[id] || []).push(a);
    }
    const rows = cards.map(c => {
      const acts = (byCard[c.id] || []).sort((a, b) => new Date(a.date) - new Date(b.date));
      const created = new Date(parseInt(c.id.slice(0, 8), 16) * 1000);
      const who = t => { const a = acts.find(a => a.type === "commentCard" && a.data.text?.includes(t)); const m = a && a.data.text.match(/por (.+?) \(painel\)/); return m ? m[1] : ""; };
      if (who("Excluída por")) return null; // excluída pelo painel: fora do relatório
      const moveDone = acts.filter(a => a.type === "updateCard" && a.data.listAfter?.id === state.lists.done).pop();
      const isShift = /^Turno .+ — \d{2}\/\d{2}\/\d{4}$/.test(c.name);
      const items = (c.checklists || []).flatMap(cl => cl.checkItems);
      const ticks = acts.filter(a => a.type === "updateCheckItemStateOnCard" && a.data.checkItem?.state === "complete");
      const done = c.idList === state.lists.done || c.closed;
      return {
        id: c.id, name: c.name, shift: isShift,
        created: created.toISOString(),
        createdBy: who("Criada por") || (acts.find(a => a.type === "createCard")?.memberCreator?.fullName ?? ""),
        owner: (c.idMembers || []).map(memberName).filter(Boolean).join(", "),
        due: c.due || "", overdue: !!(c.due && !c.dueComplete && !done && new Date(c.due) < new Date()),
        done, doneAt: moveDone ? moveDone.date : (done && !isShift ? c.dateLastActivity || "" : ""),
        doneBy: who("Concluída por"),
        itemsTotal: items.length, itemsDone: items.filter(i => i.state === "complete").length,
        lastTick: ticks.length ? ticks[ticks.length - 1].date : ""
      };
    }).filter(Boolean);
    window.desktop.openReport(reportHtml(rows));
    $("status").textContent = "Relatório aberto no navegador.";
  } catch (e) {
    console.error(e);
    $("status").textContent = "Erro ao gerar relatório.";
  }
}

function reportHtml(rows) {
  const data = JSON.stringify(rows).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório — Painel do Turno</title>
<style>
body{font-family:"Segoe UI",Arial,sans-serif;margin:0;background:#f4f5f7;color:#172b4d}
header{background:#172b4d;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header h1{font-size:18px;margin:0;flex:1}
.tabs button{border:1px solid #fff5;background:transparent;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;margin-left:4px;font:inherit}
.tabs button.on{background:#fff;color:#172b4d;font-weight:700}
main{padding:20px 24px;max-width:1200px;margin:0 auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:22px}
.kpi{background:#fff;border:1px solid #dfe1e6;border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:26px}.kpi span{font-size:12px;color:#6b778c}
.kpi.red b{color:#de350b}.kpi.green b{color:#006644}
h2{font-size:15px;margin:22px 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe1e6;font-size:13px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #ebecf0;vertical-align:top}th{background:#f7f8fa;font-size:11px;text-transform:uppercase;color:#6b778c}
tr.overdue td{background:#fff7f6}tr.done td{color:#6b778c}
.tag{display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}
.tag.open{background:#deebff;color:#0747a6}.tag.late{background:#ffebe6;color:#bf2600}.tag.ok{background:#e3fcef;color:#006644}.tag.part{background:#fffae6;color:#974f0c}
.empty{color:#6b778c;padding:14px;text-align:center;background:#fff;border:1px dashed #dfe1e6;border-radius:10px}
@media print{header{background:#fff;color:#172b4d}.tabs{display:none}}
</style></head><body>
<header><h1>📊 Relatório da operação</h1><div class="tabs">
<button data-p="1">Hoje</button><button data-p="7" class="on">7 dias</button><button data-p="30">30 dias</button>
<button onclick="print()">🖨 Imprimir / PDF</button></div></header>
<main id="m"></main>
<script>
const ROWS=${data};
const f=d=>d?new Date(d).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
const esc=s=>String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const hrs=(a,b)=>a&&b?((new Date(b)-new Date(a))/36e5).toFixed(1)+" h":"—";
function render(days){
  const from=new Date();from.setHours(0,0,0,0);from.setDate(from.getDate()-(days-1));
  const inP=d=>d&&new Date(d)>=from;
  const shifts=ROWS.filter(r=>r.shift&&inP(r.created)).sort((a,b)=>b.created.localeCompare(a.created));
  const pend=ROWS.filter(r=>!r.shift&&(!r.done||inP(r.created)||inP(r.doneAt))).sort((a,b)=>(b.overdue-a.overdue)||(a.done-b.done)||b.created.localeCompare(a.created));
  const created=pend.filter(r=>inP(r.created)).length, concluded=pend.filter(r=>r.done&&inP(r.doneAt)).length;
  const open=ROWS.filter(r=>!r.shift&&!r.done).length, late=ROWS.filter(r=>r.overdue).length;
  const chk=shifts.reduce((s,r)=>s+(r.itemsTotal?r.itemsDone/r.itemsTotal:0),0), pct=shifts.length?Math.round(chk/shifts.length*100):0;
  const people={}; const P=n=>(people[n]=people[n]||{c:0,d:0,t:0,cd:0,ct:0});
  for(const r of pend){ if(r.createdBy&&inP(r.created))P(r.createdBy).c++; if(r.doneBy&&r.done&&inP(r.doneAt))P(r.doneBy).d++; }
  for(const r of shifts){ const p=P(r.owner||"(sem responsável)"); p.t++; p.cd+=r.itemsDone; p.ct+=r.itemsTotal; }
  const tag=r=>r.done?'<span class="tag ok">concluída</span>':r.overdue?'<span class="tag late">ATRASADA</span>':'<span class="tag open">aberta</span>';
  const ctag=p=>p>=1?'<span class="tag ok">completo</span>':p>0?'<span class="tag part">parcial</span>':'<span class="tag late">não feito</span>';
  document.getElementById("m").innerHTML=
  '<div class="kpis">'+
    '<div class="kpi"><b>'+created+'</b><span>pendências criadas</span></div>'+
    '<div class="kpi green"><b>'+concluded+'</b><span>concluídas</span></div>'+
    '<div class="kpi"><b>'+open+'</b><span>abertas agora</span></div>'+
    '<div class="kpi red"><b>'+late+'</b><span>atrasadas agora</span></div>'+
    '<div class="kpi"><b>'+shifts.length+'</b><span>turnos</span></div>'+
    '<div class="kpi '+(pct>=90?"green":pct<60?"red":"")+'"><b>'+pct+'%</b><span>checklist médio</span></div>'+
  '</div>'+
  '<h2>🚨 Pendências</h2>'+
  (pend.length?'<table><tr><th>Tarefa</th><th>Criada</th><th>Por</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Concluída</th><th>Por</th><th>Tempo</th></tr>'+
    pend.map(r=>'<tr class="'+(r.overdue?"overdue":r.done?"done":"")+'"><td>'+esc(r.name)+'</td><td>'+f(r.created)+'</td><td>'+(esc(r.createdBy)||"—")+'</td><td>'+(esc(r.owner)||"—")+'</td><td>'+f(r.due)+'</td><td>'+tag(r)+'</td><td>'+f(r.doneAt)+'</td><td>'+(esc(r.doneBy)||"—")+'</td><td>'+(r.done?hrs(r.created,r.doneAt):hrs(r.created,new Date().toISOString())+" aberta")+'</td></tr>').join("")+'</table>'
   :'<div class="empty">Nenhuma pendência no período.</div>')+
  '<h2>☑ Turnos</h2>'+
  (shifts.length?'<table><tr><th>Turno</th><th>Responsável</th><th>Checklist</th><th>Status</th><th>Último item marcado</th></tr>'+
    shifts.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+(esc(r.owner)||"—")+'</td><td>'+r.itemsDone+'/'+r.itemsTotal+'</td><td>'+ctag(r.itemsTotal?r.itemsDone/r.itemsTotal:0)+'</td><td>'+f(r.lastTick)+'</td></tr>').join("")+'</table>'
   :'<div class="empty">Nenhum turno no período.</div>')+
  '<h2>👤 Por pessoa</h2>'+
  (Object.keys(people).length?'<table><tr><th>Pessoa</th><th>Turnos</th><th>Checklist</th><th>Pendências criadas</th><th>Pendências concluídas</th></tr>'+
    Object.entries(people).sort((a,b)=>b[1].t-a[1].t).map(([n,p])=>'<tr><td>'+esc(n)+'</td><td>'+p.t+'</td><td>'+(p.ct?Math.round(p.cd/p.ct*100)+"%":"—")+'</td><td>'+p.c+'</td><td>'+p.d+'</td></tr>').join("")+'</table>'
   :'<div class="empty">Sem dados.</div>')+
  '<p style="font-size:11px;color:#6b778c;margin-top:20px">Gerado em '+new Date().toLocaleString("pt-BR")+' · fonte: Trello (quadro Operação)</p>';
}
document.querySelectorAll(".tabs button[data-p]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("on"));b.classList.add("on");render(+b.dataset.p)});
render(7);
</script></body></html>`;
}

// ---------- util ----------
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])); }
function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }

// ---------- eventos ----------
$("connect").onclick = async () => { cfg.set("trello_key", $("key").value.trim()); cfg.set("trello_token", $("token").value.trim()); await connect(); };
$("createBoard").onclick = createOperationBoard;
$("saveSetup").onclick = saveSetup;
$("quitApp").onclick = () => window.desktop.quit();
$("linkKey").onclick = e => { e.preventDefault(); window.desktop.openExternal("https://trello.com/power-ups/admin"); };
$("settings").onclick = showSetup;
$("refresh").onclick = refresh;
$("reportBtn").onclick = openReport;
$("openBoard").onclick = () => state.boardUrl && window.desktop.openExternal(state.boardUrl);
$("manualBtn").onclick = () => window.desktop.openExternal(state.manualUrl || "https://trello.com");
$("who").onchange = e => setWho(e.target.value);
$("addBtn").onclick = () => { $("addBox").classList.toggle("hidden"); $("newName").focus(); };
$("lastPass").addEventListener("click", e => { if (e.target.id === "passEditBtn") startEditPass(); });
$("passBtn").onclick = () => {
  const box = $("passBox");
  if (box.classList.contains("hidden") && !box.childElementCount) buildPassBox();
  box.classList.toggle("hidden");
};
$("shifts").addEventListener("click", e => {
  if (e.target.id === "shiftAdd") {
    const cur = readShiftsEditor();
    renderShiftsEditor(cur.concat({ name: `T${cur.length + 1}`, start: 0, end: 0 }));
  } else if (e.target.classList.contains("shift-del")) {
    const cur = readShiftsEditor();
    const rows = [...$("shifts").querySelectorAll(".shift-row")];
    const i = rows.indexOf(e.target.closest(".shift-row"));
    cur.splice(i, 1);
    renderShiftsEditor(cur);
  }
});
$("newSave").onclick = createPending;
$("newName").onkeydown = e => { if (e.key === "Enter") createPending(); };
$("checklist").addEventListener("change", e => { if (e.target.matches("input[type=checkbox]")) toggleItem(e.target.dataset.id, e.target.checked); });
$("cards").addEventListener("click", e => { const b = e.target.closest("button[data-act]"); if (b) cardAction(b.dataset.act, b.dataset.id, b.dataset.url); });
$("minBtn").onclick = () => window.desktop.minimize();
$("closeBtn").onclick = () => window.desktop.hide();
$("topBtn").onclick = async () => { const on = await window.desktop.toggleTop(); $("topBtn").textContent = on ? "📌" : "📍"; };

setInterval(() => {
  if ($("app").classList.contains("hidden")) return;
  if (state.editingCard) return; // não apagar o que a pessoa está digitando
  refresh();
}, 60000);

// ---------- início ----------
(async () => {
  await loadConfig();
  if (cfg.key && cfg.token && cfg.board) {
    try { state.boards = await api("/members/me/boards", { fields: "id,name,url", filter: "open" }); } catch {}
    await openPanel();
  } else {
    await showSetup();
  }
})();
