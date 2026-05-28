const STORAGE_KEY = "aa-ledger-state-v2";
const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
});

const defaultState = {
  members: [],
  expenses: [],
  dateRange: defaultDateRange(),
};

let state = loadState();
let dateRange = normalizeDateRange(state.dateRange || rangeFromLatestExpense() || defaultDateRange());
let expandedMemberId = null;
let selectedExpenseIds = new Set();
let deferredInstallPrompt = null;
let expandedSettlementKey = null;

const els = {
  tabs: document.querySelectorAll(".tab-button"),
  views: document.querySelectorAll(".view"),
  viewTitle: document.querySelector("#viewTitle"),
  memberForm: document.querySelector("#memberForm"),
  memberName: document.querySelector("#memberName"),
  memberChips: document.querySelector("#memberChips"),
  memberTable: document.querySelector("#memberTable"),
  payerSelect: document.querySelector("#payerSelect"),
  participantList: document.querySelector("#participantList"),
  expenseForm: document.querySelector("#expenseForm"),
  expenseAmount: document.querySelector("#expenseAmount"),
  expenseTitle: document.querySelector("#expenseTitle"),
  expenseDate: document.querySelector("#expenseDate"),
  startDateFilter: document.querySelector("#startDateFilter"),
  endDateFilter: document.querySelector("#endDateFilter"),
  historyHint: document.querySelector("#historyHint"),
  expenseSearch: document.querySelector("#expenseSearch"),
  clearSearchBtn: document.querySelector("#clearSearchBtn"),
  selectVisibleExpenses: document.querySelector("#selectVisibleExpenses"),
  selectedCount: document.querySelector("#selectedCount"),
  bulkDeleteBtn: document.querySelector("#bulkDeleteBtn"),
  expenseList: document.querySelector("#expenseList"),
  totalExpense: document.querySelector("#totalExpense"),
  averageExpense: document.querySelector("#averageExpense"),
  expenseCount: document.querySelector("#expenseCount"),
  balanceList: document.querySelector("#balanceList"),
  settlementList: document.querySelector("#settlementList"),
  installBtn: document.querySelector("#installBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFileInput: document.querySelector("#importFileInput"),
  resetBtn: document.querySelector("#resetBtn"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
};

els.expenseDate.valueAsDate = new Date();
enableDatePickerOnClick(els.expenseDate);

els.tabs.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

els.startDateFilter.addEventListener("change", () => {
  dateRange = normalizeDateRange({ start: els.startDateFilter.value, end: els.endDateFilter.value });
  state.dateRange = dateRange;
  expandedMemberId = null;
  expandedSettlementKey = null;
  selectedExpenseIds.clear();
  els.expenseSearch.value = "";
  saveAndRender();
});

els.endDateFilter.addEventListener("change", () => {
  dateRange = normalizeDateRange({ start: els.startDateFilter.value, end: els.endDateFilter.value });
  state.dateRange = dateRange;
  expandedMemberId = null;
  expandedSettlementKey = null;
  selectedExpenseIds.clear();
  els.expenseSearch.value = "";
  saveAndRender();
});

els.expenseSearch.addEventListener("input", () => {
  selectedExpenseIds.clear();
  renderExpenses();
});

els.clearSearchBtn.addEventListener("click", () => {
  els.expenseSearch.value = "";
  selectedExpenseIds.clear();
  renderExpenses();
});

els.selectVisibleExpenses.addEventListener("change", () => {
  const visibleIds = getVisibleExpenses().map((expense) => expense.id);
  if (els.selectVisibleExpenses.checked) {
    visibleIds.forEach((id) => selectedExpenseIds.add(id));
  } else {
    visibleIds.forEach((id) => selectedExpenseIds.delete(id));
  }
  renderExpenses();
});

els.bulkDeleteBtn.addEventListener("click", () => {
  const count = selectedExpenseIds.size;
  if (!count || !confirm(`确定删除选中的 ${count} 笔账单吗？`)) return;
  state.expenses = state.expenses.filter((expense) => !selectedExpenseIds.has(expense.id));
  selectedExpenseIds.clear();
  saveAndRender();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBtn.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  els.installBtn.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

els.memberForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.memberName.value.trim();
  if (!name || state.members.some((member) => member.name === name)) return;
  state.members.push({ id: createId(), name });
  els.memberName.value = "";
  saveAndRender();
});

els.expenseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const participantIds = [...document.querySelectorAll("[name='participants']:checked")].map((item) => item.value);
  if (participantIds.length === 0) {
    alert("请选择至少一位参与 AA 的成员。");
    return;
  }

  state.expenses.push({
    id: createId(),
    title: els.expenseTitle.value.trim(),
    amount: Number(els.expenseAmount.value),
    payerId: els.payerSelect.value,
    participantIds,
    shares: null,
    date: els.expenseDate.value,
    createdAt: Date.now(),
  });

  dateRange = rangeForDate(els.expenseDate.value);
  state.dateRange = dateRange;
  selectedExpenseIds.clear();
  els.expenseForm.reset();
  els.expenseDate.valueAsDate = new Date();
  saveAndRender();
});

