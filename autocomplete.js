(() => {
  "use strict";
  const api = globalThis.LbcFilter;

  function attachCategoryAutocomplete(field, box, getOptions) {
    let matches = [];
    let active = -1;
    const normalize = value => api.normalizeName(value).replace(/_/g, " ");

    function token() {
      const value = field.value;
      const cursor = field.selectionStart;
      let start = cursor;
      let end = cursor;
      while (start > 0 && !/[\n,;]/.test(value[start - 1])) start--;
      while (end < value.length && !/[\n,;]/.test(value[end])) end++;
      return { start, end, query: value.slice(start, cursor).trim() };
    }
    function close() {
      matches = [];
      active = -1;
      box.replaceChildren();
      box.hidden = true;
      field.setAttribute("aria-expanded", "false");
      field.removeAttribute("aria-activedescendant");
    }
    function choose(index) {
      if (!matches[index]) return;
      const { start, end } = token();
      const suffix = end === field.value.length ? "\n" : "";
      field.setRangeText(matches[index].label + suffix, start, end, "end");
      field.focus();
      field.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    }
    function highlight(index) {
      active = index;
      [...box.children].forEach((button, position) => button.setAttribute("aria-selected", String(position === active)));
      field.setAttribute("aria-activedescendant", box.children[active].id);
      box.children[active].scrollIntoView({ block: "nearest" });
    }
    function render() {
      if (document.activeElement !== field) { close(); return; }
      const current = token();
      const query = normalize(current.query);
      if (!query) { close(); return; }
      const rest = field.value.slice(0, current.start) + ";" + field.value.slice(current.end);
      const selected = new Set(rest.split(/[\n,;]+/).filter(value => value.trim()).map(api.categorySlug));
      matches = getOptions().filter(option => !selected.has(option.slug) && (
        normalize(option.label).includes(query) || normalize(option.slug).includes(query)
      )).sort((a, b) => {
        const prefixA = normalize(a.label).startsWith(query);
        const prefixB = normalize(b.label).startsWith(query);
        return Number(prefixB) - Number(prefixA) || a.label.localeCompare(b.label, "fr");
      }).slice(0, 8);
      active = -1;
      box.replaceChildren();
      field.removeAttribute("aria-activedescendant");
      box.hidden = !matches.length;
      field.setAttribute("aria-expanded", String(matches.length > 0));
      matches.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.id = "category-option-" + index;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1;
        button.textContent = option.label;
        button.addEventListener("mousedown", event => event.preventDefault());
        button.addEventListener("click", () => choose(index));
        box.append(button);
      });
    }
    field.addEventListener("input", render);
    field.addEventListener("focus", render);
    field.addEventListener("click", render);
    field.addEventListener("blur", close);
    field.addEventListener("keydown", event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { close(); return; }
      if (!matches.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        highlight(active < 0 ? (direction === 1 ? 0 : matches.length - 1) : (active + direction + matches.length) % matches.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        choose(active < 0 ? 0 : active);
      } else if (event.key === "Tab") { close(); }
    });
  }
  api.attachCategoryAutocomplete = attachCategoryAutocomplete;
})();
