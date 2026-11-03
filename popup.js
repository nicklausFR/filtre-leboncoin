(() => {
  "use strict";
  const api = globalThis.LbcFilter;
  const form = document.getElementById("filters");
  const enabled = document.getElementById("enabled");
  const cities = document.getElementById("cities");
  const maxAgeDays = document.getElementById("max-age-days");
  const titleContains = document.getElementById("title-contains");
  const categories = document.getElementById("categories");
  const status = document.getElementById("status");
  const apply = document.getElementById("apply");
  const resetButton = document.getElementById("reset-filters");
  const groups = [
    { key: "categories", field: categories, panel: document.getElementById("page-categories"), list: document.getElementById("page-category-list"), status: document.getElementById("page-category-status"), normalize: api.categorySlug, label: api.categoryLabel, empty: "Aucune catégorie." },
    { key: "cities", field: cities, panel: document.getElementById("page-cities"), list: document.getElementById("page-city-list"), status: document.getElementById("page-city-status"), normalize: api.normalizeName, label: value => value, empty: "Aucune ville." }
  ];
  let ready = false;
  let connected = false;
  let suggestions = [];
  let requestId = 0;
  let activeTabId = null;
  const entries = field => field.value.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
  const titleEntries = () => titleContains.value.split(/[\r\n]+/).map(value => value.trim()).filter(Boolean);
  api.attachCategoryAutocomplete(categories, document.getElementById("category-suggestions"), () => suggestions);

  function syncChecks() {
    for (const group of groups) {
      const selected = new Set(entries(group.field).map(group.normalize));
      for (const input of group.list.querySelectorAll("input")) {
        input.checked = selected.has(group.normalize(input.value));
      }
    }
  }
  function renderChoices(group, values) {
    group.list.replaceChildren();
    const unique = new Map();
    for (const value of values) {
      if (typeof value === "string" && value.trim() && !unique.has(group.normalize(value))) unique.set(group.normalize(value), value);
    }
    const options = [...unique.values()].sort((a, b) => group.label(a).localeCompare(group.label(b), "fr"));
    group.status.textContent = !connected ? "Page indisponible." : options.length ? "" : group.empty;
    if (!connected) return;
    for (const value of options) {
      const item = document.createElement("li");
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.addEventListener("change", () => {
        const key = group.normalize(value);
        const values = entries(group.field).filter(entry => group.normalize(entry) !== key);
        if (input.checked) values.push(group.label(value));
        group.field.value = values.join("\n");
        group.field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      label.append(input, document.createTextNode(group.label(value)));
      item.append(label);
      group.list.append(item);
    }
  }
  async function readPageState() {
    const currentRequest = ++requestId;
    for (const group of groups) group.status.textContent = "Chargement…";
    let state = {};
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = tab?.id ?? null;
      state = await chrome.tabs.sendMessage(tab.id, { type: "lbc:get-state" }) || {};
    } catch { /* Les réglages restent utilisables sans onglet accessible. */ }
    if (currentRequest !== requestId) return;
    connected = Boolean(state.isResultsPage);
    api.registerCategories(state.categoryOptions || []);
    const present = (state.categories || []).filter(slug => typeof slug === "string" && /^[a-z0-9_\-]+$/.test(slug));
    api.registerCategories(present.map(slug => ({ slug, label: api.categoryLabel(slug) })));
    renderChoices(groups[0], present);
    renderChoices(groups[1], state.cities || []);
    suggestions = api.categoryOptions();
    syncChecks();
  }
  for (const group of groups) {
    const open = document.getElementById("open-page-" + group.key);
    const close = document.getElementById("close-page-" + group.key);
    close.addEventListener("click", () => group.panel.close());
    group.panel.addEventListener("close", () => open.focus());
    open.addEventListener("click", async () => {
      if (!ready) return;
      open.disabled = true;
      try {
        await readPageState();
        open.disabled = false;
        open.focus();
        group.panel.showModal();
      } finally { open.disabled = false; }
    });
  }
  form.addEventListener("input", event => {
    status.textContent = "";
    if (event.target === categories || event.target === cities) syncChecks();
  });
  function readForm() {
    return api.cleanSettings({
      enabled: enabled.checked,
      categories: entries(categories), cities: entries(cities),
      titleContains: titleEntries(),
      maxAgeDays: maxAgeDays.value === "" ? null : Number(maxAgeDays.value)
    });
  }
  async function save(event, reloadPage = event?.type === "submit") {
    event?.preventDefault();
    if (!ready || !form.reportValidity()) return;
    apply.disabled = true;
    resetButton.disabled = true;
    try {
      await chrome.storage.local.set({ [api.storageKey]: readForm() });
      status.textContent = "Enregistré.";
      if (reloadPage) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const url = tab?.pendingUrl || tab?.url;
          const isLeboncoin = url ? /^https:\/\/(?:www\.)?leboncoin\.fr(?:\/|$)/i.test(url)
            : tab?.id !== undefined && (await chrome.tabs.sendMessage(tab.id, { type: "lbc:get-state" }))?.isLeboncoinPage;
          if (tab?.id !== undefined && isLeboncoin) {
            await chrome.tabs.reload(tab.id);
            status.textContent = "Enregistré. Page actualisée.";
          }
        } catch { status.textContent = "Enregistré. Actualisation impossible."; }
      }
    } catch { status.textContent = "Enregistrement impossible."; }
    finally { apply.disabled = false; resetButton.disabled = false; }
  }
  resetButton.addEventListener("click", async () => {
    if (!ready || apply.disabled) return;
    categories.value = "";
    cities.value = "";
    titleContains.value = "";
    maxAgeDays.value = "";
    syncChecks();
    await save(undefined, true);
  });
  form.addEventListener("submit", save);
  enabled.addEventListener("change", save);
  async function init() {
    apply.disabled = true;
    resetButton.disabled = true;
    enabled.disabled = true;
    try {
      const stored = await chrome.storage.local.get(api.storageKey);
      const settings = api.cleanSettings(stored[api.storageKey]);
      await readPageState();
      enabled.checked = settings.enabled;
      cities.value = settings.cities.join("\n");
      maxAgeDays.value = settings.maxAgeDays ?? "";
      titleContains.value = settings.titleContains.join("\n");
      categories.value = settings.categories.map(api.categoryLabel).join("\n");
      for (const slug of settings.categories) {
        if (!suggestions.some(option => option.slug === slug)) suggestions.push({ slug, label: api.categoryLabel(slug) });
      }
      let draft;
      if (activeTabId !== null) {
        const key = api.popupDraftPrefix + activeTabId;
        try {
          const pending = await chrome.storage.session.get(key);
          draft = pending[key];
          await chrome.storage.session.remove(key);
        } catch { /* Le formulaire reste utilisable sans brouillon. */ }
      }
      if (typeof draft?.title === "string" && draft.title.trim()) {
        const values = titleEntries();
        const normalized = api.normalizeName(draft.title);
        let index = values.findIndex(value => api.normalizeName(value) === normalized);
        if (index < 0) { index = values.length; values.push(draft.title.trim()); }
        titleContains.value = values.join("\n");
        titleContains.focus();
        const start = values.slice(0, index).reduce((length, value) => length + value.length + 1, 0);
        titleContains.setSelectionRange(start, start + values[index].length);
      }
      syncChecks();
      ready = true;
      apply.disabled = false;
      resetButton.disabled = false;
      enabled.disabled = false;
    } catch { status.textContent = "Chargement impossible."; }
  }
  init();
})();
