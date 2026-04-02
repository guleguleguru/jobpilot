(function initSiteAdapterRegistry() {
  const adapters = [];
  let fallbackAdapter = null;

  function register(adapter) {
    if (!adapter?.id) return;
    if (adapters.some(existing => existing.id === adapter.id)) return;
    adapters.push(adapter);
  }

  function getFallbackAdapter() {
    if (adapters.some(adapter => adapter.id === 'generic-action-engine')) return null;
    if (fallbackAdapter) return fallbackAdapter;

    const BaseSiteAdapter = window.__jobpilotSiteAdapterBase?.BaseSiteAdapter;
    if (!BaseSiteAdapter) return null;

    class GenericFallbackAdapter extends BaseSiteAdapter {
      constructor() {
        super({ id: 'generic-action-engine', name: 'Generic Action Engine' });
      }

      matches() {
        return true;
      }
    }

    fallbackAdapter = new GenericFallbackAdapter();
    return fallbackAdapter;
  }

  function getActiveSiteAdapter(context = {}) {
    const doc = context.document || document;
    const loc = context.location || window.location;
    const matched = adapters.find(adapter => {
      try {
        return adapter.matches(loc, doc);
      } catch (_) {
        return false;
      }
    });
    if (matched) return matched;

    const fallback = getFallbackAdapter();
    if (!fallback) return null;
    try {
      return fallback.matches(loc, doc) ? fallback : null;
    } catch (_) {
      return null;
    }
  }

  window.__jobpilotRegisterSiteAdapter = register;
  window.__jobpilotGetSiteAdapter = getActiveSiteAdapter;
  window.__jobpilotListSiteAdapters = () => {
    const fallback = getFallbackAdapter();
    return fallback ? [...adapters, fallback] : adapters.slice();
  };
})();
