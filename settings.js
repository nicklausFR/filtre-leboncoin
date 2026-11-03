(() => {
  "use strict";
  const storageKey = "lbcFilterSettings";
  const popupDraftPrefix = "lbcFilterDraft:";
  const defaults = { enabled: true, categoryMode: "exclude", categories: ["voitures"], cities: [], maxAgeDays: null, titleContains: [] };
  const labels = {
    voitures: "Voitures", motos: "Motos", equipement_auto: "Équipement auto",
    equipement_moto: "Équipement moto", jeux_jouets: "Jeux et jouets", jardin_plantes: "Jardin & Plantes"
  };
  const categoryAliases = new Map();
  function normalizeName(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr").replace(/[’']/g, " ").replace(/[-\s]+/g, " ").trim();
  }
  function cleanSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const strings = (values, fallback) => [...new Set(
      (Array.isArray(values) ? values : fallback)
        .filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean)
    )];
    return {
      enabled: source.enabled !== false,
      categoryMode: "exclude",
      categories: [...new Set(strings(source.categories, defaults.categories).map(categorySlug))]
        .filter(item => /^[a-z0-9_\-]+$/.test(item)),
      cities: strings(source.cities, []),
      titleContains: strings(source.titleContains, []),
      maxAgeDays: Number.isSafeInteger(Number(source.maxAgeDays)) && Number(source.maxAgeDays) > 0
        ? Number(source.maxAgeDays) : null
    };
  }
  function categorySlug(value) {
    const raw = value.trim().toLocaleLowerCase("fr");
    if (/^[a-z0-9_\-]+$/.test(raw)) return raw;
    const name = normalizeName(value);
    if (categoryAliases.has(name)) return categoryAliases.get(name);
    const known = Object.keys(labels).find(slug => normalizeName(labels[slug]) === name);
    return known || name.replace(/ /g, "_");
  }
  function categoryLabel(slug) {
    return labels[slug] || slug.replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
  }
  function registerCategories(options) {
    for (const option of options || []) {
      if (!option || !/^[a-z0-9_\-]+$/.test(option.slug) || typeof option.label !== "string") continue;
      const label = option.label.trim();
      if (!label || label.length > 100) continue;
      categoryAliases.set(normalizeName(categoryLabel(option.slug)), option.slug);
      categoryAliases.set(normalizeName(label), option.slug);
      labels[option.slug] = label;
    }
  }
  function categoryOptions() {
    return Object.entries(labels).map(([slug, label]) => ({ slug, label }));
  }
  function matchesCity(text, city, requirePostcode = false) {
    const location = cityFromLocation(text, requirePostcode);
    return location !== null && normalizeName(location) === normalizeName(city);
  }
  function cityFromLocation(text, requirePostcode = false) {
    let location = String(text).trim().split(/[·•|\n]/)[0].replace(/\s+/g, " ").trim()
      .replace(/^(?:localisation\s*:|situ[eé]e?\s+[aà])\s*/i, "").replace(/\.$/, "").trim();
    const trailingCode = location.match(/^(.*?)\s+\(?\d{5}\)?(?:\s+[\p{L}][\p{L}\p{M}\d\s.'’()\-]*)?$/u);
    const leadingCode = location.match(/^\(?\d{5}\)?\s+(.+)$/);
    if (trailingCode) location = trailingCode[1];
    else if (leadingCode) location = leadingCode[1];
    else if (requirePostcode) return null;
    return /^[\p{L}][\p{L}\p{M}\s.'’()\-]*$/u.test(location) ? location : null;
  }
  globalThis.LbcFilter = {
    storageKey, popupDraftPrefix, defaults, cleanSettings, categoryLabel, categorySlug, matchesCity, cityFromLocation,
    normalizeName, registerCategories, categoryOptions
  };
})();
