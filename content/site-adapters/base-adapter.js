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
    let current = element;
    let depth = 0;
    while (current && depth < 12) {
      if (current.hidden || current.hasAttribute?.('hidden') || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      current = current.parentElement;
      depth += 1;
    }
    return true;
  }

  function normalizeComparableText(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function getElementText(element) {
    return normalizeText([
      element?.textContent || '',
      element?.ariaLabel || '',
      element?.getAttribute?.('aria-label') || '',
      element?.getAttribute?.('title') || '',
      element?.getAttribute?.('placeholder') || '',
      element?.value || '',
    ].filter(Boolean).join(' '));
  }

  function getClickableElements(root = document) {
    return Array.from(root.querySelectorAll('button, a, [role="button"], .btn, .button, .add, .append'));
  }

  function triggerClick(element) {
    if (!element) return;
    try {
      element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      try {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      } catch (_) {}
    }
    try {
      element.click?.();
    } catch (_) {}
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

  const GENERIC_REPEAT_SECTION_CONFIG = {
    education: {
      keywords: ['教育经历', '教育背景', 'education', 'academic'],
      triggerPatterns: [/教育经历|教育背景|education|academic/i],
      buttonPatterns: [/(添加|新增).{0,6}(教育|学历|学校)/i, /\b(add|new)\b.{0,12}\b(education|degree|school)\b/i],
    },
    experience: {
      keywords: ['实习经历', '工作经历', '工作经验', 'experience', 'internship'],
      triggerPatterns: [/实习经历|工作经历|工作经验|experience|internship/i],
      buttonPatterns: [/(添加|新增|继续添加).{0,6}(实习|工作|经历|经验)/i, /\b(add|new|append)\b.{0,12}\b(experience|internship|work)\b/i],
    },
    projects: {
      keywords: ['项目经历', '项目经验', '校园实践', 'project', 'practice'],
      triggerPatterns: [/项目经历|项目经验|校园实践|project|practice/i],
      buttonPatterns: [/(添加|新增|继续添加).{0,6}(项目|实践)/i, /\b(add|new|append)\b.{0,12}\b(project|practice)\b/i],
    },
    awards: {
      keywords: ['奖项', '荣誉', 'awards', 'honors'],
      triggerPatterns: [/奖项|荣誉|awards|honors/i],
      buttonPatterns: [/(添加|新增).{0,6}(奖项|荣誉)/i, /\b(add|new)\b.{0,12}\b(award|honor)\b/i],
    },
    competitions: {
      keywords: ['竞赛', '竞赛经历', '比赛', '比赛经历', '大赛', '大赛经历', 'competition', 'contest'],
      triggerPatterns: [/竞赛|竞赛经历|比赛|比赛经历|大赛|大赛经历|competition|contest/i],
      buttonPatterns: [/(添加|新增).{0,6}(竞赛|比赛|大赛)/i, /\b(add|new)\b.{0,12}\b(competition|contest)\b/i],
    },
    languages: {
      keywords: ['语言能力', '语言', '外语', 'language'],
      triggerPatterns: [/语言能力|语言|外语|language/i],
      buttonPatterns: [/(添加|新增).{0,6}(语言|外语)/i, /\b(add|new)\b.{0,12}\b(language)\b/i],
    },
    languageExams: {
      keywords: ['语言考试', '外语考试', '英语考试', 'language exam', 'english test'],
      triggerPatterns: [/语言考试|外语考试|英语考试|language exam|english test/i],
      buttonPatterns: [/(添加|新增).{0,6}(考试|成绩|外语)/i, /\b(add|new)\b.{0,12}\b(exam|test|score)\b/i],
    },
    developerLanguages: {
      keywords: ['开发语言', '编程语言', '技术栈', 'programming language', 'tech stack'],
      triggerPatterns: [/开发语言|编程语言|技术栈|programming language|tech stack/i],
      buttonPatterns: [/(添加|新增).{0,6}(开发语言|编程语言|技术栈)/i, /\b(add|new)\b.{0,12}\b(language|tech stack)\b/i],
    },
    familyMembers: {
      keywords: ['家庭成员', '家庭情况', 'family', 'relationship'],
      triggerPatterns: [/家庭成员|家庭情况|family|relationship/i],
      buttonPatterns: [/(添加|新增).{0,6}(家庭|成员)/i, /\b(add|new)\b.{0,12}\b(family|member|relationship)\b/i],
    },
  };

  function getSectionConfig(sectionKey, overrides = {}) {
    const base = GENERIC_REPEAT_SECTION_CONFIG[sectionKey] || null;
    if (!base && !overrides.keywords?.length && !overrides.triggerPatterns?.length) return null;
    return {
      keywords: overrides.keywords || base?.keywords || [],
      triggerPatterns: overrides.triggerPatterns || base?.triggerPatterns || [],
      buttonPatterns: overrides.buttonPatterns || base?.buttonPatterns || [],
    };
  }

  function looksLikeSectionWrapper(candidate) {
    if (!candidate || !isVisible(candidate)) return false;
    const className = String(candidate.className || '');
    if (/applyFormModuleWrapper-(left|right|title|text|desc)\b/.test(className)) return false;
    if (/\bud__button\b/.test(className)) return false;
    if (/apply-form-array-card-(content|operate|add)\b/.test(className)) return false;
    return true;
  }

  function getSectionWrapperCandidates(root = document) {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll([
      '.applyFormModuleWrapper-windows',
      '[class*="applyFormModuleWrapper-windows"]',
      '[class*="createFormSection"]',
      '[class*="resumeEditForm-part"]',
      '[class*="apply-form-array-card"]',
    ].join(', '))).filter(looksLikeSectionWrapper);
  }

  function getSectionRoot(keywords = []) {
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    if (!normalizedKeywords.length) return null;

    const wrapperCandidates = getSectionWrapperCandidates()
      .filter(candidate => {
        const titleText = normalizeComparableText([
          candidate.querySelector?.('.applyFormModuleWrapper-title, [class*="applyFormModuleWrapper-title"]')?.textContent || '',
          candidate.querySelector?.('.applyFormModuleWrapper-left, [class*="applyFormModuleWrapper-left"]')?.textContent || '',
          candidate.querySelector?.('h1, h2, h3, h4, h5, h6, legend, .section-title, .form-section-title')?.textContent || '',
        ].join(' '));
        if (!titleText) return false;
        return normalizedKeywords.some(keyword => titleText.includes(keyword) || keyword.includes(titleText));
      })
      .sort((left, right) => normalizeText(left.textContent || '').length - normalizeText(right.textContent || '').length);

    if (wrapperCandidates[0]) return wrapperCandidates[0];

    const candidates = Array.from(document.querySelectorAll([
      'section',
      'fieldset',
      'form',
      '.section',
      '.panel',
      '.block',
      '.module',
      '.card',
      '.group',
      '.item-list',
      '[class*="createFormSection"]',
      '[class*="resumeEditForm-part"]',
      '[class*="apply-form-array-card"]',
    ].join(', ')))
      .filter(candidate => {
        if (!looksLikeSectionWrapper(candidate)) return false;
        const text = normalizeComparableText(candidate.textContent || '');
        if (!normalizedKeywords.some(keyword => text.includes(keyword))) return false;
        return hasRelevantSectionContent(candidate, keywords);
      })
      .sort((left, right) => (left.textContent || '').length - (right.textContent || '').length);

    return candidates[0] || null;
  }

  function getFieldControlCount(root = document) {
    if (!root?.querySelectorAll) return 0;
    const formItems = root.querySelectorAll([
      '.form-item',
      '.ud-formily-item',
      '[id*="formily-item-"]',
      '[class*="formily-item"]',
      '[class*="resumeEditForm-item"]',
      '[class*="apply-form-array-card"]',
    ].join(', ')).length;
    if (formItems) return formItems;
    return root.querySelectorAll('input, select, textarea, [role="combobox"], [role="textbox"]').length;
  }

  function findSectionContainer(keywords = []) {
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    if (!normalizedKeywords.length) return null;

    const wrapperCandidates = getSectionWrapperCandidates()
      .filter(candidate => {
        const titleText = normalizeComparableText([
          candidate.querySelector?.('.applyFormModuleWrapper-title, [class*="applyFormModuleWrapper-title"]')?.textContent || '',
          candidate.querySelector?.('.applyFormModuleWrapper-left, [class*="applyFormModuleWrapper-left"]')?.textContent || '',
          candidate.querySelector?.('h1, h2, h3, h4, h5, h6, legend, .section-title, .form-section-title')?.textContent || '',
        ].join(' '));
        if (!titleText) return false;
        return normalizedKeywords.some(keyword => titleText.includes(keyword) || keyword.includes(titleText));
      })
      .sort((left, right) => {
        const leftScore = getFieldControlCount(left) + (left.querySelector?.('button, a, [role="button"]') ? 2 : 0);
        const rightScore = getFieldControlCount(right) + (right.querySelector?.('button, a, [role="button"]') ? 2 : 0);
        return leftScore - rightScore;
      });

    if (wrapperCandidates[0]) return wrapperCandidates[0];

    const headingCandidates = Array.from(document.querySelectorAll([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'legend',
      'label',
      'strong',
      '.section-title',
      '.form-section-title',
      '[class*="createFormSection-title"]',
      '[class*="resumeEditForm-part"]',
      '[id]',
    ].join(', ')))
      .filter(node => {
        if (!isVisible(node)) return false;
        const rawText = normalizeText(node.textContent || '');
        if (!rawText || rawText.length > 48) return false;
        const text = normalizeComparableText(rawText);
        return normalizedKeywords.some(keyword => text.includes(keyword));
      });

    for (const heading of headingCandidates) {
      let current = heading;
      let depth = 0;
      while (current?.parentElement && depth < 6) {
        current = current.parentElement;
        if (!current || !isVisible(current)) break;
        if (hasRelevantSectionContent(current, keywords)) {
          return current;
        }
        depth += 1;
      }
    }

    const sectionRoot = getSectionRoot(keywords);
    return sectionRoot?.parentElement || sectionRoot || null;
  }

  function collectHeadingTextsAround(element, maxDepth = 6) {
    const texts = [];
    let current = element;
    let depth = 0;

    while (current?.parentElement && depth < maxDepth) {
      const currentText = normalizeComparableText(getElementText(current));
      if (currentText && currentText.length <= 48) texts.push(currentText);

      let previous = current.previousElementSibling;
      let guard = 0;
      while (previous && guard < 4) {
        const text = normalizeComparableText(getElementText(previous));
        if (text && text.length <= 48) texts.push(text);
        previous = previous.previousElementSibling;
        guard += 1;
      }
      current = current.parentElement;
      depth += 1;
    }

    return [...new Set(texts)];
  }

  function looksLikeSectionTrigger(element, patterns = []) {
    if (!element || !(element instanceof Element) || !isVisible(element)) return false;
    const text = getElementText(element);
    if (!text || !patterns.some(pattern => pattern.test(text))) return false;

    const identity = normalizeComparableText([
      element.tagName || '',
      element.id || '',
      element.className || '',
      element.getAttribute?.('role') || '',
      element.getAttribute?.('aria-controls') || '',
      element.getAttribute?.('aria-expanded') || '',
      element.getAttribute?.('data-testid') || '',
    ].join(' '));

    if (element.tagName === 'SUMMARY') return true;
    if (element.getAttribute?.('role') === 'tab') return true;
    if (element.hasAttribute?.('aria-expanded')) return true;
    return /(tab|collapse|accordion|panel|section|title|header|step|menu|nav|toggle|switch|btn|button)/.test(identity);
  }

  function scoreSectionTriggerCandidate(element, patterns = []) {
    if (!looksLikeSectionTrigger(element, patterns)) return -Infinity;
    const text = getElementText(element);
    const identity = normalizeComparableText([
      element.tagName || '',
      element.id || '',
      element.className || '',
      element.getAttribute?.('role') || '',
      element.getAttribute?.('aria-controls') || '',
      element.getAttribute?.('aria-expanded') || '',
      element.getAttribute?.('data-testid') || '',
    ].join(' '));
    const compactText = normalizeText(text);

    let score = 0;
    if (patterns.some(pattern => pattern.test(text))) score += 5;
    if (element.tagName === 'SUMMARY') score += 3;
    if (element.getAttribute?.('role') === 'tab') score += 3;
    if (element.hasAttribute?.('aria-expanded')) score += 2;
    if (/(tab|collapse|accordion|panel|section|title|header|step|menu|nav|toggle|switch)/.test(identity)) score += 2;
    if (/button|btn/.test(identity) || /^(BUTTON|A)$/i.test(element.tagName || '') || element.getAttribute?.('role') === 'button') score += 1;
    if (compactText && compactText.length <= 24) score += 1;
    if (compactText.length > 48) score -= 2;

    return score;
  }

  function findSectionTriggers(patterns = [], root = document) {
    if (!patterns.length || !root?.querySelectorAll) return null;
    const candidates = Array.from(root.querySelectorAll([
      '[role="tab"]',
      'summary',
      '[aria-expanded]',
      'button',
      'a',
      '[role="button"]',
      '.tab',
      '.tabs-tab',
      '.tab-item',
      '.section-title',
      '.module-title',
      '.panel-title',
      '.collapse-header',
      '.accordion-header',
      'span',
      'div',
    ].join(', ')));

    const fallback = findElementByText('button, a, [role="button"], [role="tab"], summary, span, div', patterns, root);
    return uniqueElements([...candidates, fallback])
      .map(element => ({ element, score: scoreSectionTriggerCandidate(element, patterns) }))
      .filter(candidate => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score)
      .map(candidate => candidate.element);
  }

  function findSectionTrigger(patterns = [], root = document) {
    return findSectionTriggers(patterns, root)?.[0] || null;
  }

  function looksLikeAddButton(element, buttonPatterns = [], keywords = []) {
    if (!element || !(element instanceof Element) || !isVisible(element)) return false;
    const text = getElementText(element);
    const compactText = normalizeText(text);
    const normalizedText = normalizeComparableText(text);
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    const identity = normalizeComparableText([
      element.tagName || '',
      element.id || '',
      element.className || '',
      element.getAttribute?.('data-testid') || '',
      element.getAttribute?.('aria-label') || '',
      element.getAttribute?.('title') || '',
    ].join(' '));
    const isClickableLike =
      /^(button|a|summary)$/i.test(element.tagName || '')
      || element.getAttribute?.('role') === 'button'
      || element.hasAttribute?.('tabindex')
      || typeof element.onclick === 'function'
      || /(btn|button|clickable|action|add|append)/.test(identity);
    const hasAddIdentity = /(_addbutton$|(^|[^a-z])(add(btn|more)?|append|create|plus)([^a-z]|$)|createformsectionadd|formoperateaddbtn|applyformarraycardadd)/.test(identity);

    if (!isClickableLike) return false;
    if (!compactText && !hasAddIdentity) return false;
    if (compactText.length > 24 && !hasAddIdentity) return false;

    const unicodeAddTextPattern = /^(?:\u6dfb\u52a0|\u65b0\u589e|\u7ee7\u7eed\u6dfb\u52a0|add|new)$/i;
    const unicodeNormalizedAddPattern = /^(?:\u6dfb\u52a0|\u65b0\u589e|\u7ee7\u7eed\u6dfb\u52a0)$/;

    if (unicodeAddTextPattern.test(text)) return true;
    if (unicodeNormalizedAddPattern.test(normalizedText)) return true;
    if (buttonPatterns.some(pattern => pattern.test(text))) return true;
    if (/^(添加|新增|继续添加|add|new)$/i.test(text)) return true;
    if (hasAddIdentity || /(add|append|create|new|plus)/.test(identity)) return true;
    if (/(添加|新增|继续添加)/.test(text) && (!normalizedKeywords.length || normalizedKeywords.some(keyword => normalizedText.includes(keyword)))) {
      return true;
    }

    const hasPlusIcon = Boolean(element.querySelector?.('svg path')) && !text;
    if (hasPlusIcon && hasAddIdentity) return true;
    return false;
  }

  function hasRelevantSectionContent(root, keywords = []) {
    if (!root?.querySelectorAll || !isVisible(root)) return false;
    if (getFieldControlCount(root) >= 2) return true;
    return Array.from(root.querySelectorAll('button, a, [role="button"], .btn, .button, .add, .append, span, div'))
      .some(element => looksLikeAddButton(element, [], keywords));
  }

  function findRepeatAddButton({ sectionRoot = document, buttonPatterns = [], keywords = [] } = {}) {
    const rootTextLength = normalizeText(sectionRoot?.textContent || '').length;
    const canTrustLocalRoot = rootTextLength > 0 && rootTextLength <= 800;
    const roots = uniqueElements([
      canTrustLocalRoot ? sectionRoot : null,
      canTrustLocalRoot ? sectionRoot?.parentElement : null,
      canTrustLocalRoot ? sectionRoot?.previousElementSibling : null,
      canTrustLocalRoot ? sectionRoot?.nextElementSibling : null,
    ]);
    const normalizedKeywords = keywords.map(item => normalizeComparableText(item)).filter(Boolean);
    const candidateScores = new Map();
    const localMatches = new Set();
    const primaryRootMatches = new Set();

    function scoreCandidate(element, baseScore = 0) {
      if (!element) return;
      const text = normalizeComparableText(getElementText(element));
      const identity = normalizeComparableText([
        element.id || '',
        element.className || '',
        element.getAttribute?.('data-testid') || '',
        element.getAttribute?.('aria-label') || '',
        element.getAttribute?.('title') || '',
      ].join(' '));
      const nearbyTexts = collectHeadingTextsAround(element);

      let score = baseScore;
      if (normalizedKeywords.length) {
        if (text && normalizedKeywords.some(keyword => text.includes(keyword) || keyword.includes(text))) score += 2;
        if (nearbyTexts.some(nearby => nearby && normalizedKeywords.some(keyword => nearby.includes(keyword) || keyword.includes(nearby)))) score += 2;
        if (identity && normalizedKeywords.some(keyword => identity.includes(keyword) || keyword.includes(identity))) score += 1;
      }

      const previous = candidateScores.get(element);
      if (previous == null || score > previous) {
        candidateScores.set(element, score);
      }
    }

    for (const root of roots) {
      if (!root?.querySelectorAll) continue;

      const explicit = Array.from(root.querySelectorAll('[id$="_addButton"]'))
        .filter(element => looksLikeAddButton(element, buttonPatterns, keywords));
      for (const element of explicit) {
        localMatches.add(element);
        if (root === sectionRoot) primaryRootMatches.add(element);
        scoreCandidate(element, 2);
      }

      const localCandidates = Array.from(root.querySelectorAll('button, a, [role="button"], .btn, .button, .add, .append, span, div'))
        .filter(element => looksLikeAddButton(element, buttonPatterns, keywords));
      for (const element of localCandidates) {
        localMatches.add(element);
        if (root === sectionRoot) primaryRootMatches.add(element);
        scoreCandidate(element, 0);
      }
    }

    const globalCandidates = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, .button, .add, .append, span, div'))
      .filter(element => looksLikeAddButton(element, buttonPatterns, keywords))
    for (const element of globalCandidates) {
      scoreCandidate(element, 0);
    }

    const candidates = [...candidateScores.entries()]
      .map(([element, score]) => ({ element, score }))
      .sort((left, right) => right.score - left.score);

    if (canTrustLocalRoot && primaryRootMatches.size === 1) {
      return [...primaryRootMatches][0];
    }
    if (canTrustLocalRoot && localMatches.size === 1) {
      return [...localMatches][0];
    }
    if (candidates[0] && (!normalizedKeywords.length || candidates[0].score > 0)) {
      return candidates[0].element;
    }

    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getTriggerDescriptor(element) {
    return {
      text: normalizeText(getElementText(element)).slice(0, 120),
      tag: String(element?.tagName || '').toUpperCase(),
      role: String(element?.getAttribute?.('role') || ''),
      id: String(element?.id || ''),
      className: String(element?.className || '').slice(0, 120),
      ariaExpanded: String(element?.getAttribute?.('aria-expanded') || ''),
      ariaControls: String(element?.getAttribute?.('aria-controls') || ''),
    };
  }

  function createSectionSnapshot(keywords = []) {
    const container = findSectionContainer(keywords) || getSectionRoot(keywords) || null;
    return {
      visible: Boolean(container),
      fieldCount: getFieldControlCount(container || document),
    };
  }

  function scoreTriggerAttempt(beforeSnapshot, afterSnapshot, domChanged) {
    const delta = Number(afterSnapshot?.fieldCount || 0) - Number(beforeSnapshot?.fieldCount || 0);
    let score = delta;
    if (domChanged) score += 1;
    if (afterSnapshot?.visible) score += 8;
    return score;
  }

  function createTriggerAttemptRecord({
    section,
    element = null,
    beforeSnapshot = null,
    afterSnapshot = null,
    domChanged = false,
    outcome = 'no_effect',
    reason = '',
  } = {}) {
    const safeBefore = beforeSnapshot || { visible: false, fieldCount: 0 };
    const safeAfter = afterSnapshot || safeBefore;
    return {
      section,
      ...getTriggerDescriptor(element),
      domChanged: Boolean(domChanged),
      visibleBefore: Boolean(safeBefore.visible),
      visibleAfter: Boolean(safeAfter.visible),
      fieldCountBefore: Number(safeBefore.fieldCount || 0),
      fieldCountAfter: Number(safeAfter.fieldCount || 0),
      fieldCountDelta: Number(safeAfter.fieldCount || 0) - Number(safeBefore.fieldCount || 0),
      score: scoreTriggerAttempt(safeBefore, safeAfter, domChanged),
      outcome,
      reason: String(reason || outcome),
    };
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

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded', 'hidden'],
      });
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

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded', 'hidden'],
      });

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
      this.runtimeDiagnostics = {
        triggerAttempts: [],
      };
      this.repeatableLimits = {
        education: 6,
        experience: 6,
        projects: 6,
        awards: 6,
        competitions: 6,
        languages: 6,
        languageExams: 6,
        developerLanguages: 6,
        familyMembers: 6,
      };
    }

    matches() {
      return false;
    }

    async beforeFill() {
      this.runtimeDiagnostics = {
        triggerAttempts: [],
      };
      return null;
    }

    async afterFill() {
      return null;
    }

    async ensureRepeatItem(sectionKey, index, context = {}) {
      const config = getSectionConfig(sectionKey);
      if (!config) {
        return { created: false, reason: 'unsupported' };
      }

      return this.ensureRepeatItemGeneric({
        sectionKey,
        index,
        keywords: config.keywords,
        buttonPatterns: config.buttonPatterns,
        triggerPatterns: config.triggerPatterns,
        countRoot: findSectionContainer(config.keywords) || getSectionRoot(config.keywords) || context.document || document,
      });
    }

    async ensureSectionVisible(sectionKey, options = {}) {
      const config = getSectionConfig(sectionKey, options);
      if (!config) return { activated: false, reason: 'unsupported' };

      const existing = findSectionContainer(config.keywords) || getSectionRoot(config.keywords);
      if (existing) {
        const snapshot = createSectionSnapshot(config.keywords);
        this.runtimeDiagnostics.triggerAttempts.push(createTriggerAttemptRecord({
          section: sectionKey,
          element: existing,
          beforeSnapshot: snapshot,
          afterSnapshot: snapshot,
          domChanged: false,
          outcome: 'already_visible',
          reason: 'already_visible',
        }));
        return { activated: false, reason: 'already_visible' };
      }

      const triggers = findSectionTriggers(config.triggerPatterns) || [];
      if (!triggers.length) {
        const snapshot = createSectionSnapshot(config.keywords);
        this.runtimeDiagnostics.triggerAttempts.push(createTriggerAttemptRecord({
          section: sectionKey,
          element: null,
          beforeSnapshot: snapshot,
          afterSnapshot: snapshot,
          domChanged: false,
          outcome: 'trigger_not_found',
          reason: 'trigger_not_found',
        }));
        return { activated: false, reason: 'trigger_not_found' };
      }

      let sawDomChange = false;
      for (const trigger of triggers.slice(0, 6)) {
        const beforeSnapshot = createSectionSnapshot(config.keywords);
        const changed = await waitForDomChange(() => triggerClick(trigger), 1800);
        if (changed) {
          sawDomChange = true;
          await sleep(120);
        }

        const afterSnapshot = createSectionSnapshot(config.keywords);
        const attempt = createTriggerAttemptRecord({
          section: sectionKey,
          element: trigger,
          beforeSnapshot,
          afterSnapshot,
          domChanged: changed,
          outcome: afterSnapshot.visible || afterSnapshot.fieldCount > beforeSnapshot.fieldCount
            ? 'activated'
            : changed
              ? 'dom_changed_without_section'
              : 'no_effect',
          reason: afterSnapshot.visible || afterSnapshot.fieldCount > beforeSnapshot.fieldCount
            ? 'activated'
            : changed
              ? 'dom_changed_without_section'
              : 'no_effect',
        });
        this.runtimeDiagnostics.triggerAttempts.push(attempt);

        if (afterSnapshot.visible || afterSnapshot.fieldCount > beforeSnapshot.fieldCount) {
          return {
            activated: true,
            reason: 'activated',
          };
        }
      }

      return {
        activated: false,
        reason: sawDomChange ? 'dom_changed_without_section' : 'not_visible_after_click',
      };
    }

    async ensureFieldReady({ fieldEntry } = {}) {
      const sectionKey = inferSectionKeyFromField(fieldEntry);
      if (!sectionKey) return { activated: false, reason: 'unknown_section' };
      return this.ensureSectionVisible(sectionKey);
    }

    async ensureRepeatItemGeneric({ sectionKey, index = 0, keywords = [], buttonPatterns = [], triggerPatterns = [], countRoot } = {}) {
      const limit = this.repeatableLimits[sectionKey] || 5;
      if (index + 1 > limit) {
        return { created: false, reason: `${sectionKey}_limit_reached` };
      }

      const visibilityResult = await this.ensureSectionVisible(sectionKey, { keywords, triggerPatterns });

      const sectionContainer = findSectionContainer(keywords) || getSectionRoot(keywords) || null;
      if (!sectionContainer) {
        const unavailableReason = visibilityResult?.reason && visibilityResult.reason !== 'already_visible'
          ? visibilityResult.reason
          : 'section_not_found';
        return { created: false, reason: `${sectionKey}_section_unavailable_on_page:${unavailableReason}` };
      }

      const addButton = findRepeatAddButton({ sectionRoot: sectionContainer, buttonPatterns, keywords });
      if (!addButton) {
        return { created: false, reason: `${sectionKey}_add_button_not_found` };
      }

      const getCount = () => getFieldControlCount(countRoot || sectionContainer);
      const changed = await waitForCountIncrease(getCount, () => triggerClick(addButton), 3500);
      if (changed) return { created: true, reason: 'created' };

      const fallbackChanged = await waitForDomChange(() => triggerClick(addButton), 2200);
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

    getRuntimeDiagnostics() {
      return {
        triggerAttempts: [...(this.runtimeDiagnostics?.triggerAttempts || [])],
      };
    }
  }

  function inferSectionKeyFromField(fieldEntry = {}) {
    const keyPath = String(fieldEntry?.key || fieldEntry?.field?.normalizedKey || '');
    const keyMatch = keyPath.match(/^([a-zA-Z]+)\[\d+\]\./);
    if (keyMatch) return keyMatch[1];

    const field = fieldEntry?.field || fieldEntry;
    const combined = normalizeComparableText([
      field?.sectionLabel,
      field?.label,
      ...(field?.labelCandidates || []),
      field?.placeholder,
      field?.contextText,
    ].filter(Boolean).join(' '));

    return Object.entries(GENERIC_REPEAT_SECTION_CONFIG)
      .sort((left, right) => {
        const leftScore = Math.max(...(left[1].keywords || []).map(keyword => normalizeComparableText(keyword).length), 0);
        const rightScore = Math.max(...(right[1].keywords || []).map(keyword => normalizeComparableText(keyword).length), 0);
        return rightScore - leftScore;
      })
      .find(([, config]) => (
        config.keywords || []
      ).some(keyword => combined.includes(normalizeComparableText(keyword))))?.[0] || '';
  }

  window.__jobpilotSiteAdapterBase = {
    BaseSiteAdapter,
    getSectionConfig,
    inferSectionKeyFromField,
    findSectionTrigger,
      findSectionTriggers,
      findElementByText,
      getClickableElements,
      getFieldControlCount,
      getElementText,
      getSectionWrapperCandidates,
      findRepeatAddButton,
      findSectionContainer,
      getSectionRoot,
      isVisible,
    normalizeComparableText,
    normalizeText,
    sleep,
    triggerClick,
    waitForCountIncrease,
    waitForDomChange,
  };
})();