els.exportBtn.addEventListener("click", () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aa-ledger-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

els.importBtn.addEventListener("click", () => {
  els.importFileInput.click();
});

els.importFileInput.addEventListener("change", async () => {
  const file = els.importFileInput.files?.[0];
  els.importFileInput.value = "";
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (!isValidImportedState(imported)) {
      alert("这个文件不是有效的 AA 账本数据。");
      return;
    }
    if (!confirm("上传的数据会覆盖当前设备上的账本，确定继续吗？")) return;
    state = normalizeImportedState(imported);
    dateRange = normalizeDateRange(state.dateRange || rangeFromLatestExpense() || defaultDateRange());
    expandedMemberId = null;
    expandedSettlementKey = null;
    selectedExpenseIds.clear();
    els.expenseSearch.value = "";
    saveAndRender();
    alert("账本数据已导入。");
  } catch {
    alert("读取失败，请确认上传的是导出的 JSON 文件。");
  }
});

els.resetBtn.addEventListener("click", () => {
  if (!confirm("确定清空当前账本吗？此操作不可撤销。")) return;
  dateRange = defaultDateRange();
  expandedMemberId = null;
  expandedSettlementKey = null;
  selectedExpenseIds.clear();
  state = { members: [], expenses: [], dateRange };
  saveAndRender();
});

function loadState() {
  const raw = readStorage();
  if (!raw) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.members) || !Array.isArray(parsed.expenses)) {
      return structuredClone(defaultState);
    }
    return parsed;
  } catch {
    return structuredClone(defaultState);
  }
}

function isValidImportedState(value) {
  return Boolean(
    value &&
      Array.isArray(value.members) &&
      Array.isArray(value.expenses) &&
      value.members.every((member) => member.id && member.name) &&
      value.expenses.every((expense) => expense.id && expense.title && Number(expense.amount) >= 0 && expense.payerId && expense.date),
  );
}

function normalizeImportedState(value) {
  return {
    members: value.members,
    expenses: value.expenses,
    dateRange: normalizeDateRange(value.dateRange || rangeFromExpenses(value.expenses) || defaultDateRange()),
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function enableDatePickerOnClick(input) {
  input.addEventListener("click", () => {
    if (typeof input.showPicker === "function") {
      input.showPicker();
    }
  });
}

function readStorage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return window.__aaLedgerFallback || null;
  }
}

function writeStorage(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    window.__aaLedgerFallback = value;
  }
}

function getActiveExpenses() {
  return state.expenses.filter((expense) => isDateInRange(expense.date, dateRange));
}

function getVisibleExpenses() {
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const searchTerm = els.expenseSearch.value.trim().toLowerCase();
  const rangeExpenses = getActiveExpenses();
  return searchTerm
    ? rangeExpenses.filter((expense) => expenseMatchesSearch(expense, memberNames, searchTerm))
    : rangeExpenses;
}

function defaultDateRange() {
  return rangeForDate(new Date().toISOString().slice(0, 10));
}

function rangeFromLatestExpense() {
  return rangeFromExpenses(state.expenses);
}

function rangeFromExpenses(expenses) {
  const latestDate = expenses
    .map((expense) => normalizeDate(expense.date))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0];
  return latestDate ? rangeForDate(latestDate) : null;
}

function rangeForDate(value) {
  const date = normalizeDate(value) || new Date().toISOString().slice(0, 10);
  const month = date.slice(0, 7);
  const start = `${month}-01`;
  const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);
  return { start, end };
}

