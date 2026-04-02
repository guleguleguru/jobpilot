(function registerGenericSiteAdapter() {
  const base = window.__jobpilotSiteAdapterBase;
  if (!base || !window.__jobpilotRegisterSiteAdapter) return;

  const { BaseSiteAdapter } = base;

  class GenericSiteAdapter extends BaseSiteAdapter {
    constructor() {
      super({ id: 'generic-action-engine', name: 'Generic Action Engine' });
    }

    matches() {
      return true;
    }
  }

  window.__jobpilotRegisterSiteAdapter(new GenericSiteAdapter());
})();
