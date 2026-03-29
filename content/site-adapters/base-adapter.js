(function initSiteAdapterBase() {
  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeComparableText(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[()（）\-_/\\,.;:：，。'"`~!@#$%^&*+=?|[\]{}<>]/g, '');
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getElementText(element) {
    return normalizeText(element?.textContent || element?.ariaLabel || element?.value || '');
  }

  function getClickableElements(root = document) {
    return Array.from(root.querySelectorAll('button, a, [role="button"], .btn, .button, .add, .append'));
  }

  function findElementByText(selectors, patterns, root = document) {
    const nodes = Array.from(root.querySelectorAll(selectors));
    return nodes.find(node => {
      if (!isVisible(node)) return false;
      const text = getElementText(node);
      return patterns.some(pattern => pattern.test(text));
    }) || null;
  }

  function getSectionRoot(keywords = []) {
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    if (!normalizedKeywords.length) return null;

    const candidates = Array.from(document.querySelectorAll('section, fieldset, form, .section, .panel, .block, .module, .card, .group, .item-list'));
    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      const text = normalizeComparableText(candidate.textContent || '');
      if (normalizedKeywords.some(keyword => text.includes(keyword))) return candidate;
    }

    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForDomChange(callback, timeout = 1200) {
    return new Promise(resolve => {
      let settled = false;
      const observer = new MutationObserver(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(true);
      });

      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      Promise.resolve()
        .then(callback)
        .catch(() => {})
        .finally(() => {
          setTimeout(() => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            resolve(false);
          }, timeout);
        });
    });
  }

  class BaseSiteAdapter {
    constructor({ id, name }) {
      this.id = id;
      this.name = name || id;
      this.repeatableLimits = {
        languages: 6,
        familyMembers: 6,
      };
    }

    matches() {
      return false;
    }

    async beforeFill() {
      return null;
    }

    async afterFill() {
      return null;
    }

    async ensureRepeatItem() {
      return { created: false, reason: 'unsupported' };
    }

    setSelectValue() {
      return null;
    }

    setDateValue() {
      return null;
    }

    setRadioValue() {
      return null;
    }

    mapEnumValue() {
      return null;
    }

    enrichFieldDescriptor() {
      return null;
    }

    matchField() {
      return null;
    }

    getDiagnosticsHints() {
      return [];
    }
  }

  window.__jobpilotSiteAdapterBase = {
    BaseSiteAdapter,
    findElementByText,
    getClickableElements,
    getElementText,
    getSectionRoot,
    isVisible,
    normalizeComparableText,
    normalizeText,
    sleep,
    waitForDomChange,
  };
})();