function normalizeDateRange(range) {
  const fallback = defaultDateRange();
  let start = normalizeDate(range?.start) || fallback.start;
  let end = normalizeDate(range?.end) || fallback.end;
  if (start > end) [start, end] = [end, start];
  return { start, end };
}

function normalizeDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isDateInRange(value, range) {
  const date = normalizeDate(value);
  return Boolean(date && date >= range.start && date <= range.end);
}

function formatDateRange(range) {
  return `${range.start} 至 ${range.end}`;
}

function saveAndRender() {
  state.dateRange = dateRange;
  writeStorage(JSON.stringify(state));
  render();
}

function switchTab(tab) {
  const titleMap = {
    overview: "款项总览",
    expenses: "新增记账",
    members: "成员管理",
  };

  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  els.views.forEach((view) => view.classList.toggle("active", view.id === `${tab}View`));
  els.viewTitle.textContent = titleMap[tab];
}

function render() {
  renderDateRange();
  renderMembers();
  renderExpenseForm();
  renderExpenses();
  renderOverview();
}

function renderDateRange() {
  dateRange = normalizeDateRange(dateRange);
  state.dateRange = dateRange;
  els.startDateFilter.value = dateRange.start;
  els.endDateFilter.value = dateRange.end;
}

function renderMembers() {
  els.memberChips.innerHTML = "";
  state.members.forEach((member) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = member.name;
    els.memberChips.append(chip);
  });

  els.memberTable.innerHTML = "";
  if (state.members.length === 0) {
    els.memberTable.append(emptyNode("还没有成员", "添加成员后就可以开始 AA 记账。"));
    return;
  }

  const rangeExpenses = getActiveExpenses();
  const balances = calculateBalances(rangeExpenses);
  state.members.forEach((member) => {
    const row = document.createElement("div");
    row.className = "member-row";
    const expenseCount = rangeExpenses.filter(
      (expense) => expense.payerId === member.id || expense.participantIds.includes(member.id),
    ).length;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <small>${expenseCount} 笔相关记录 · 当前余额 ${formatAmount(balances.get(member.id) || 0)}</small>
      </div>
      <div class="member-actions">
        <button class="ghost-button" type="button" data-view-member="${member.id}">${expandedMemberId === member.id ? "收起" : "查看"}</button>
        <button class="danger-button" type="button" data-remove-member="${member.id}">删除</button>
      </div>
    `;
    els.memberTable.append(row);
    if (expandedMemberId === member.id) {
      els.memberTable.append(renderMemberDetail(member.id));
    }
  });

  document.querySelectorAll("[data-view-member]").forEach((button) => {
    button.addEventListener("click", () => {
      expandedMemberId = expandedMemberId === button.dataset.viewMember ? null : button.dataset.viewMember;
      renderMembers();
    });
  });

  document.querySelectorAll("[data-remove-member]").forEach((button) => {
    button.addEventListener("click", () => removeMember(button.dataset.removeMember));
  });
}

function renderMemberDetail(memberId) {
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const relatedExpenses = getActiveExpenses()
    .filter((expense) => expense.payerId === memberId || expense.participantIds.includes(memberId))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);

  const detail = document.createElement("div");
  detail.className = "member-detail";

  if (relatedExpenses.length === 0) {
    detail.append(emptyNode("暂无相关明细", "该成员还没有付款或参与分摊记录。"));
    return detail;
  }

  relatedExpenses.forEach((expense) => {
    const item = document.createElement("article");
    item.className = "member-expense";
    const paid = expense.payerId === memberId;
    const joined = expense.participantIds.includes(memberId);
    const share = getMemberShare(expense, memberId);
    const roles = [paid ? "付款人" : null, joined ? "参与分摊" : null].filter(Boolean).join(" · ");
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(expense.title)}</strong>
        <small>${expense.date} · ${escapeHtml(memberNames.get(expense.payerId) || "未知")} 付款</small>
        <div class="participant-line">${roles || "相关记录"}</div>
      </div>
      <div class="member-expense-amount">
        <strong>${formatAmount(expense.amount)}</strong>
        <small>本人分摊 ${formatAmount(share)}</small>
      </div>
    `;
    detail.append(item);
  });

  return detail;
}

