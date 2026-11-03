(() => {
  "use strict";
  const api = globalThis.LbcFilter;
  const dayMs = 86400000;
  const months = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

  function localDate(year, month, day, hour = 0, minute = 0) {
    const date = new Date(year, month, day, hour, minute);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day || hour > 23 || minute > 59) return null;
    return date.getTime();
  }
  function parsePublicationDate(value, now = Date.now()) {
    if (typeof value === "number") {
      const stamp = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
      return Number.isFinite(stamp) && stamp <= now ? stamp : null;
    }
    if (typeof value !== "string") return null;
    let text = api.normalizeName(value).replace(/[.\s]+$/, "")
      .replace(/^(?:date de depot|date de publication|publiee? le|mise en ligne le)\s*:?\s*/, "");
    // Le format ISO est traité avant la normalisation, qui remplace les tirets.
    const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
    if (iso) {
      const validDay = localDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (validDay === null) return null;
      const stamp = value.trim().length === 10 ? validDay : Date.parse(value.trim().replace(" ", "T"));
      return Number.isFinite(stamp) && stamp <= now ? stamp : null;
    }
    const relative = text.match(/^il y a (\d+)\s*(minute|min|heure|h|jour|j|semaine)s?$/);
    if (relative) {
      const units = { minute: 60000, min: 60000, heure: 3600000, h: 3600000, jour: dayMs, j: dayMs, semaine: 7 * dayMs };
      const stamp = now - Number(relative[1]) * units[relative[2]];
      return Number.isFinite(stamp) && stamp >= 0 ? stamp : null;
    }
    const recent = text.match(/^(aujourd hui|hier)(?:\s+a\s+(\d{1,2})[:h](\d{2}))?$/);
    if (recent) {
      if (!recent[2]) return now - (recent[1] === "hier" ? dayMs : 0);
      const date = new Date(now);
      date.setDate(date.getDate() - (recent[1] === "hier" ? 1 : 0));
      const stamp = localDate(date.getFullYear(), date.getMonth(), date.getDate(), Number(recent[2]), Number(recent[3]));
      return stamp !== null && stamp <= now ? stamp : null;
    }
    const numeric = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+a\s+(\d{1,2}):(\d{2}))?$/);
    if (numeric) {
      const stamp = localDate(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), Number(numeric[4] || 0), Number(numeric[5] || 0));
      return stamp !== null && stamp <= now ? stamp : null;
    }
    const french = text.match(/^(\d{1,2})(?:er)?\s+([a-z]+)(?:\s+(\d{4}))?(?:\s+a\s+(\d{1,2})[:h](\d{2}))?$/);
    if (french && months.includes(french[2])) {
      const year = french[3] ? Number(french[3]) : new Date(now).getFullYear();
      let stamp = localDate(year, months.indexOf(french[2]), Number(french[1]), Number(french[4] || 0), Number(french[5] || 0));
      if (!french[3] && stamp !== null && stamp > now) {
        stamp = localDate(year - 1, months.indexOf(french[2]), Number(french[1]), Number(french[4] || 0), Number(french[5] || 0));
      }
      return stamp !== null && stamp <= now ? stamp : null;
    }
    return null;
  }

  function publicationDatesFromJson(data) {
    const dates = new Map();
    const pending = [data];
    let visited = 0;
    while (pending.length && visited++ < 100000) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      const id = value.list_id ?? value.listId;
      if (id !== undefined && /^\d+$/.test(String(id))) {
        const date = value.first_publication_date ?? value.publication_date ?? value.datePublished ?? value.index_date;
        const timestamp = parsePublicationDate(date);
        if (timestamp !== null) dates.set(String(id), timestamp);
      }
      for (const child of Object.values(value)) if (child && typeof child === "object") pending.push(child);
    }
    return dates;
  }
  Object.assign(api, { dayMs, parsePublicationDate, publicationDatesFromJson });
})();
