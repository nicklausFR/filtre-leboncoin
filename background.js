(() => {
  "use strict";
  importScripts("settings.js");
  const api = globalThis.LbcFilter;
  chrome.runtime.onInstalled.addListener(() => {
    // Retirer l'ancien menu générique au rechargement de l'extension.
    chrome.contextMenus.removeAll();
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "lbc:open-filters") return;
    const tab = sender.tab;
    if (tab?.id === undefined || sender.frameId !== 0 ||
        !/^https:\/\/(?:www\.)?leboncoin\.fr(?:\/|$)/i.test(sender.url || "") ||
        (message.title !== undefined && typeof message.title !== "string")) {
      respond({ ok: false });
      return;
    }
    const key = api.popupDraftPrefix + tab.id;
    (async () => {
      const title = message.title?.trim();
      if (title) await chrome.storage.session.set({ [key]: { title } });
      else await chrome.storage.session.remove(key);
      try {
        await chrome.action.openPopup({ windowId: tab.windowId });
      } catch (error) {
        await chrome.storage.session.remove(key);
        throw error;
      }
    })().then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    chrome.storage.session.remove(api.popupDraftPrefix + tabId);
  });
})();