function renderExpenseForm() {
  els.payerSelect.innerHTML = "";
  state.members.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    els.payerSelect.append(option);
  });

  els.participantList.innerHTML = "";
  state.members.forEach((member) => {
    const label = document.createElement("label");
    label.className = "check-pill";
    label.innerHTML = `
      <input name="participants" type="checkbox" value="${member.id}" checked />
      ${escapeHtml(member.name)}
    `;
    els.participantList.append(label);
  });
}

function renderExpenses() {
  els.expenseList.innerHTML = "";
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const rangeExpenses = getActiveExpenses();
  const visibleExpenses = getVisibleExpenses();
  selectedExpenseIds = new Set([...selectedExpenseIds].filter((id) => visibleExpenses.some((expense) => expense.id === id)));
  renderBulkActions(visibleExpenses);
  els.historyHint.textContent = `${formatDateRange(dateRange)} · 按时间倒序`;
  if (rangeExpenses.length === 0) {
    els.expenseList.append(emptyNode("区间内还没有明细", "调整日期区间，或新增一笔共同支出。"));
    return;
  }
  if (visibleExpenses.length === 0) {
    els.expenseList.append(emptyNode("没有匹配明细", "换个关键词试试，或清除搜索。"));
    return;
  }

  visibleExpenses
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt)
    .forEach((expense) => {
      const item = document.createElement("article");
      item.className = "expense-item";
      const participants = expense.participantIds.map((id) => memberNames.get(id)).filter(Boolean);
      const shareDetails = formatShareDetails(expense, memberNames);
      item.innerHTML = `
        <label class="expense-check" title="选择账单">
          <input type="checkbox" data-select-expense="${expense.id}" ${selectedExpenseIds.has(expense.id) ? "checked" : ""} />
        </label>
        <div>
          <strong>${escapeHtml(expense.title)}</strong>
          <small>${expense.date} · ${escapeHtml(memberNames.get(expense.payerId) || "未知")} 付款 · ${participants.length} 人 AA</small>
          <div class="participant-line">参与：${participants.map(escapeHtml).join("、") || "无"}</div>
          <div class="share-line">${shareDetails}</div>
        </div>
        <strong>${formatAmount(expense.amount)}</strong>
        <div class="expense-actions">
          <button class="icon-button" type="button" title="删除" data-remove-expense="${expense.id}">×</button>
        </div>
      `;
      els.expenseList.append(item);
    });

  document.querySelectorAll("[data-remove-expense]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedExpenseIds.delete(button.dataset.removeExpense);
      state.expenses = state.expenses.filter((expense) => expense.id !== button.dataset.removeExpense);
      saveAndRender();
    });
  });

  document.querySelectorAll("[data-select-expense]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedExpenseIds.add(checkbox.dataset.selectExpense);
      } else {
        selectedExpenseIds.delete(checkbox.dataset.selectExpense);
      }
      renderExpenses();
    });
  });
}

function renderBulkActions(visibleExpenses) {
  const visibleIds = visibleExpenses.map((expense) => expense.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedExpenseIds.has(id)).length;
  els.selectedCount.textContent = `已选 ${selectedVisibleCount} 笔`;
  els.bulkDeleteBtn.disabled = selectedVisibleCount === 0;
  els.selectVisibleExpenses.disabled = visibleExpenses.length === 0;
  els.selectVisibleExpenses.checked = visibleExpenses.length > 0 && selectedVisibleCount === visibleExpenses.length;
  els.selectVisibleExpenses.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleExpenses.length;
}

function renderOverview() {
  const rangeExpenses = getActiveExpenses();
  const total = rangeExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const average = state.members.length ? total / state.members.length : 0;
  els.totalExpense.textContent = formatAmount(total);
  els.averageExpense.textContent = formatAmount(average);
  els.expenseCount.textContent = String(rangeExpenses.length);

  renderBalances();
  renderSettlements();
}

