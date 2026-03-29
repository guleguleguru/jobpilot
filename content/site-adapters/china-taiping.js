(function registerChinaTaipingAdapter() {
  const base = window.__jobpilotSiteAdapterBase;
  if (!base || !window.__jobpilotRegisterSiteAdapter) return;

  const {
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
  } = base;

  const FIELD_CONTROL_SELECTOR = 'input, select, textarea, button, [role="button"], [role="combobox"]';
  const DROPDOWN_ROOT_SELECTOR = '.el-select-dropdown, .ant-select-dropdown, .ivu-select-dropdown, .layui-form-select, [role="listbox"], .dropdown-menu, .select-dropdown, .select-options';
  const DROPDOWN_OPTION_SELECTOR = '.el-select-dropdown__item, .ant-select-item-option, .ant-select-item-option-content, .ant-select-dropdown-menu-item, .ivu-select-item, .layui-this, [role="option"], .dropdown-item, li';
  const RADIO_OPTION_SELECTOR = 'label, button, [role="radio"], [role="button"], .radio, .ant-radio-wrapper, .el-radio, .ant-checkbox-wrapper, .el-checkbox';
  const PHOENIX_LIST_ITEM_SELECTOR = '.list-item-container, .phoenix-selectList__listItem, .area-item-container';
  const LABEL_NOISE_PATTERN = /^(请输入|请选择|点击选择|点击上传|上传文件|上传附件|搜索|0\/2000)$/;
  const DATE_HINT_PATTERN = /(日期|时间|date|time)/i;
  const RADIO_HINT_PATTERN = /(性别|gender|是否|留学|海外|应届|fresh\s*graduate|graduate\s*status)/i;
  const SIMPLE_CHOICE_PATTERN = /^(男|女|是|否)$/;
  const SECTION_TITLE_PATTERN = /(个人信息|教育经历|在校实践|实习经历|语言能力|家庭情况|附加信息)/;
  const AUTO_FILL_OVERRIDE_KEYS = new Set([
    'personal.gender',
    'personal.birthDate',
    'personal.nationality',
    'personal.ethnicity',
    'personal.nativePlace',
    'personal.politicalStatus',
    'personal.partyJoinDate',
    'personal.maritalStatus',
    'personal.healthStatus',
    'personal.heightCm',
    'personal.weightKg',
    'personal.freshGraduateStatus',
    'personal.hasOverseasStudy',
    'contact.address',
    'contact.postalCode',
    'contact.wechat',
    'residency.currentAddress',
    'residency.homeAddress',
    'residency.householdType',
    'residency.householdAddress',
    'residency.policeStation',
    'identity.documentType',
  ]);
  const AUTO_FILL_OVERRIDE_PREFIXES = [
    'familyMembers[',
    'jobPreferences.',
  ];

  const SECTION_KEYWORDS = {
    education: ['教育经历', '教育背景', '学习经历'],
    projects: ['在校实践', '校内实践', '项目经历'],
    experience: ['实习经历', '工作经历', '实习经验'],
    languages: ['语言能力', '外语能力', '语言水平', '语种'],
    familyMembers: ['家庭成员', '家庭情况', '主要家庭成员', '家庭信息'],
  };

  const SECTION_ADD_PATTERNS = {
    education: [/(添加|新增|继续添加).{0,4}(教育|学校|学习经历)/, /(添加|新增).{0,4}(一条|一项)/],
    projects: [/(添加|新增|继续添加).{0,4}(在校实践|校内实践|项目)/, /(添加|新增).{0,4}(一条|一项)/],
    experience: [/(添加|新增|继续添加).{0,4}(实习|工作|经历)/, /(添加|新增).{0,4}(一条|一项)/],
    languages: [/(添加|新增|继续添加).{0,4}(语言|语种|外语)/, /(添加|新增).{0,4}(一条|一项)/],
    familyMembers: [/(添加|新增|继续添加).{0,4}(家庭|成员|家属)/, /(添加|新增).{0,4}(一条|一项)/],
  };

  const FAMILY_SECTION_PATTERN = /(家庭情况|家庭成员|家属|与本人关系|身份类别|家庭所在地|存在状态)/;
  const LANGUAGE_SECTION_PATTERN = /(语言能力|外语能力|语言水平|语种|掌握程度|听说|读写)/;

  const TAIPING_SECTION_RULES = {
    languages: [
      { pattern: /(语言类型|语种|language)/, subkey: 'language' },
      { pattern: /(掌握程度|语言水平|熟练程度|level|proficiency)/, subkey: 'proficiency' },
      { pattern: /(听说|listening|speaking)/, subkey: 'listeningSpeaking' },
      { pattern: /(读写|reading|writing)/, subkey: 'readingWriting' },
    ],
    familyMembers: [
      { pattern: /(与本人关系|relation)/, subkey: 'relation' },
      { pattern: /(^|[\s:：])姓名($|[\s:：])|成员姓名|member\s*name/, subkey: 'name' },
      { pattern: /(出生日期|family.*birth|birth)/, subkey: 'birthDate' },
      { pattern: /(政治面貌|family.*political|political)/, subkey: 'politicalStatus' },
      { pattern: /(身份类别|identity\s*type)/, subkey: 'identityType' },
      { pattern: /(工作单位|family.*employer|employer|company)/, subkey: 'employer' },
      { pattern: /(职务|job\s*title|title|position)/, subkey: 'jobTitle' },
      { pattern: /(存在状态|状态|status)/, subkey: 'status' },
      { pattern: /(家庭所在地|family.*location|所在地|location)/, subkey: 'location' },
    ],
  };

  const SECTION_LAYOUT_TEMPLATES = {
    personalinfo: {
      '1-1': 'personal.fullName',
      '1-2': 'personal.fullNamePinyin',
      '2-1': 'personal.gender',
      '2-2': 'contact.email',
      '3-1': 'contact.phone',
      '3-2': 'personal.photo',
      '4-1': 'personal.nationality',
      '4-2': 'identity.documentNumber',
      '5-1': 'personal.birthDate',
      '5-2': 'personal.ethnicity',
      '6-1': 'personal.heightCm',
      '6-2': 'personal.weightKg',
      '7-1': 'personal.politicalStatus',
      '7-2': 'personal.partyJoinDate',
      '8-1': 'personal.healthStatus',
      '8-2': 'personal.maritalStatus',
      '9-1': 'personal.nativePlace',
      '9-2': 'residency.currentCity',
      '10-1': 'residency.currentAddress',
      '10-2': 'residency.homeAddress',
      '11-1': 'residency.householdType',
      '11-2': 'residency.householdAddress',
      '12-1': 'residency.policeStation',
      '12-2': 'personal.freshGraduateStatus',
      '13-1': 'personal.hasOverseasStudy',
    },
    educationexperience: {
      '1-1': ['education', 'startDate'],
      '1-2': ['education', 'endDate'],
      '2-1': ['education', 'school'],
      '2-2': ['education', 'schoolCountry'],
      '3-1': ['education', 'major'],
      '3-2': ['education', 'degree'],
      '4-1': ['education', 'studyMode'],
      '4-2': ['education', 'educationLevel'],
      '5-1': 'personal.hasOverseasStudy',
    },
    campuspractice: {
      '1-1': ['projects', 'startDate'],
      '1-2': ['projects', 'endDate'],
      '2-1': ['projects', 'name'],
      '2-2': ['projects', 'description'],
    },
    internexperience: {
      '1-1': ['experience', 'company'],
      '1-2': ['experience', 'department'],
      '2-1': ['experience', 'startDate'],
      '2-2': ['experience', 'endDate'],
      '3-1': ['experience', 'description'],
      '3-2': ['experience', 'title'],
    },
    languageability: {
      '1-1': ['languages', 'language'],
      '1-2': ['languages', 'proficiency'],
      '2-1': ['languages', 'listeningSpeaking'],
      '2-2': ['languages', 'readingWriting'],
    },
    familysituation: {
      '1-1': ['familyMembers', 'relation'],
      '1-2': ['familyMembers', 'name'],
      '2-1': ['familyMembers', 'birthDate'],
      '2-2': ['familyMembers', 'politicalStatus'],
      '3-1': ['familyMembers', 'identityType'],
      '3-2': ['familyMembers', 'employer'],
      '4-1': ['familyMembers', 'jobTitle'],
      '4-2': ['familyMembers', 'status'],
      '5-1': ['familyMembers', 'location'],
    },
    additionalinfo: {
      '1-1': 'graduationYear',
      '2-1': 'selfIntro',
    },
  };
  const SECTION_ORDINAL_RANGES = [
    { start: 1, end: 24, section: 'personalinfo' },
    { start: 25, end: 32, section: 'educationexperience' },
    { start: 33, end: 37, section: 'campuspractice' },
    { start: 38, end: 44, section: 'internexperience' },
    { start: 45, end: 48, section: 'languageability' },
    { start: 49, end: 57, section: 'familysituation' },
    { start: 58, end: 60, section: 'additionalinfo' },
  ];

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isUsefulLabel(text, helpers) {
    const cleaned = helpers.cleanLabelText(text);
    if (!helpers.isMeaningfulLabelText(cleaned)) return false;
    if (LABEL_NOISE_PATTERN.test(cleaned)) return false;
    if (SIMPLE_CHOICE_PATTERN.test(cleaned)) return false;
    return true;
  }

  function collectLabelFromNode(node, helpers, results) {
    if (!(node instanceof Element)) return;
    const text = helpers.cleanLabelText(helpers.cloneTextWithoutFields(node));
    if (isUsefulLabel(text, helpers)) results.push(text);
  }

  function collectAncestorLabelCandidates(element, helpers) {
    const results = [];
    let current = element;
    let depth = 0;

    while (current?.parentElement && depth < 8) {
      let previous = current.previousElementSibling;
      let guard = 0;
      while (previous && guard < 3) {
        collectLabelFromNode(previous, helpers, results);
        previous = previous.previousElementSibling;
        guard += 1;
      }

      const parent = current.parentElement;
      const parentSiblings = Array.from(parent.children)
        .filter(node => node !== current && !node.contains(current));
      for (const sibling of parentSiblings.slice(0, 4)) {
        collectLabelFromNode(sibling, helpers, results);
      }

      current = parent;
      depth += 1;
    }

    return helpers.uniqueTexts(results);
  }

  function extractSectionTitle(element, helpers) {
    let current = element;
    let depth = 0;

    while (current?.parentElement && depth < 10) {
      const parent = current.parentElement;
      const heading = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, .title, .section-title'))
        .map(node => helpers.cleanLabelText(helpers.cloneTextWithoutFields(node)))
        .find(text => SECTION_TITLE_PATTERN.test(text));
      if (heading) return heading;

      let previous = parent.previousElementSibling;
      let guard = 0;
      while (previous && guard < 3) {
        const text = helpers.cleanLabelText(helpers.cloneTextWithoutFields(previous));
        if (SECTION_TITLE_PATTERN.test(text)) return text;
        previous = previous.previousElementSibling;
        guard += 1;
      }

      current = parent;
      depth += 1;
    }

    const fieldRect = element.getBoundingClientRect();
    const spatialCandidates = Array.from(element.ownerDocument.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, .title, .section-title, span, div'))
      .filter(node => node instanceof Element && isVisible(node) && !node.contains(element))
      .map(node => {
        const text = helpers.cleanLabelText(helpers.cloneTextWithoutFields(node));
        if (!SECTION_TITLE_PATTERN.test(text)) return null;
        const rect = node.getBoundingClientRect();
        const verticalGap = fieldRect.top - rect.bottom;
        if (verticalGap < -12 || verticalGap > 240) return null;
        const horizontalGap = Math.abs(rect.left - fieldRect.left);
        if (horizontalGap > 180) return null;
        return { text, score: verticalGap + horizontalGap / 4 };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    if (spatialCandidates.length) return spatialCandidates[0].text;

    return '';
  }

  function collectSpatialLabelCandidates(element, helpers) {
    const containers = [];
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 4) {
      containers.push(current);
      current = current.parentElement;
      depth += 1;
    }

    const fieldRect = element.getBoundingClientRect();
    const results = [];
    for (const container of containers) {
      const nodes = Array.from(container.querySelectorAll('label, span, div, strong, p'))
        .filter(node => node instanceof Element && node !== element && !node.contains(element))
        .map(node => {
          const text = helpers.cleanLabelText(helpers.cloneTextWithoutFields(node));
          if (!isUsefulLabel(text, helpers)) return null;
          const rect = node.getBoundingClientRect();
          if (!rect.width && !rect.height) return null;

          const verticalGap = Math.abs(((rect.top + rect.bottom) / 2) - ((fieldRect.top + fieldRect.bottom) / 2));
          const leftGap = fieldRect.left - rect.right;
          const aboveGap = fieldRect.top - rect.bottom;
          const alignedLeft = leftGap >= -12 && leftGap <= 280 && verticalGap <= 40;
          const alignedAbove = aboveGap >= -12 && aboveGap <= 48 && Math.abs(rect.left - fieldRect.left) <= 120;
          if (!alignedLeft && !alignedAbove) return null;

          return {
            text,
            score: alignedLeft ? leftGap + verticalGap : 80 + aboveGap + Math.abs(rect.left - fieldRect.left),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score)
        .slice(0, 6);

      results.push(...nodes.map(node => node.text));
    }

    return helpers.uniqueTexts(results);
  }

  function isCustomSelectInput(element) {
    if (!(element instanceof HTMLInputElement)) return false;
    const listItem = element.closest('li');
    if (listItem?.parentElement?.tagName === 'UL') return true;
    if (element.readOnly && !element.placeholder) return true;
    return false;
  }

  function findChoiceRoot(element) {
    let current = element;
    let depth = 0;
    while (current?.parentElement && depth < 6) {
      const parent = current.parentElement;
      const text = normalizeText(parent.textContent || '');
      if (SIMPLE_CHOICE_PATTERN.test(text) || /(男.*女|是.*否)/.test(text)) {
        return parent;
      }
      current = parent;
      depth += 1;
    }
    return element.parentElement || element.ownerDocument;
  }

  function uniqueElements(nodes = []) {
    return [...new Set(nodes.filter(node => node instanceof Element || node instanceof Document))];
  }

  function collectSearchRoots(element, maxDepth = 5) {
    const roots = [];
    let current = element instanceof Element ? element : null;
    let depth = 0;
    while (current && depth < maxDepth) {
      roots.push(current);
      current = current.parentElement;
      depth += 1;
    }
    return uniqueElements(roots);
  }

  function resolvePopupRoot(trigger) {
    const doc = trigger?.ownerDocument || document;
    const popupId = trigger?.getAttribute?.('aria-controls') || trigger?.getAttribute?.('aria-owns') || '';
    if (!popupId) return null;
    const popup = doc.getElementById(popupId);
    return popup && isVisible(popup) ? popup : null;
  }

  function getVisibleDropdownRoots(doc = document) {
    return uniqueElements(Array.from(doc.querySelectorAll(DROPDOWN_ROOT_SELECTOR)).filter(isVisible));
  }

  function findOptionAcrossRoots(roots, selectors, patterns) {
    for (const root of uniqueElements(roots)) {
      const found = findElementByText(selectors, patterns, root);
      if (found) return found;
    }
    return null;
  }

  function isPhoenixSelectInput(element) {
    return element instanceof HTMLInputElement && element.classList.contains('phoenix-select__input');
  }

  function isPhoenixRadioRoot(element) {
    return element instanceof Element && Boolean(element.closest('.phoenix-radio-group, .phoenix-radio'));
  }

  function dispatchKey(element, key) {
    if (!element) return;
    const options = {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    element.dispatchEvent(new KeyboardEvent('keydown', options));
    element.dispatchEvent(new KeyboardEvent('keyup', options));
  }

  function getVisiblePhoenixLayer(doc = document) {
    const layers = Array.from(doc.querySelectorAll('.common-unmodeled-layer, .common-unmodeled-layer__layerContent'))
      .filter(node => node instanceof Element && isVisible(node));
    return layers.at(-1) || null;
  }

  function normalizeCompactText(value) {
    return normalizeText(value).replace(/\s+/g, '');
  }

  function matchesChoiceText(text, value) {
    const left = normalizeCompactText(text);
    const right = normalizeCompactText(value);
    return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
  }

  async function openPhoenixSelector(element) {
    const trigger = element.closest('.phoenix-select, .phoenix-unmodeled-layer__protect, .phoenix-unmodeled-layer') || element;
    trigger.click();
    element.focus?.();
    dispatchKey(element, 'ArrowDown');
    const doc = element.ownerDocument || document;
    for (let i = 0; i < 10; i += 1) {
      await sleep(120);
      const layer = getVisiblePhoenixLayer(doc);
      if (layer) return layer;
    }
    return null;
  }

  async function commitPhoenixSelector(layer) {
    const buttons = Array.from(layer?.querySelectorAll('.selector-footer-button .phoenix-button, .area-footer-button .phoenix-button') || []);
    const confirm = buttons.find(button => /确定/.test(normalizeText(button.textContent || ''))) || buttons.at(-1) || null;
    if (confirm) {
      confirm.click();
      await sleep(120);
      return true;
    }
    return false;
  }

  function getPhoenixSelectedText(element) {
    const inputValue = normalizeCompactText(element?.value || '');
    if (inputValue) return inputValue;

    const selectRoot = element?.closest?.('.phoenix-select, .phoenix-unmodeled-layer, .phoenix-unmodeled-layer__protect');
    const textNode = selectRoot?.querySelector?.('.phoenix-select__text, .phoenix-select__singleLabel, .phoenix-select__placeholder');
    return normalizeCompactText(textNode?.textContent || '');
  }

  function getPhoenixListItems(layer) {
    return Array.from(layer?.querySelectorAll(PHOENIX_LIST_ITEM_SELECTOR) || []);
  }

  async function setPhoenixMonthValue(element, value) {
    const [yearText, monthText] = String(value || '').split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return false;

    const doc = element.ownerDocument || document;
    let layer = getVisiblePhoenixLayer(doc);
    if (!layer) return false;

    let guard = 0;
    while (guard < 24) {
      layer = getVisiblePhoenixLayer(doc) || layer;
      const yearDisplay = layer.querySelector('.phoenix-calendar-month-panel-year-select-content');
      const currentYear = Number(normalizeText(yearDisplay?.textContent || '').replace(/[^\d]/g, ''));
      if (!Number.isFinite(currentYear)) break;
      if (currentYear === year) break;

      const buttonSelector = currentYear > year
        ? '.phoenix-calendar-month-panel-prev-year-btn, .phoenix-calendar-prev-year-btn'
        : '.phoenix-calendar-month-panel-next-year-btn, .phoenix-calendar-next-year-btn';
      const button = layer.querySelector(buttonSelector);
      if (!(button instanceof HTMLElement)) break;
      button.click();
      await sleep(120);
      guard += 1;
    }

    layer = getVisiblePhoenixLayer(doc) || layer;
    const monthCells = Array.from(layer.querySelectorAll('.phoenix-calendar-month-panel-cell'));
    const target = monthCells[month - 1];
    if (!(target instanceof HTMLElement)) return false;

    target.click();
    await sleep(200);
    return matchesChoiceText(getPhoenixSelectedText(element), value);
  }

  async function selectPhoenixOption(element, value) {
    const doc = element.ownerDocument || document;
    let layer = await openPhoenixSelector(element);
    if (!layer) return false;

    if (layer.querySelector('.phoenix-date-picker, .phoenix-calendar-input')) {
      return setPhoenixDateValue(element, value, {
        setInputValue(el, next) {
          el.focus?.();
          el.value = next;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
      }, layer);
    }

    let items = getPhoenixListItems(layer);
    for (let i = 0; !items.length && i < 10; i += 1) {
      await sleep(120);
      layer = getVisiblePhoenixLayer(doc) || layer;
      items = getPhoenixListItems(layer);
    }
    const target = items.find(item => matchesChoiceText(item.textContent || '', value));
    if (!target) return false;

    const icon = target.querySelector('.icon-container.visible, .icon-container') || target;
    icon.click();
    await sleep(150);

    const committed = await commitPhoenixSelector(getVisiblePhoenixLayer(doc) || layer);
    if (!committed && !target.matches('.phoenix-selectList__listItem')) {
      dispatchKey(element, 'Enter');
    }
    await sleep(250);

    const selectedText = getPhoenixSelectedText(element) || normalizeCompactText(target.textContent || '');
    return matchesChoiceText(selectedText, value);
  }

  async function setPhoenixDateValue(element, value, utils, initialLayer = null) {
    const doc = element.ownerDocument || document;
    const layer = initialLayer || await openPhoenixSelector(element);
    if (!layer) return false;

    if (layer.querySelector('.phoenix-calendar-month-panel')) {
      return setPhoenixMonthValue(element, value);
    }

    const calendarInput = layer.querySelector('input.phoenix-calendar-input');
    if (!(calendarInput instanceof HTMLInputElement)) return false;

    utils?.setInputValue?.(calendarInput, value);
    dispatchKey(calendarInput, 'Enter');
    await sleep(150);

    const nextValue = normalizeText(element.value || '');
    if (matchesChoiceText(nextValue, value)) return true;

    const fallbackLayer = getVisiblePhoenixLayer(doc);
    const committed = await commitPhoenixSelector(fallbackLayer || layer);
    if (!committed) {
      calendarInput.blur();
      await sleep(120);
    }
    return matchesChoiceText(element.value || '', value);
  }

  function extractChoiceOptions(element) {
    const roots = [];
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 5) {
      roots.push(current);
      current = current.parentElement;
      depth += 1;
    }

    for (const root of roots) {
      const options = [...new Set(
        Array.from(root.querySelectorAll('label, span, div'))
          .filter(isVisible)
          .map(node => normalizeText(node.textContent || ''))
          .filter(text => SIMPLE_CHOICE_PATTERN.test(text))
      )];
      if (options.length >= 2) {
        return options.map(text => ({ value: text, text }));
      }
    }

    return [];
  }

  function inferFieldType(element, field, labelCandidates, sectionLabel) {
    const combinedText = [
      field.label,
      field.placeholder,
      field.helperText,
      field.name,
    ].filter(Boolean).join(' ');

    if (field.type === 'text') {
      if (isCustomSelectInput(element)) return 'select';
      if (DATE_HINT_PATTERN.test(combinedText)) return 'date';
    }

    if (field.type === 'checkbox' && RADIO_HINT_PATTERN.test(combinedText)) {
      return 'radio';
    }

    return field.type;
  }

  function normalizeSectionKey(value) {
    const normalized = normalizeComparableText(value);
    if (!normalized) return '';
    if (normalized.includes('个人信息')) return 'personalinfo';
    if (normalized.includes('教育经历')) return 'educationexperience';
    if (normalized.includes('语言能力')) return 'languageability';
    if (normalized.includes('家庭情况')) return 'familysituation';
    if (normalized.includes('在校实践')) return 'campuspractice';
    if (normalized.includes('实习经历')) return 'internexperience';
    if (normalized.includes('附加信息')) return 'additionalinfo';
    return normalized;
  }

  function extractGridPosition(selector = '') {
    if (!selector.startsWith('#')) return null;
    const segments = selector.replace(/^#.+? > /, '').split(' > ');
    const rowSegment = segments.find(segment => /^div:nth-of-type\(\d+\)$/.test(segment));
    if (!rowSegment) return null;

    const rowIndex = segments.indexOf(rowSegment);
    const rowMatch = rowSegment.match(/\((\d+)\)/);
    if (!rowMatch) return null;

    const colSegment = segments[rowIndex + 1] || '';
    const colMatch = colSegment.match(/^div:nth-of-type\((\d+)\)$/);
    return {
      row: Number(rowMatch[1]),
      col: colMatch ? Number(colMatch[1]) : 1,
    };
  }

  function isAutoFillOverrideKey(key = '') {
    return AUTO_FILL_OVERRIDE_KEYS.has(key) || AUTO_FILL_OVERRIDE_PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function extractFieldOrdinal(fieldId = '') {
    const match = String(fieldId).match(/field_(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function resolveSectionKey(field) {
    const explicit = normalizeSectionKey(field.sectionLabel);
    if (explicit) return explicit;

    const ordinal = extractFieldOrdinal(field.id);
    if (ordinal == null) return '';
    const matched = SECTION_ORDINAL_RANGES.find(range => ordinal >= range.start && ordinal <= range.end);
    return matched?.section || '';
  }

  function resolveTemplateKey(field, helpers) {
    const sectionKey = resolveSectionKey(field);
    const template = SECTION_LAYOUT_TEMPLATES[sectionKey];
    if (!template) return null;

    const position = extractGridPosition(field.selector);
    if (!position) return null;

    const matched = template[`${position.row}-${position.col}`];
    if (!matched) return null;

    if (Array.isArray(matched)) {
      return helpers.claimGroupedKey(matched[0], matched[1]);
    }

    return matched;
  }

  class ChinaTaipingAdapter extends BaseSiteAdapter {
    constructor() {
      super({ id: 'china-taiping', name: '中国太平' });
    }

    matches(location, doc) {
      const hostname = location?.hostname || '';
      const pageText = `${doc?.title || ''} ${doc?.body?.innerText || ''}`;
      return /(?:^|\.)cntp\.zhiye\.com$/i.test(hostname)
        || /taiping|cntaiping|tplife/i.test(hostname)
        || /中国太平|太平人寿|太平保险/.test(pageText);
    }

    mapEnumValue(fieldKey, value, context = {}) {
      const normalizedKey = normalizeComparableText(fieldKey);
      const normalizedValue = normalizeComparableText(value);
      if (!normalizedKey || !normalizedValue) return null;

      const options = context.options || [];
      const findOption = patterns => {
        const match = options.find(option => patterns.some(pattern => pattern.test(getElementText({ textContent: `${option.text} ${option.value}` }))));
        return match ? match.value : null;
      };

      if (/political/.test(normalizedKey)) {
        if (/中共党员|共产党员|党员/.test(value)) return findOption([/党员/, /中共/]);
        if (/共青团员|团员/.test(value)) return findOption([/团员/]);
        if (/群众|无党派/.test(value)) return findOption([/群众/, /无党派/]);
      }

      if (/marital/.test(normalizedKey)) {
        if (/已婚/.test(value)) return findOption([/已婚/]);
        if (/未婚|单身/.test(value)) return findOption([/未婚/, /单身/]);
      }

      if (/freshgraduate|graduate/.test(normalizedKey)) {
        if (/应届/.test(value)) return findOption([/应届/]);
        if (/往届|非应届/.test(value)) return findOption([/往届/, /非应届/]);
      }

      if (/hasoverseasstudy|overseas/.test(normalizedKey)) {
        if (/是|有|已/.test(value)) return findOption([/是/, /有/]);
        if (/否|无|未/.test(value)) return findOption([/否/, /无/]);
      }

      if (/gender/.test(normalizedKey)) {
        if (/男/.test(value)) return findOption([/^男$/]);
        if (/女/.test(value)) return findOption([/^女$/]);
      }

      return null;
    }

    enrichFieldDescriptor({ element, field, helpers }) {
      const localContainer = element.closest('.el-form-item, .ant-form-item, .ivu-form-item, .layui-form-item, .form-row, .row, li, td, tr, div');
      const localLabels = localContainer
        ? Array.from(localContainer.querySelectorAll('.el-form-item__label, .ant-form-item-label, .ivu-form-item-label, .layui-form-label, label, span, div'))
          .filter(node =>
            node instanceof Element &&
            node !== element &&
            !node.contains(element)
          )
          .map(node => helpers.cleanLabelText(helpers.cloneTextWithoutFields(node)))
          .filter(text => isUsefulLabel(text, helpers))
        : [];

      const ancestorLabels = collectAncestorLabelCandidates(element, helpers);
      const spatialLabels = collectSpatialLabelCandidates(element, helpers);
      const labelCandidates = helpers.uniqueTexts([...(field.labelCandidates || []), ...localLabels, ...ancestorLabels, ...spatialLabels]);
      const sectionLabel = field.sectionLabel || extractSectionTitle(element, helpers);
      const inferredType = inferFieldType(element, field, labelCandidates, sectionLabel);
      const patch = { labelCandidates };

      if ((!field.label || LABEL_NOISE_PATTERN.test(field.label)) && labelCandidates.length) {
        patch.label = labelCandidates[0];
      }

      if (!field.sectionLabel && sectionLabel) {
        patch.sectionLabel = sectionLabel;
      }

      if (inferredType !== field.type) {
        patch.type = inferredType;
      }

      if (inferredType === 'radio' && !(field.options || []).length) {
        const options = extractChoiceOptions(element);
        if (options.length) patch.options = options;
      }

      return patch;
    }

    matchField({ field, profile, helpers }) {
      return null;

      const combinedText = [
        field.label,
        ...(field.labelCandidates || []),
        field.placeholder,
        field.helperText,
        field.sectionLabel,
        field.contextText,
        field.containerText,
        field.name,
      ].filter(Boolean).join(' ');
      const directText = [
        field.label,
        field.placeholder,
        field.helperText,
        field.name,
      ].filter(Boolean).join(' ');
      const hasExplicitLabel = [
        field.label,
        ...(field.labelCandidates || []),
      ].some(text => {
        const normalized = normalizeText(text);
        return normalized && !LABEL_NOISE_PATTERN.test(normalized) && !SIMPLE_CHOICE_PATTERN.test(normalized);
      });

      const buildMatch = key => ({
        matched: true,
        key,
        value: helpers.getProfileValue(profile, key),
        isFile: false,
        manualOnly: !isAutoFillOverrideKey(key) && helpers.isSensitiveField(field, key),
      });

      if (FAMILY_SECTION_PATTERN.test(combinedText) && directText) {
        for (const rule of TAIPING_SECTION_RULES.familyMembers) {
          if (rule.pattern.test(directText)) {
            return buildMatch(helpers.claimGroupedKey('familyMembers', rule.subkey));
          }
        }
      }

      if (LANGUAGE_SECTION_PATTERN.test(combinedText) && directText) {
        for (const rule of TAIPING_SECTION_RULES.languages) {
          if (rule.pattern.test(directText)) {
            return buildMatch(helpers.claimGroupedKey('languages', rule.subkey));
          }
        }
      }

      if (/在校实践|校内实践/.test(combinedText) && directText) {
        if (/实践名称/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('projects', 'name'));
        }
        if (/实践描述/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('projects', 'description'));
        }
      }

      if (/实习经历|工作经历|实习经验/.test(combinedText) && directText) {
        if (/单位名称/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('experience', 'company'));
        }
        if (/职位名称/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('experience', 'title'));
        }
        if (/实习内容/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('experience', 'description'));
        }
      }

      if (/教育经历|教育背景|学习经历/.test(combinedText) && directText) {
        if (/学校名称/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('education', 'school'));
        }
        if (/学校所在国家/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('education', 'schoolCountry'));
        }
        if (/专业名称/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('education', 'major'));
        }
        if (/学历取得方式/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('education', 'studyMode'));
        }
        if (/学位/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('education', 'educationLevel'));
        }
        if (/学历/.test(directText)) {
          return buildMatch(helpers.claimGroupedKey('education', 'degree'));
        }
      }

      if (hasExplicitLabel && !/(证件照|上传文件|上传照片)/.test(directText)) {
        return null;
      }

      if (field.type === 'file' || /(证件照|上传文件|上传照片|证件照片)/.test(directText)) {
        return buildMatch('personal.photo');
      }

      if (hasExplicitLabel) {
        return null;
      }

      const templateKey = resolveTemplateKey(field, helpers);
      if (templateKey) {
        return buildMatch(templateKey);
      }

      return null;
    }

    async ensureRepeatItem(sectionKey, index) {
      const sectionKeywords = SECTION_KEYWORDS[sectionKey] || [];
      const sectionRoot = getSectionRoot(sectionKeywords) || document.body || document;
      const result = await this.ensureRepeatItemGeneric({
        sectionKey,
        index,
        keywords: sectionKeywords,
        buttonPatterns: SECTION_ADD_PATTERNS[sectionKey] || [],
        countRoot: sectionRoot,
      });
      await sleep(200);
      return result;
    }

    findAddButton(sectionKey, sectionRoot) {
      const patterns = SECTION_ADD_PATTERNS[sectionKey] || [];
      const local = getClickableElements(sectionRoot).find(element => {
        if (!isVisible(element)) return false;
        const text = getElementText(element);
        return patterns.some(pattern => pattern.test(text));
      });
      if (local) return local;

      return findElementByText('button, a, [role="button"], .btn, .button, span, div', patterns, sectionRoot);
    }

    async setSelectValue({ element, value, utils }) {
      const text = String(value || '').trim();
      if (!text) return null;

      if (isPhoenixSelectInput(element)) {
        const ok = await selectPhoenixOption(element, text);
        return ok;
      }

      const doc = element?.ownerDocument || document;
      const trigger = element.closest('[role="combobox"], li, .select, .dropdown') || element;
      trigger.click();

      if (typeof utils?.setInputValue === 'function' && trigger instanceof HTMLInputElement) {
        try {
          utils.setInputValue(trigger, text);
        } catch (_) {}
      }

      const exactPattern = new RegExp(`^${escapeRegExp(text)}$`);
      const fuzzyPattern = new RegExp(escapeRegExp(text));
      const option = findOptionAcrossRoots(
        [
          resolvePopupRoot(trigger),
          ...getVisibleDropdownRoots(doc),
          ...collectSearchRoots(trigger, 4),
        ],
        DROPDOWN_OPTION_SELECTOR,
        [exactPattern, fuzzyPattern]
      );

      if (!option) return null;
      option.click();
      return true;
    }

    async setDateValue({ element, value, utils }) {
      if (isPhoenixSelectInput(element)) {
        return await setPhoenixDateValue(element, value, utils);
      }

      try {
        utils.setInputValue(element, value);
        return true;
      } catch (_) {
        return null;
      }
    }

    async setRadioValue({ element, value }) {
      const text = String(value || '').trim();
      if (!text) return null;

      if (isPhoenixRadioRoot(element)) {
        const radioRoot = element.closest('.phoenix-radio-group') || findChoiceRoot(element);
        const radios = Array.from(radioRoot.querySelectorAll('.phoenix-radio'));
        const target = radios.find(radio => matchesChoiceText(radio.textContent || '', text));
        if (!target) return false;
        target.click();
        await sleep(80);
        return target.classList.contains('phoenix-radio--checked');
      }

      const radioRoot = findChoiceRoot(element);
      const exactPattern = new RegExp(`^${escapeRegExp(text)}$`);
      const fuzzyPattern = new RegExp(escapeRegExp(text));
      const option = findOptionAcrossRoots(
        [radioRoot, ...collectSearchRoots(element, 4)],
        RADIO_OPTION_SELECTOR,
        [exactPattern, fuzzyPattern]
      );

      if (!option) return null;
      option.click();
      return true;
    }

    getDiagnosticsHints(context = {}) {
      const hints = [];
      if ((context.profile?.education?.length || 0) > 1 && !context.repeatSupport?.education) {
        hints.push('中国太平教育经历区块未识别到稳定的新增入口');
      }
      if ((context.profile?.projects?.length || 0) > 1 && !context.repeatSupport?.projects) {
        hints.push('中国太平在校实践区块未识别到稳定的新增入口');
      }
      if ((context.profile?.experience?.length || 0) > 1 && !context.repeatSupport?.experience) {
        hints.push('中国太平实习经历区块未识别到稳定的新增入口');
      }
      if ((context.profile?.languages?.length || 0) > 1 && !context.repeatSupport?.languages) {
        hints.push('中国太平语言能力区块未识别到稳定的新增入口');
      }
      if ((context.profile?.familyMembers?.length || 0) > 1 && !context.repeatSupport?.familyMembers) {
        hints.push('中国太平家庭成员区块未识别到稳定的新增入口');
      }
      return hints;
    }
  }

  window.__jobpilotRegisterSiteAdapter(new ChinaTaipingAdapter());
})();
