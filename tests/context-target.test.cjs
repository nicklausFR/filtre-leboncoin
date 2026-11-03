const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// DOM réduit à la structure réellement observée sur la carte « Roues complètes ».
class Element {
  constructor(tag, attrs = {}, ...children) {
    this.tagName = tag;
    this.attrs = { ...attrs };
    this.childNodes = children.map(child => typeof child === "string" ? { textContent: child } : child);
    for (const child of this.childNodes) child.parentElement = this;
    this.handlers = {};
    this.style = { setProperty() {} };
    this.rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
  }
  get children() { return this.childNodes.filter(child => child instanceof Element); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(""); }
  set textContent(text) { this.textWrites = (this.textWrites || 0) + 1; this.childNodes = [{ textContent: text, parentElement: this }]; }
  get isConnected() { return true; }
  get id() { return this.attrs.id; }
  set id(value) { this.attrs.id = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  matches(selectors) {
    return selectors.split(",").some(selector => {
      const match = selector.trim().match(/^(\w+)?(?:\[([\w-]+)(?:(\*=|=)"([^"]*)")?\])?$/);
      if (!match) return false;
      const [, tag, attr, op, value] = match;
      return (!tag || tag === this.tagName) && (!attr || (attr in this.attrs &&
        (!op || (op === "=" ? this.attrs[attr] === value : this.attrs[attr].includes(value)))));
    });
  }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element;
    return null;
  }
  contains(node) {
    for (; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  append(child) { child.parentElement = this; this.childNodes.push(child); }
  remove() {
    if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this);
    this.parentElement = null;
  }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  getBoundingClientRect() { return this.rect; }
  focus() {}
}

function fixture() {
  const title = new Element("p", {}, "Roues complètes");
  const category = new Element("p", { "aria-hidden": "true" }, "Équipement auto");
  const categoryDescription = new Element("p", { class: "sr-only" }, "Catégorie : Équipement auto.");
  const city = new Element("p", { "aria-hidden": "true" }, "Die 26150");
  const cityDescription = new Element("p", { class: "sr-only" }, "Située à Die 26150.");
  const metadata = new Element("div", {}, category, categoryDescription, city, cityDescription);
  const overlay = new Element("span", { title: "Voir l’annonce: Roues complètes", opacity: "0" });
  const heading = new Element("h3");
  const card = new Element("div", { "data-qa-id": "aditem_container" }, heading,
    new Element("a", { href: "/ad/equipement_auto/3286880141", "aria-label": "Voir l’annonce" }, overlay),
    new Element("div", {}, title, new Element("span", {}, "200 €"), metadata));
  const root = new Element("main", {}, new Element("li", {}, card));
  const events = {};
  const messages = [];
  let selection = null;
  let storedSettings = null;
  const document = {
    documentElement: root,
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector),
    createElement: tag => new Element(tag),
    addEventListener: (type, handler) => { events[type] = handler; },
    createTreeWalker: parent => {
      const collect = element => element.childNodes.flatMap(child => child instanceof Element ? collect(child) : [child]);
      const nodes = collect(parent);
      let index = 0;
      return { nextNode: () => nodes[index++] || null };
    },
    createRange: () => {
      let node;
      return { selectNodeContents: value => { node = value; }, getClientRects: () => [node.parentElement.rect] };
    }
  };
  const context = vm.createContext({
    URL, document, NodeFilter: { SHOW_TEXT: 4 },
    location: { pathname: "/recherche", href: "https://www.leboncoin.fr/recherche" },
    getComputedStyle: element => ({ display: "block", visibility: "visible", opacity: element.attrs.opacity || "1" }),
    window: { getSelection: () => selection, addEventListener() {}, innerWidth: 1200, innerHeight: 900 },
    MutationObserver: class { observe() {} }, setTimeout: () => 1, clearTimeout() {},
    chrome: {
      storage: {
        local: {
          get: () => storedSettings ? Promise.resolve({ lbcFilterSettings: storedSettings }) : new Promise(() => {}),
          set: async data => { storedSettings = JSON.parse(JSON.stringify(data.lbcFilterSettings)); }
        },
        onChanged: { addListener() {} }
      },
      runtime: { onMessage: { addListener() {} }, sendMessage: async message => { messages.push(message); return { ok: true }; } }
    }
  });
  const base = path.join(__dirname, "..");
  vm.runInContext(fs.readFileSync(path.join(base, "settings.js"), "utf8"), context);
  const source = fs.readFileSync(path.join(base, "content.js"), "utf8")
    .replace("  function filter() {", "  globalThis.inspectAd = { cardTitle, contextTarget, filter, setSettings: value => { settings = api.cleanSettings(value); } };\n  function filter() {");
  vm.runInContext(source, context);
  const rightClick = (element, x = 0, y = 0) => {
    const event = { target: element, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} };
    events.contextmenu(event);
  };
  return { ...context.inspectAd, title, category, city, metadata, card, root, heading, overlay, messages, rightClick,
    storeSettings: value => { storedSettings = value; context.inspectAd.setSettings(value); },
    storedSettings: () => storedSettings,
    select: (element, text) => { selection = { anchorNode: element.childNodes[0], focusNode: element.childNodes[0], isCollapsed: false, toString: () => text }; }
  };
}

test("le h3 vide et le lien générique ne remplacent pas le vrai titre", () => {
  const page = fixture();
  assert.equal(page.cardTitle(page.card), "Roues complètes");
  const target = page.contextTarget(page.title);
  assert.equal(target.kind, "title");
  assert.equal(target.value, "Roues complètes");
  assert.equal(target.selected, false);
});

test("le titre sans sélection ouvre les filtres avec uniquement le titre", () => {
  const page = fixture();
  page.rightClick(page.title);
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, "lbc:open-filters");
  assert.equal(page.messages[0].title, "Roues complètes");
});