function renderBalances() {
  els.balanceList.innerHTML = "";
  if (state.members.length === 0) {
    els.balanceList.append(emptyNode("还没有成员", "添加成员后会显示每个人应收应付。"));
    return;
  }

  const balances = calculateBalances(getActiveExpenses());
  state.members.forEach((member) => {
    const balance = roundMoney(balances.get(member.id) || 0);
    const item = document.createElement("div");
    item.className = "balance-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <small>${balance > 0 ? "应收" : balance < 0 ? "应付" : "已平账"}</small>
      </div>
      <strong class="${balanceClass(balance)}">${formatAmount(balance)}</strong>
    `;
    els.balanceList.append(item);
  });
}

function renderSettlements() {
  els.settlementList.innerHTML = "";
  const transferDetails = calculateTransferDetails();
  const netTransferDetails = calculateNetTransferDetails(transferDetails);
  const settlements = calculateSettlements();
  if (transferDetails.length === 0 && settlements.length === 0) {
    els.settlementList.append(emptyNode("暂无需结算", "所有成员当前已经平账。"));
    return;
  }

  els.settlementList.append(sectionTitle("转账明细"));
  if (transferDetails.length === 0) {
    els.settlementList.append(compactEmptyNode("当前区间没有需要转账的分摊明细。"));
  } else {
    transferDetails.forEach((transfer) => {
      const key = `detail:${transfer.fromId}->${transfer.toId}`;
      const item = document.createElement("div");
      item.className = "settlement-item transfer-detail-item settlement-clickable";
      item.dataset.toggleSettlement = key;
      item.innerHTML = `
        <div>
          <span>${escapeHtml(transfer.from)} → ${escapeHtml(transfer.to)}</span>
          <small>${transfer.count} 笔分摊 · 点击查看账单</small>
        </div>
        <div class="settlement-side">
          <strong>${formatAmount(transfer.amount)}</strong>
          <button class="icon-button" type="button" title="查看账单">${expandedSettlementKey === key ? "−" : "+"}</button>
        </div>
      `;
      els.settlementList.append(item);
      if (expandedSettlementKey === key) {
        els.settlementList.append(renderSettlementBills(transfer.items, "分摊来源账单"));
      }
    });
  }

  els.settlementList.append(sectionTitle("抵消后明细"));
  if (netTransferDetails.length === 0) {
    els.settlementList.append(compactEmptyNode("双向往来抵消后无需转账。"));
  } else {
    netTransferDetails.forEach((transfer) => {
      const key = `net:${transfer.fromId}->${transfer.toId}`;
      const item = document.createElement("div");
      item.className = "settlement-item transfer-detail-item settlement-clickable";
      item.dataset.toggleSettlement = key;
      item.innerHTML = `
        <div>
          <span>${escapeHtml(transfer.from)} → ${escapeHtml(transfer.to)}</span>
          <small>已抵消反向往来 · 点击查看账单</small>
        </div>
        <div class="settlement-side">
          <strong>${formatAmount(transfer.amount)}</strong>
          <button class="icon-button" type="button" title="查看账单">${expandedSettlementKey === key ? "−" : "+"}</button>
        </div>
      `;
      els.settlementList.append(item);
      if (expandedSettlementKey === key) {
        els.settlementList.append(renderSettlementBills(transfer.items, "抵消相关账单"));
      }
    });
  }

  els.settlementList.append(sectionTitle("最少转账方向"));
  if (settlements.length === 0) {
    els.settlementList.append(compactEmptyNode("原始分摊相互抵消后无需转账。"));
    return;
  }

  settlements.forEach((settlement) => {
    const key = `minimal:${settlement.fromId}->${settlement.toId}`;
    const item = document.createElement("div");
    item.className = "settlement-item settlement-clickable";
    item.dataset.toggleSettlement = key;
    item.innerHTML = `
      <span>${escapeHtml(settlement.from)} → ${escapeHtml(settlement.to)}</span>
      <div class="settlement-side">
        <strong>${formatAmount(settlement.amount)}</strong>
        <button class="icon-button" type="button" title="查看账单">${expandedSettlementKey === key ? "−" : "+"}</button>
      </div>
    `;
    els.settlementList.append(item);
    if (expandedSettlementKey === key) {
      els.settlementList.append(renderSettlementBills(getRelatedSettlementBills(settlement.fromId, settlement.toId), "相关账单"));
    }
  });

  document.querySelectorAll("[data-toggle-settlement]").forEach((button) => {
    button.addEventListener("click", () => {
      expandedSettlementKey = expandedSettlementKey === button.dataset.toggleSettlement ? null : button.dataset.toggleSettlement;
      renderSettlements();
    });
  });
}

function renderSettlementBills(items, title) {
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const wrapper = document.createElement("div");
  wrapper.className = "settlement-bills";
  const heading = document.createElement("div");
  heading.className = "settlement-bills-title";
  heading.textContent = title;
  wrapper.append(heading);

  if (items.length === 0) {
    wrapper.append(compactEmptyNode("没有找到对应账单。"));
    return wrapper;
  }

  items.forEach((entry) => {
    const expense = entry.expense || entry;
    const participants = expense.participantIds.map((id) => memberNames.get(id)).filter(Boolean);
    const row = document.createElement("article");
    row.className = "settlement-bill-item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(expense.title)}</strong>
        <small>${expense.date} · ${escapeHtml(memberNames.get(expense.payerId) || "未知")} 付款 · ${participants.join("、") || "无"} 参与</small>
      </div>
      <div class="settlement-bill-amounts">
        <strong>${formatAmount(expense.amount)}</strong>
        ${entry.share ? `<small>对应分摊 ${formatAmount(entry.share)}</small>` : ""}
      </div>
    `;
    wrapper.append(row);
  });

  return wrapper;
}

