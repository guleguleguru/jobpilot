(function initSiteAdapterRegistry() {
  const adapters = [];

  function register(adapter) {
    if (!adapter?.id) return;
    if (adapters.some(existing => existing.id === adapter.id)) return;
    adapters.push(adapter);
  }

  function getActiveSiteAdapter(context = {}) {
    const doc = context.document || document;
    const loc = context.location || window.location;
    return adapters.find(adapter => {
      try {
        return adapter.matches(loc, doc);
      } catch (_) {
        return false;
      }
    }) || null;
  }

  window.__jobpilotRegisterSiteAdapter = register;
  window.__jobpilotGetSiteAdapter = getActiveSiteAdapter;
  window.__jobpilotListSiteAdapters = () => adapters.slice();
})();
