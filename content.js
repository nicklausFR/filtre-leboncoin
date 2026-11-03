(() => {
  "use strict";
  const api = globalThis.LbcFilter;
  const marker = "data-lbc-poc-hidden";
  const hiddenCards = new Set();
  const cardSelector = [
    '[data-test-id="ad"]', '[data-test-id="adcard"]',
    '[data-qa-id="aditem_container"]', '[data-testid="ad-card"]', "article", "li"
  ].join(",");
  const locationSelector = [
    '[data-test-id*="location"]', '[data-testid*="location"]',
    '[data-qa-id*="location"]', '[itemprop="addressLocality"]'
  ].join(",");
  const titleSelector = '[data-test-id*="title"], [data-testid*="title"], [data-qa-id*="title"], [itemprop="name"], h1, h2, h3, h4, h5, h6';
  const categorySelector = '[data-test-id*="category"], [data-testid*="category"], [data-qa-id*="category"], [itemprop="category"]';
  let settings = api.cleanSettings();
  let observedCategories = [];
  let observedCities = [];
  let scheduled = false;
  let contextMenu = null;
  let filterIndicator = null;
  let filterIndicatorItem = null;
  let filterIndicatorRow = null;
  let notice = null;
  let noticeTimer;
  const dateScripts = new WeakMap();
  function pagePublicationDates() {
    const dates = new Map();
    for (const script of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')) {
      const text = script.textContent;
      let cached = dateScripts.get(script);
      if (!cached || cached.text !== text) {
        let entries = new Map();
        try {
          if (text.length <= 5000000) entries = api.publicationDatesFromJson(JSON.parse(text));
        } catch { /* Une donnée illisible ne donne pas de date exploitable. */ }
        cached = { text, entries };
        dateScripts.set(script, cached);
      }
      for (const [id, timestamp] of cached.entries) dates.set(id, timestamp);
    }
    return dates;
  }
  function tooOld(card, path, dates, now) {
    if (settings.maxAgeDays === null) return false;
    const id = path.split("/")[3].replace(/\.htm$/, "");
    let timestamp = dates.get(id) ?? null;
    if (timestamp === null) {
      const candidates = [...card.querySelectorAll('time, [datetime], [itemprop="datePublished"], [data-test-id*="date"], [data-qa-id*="date"]')];
      for (const element of candidates) {
        timestamp = api.parsePublicationDate(element.getAttribute("datetime") || element.getAttribute("content") || element.textContent, now);
        if (timestamp !== null) break;
      }
    }
    if (timestamp === null) {
      for (const element of card.querySelectorAll("p, span")) {
        if (element.children.length || element.closest('h1, h2, h3, [data-test-id*="title"], [data-qa-id*="title"]')) continue;
        timestamp = api.parsePublicationDate(element.textContent, now);
        if (timestamp !== null) break;
      }
    }
    return timestamp !== null && now - timestamp > settings.maxAgeDays * api.dayMs;
  }
  function adPath(link) {
    try {
      const url = new URL(link.getAttribute("href"), location.href);
      if (!/^(www\.)?leboncoin\.fr$/.test(url.hostname)) return null;
      return /^\/ad\/[^/]+\/[^/]+\/?$/.test(url.pathname)
        ? url.pathname.replace(/\/$/, "") : null;
    } catch { return null; }
  }
  function isResultsPage() {
    return /^\/(recherche|cl|c|ck|l|annonces_similaires)(\/|$)/.test(location.pathname);
  }
  function pageCategoryOptions() {
    const options = new Map(observedCategories.map(slug => [slug, { slug, label: api.categoryLabel(slug) }]));
    // Les rubriques parentes ne correspondent pas à une catégorie d'annonce unique.
    const groups = new Set([
      "immobilier", "vehicules", "materiel pro", "materiel professionnel", "emploi",
      "mode", "maison & jardin", "famille", "electronique", "loisirs", "services",
      "locations de vacances"
    ]);
    for (const link of document.querySelectorAll('a[href*="/c/"], a[href*="/cl/"]')) {
      try {
        const url = new URL(link.getAttribute("href"), location.href);
        const match = url.pathname.match(/^\/(?:c|cl)\/([a-z0-9_\-]+)\/?$/);
        const label = link.textContent.replace(/\s+/g, " ").trim();
        if (!/^(www\.)?leboncoin\.fr$/.test(url.hostname) || !match || !label || label.length > 100) continue;
        if (groups.has(api.normalizeName(label))) continue;
        options.set(match[1], { slug: match[1], label });
      } catch { /* Un lien non exploitable ne fournit pas de suggestion. */ }
    }
    return [...options.values()];
  }
  function cardCities(card) {
    const locations = [...card.querySelectorAll(locationSelector)]
      .map(element => api.cityFromLocation(element.textContent)).filter(Boolean);
    if (locations.length) return locations;
    // Sans champ de localisation identifié, exiger un code postal et éviter le titre.
    return [...card.querySelectorAll("p, span")].filter(element => (
      !element.children.length && !element.closest('h1, h2, h3, [data-test-id*="title"], [data-qa-id*="title"]')
    )).map(element => api.cityFromLocation(element.textContent, true)).filter(Boolean);
  }
  function cardTitle(card) {
    const cleanTitle = value => {
      const title = (value || "").replace(/^voir\s+l[’']annonce\s*:\s*/i, "").replace(/\s+/g, " ").trim();
      return /^voir\s+(?:l[’'])?annonce$/i.test(title) ? "" : title;
    };
    const links = card.matches('a[href*="/ad/"]') ? [card] : [...card.querySelectorAll('a[href*="/ad/"]')];
    // Certaines cartes ont un h3 vide ; le titre reste présent sur le lien superposé.
    for (const link of links) {
      for (const element of [link, ...link.querySelectorAll("[title]")]) {
        const label = element.getAttribute("title");
        if (!/^voir\s+l[’']annonce\s*:/i.test(label || "")) continue;
        const title = cleanTitle(label);
        if (title) return title;
      }
    }
    for (const selector of [
      '[data-test-id*="title"], [data-testid*="title"], [data-qa-id*="title"]',
      "h1, h2, h3, h4, h5, h6", '[itemprop="name"]'
    ]) {
      for (const element of card.querySelectorAll(selector)) {
        const title = cleanTitle(element.textContent);
        if (title) return title;
      }
    }
    for (const link of links) {
      const title = cleanTitle(link.getAttribute("title")) || cleanTitle(link.getAttribute("aria-label"));
      if (title) return title;
    }
    return "";
  }
  function layoutItem(card) {
    const item = card.closest('li, [role="listitem"]');
    if (!item || item === card || item.closest("nav, header, footer")) return card;
    const paths = new Set([...item.querySelectorAll('a[href*="/ad/"]')].map(adPath).filter(Boolean));
    // La ligne complète porte l'espace réservé ; ne pas la masquer si elle
    // regroupe aussi une autre annonce (carrousel ou groupe de résultats).
    return paths.size === 1 ? item : card;
  }
  function notify(text) {
    clearTimeout(noticeTimer);
    notice?.remove();
    notice = document.createElement("div");
    notice.id = "lbc-filter-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.textContent = text;
    document.documentElement.append(notice);
    noticeTimer = setTimeout(() => { notice?.remove(); notice = null; }, 6000);
  }
  function openFilters(title) {
    const message = { type: "lbc:open-filters" };
    if (title) message.title = title;
    chrome.runtime.sendMessage(message).then(result => {
      if (!result?.ok) notify("Ouverture des filtres impossible. Rechargez la page Leboncoin.");
    }).catch(() => notify("Ouverture des filtres impossible. Rechargez la page Leboncoin."));
  }
  function updateFilterIndicator(hiddenCount = 0) {
    if (!isResultsPage()) {
      filterIndicator?.remove();
      filterIndicatorItem?.remove();
      filterIndicatorRow?.removeAttribute("data-lbc-filter-row");
      filterIndicator = null;
      filterIndicatorItem = null;
      filterIndicatorRow = null;
      return;
    }
    if (!filterIndicator) {
      filterIndicator = document.createElement("button");
      filterIndicator.id = "lbc-filter-indicator";
      filterIndicator.type = "button";
      filterIndicator.title = "Ouvrir les filtres Leboncoin";
      filterIndicator.addEventListener("click", () => openFilters());
    }
    const activeFilters = document.querySelector('[aria-label="Filtres actifs appliqués à la recherche"]');
    if (activeFilters) {
      if (filterIndicatorRow !== activeFilters) {
        filterIndicatorRow?.removeAttribute("data-lbc-filter-row");
        filterIndicatorRow = activeFilters;
        filterIndicatorRow.setAttribute("data-lbc-filter-row", "yes");
      }
      if (!filterIndicatorItem) {
        filterIndicatorItem = document.createElement("li");
        filterIndicatorItem.id = "lbc-filter-indicator-item";
      }
      if (filterIndicator.parentElement !== filterIndicatorItem) filterIndicatorItem.append(filterIndicator);
      if (activeFilters.lastElementChild !== filterIndicatorItem) activeFilters.append(filterIndicatorItem);
      filterIndicator.removeAttribute("data-lbc-floating");
    } else {
      if (filterIndicator.parentElement !== document.documentElement) document.documentElement.append(filterIndicator);
      filterIndicatorItem?.remove();
      filterIndicatorItem = null;
      filterIndicatorRow?.removeAttribute("data-lbc-filter-row");
      filterIndicatorRow = null;
      filterIndicator.setAttribute("data-lbc-floating", "yes");
    }
    filterIndicator.setAttribute("data-lbc-disabled", String(!settings.enabled));
    const text = settings.enabled
      ? `Filtres extension · ${hiddenCount} annonce${hiddenCount === 1 ? "" : "s"} masquée${hiddenCount === 1 ? "" : "s"}`
      : "Filtres extension · désactivés";
    // Ne pas relancer l'observateur du DOM lorsque le compteur est inchangé.
    if (filterIndicator.textContent !== text) filterIndicator.textContent = text;
    filterIndicator.setAttribute("aria-label", `${text}. Ouvrir les filtres Leboncoin`);
  }
  function contextTarget(target) {
    if (!isResultsPage() || !target?.closest || target.closest("nav, header, footer")) return null;
    const card = target.closest(cardSelector) || target.closest('a[href*="/ad/"]');
    if (!card) return null;
    const links = card.matches('a[href*="/ad/"]') ? [card] : card.querySelectorAll('a[href*="/ad/"]');
    const paths = new Set([...links].map(adPath).filter(Boolean));
    if (paths.size !== 1) return null;
    const path = [...paths][0];
    const base = { card, path };
    const title = cardTitle(card);
    let titleElement = target.closest(titleSelector);
    if (!titleElement || !card.contains(titleElement)) {
      titleElement = null;
      for (let element = target; element && element !== card; element = element.parentElement) {
        if (title && api.normalizeName(element.textContent) === api.normalizeName(title)) {
          titleElement = element;
          break;
        }
      }
    }
    if (titleElement && title) {
      const value = titleElement.textContent.replace(/\s+/g, " ").trim() || title;
      const selection = window.getSelection();
      const text = selection?.toString().replace(/\s+/g, " ").trim();
      const isTitleNode = node => {
        if (!card.contains(node)) return false;
        if (titleElement.contains(node)) return true;
        // Le lien transparent de Leboncoin duplique le titre visible.
        for (let element = node?.parentElement; element && element !== card; element = element.parentElement) {
          if (api.normalizeName(element.textContent) === api.normalizeName(value)) return true;
        }
        return false;
      };
      const selectedTitle = text && !selection.isCollapsed &&
        isTitleNode(selection.anchorNode) && isTitleNode(selection.focusNode) &&
        api.normalizeName(value).includes(api.normalizeName(text));
      return { ...base, kind: "title", value: selectedTitle ? text : value, selected: Boolean(selectedTitle) };
    }
    const category = path.split("/")[2];
    for (let element = target; element && element !== card; element = element.parentElement) {
      // Ne pas interpréter le texte de toute la carte comme celui du champ visé.
      if (element.matches('a[href*="/ad/"]') || element.querySelector(titleSelector) || element.querySelector("p")) break;
      const text = element.textContent.replace(/\s+/g, " ").trim();
      if (element.matches(locationSelector)) {
        const candidates = [element, ...element.querySelectorAll("p, span")];
        for (const candidate of candidates) {
          const city = api.cityFromLocation(candidate.getAttribute("aria-label") || candidate.textContent);
          if (city) return { ...base, kind: "city", value: city };
        }
      }
      const labelledCategory = text.match(/^cat[eé]gorie\s*:\s*([^.!?\r\n]+)\.?$/i)?.[1]?.trim();
      let categoryLink = false;
      if (element.matches("a[href]")) {
        try {
          const url = new URL(element.getAttribute("href"), location.href);
          categoryLink = /^(www\.)?leboncoin\.fr$/.test(url.hostname) &&
            url.pathname.match(/^\/(?:c|cl)\/([a-z0-9_\-]+)\/?$/)?.[1] === category;
        } catch { /* Le libellé reste utilisable sans lien. */ }
      }
      if (/^[a-z0-9_\-]+$/.test(category) && (element.matches(categorySelector) || categoryLink || labelledCategory ||
          api.normalizeName(text) === api.normalizeName(api.categoryLabel(category)))) {
        const label = labelledCategory || api.categoryLabel(category);
        api.registerCategories([{ slug: category, label }]);
        return { ...base, kind: "category", value: category, label };
      }
      // Sans attribut dédié, seul un libellé contenant un code postal désigne une ville.
      const city = api.cityFromLocation(text, true);
      if (city) return { ...base, kind: "city", value: city };
    }
    return null;
  }
  function visibleTextAtPoint(card, x, y) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!node.textContent.trim() || element.closest("script, style, [hidden], .sr-only")) continue;
      let visible = true;
      for (let parent = element; parent && parent !== card; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 ||
            (rect.width <= 2 && rect.height <= 2)) { visible = false; break; }
      }
      if (!visible) continue;
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return element;
    }
    return null;
  }
  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }
  function showActionsMenu(event, actions) {
    const menu = document.createElement("div");
    menu.id = "lbc-filter-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Filtres Leboncoin");
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = action.label;
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        closeContextMenu();
        try { await action.run(); }
        catch { notify("Enregistrement impossible. Réessayez depuis le menu."); }
      });
      menu.append(button);
    }
    document.documentElement.append(menu);
    contextMenu = menu;
    const rect = menu.getBoundingClientRect();
    const anchor = event.target.getBoundingClientRect();
    const x = event.clientX || anchor.left;
    const y = event.clientY || anchor.bottom;
    menu.style.setProperty("left", `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`, "important");
    menu.style.setProperty("top", `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`, "important");
    menu.querySelector("button").focus({ preventScroll: true });
  }
  function showContextMenu(event, target) {
    showActionsMenu(event, [{
      label: `Exclure « ${target.label || target.value} »`,
      run: async () => {
        const links = target.card.matches('a[href*="/ad/"]') ? [target.card] : target.card.querySelectorAll('a[href*="/ad/"]');
        const paths = new Set([...links].map(adPath).filter(Boolean));
        if (!isResultsPage() || !target.card.isConnected || paths.size !== 1 || !paths.has(target.path)) {
          notify("Cette annonce a changé. Faites à nouveau un clic droit dessus.");
          return;
        }
        const key = { category: "categories", city: "cities", title: "titleContains" }[target.kind];
        await saveExclusion(key, [target.value]);
      }
    }]);
  }
  async function changeFilterSettings(action, enabled) {
    const stored = await chrome.storage.local.get(api.storageKey);
    const updated = api.cleanSettings(stored[api.storageKey]);
    if (action === "reset") {
      updated.categories = [];
      updated.cities = [];
      updated.titleContains = [];
      updated.maxAgeDays = null;
    } else updated.enabled = enabled;
    await chrome.storage.local.set({ [api.storageKey]: updated });
    settings = updated;
    filter();
  }
  function showFilterMenu(event) {
    const enabled = !settings.enabled;
    showActionsMenu(event, [
      { label: enabled ? "Activer" : "Désactiver", run: () => changeFilterSettings("toggle", enabled) },
      { label: "Réinitialiser", run: () => changeFilterSettings("reset") }
    ]);
  }
  document.addEventListener("contextmenu", event => {
    closeContextMenu();
    if (filterIndicator?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      showFilterMenu(event);
      return;
    }
    let element = event.target;
    const link = element?.closest?.('a[href*="/ad/"]');
    if (link && (event.clientX || event.clientY) && (element === link || Number(getComputedStyle(element).opacity) === 0)) {
      const card = link.closest(cardSelector) || link;
      element = visibleTextAtPoint(card, event.clientX, event.clientY);
    }
    const target = contextTarget(element);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.kind === "title" && !target.selected) {
      openFilters(target.value);
    } else showContextMenu(event, target);
  }, true);
  document.addEventListener("pointerdown", event => {
    if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
  }, true);
  document.addEventListener("keydown", event => {
    if (contextMenu && event.key === "Escape") { closeContextMenu(); event.preventDefault(); }
  }, true);
  document.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("resize", closeContextMenu);
  window.addEventListener("blur", closeContextMenu);
  window.addEventListener("popstate", closeContextMenu);
  async function saveExclusion(key, values) {
    const stored = await chrome.storage.local.get(api.storageKey);
    const updated = api.cleanSettings(stored[api.storageKey]);
    const existing = new Set(updated[key].map(api.normalizeName));
    for (const value of values) {
      const normalized = api.normalizeName(value);
      if (!normalized || existing.has(normalized)) continue;
      updated[key].push(value);
      existing.add(normalized);
    }
    await chrome.storage.local.set({ [api.storageKey]: updated });
    settings = updated;
    filter();
    notify(updated.enabled ? "Exclusion enregistrée et appliquée." : "Exclusion enregistrée. Activez le filtre pour l’appliquer.");
    return { ok: true };
  }
  function filter() {
    scheduled = false;
    for (const card of hiddenCards) card.removeAttribute(marker);
    hiddenCards.clear();
    observedCategories = [];
    observedCities = [];
    if (!isResultsPage()) { updateFilterIndicator(); return; }
    const categories = new Set();
    const cards = new Map();
    for (const link of document.querySelectorAll('a[href*="/ad/"]')) {
      const path = adPath(link);
      if (!path || link.closest("nav, header, footer")) continue;
      const card = link.closest(cardSelector) || link;
      const paths = new Set([...card.querySelectorAll('a[href*="/ad/"]')].map(adPath).filter(Boolean));
      // Un conteneur regroupant plusieurs annonces n'est pas une carte individuelle.
      if (paths.size > 1) continue;
      const category = path.split("/")[2];
      categories.add(category);
      cards.set(card, { category, path });
    }
    observedCategories = [...categories].sort();
    const cities = new Map();
    for (const [card, entry] of cards) {
      entry.cities = cardCities(card);
      for (const city of entry.cities) cities.set(api.normalizeName(city), city);
    }
    observedCities = [...cities.values()].sort((a, b) => a.localeCompare(b, "fr"));
    if (!settings.enabled) { updateFilterIndicator(); return; }
    const now = Date.now();
    const dates = settings.maxAgeDays === null ? new Map() : pagePublicationDates();
    const titleTerms = settings.titleContains.map(api.normalizeName).filter(Boolean);
    let hiddenCount = 0;
    for (const [card, { category, path, cities: cardLocations }] of cards) {
      const blockedCategory = settings.categories.includes(category);
      const blockedCity = cardLocations.some(location => settings.cities.some(city => api.normalizeName(location) === api.normalizeName(city)));
      const title = titleTerms.length ? api.normalizeName(cardTitle(card)) : "";
      const blockedTitle = titleTerms.some(term => title.includes(term));
      if (blockedCategory || blockedCity || blockedTitle || tooOld(card, path, dates, now)) {
        hiddenCount++;
        card.setAttribute(marker, "yes");
        hiddenCards.add(card);
        const item = layoutItem(card);
        item.setAttribute(marker, "yes");
        hiddenCards.add(item);
      }
    }
    updateFilterIndicator(hiddenCount);
  }
  function scheduleFilter() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(filter, 50);
  }
  new MutationObserver(scheduleFilter).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["href", "datetime", "content"]
  });
  window.addEventListener("popstate", scheduleFilter);
  window.addEventListener("focus", scheduleFilter);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[api.storageKey]) {
      settings = api.cleanSettings(changes[api.storageKey].newValue);
      filter();
    }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "lbc:get-state") return;
    // Relire le DOM actuel, même si le filtre différé n'a pas encore tourné.
    filter();
    respond({ categories: observedCategories, cities: observedCities, categoryOptions: pageCategoryOptions(), isResultsPage: isResultsPage(), isLeboncoinPage: true });
  });
  chrome.storage.local.get(api.storageKey).then(stored => {
    settings = api.cleanSettings(stored[api.storageKey]);
    filter();
  }).catch(() => filter());
})();