function sectionTitle(text) {
  const title = document.createElement("div");
  title.className = "settlement-section-title";
  title.textContent = text;
  return title;
}

function compactEmptyNode(text) {
  const node = document.createElement("div");
  node.className = "compact-empty";
  node.textContent = text;
  return node;
}

function calculateBalances(expenses = getActiveExpenses()) {
  const balances = new Map(state.members.map((member) => [member.id, 0]));

  expenses.forEach((expense) => {
    if (!balances.has(expense.payerId) || expense.participantIds.length === 0) return;
    balances.set(expense.payerId, balances.get(expense.payerId) + expense.amount);
    if (expense.shares && typeof expense.shares === "object") {
      Object.entries(expense.shares).forEach(([id, share]) => {
        if (balances.has(id)) {
          balances.set(id, balances.get(id) - Number(share));
        }
      });
    } else {
      const share = expense.amount / expense.participantIds.length;
      expense.participantIds.forEach((id) => {
        if (balances.has(id)) {
          balances.set(id, balances.get(id) - share);
        }
      });
    }
  });

  return balances;
}

function calculateTransferDetails(expenses = getActiveExpenses()) {
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const transfers = new Map();

  expenses.forEach((expense) => {
    if (!memberNames.has(expense.payerId) || expense.participantIds.length === 0) return;
    const shares = getExpenseShares(expense);
    Object.entries(shares).forEach(([memberId, amount]) => {
      const roundedAmount = roundMoney(Number(amount));
      if (memberId === expense.payerId || !memberNames.has(memberId) || roundedAmount < 0.01) return;
      const key = `${memberId}->${expense.payerId}`;
      const existing = transfers.get(key) || {
        fromId: memberId,
        toId: expense.payerId,
        from: memberNames.get(memberId),
        to: memberNames.get(expense.payerId),
        amount: 0,
        count: 0,
        items: [],
      };
      existing.amount = roundMoney(existing.amount + roundedAmount);
      existing.count += 1;
      existing.items.push({ expense, share: roundedAmount });
      transfers.set(key, existing);
    });
  });

  return [...transfers.values()]
    .filter((transfer) => transfer.amount >= 0.01)
    .sort((a, b) => b.amount - a.amount || a.from.localeCompare(b.from, "zh-CN"));
}

function calculateNetTransferDetails(transfers) {
  const pairs = new Map();

  transfers.forEach((transfer) => {
    const pairIds = [transfer.fromId, transfer.toId].sort();
    const key = pairIds.join("<>");
    const existing = pairs.get(key) || { entries: [] };
    existing.entries.push(transfer);
    pairs.set(key, existing);
  });

  const netTransfers = [];
  pairs.forEach(({ entries }) => {
    if (entries.length === 1) {
      const transfer = entries[0];
      netTransfers.push({ ...transfer, items: transfer.items });
      return;
    }

    const [first, second] = entries;
    const netAmount = roundMoney(first.amount - second.amount);
    if (Math.abs(netAmount) < 0.01) return;

    const winner = netAmount > 0 ? first : second;
    netTransfers.push({
      fromId: winner.fromId,
      toId: winner.toId,
      from: winner.from,
      to: winner.to,
      amount: Math.abs(netAmount),
      count: first.count + second.count,
      items: [...first.items, ...second.items].sort(
        (a, b) => new Date(b.expense.date) - new Date(a.expense.date) || b.expense.createdAt - a.expense.createdAt,
      ),
    });
  });

  return netTransfers.sort((a, b) => b.amount - a.amount || a.from.localeCompare(b.from, "zh-CN"));
}

