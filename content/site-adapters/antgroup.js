(function registerAntGroupAdapter() {
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
    sleep,
  } = base;

  const SECTION_KEYWORDS = {
    education: ['教育经历', '教育背景'],
    experience: ['实习经历', '工作经历'],
    projects: ['项目经历', '在校实践', '校园实践'],
    awards: ['大赛经历', '荣誉'],
    additional: ['其他信息'],
  };

  const SECTION_TABS = {
    education: [/教育经历/, /教育背景/],
    experience: [/实习经历/, /工作经历/],
    projects: [/项目经历/, /在校实践/, /校园实践/],
    awards: [/大赛经历/, /荣誉/],
    additional: [/其他信息/],
  };

  const SECTION_ADD_PATTERNS = {
    education: [/(添加|新增).{0,4}(教育|学历|学校)/],
    experience: [/(添加|新增).{0,4}(实习|工作|经历)/],
    projects: [/(添加|新增).{0,4}(项目|实践)/],
  };

  const DIRECT_FIELD_MAP = {
    basic_name: 'personal.fullName',
    basic_nationality: 'personal.nationality',
    basic_mobile: 'contact.phone',
    basic_email: 'contact.email',
    basic_familyCity: 'personal.nativePlace',
    basic_schoolCity: 'residency.currentCity',
    basic_competitionsExp: 'competitions[0].description',
    basic_reward: 'awards[0].name',
    basic_proficientDevelopmentLanguages: 'developerLanguages[0].name',
    basic_otherInformation: 'selfIntro',
  };

  const PREFIX_RULES = [
    { pattern: /^editForm_educations_(\d+)_topDegree$/, key: index => `education[${index}].degree` },
    { pattern: /^editForm_educations_(\d+)_school$/, key: index => `education[${index}].school` },
    { pattern: /^editForm_educations_(\d+)_academy$/, key: index => `education[${index}].campusPositions` },
    { pattern: /^editForm_educations_(\d+)_major$/, key: index => `education[${index}].major` },
    { pattern: /^editForm_educations_(\d+)_professionalRanking$/, key: index => `education[${index}].ranking` },
    { pattern: /^editForm_educations_(\d+)_gpaTotalScore$/, key: index => `education[${index}].customFields.gpaTotalScore` },
    { pattern: /^editForm_educations_(\d+)_gpaScore$/, key: index => `education[${index}].gpa` },
    { pattern: /^editForm_educations_(\d+)_tutor$/, key: index => `education[${index}].customFields.tutor` },
    { pattern: /^editForm_educations_(\d+)_laboratory$/, key: index => `education[${index}].customFields.laboratory` },
    { pattern: /^editForm_educations_(\d+)_researchField$/, key: index => `education[${index}].customFields.researchField` },
    { pattern: /^editForm_educations_(\d+)_hasNationalScholarship$/, key: index => `education[${index}].scholarships` },

    { pattern: /^editForm_(?:internships|experiences)_(\d+)_company$/, key: index => `experience[${index}].company` },
    { pattern: /^editForm_(?:internships|experiences)_(\d+)_department$/, key: index => `experience[${index}].department` },
    { pattern: /^editForm_(?:internships|experiences)_(\d+)_title$/, key: index => `experience[${index}].title` },
    { pattern: /^editForm_(?:internships|experiences)_(\d+)_startTime$/, key: index => `experience[${index}].startDate` },
    { pattern: /^editForm_(?:internships|experiences)_(\d+)_endTime$/, key: index => `experience[${index}].endDate` },
    { pattern: /^editForm_(?:internships|experiences)_(\d+)_description$/, key: index => `experience[${index}].description` },

    { pattern: /^editForm_(?:projects|practices)_(\d+)_name$/, key: index => `projects[${index}].name` },
    { pattern: /^editForm_(?:projects|practices)_(\d+)_role$/, key: index => `projects[${index}].role` },
    { pattern: /^editForm_(?:projects|practices)_(\d+)_startTime$/, key: index => `projects[${index}].startDate` },
    { pattern: /^editForm_(?:projects|practices)_(\d+)_endTime$/, key: index => `projects[${index}].endDate` },
    { pattern: /^editForm_(?:projects|practices)_(\d+)_description$/, key: index => `projects[${index}].description` },
    { pattern: /^editForm_(?:projects|practices)_(\d+)_tech(?:Stack|nology)?$/, key: index => `projects[${index}].techStack` },
  ];

  function buildMatch(profile, helpers, field, key) {
    return {
      matched: true,
      key,
      value: helpers.getProfileValue(profile, key),
      isFile: false,
      manualOnly: helpers.isSensitiveField(field, key),
    };
  }

  function getFieldIdentity(field = {}) {
    return String(field.name || field.id || field.selector || '').trim();
  }

  function buildCombinedText(field = {}) {
    return [
      field.label,
      ...(field.labelCandidates || []),
      field.placeholder,
      field.helperText,
      field.sectionLabel,
      field.contextText,
      field.containerText,
      field.name,
    ].filter(Boolean).join(' ');
  }

  function findSectionTrigger(patterns = []) {
    const clickables = getClickableElements(document);
    return clickables.find(element => {
      if (!isVisible(element)) return false;
      const text = getElementText(element);
      return patterns.some(pattern => pattern.test(text));
    }) || findElementByText('button, a, [role="button"], .btn, .button, span, div', patterns, document);
  }

  async function activateSection(sectionKey) {
    const patterns = SECTION_TABS[sectionKey] || [];
    if (!patterns.length) return false;

    const currentSection = getSectionRoot(SECTION_KEYWORDS[sectionKey] || []);
    if (currentSection) return false;

    const trigger = findSectionTrigger(patterns);
    if (!trigger) return false;
    trigger.click();
    await sleep(250);
    return true;
  }

  class AntGroupAdapter extends BaseSiteAdapter {
    constructor() {
      super({ id: 'antgroup-talent', name: '蚂蚁集团招聘' });
    }

    matches(location, doc) {
      const hostname = location?.hostname || '';
      const pageText = `${doc?.title || ''} ${doc?.body?.innerText || ''}`;
      return /(?:^|\.)talent\.antgroup\.com$/i.test(hostname) || /蚂蚁集团/.test(pageText);
    }

    matchField({ field, profile, helpers }) {
      const identity = getFieldIdentity(field);
      const combinedText = buildCombinedText(field);

      if (/开始时间/.test(combinedText) && /学历|学校全称|专业|教育/.test(combinedText)) {
        return buildMatch(profile, helpers, field, 'education[0].startDate');
      }
      if (/结束时间|毕业时间/.test(combinedText) && /学历|学校全称|专业|教育/.test(combinedText)) {
        return buildMatch(profile, helpers, field, 'education[0].endDate');
      }

      if (!identity) return null;

      if (DIRECT_FIELD_MAP[identity]) {
        return buildMatch(profile, helpers, field, DIRECT_FIELD_MAP[identity]);
      }

      for (const rule of PREFIX_RULES) {
        const match = identity.match(rule.pattern);
        if (!match) continue;
        return buildMatch(profile, helpers, field, rule.key(Number(match[1])));
      }

      return null;
    }

    async ensureRepeatItem(sectionKey, index) {
      if (!['education', 'experience', 'projects', 'awards'].includes(sectionKey)) {
        return { created: false, reason: 'unsupported' };
      }

      await activateSection(sectionKey);
      const sectionRoot = getSectionRoot(SECTION_KEYWORDS[sectionKey]) || document.body || document;
      const result = await this.ensureRepeatItemGeneric({
        sectionKey,
        index,
        keywords: SECTION_KEYWORDS[sectionKey] || [],
        buttonPatterns: SECTION_ADD_PATTERNS[sectionKey] || [],
        countRoot: sectionRoot,
      });
      await sleep(200);
      return result;
    }

    getDiagnosticsHints(context = {}) {
      const hints = [];
      if ((context.profile?.experience?.length || 0) > 0 && !context.repeatSupport?.experience) {
        hints.push('蚂蚁站点未稳定识别到“实习经历”新增入口');
      }
      if ((context.profile?.projects?.length || 0) > 0 && !context.repeatSupport?.projects) {
        hints.push('蚂蚁站点未稳定识别到“项目经历”新增入口');
      }
      return hints;
    }
  }

  window.__jobpilotRegisterSiteAdapter(new AntGroupAdapter());
})();
