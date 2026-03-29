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

  function uniqueElements(nodes = []) {
    return [...new Set(nodes.filter(node => node instanceof Element || node instanceof Document))];
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

  function getFieldControlCount(root = document) {
    if (!root?.querySelectorAll) return 0;
    const formItems = root.querySelectorAll('.form-item').length;
    if (formItems) return formItems;
    return root.querySelectorAll('input, select, textarea, [role="combobox"], [role="textbox"]').length;
  }

  function findSectionContainer(keywords = []) {
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    if (!normalizedKeywords.length) return null;

    const headingCandidates = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, label, strong, .section-title, .form-section-title, [id]'))
      .filter(node => {
        if (!isVisible(node)) return false;
        const text = normalizeComparableText(node.textContent || '');
        return normalizedKeywords.some(keyword => text.includes(keyword));
      });

    for (const heading of headingCandidates) {
      let current = heading;
      let depth = 0;
      while (current?.parentElement && depth < 6) {
        current = current.parentElement;
        if (!current || !isVisible(current)) break;
        const controlCount = getFieldControlCount(current);
        const hasAddButton = Boolean(current.querySelector('[id$="_addButton"], .add, .append, button, a, [role="button"]'));
        if (controlCount >= 2 || hasAddButton) {
          return current;
        }
        depth += 1;
      }
    }

    const sectionRoot = getSectionRoot(keywords);
    return sectionRoot?.parentElement || sectionRoot || null;
  }

  function looksLikeAddButton(element, buttonPatterns = [], keywords = []) {
    if (!element || !(element instanceof Element) || !isVisible(element)) return false;
    const text = getElementText(element);
    const normalizedText = normalizeComparableText(text);
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    const identity = normalizeComparableText([
      element.id || '',
      element.className || '',
      element.getAttribute?.('data-testid') || '',
      element.getAttribute?.('aria-label') || '',
      element.getAttribute?.('title') || '',
    ].join(' '));

    if (buttonPatterns.some(pattern => pattern.test(text))) return true;
    if (/_addbutton$/.test(identity) || /(add|append|create|new|plus)/.test(identity)) return true;
    if (/添加|新增|继续添加/.test(text) && (!normalizedKeywords.length || normalizedKeywords.some(keyword => normalizedText.includes(keyword)))) {
      return true;
    }

    const hasPlusIcon = Boolean(element.querySelector?.('svg path')) && !text;
    if (hasPlusIcon && /_addbutton$/.test(identity)) return true;
    return false;
  }

  function findRepeatAddButton({ sectionRoot = document, buttonPatterns = [], keywords = [] } = {}) {
    const roots = uniqueElements([
      sectionRoot,
      sectionRoot?.parentElement,
      sectionRoot?.previousElementSibling,
      sectionRoot?.nextElementSibling,
    ]);

    for (const root of roots) {
      if (!root?.querySelectorAll) continue;

      const explicit = Array.from(root.querySelectorAll('[id$="_addButton"]'))
        .find(element => looksLikeAddButton(element, buttonPatterns, keywords));
      if (explicit) return explicit;

      const candidates = Array.from(root.querySelectorAll('button, a, [role="button"], .btn, .button, .add, .append, span, div'));
      const matched = candidates.find(element => looksLikeAddButton(element, buttonPatterns, keywords));
      if (matched) return matched;
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

  async function waitForCountIncrease(getCount, callback, timeout = 2500) {
    return new Promise(resolve => {
      const before = Number(getCount?.() || 0);
      let settled = false;

      const finish = value => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        resolve(value);
      };

      const observer = new MutationObserver(() => {
        const current = Number(getCount?.() || 0);
        if (current > before) finish(true);
      });

      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

      const intervalId = setInterval(() => {
        const current = Number(getCount?.() || 0);
        if (current > before) finish(true);
      }, 120);

      const timeoutId = setTimeout(() => finish(false), timeout);

      Promise.resolve()
        .then(callback)
        .catch(() => {});
    });
  }

  class BaseSiteAdapter {
    constructor({ id, name }) {
      this.id = id;
      this.name = name || id;
      this.repeatableLimits = {
        education: 6,
        experience: 6,
        projects: 6,
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

    async ensureRepeatItemGeneric({ sectionKey, index = 0, keywords = [], buttonPatterns = [], countRoot } = {}) {
      const limit = this.repeatableLimits[sectionKey] || 5;
      if (index + 1 > limit) {
        return { created: false, reason: `${sectionKey}_limit_reached` };
      }

      const sectionContainer = findSectionContainer(keywords) || getSectionRoot(keywords) || document.body || document;
      const addButton = findRepeatAddButton({ sectionRoot: sectionContainer, buttonPatterns, keywords });
      if (!addButton) {
        return { created: false, reason: `${sectionKey}_add_button_not_found` };
      }

      const getCount = () => getFieldControlCount(countRoot || sectionContainer);
      const changed = await waitForCountIncrease(getCount, () => addButton.click(), 3500);
      if (changed) return { created: true, reason: 'created' };

      const fallbackChanged = await waitForDomChange(() => addButton.click(), 2200);
      return {
        created: fallbackChanged,
        reason: fallbackChanged ? 'created' : `${sectionKey}_dom_not_changed`,
      };
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
    getFieldControlCount,
    getElementText,
    findRepeatAddButton,
    findSectionContainer,
    getSectionRoot,
    isVisible,
    normalizeComparableText,
    normalizeText,
    sleep,
    waitForCountIncrease,
    waitForDomChange,
  };
})();