function getExpenseShares(expense) {
  if (expense.shares && typeof expense.shares === "object") {
    return expense.shares;
  }

  const share = expense.participantIds.length ? expense.amount / expense.participantIds.length : 0;
  return Object.fromEntries(expense.participantIds.map((id) => [id, share]));
}

function formatShareDetails(expense, memberNames) {
  if (expense.shares && typeof expense.shares === "object") {
    const details = Object.entries(expense.shares)
      .map(([id, amount]) => `${escapeHtml(memberNames.get(id) || "未知")} ${formatAmount(Number(amount))}`)
      .join(" · ");
    return details ? `分摊：${details}` : "分摊：无";
  }

  const share = expense.participantIds.length ? expense.amount / expense.participantIds.length : 0;
  return `均分：每人 ${formatAmount(share)}`;
}

function expenseMatchesSearch(expense, memberNames, searchTerm) {
  const participants = expense.participantIds.map((id) => memberNames.get(id) || "").join(" ");
  const shares = expense.shares
    ? Object.entries(expense.shares)
        .map(([id, amount]) => `${memberNames.get(id) || ""} ${amount} ${formatAmount(Number(amount))}`)
        .join(" ")
    : "";
  const haystack = [
    expense.title,
    expense.date,
    expense.amount,
    formatAmount(expense.amount),
    memberNames.get(expense.payerId),
    participants,
    shares,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchTerm);
}

function getMemberShare(expense, memberId) {
  if (expense.shares && typeof expense.shares === "object") {
    return Number(expense.shares[memberId] || 0);
  }

  return expense.participantIds.includes(memberId) && expense.participantIds.length
    ? expense.amount / expense.participantIds.length
    : 0;
}

function calculateSettlements() {
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const balances = [...calculateBalances(getActiveExpenses())]
    .map(([id, amount]) => ({ id, amount: roundMoney(amount) }))
    .filter((item) => Math.abs(item.amount) >= 0.01);

  const debtors = balances.filter((item) => item.amount < 0).map((item) => ({ ...item, amount: Math.abs(item.amount) }));
  const creditors = balances.filter((item) => item.amount > 0);
  const settlements = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = roundMoney(Math.min(debtor.amount, creditor.amount));

    if (amount >= 0.01) {
      settlements.push({
        fromId: debtor.id,
        toId: creditor.id,
        from: memberNames.get(debtor.id) || "未知",
        to: memberNames.get(creditor.id) || "未知",
        amount,
      });
    }

    debtor.amount = roundMoney(debtor.amount - amount);
    creditor.amount = roundMoney(creditor.amount - amount);
    if (debtor.amount < 0.01) debtorIndex += 1;
    if (creditor.amount < 0.01) creditorIndex += 1;
  }

  return settlements;
}

function getRelatedSettlementBills(fromId, toId) {
  return getActiveExpenses()
    .filter(
      (expense) =>
        expense.payerId === fromId ||
        expense.payerId === toId ||
        expense.participantIds.includes(fromId) ||
        expense.participantIds.includes(toId),
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);
}

function removeMember(id) {
  const member = state.members.find((item) => item.id === id);
  if (!member || !confirm(`删除 ${member.name} 并移除相关记录？`)) return;
  if (expandedMemberId === id) expandedMemberId = null;
  state.members = state.members.filter((item) => item.id !== id);
  state.expenses = state.expenses.filter(
    (expense) => expense.payerId !== id && !expense.participantIds.includes(id),
  );
  saveAndRender();
}

function emptyNode(title, text) {
  const node = els.emptyTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("strong").textContent = title;
  node.querySelector("p").textContent = text;
  return node;
}

function formatAmount(amount) {
  return currency.format(roundMoney(amount));
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function balanceClass(amount) {
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "neutral";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