test("les métadonnées regroupées ne deviennent jamais un libellé d’exclusion", () => {
  const page = fixture();
  assert.equal(page.contextTarget(page.metadata), null);
  assert.equal(page.contextTarget(page.category).label, "Équipement auto");
  assert.equal(page.contextTarget(page.city).value, "Die");
});

test("une sélection dans le titre propose ce texte sans ouvrir les filtres", () => {
  const page = fixture();
  page.select(page.title, "complètes");
  const target = page.contextTarget(page.title);
  assert.equal(target.kind, "title");
  assert.equal(target.value, "complètes");
  assert.equal(target.selected, true);
  page.rightClick(page.title);
  assert.equal(page.messages.length, 0);
  assert.equal(page.root.children.at(-1).textContent, "Exclure « complètes »");
});

test("le lien transparent est résolu à la position du titre visible", () => {
  const page = fixture();
  page.title.rect = { left: 650, top: 550, right: 800, bottom: 575, width: 150, height: 25 };
  page.rightClick(page.overlay, 675, 560);
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].title, "Roues complètes");
});

test("l’indicateur compte les annonces masquées et ouvre les filtres", () => {
  const page = fixture();
  page.setSettings({ enabled: true, categories: ["equipement_auto"] });
  page.filter();
  const indicator = page.root.children.find(element => element.id === "lbc-filter-indicator");
  assert.ok(indicator);
  assert.equal(indicator.textContent, "Filtres extension · 1 annonce masquée");
  // La carte et sa ligne sont masquées ; elles correspondent à une seule annonce.
  assert.equal(page.card.getAttribute("data-lbc-poc-hidden"), "yes");
  assert.equal(page.card.parentElement.getAttribute("data-lbc-poc-hidden"), "yes");
  indicator.handlers.click();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, "lbc:open-filters");
  assert.equal(page.messages[0].title, undefined);
  const writes = indicator.textWrites;
  page.filter();
  assert.equal(indicator.textWrites, writes);
});

test("l’indicateur reste visible sans critère et signale une désactivation", () => {
  const page = fixture();
  const indicator = () => page.root.children.find(element => element.id === "lbc-filter-indicator");
  page.setSettings({ categories: ["voitures"] });
  page.filter();
  assert.equal(indicator().textContent, "Filtres extension · 0 annonces masquées");
  page.setSettings({ categories: [], cities: [], titleContains: [], maxAgeDays: null });
  page.filter();
  assert.equal(indicator().textContent, "Filtres extension · 0 annonces masquées");
  page.setSettings({ categories: [], titleContains: ["LED"] });
  page.filter();
  assert.ok(indicator());
  page.setSettings({ enabled: false, categories: [], titleContains: ["LED"] });
  page.filter();
  assert.equal(indicator().textContent, "Filtres extension · désactivés");
  assert.equal(indicator().getAttribute("data-lbc-disabled"), "true");
});

test("le menu de l’indicateur désactive, réactive et réinitialise les critères", async () => {
  const page = fixture();
  const indicator = () => page.root.children.find(element => element.id === "lbc-filter-indicator");
  const menu = () => page.root.children.find(element => element.id === "lbc-filter-context-menu");
  const initial = { enabled: true, categories: ["equipement_auto"], cities: ["Die"], titleContains: ["LED"], maxAgeDays: 30 };
  page.storeSettings(initial);
  page.filter();
  page.rightClick(indicator());
  assert.deepEqual(menu().children.map(button => button.textContent), ["Désactiver", "Réinitialiser"]);
  await menu().children[0].handlers.click();
  assert.equal(page.storedSettings().enabled, false);
  assert.deepEqual(page.storedSettings().categories, initial.categories);
  assert.deepEqual(page.storedSettings().cities, initial.cities);
  assert.deepEqual(page.storedSettings().titleContains, initial.titleContains);
  assert.equal(page.storedSettings().maxAgeDays, 30);
  assert.equal(page.card.getAttribute("data-lbc-poc-hidden"), null);
  assert.equal(indicator().textContent, "Filtres extension · désactivés");
  page.rightClick(indicator());
  assert.equal(menu().children[0].textContent, "Activer");
  await menu().children[0].handlers.click();
  assert.equal(page.storedSettings().enabled, true);
  assert.equal(page.card.getAttribute("data-lbc-poc-hidden"), "yes");
  page.rightClick(indicator());
  await menu().children[1].handlers.click();
  assert.deepEqual(page.storedSettings(), { enabled: true, categoryMode: "exclude", categories: [], cities: [], titleContains: [], maxAgeDays: null });
  assert.equal(page.card.getAttribute("data-lbc-poc-hidden"), null);
  assert.equal(indicator().textContent, "Filtres extension · 0 annonces masquées");
});
