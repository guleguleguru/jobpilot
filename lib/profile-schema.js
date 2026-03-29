const DEFAULT_PROFILE = {
  personal: {
    fullName: '',
    fullNamePinyin: '',
    englishName: '',
    firstName: '',
    lastName: '',
    gender: '',
    birthDate: '',
    age: null,
    nationality: '',
    ethnicity: '',
    nativePlace: '',
    politicalStatus: '',
    partyJoinDate: '',
    maritalStatus: '',
    healthStatus: '',
    bloodType: '',
    heightCm: null,
    weightKg: null,
    freshGraduateStatus: '',
    hasOverseasStudy: null,
    photo: '',
  },
  identity: {
    documentType: '',
    documentNumber: '',
  },
  contact: {
    phone: '',
    email: '',
    landline: '',
    address: '',
    postalCode: '',
    wechat: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  },
  residency: {
    currentCity: '',
    currentAddress: '',
    homeAddress: '',
    householdType: '',
    householdAddress: '',
    policeStation: '',
  },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  links: {
    github: '',
    linkedin: '',
    website: '',
  },
  certificates: [],
  awards: [],
  languages: [],
  familyMembers: [],
  jobPreferences: {
    expectedLocations: [],
    expectedPositions: [],
    expectedSalary: '',
    availableFrom: '',
    internshipDuration: '',
    jobStatus: '',
  },
  compliance: {
    manualOnlyFields: [],
    lastReviewAt: '',
  },
  customFields: {},
  meta: {
    schemaVersion: 2,
  },
  graduationYear: '',
  selfIntro: '',
};

const ARRAY_DEFAULTS = {
  education: {
    school: '',
    schoolCountry: '',
    degree: '',
    educationLevel: '',
    major: '',
    startDate: '',
    endDate: '',
    studyMode: '',
    gpa: '',
    ranking: '',
    scholarships: '',
    campusPositions: '',
    campusPractice: '',
  },
  experience: {
    company: '',
    department: '',
    title: '',
    startDate: '',
    endDate: '',
    location: '',
    description: '',
    achievements: '',
  },
  projects: {
    name: '',
    role: '',
    startDate: '',
    endDate: '',
    description: '',
    techStack: '',
  },
  languages: {
    language: '',
    proficiency: '',
    listeningSpeaking: '',
    readingWriting: '',
  },
  familyMembers: {
    relation: '',
    name: '',
    birthDate: '',
    politicalStatus: '',
    identityType: '',
    employer: '',
    jobTitle: '',
    status: '',
    location: '',
  },
  certificates: {
    name: '',
    issuer: '',
    issueDate: '',
    credentialId: '',
  },
  awards: {
    name: '',
    issuer: '',
    year: '',
    description: '',
  },
};

const FIELD_SOURCE_STRATEGIES = {
  'personal.fullName': 'resume_extractable',
  'personal.fullNamePinyin': 'resume_extractable',
  'personal.englishName': 'resume_extractable',
  'personal.firstName': 'resume_extractable',
  'personal.lastName': 'resume_extractable',
  'personal.gender': 'resume_extractable',
  'personal.birthDate': 'resume_extractable',
  'personal.age': 'ai_inferable_low_confidence',
  'personal.nationality': 'manual_only',
  'personal.ethnicity': 'manual_only',
  'personal.nativePlace': 'resume_extractable',
  'personal.politicalStatus': 'manual_only',
  'personal.partyJoinDate': 'manual_only',
  'personal.maritalStatus': 'manual_only',
  'personal.healthStatus': 'manual_only',
  'personal.bloodType': 'manual_only',
  'personal.heightCm': 'manual_only',
  'personal.weightKg': 'manual_only',
  'personal.freshGraduateStatus': 'manual_only',
  'personal.hasOverseasStudy': 'manual_only',
  'personal.photo': 'site_specific',
  'identity.documentType': 'manual_only',
  'identity.documentNumber': 'manual_only',
  'contact.phone': 'resume_extractable',
  'contact.email': 'resume_extractable',
  'contact.landline': 'manual_only',
  'contact.address': 'resume_extractable',
  'contact.postalCode': 'manual_only',
  'contact.wechat': 'manual_only',
  'contact.emergencyContactName': 'manual_only',
  'contact.emergencyContactPhone': 'manual_only',
  'residency.currentCity': 'resume_extractable',
  'residency.currentAddress': 'manual_only',
  'residency.homeAddress': 'manual_only',
  'residency.householdType': 'manual_only',
  'residency.householdAddress': 'manual_only',
  'residency.policeStation': 'manual_only',
  'jobPreferences.expectedLocations': 'manual_only',
  'jobPreferences.expectedPositions': 'manual_only',
  'jobPreferences.expectedSalary': 'manual_only',
  'jobPreferences.availableFrom': 'manual_only',
  'jobPreferences.internshipDuration': 'manual_only',
  'jobPreferences.jobStatus': 'manual_only',
};

const SENSITIVE_FIELD_PATHS = new Set(
  Object.entries(FIELD_SOURCE_STRATEGIES)
    .filter(([, strategy]) => strategy === 'manual_only')
    .map(([path]) => path)
);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function getByPath(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function setByPath(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = nextIsIndex ? [] : {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function mergeDefined(target, source) {
  if (!isPlainObject(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      target[key] = value.map(item => (isPlainObject(item) ? mergeDefined({}, item) : item));
      continue;
    }
    if (isPlainObject(value)) {
      const next = isPlainObject(target[key]) ? target[key] : {};
      target[key] = mergeDefined(next, value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，、/]/).map(item => item.trim()).filter(Boolean);
  return [];
}

function normalizeArrayEntries(entries, template) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => mergeDefined(deepClone(template), isPlainObject(entry) ? entry : {}))
    .filter(entry => Object.values(entry).some(value => value !== '' && value != null));
}

function migrateLegacyProfile(profile = {}) {
  const next = createEmptyProfile();

  if (isPlainObject(profile.personal) || isPlainObject(profile.identity) || isPlainObject(profile.contact)) {
    mergeDefined(next, profile);
  }

  setByPath(next, 'personal.fullName', getByPath(next, 'personal.fullName') || profile.name || '');
  setByPath(next, 'personal.firstName', getByPath(next, 'personal.firstName') || profile.firstName || '');
  setByPath(next, 'personal.lastName', getByPath(next, 'personal.lastName') || profile.lastName || '');
  setByPath(next, 'personal.gender', getByPath(next, 'personal.gender') || profile.gender || '');
  setByPath(next, 'personal.birthDate', getByPath(next, 'personal.birthDate') || profile.birthday || '');
  setByPath(next, 'personal.ethnicity', getByPath(next, 'personal.ethnicity') || profile.ethnicity || '');
  setByPath(next, 'personal.nativePlace', getByPath(next, 'personal.nativePlace') || profile.hometown || '');
  setByPath(next, 'personal.politicalStatus', getByPath(next, 'personal.politicalStatus') || profile.politicalStatus || '');

  setByPath(next, 'identity.documentType', getByPath(next, 'identity.documentType') || profile.documentType || '');
  setByPath(next, 'identity.documentNumber', getByPath(next, 'identity.documentNumber') || profile.idNumber || '');

  setByPath(next, 'contact.phone', getByPath(next, 'contact.phone') || profile.phone || '');
  setByPath(next, 'contact.email', getByPath(next, 'contact.email') || profile.email || '');
  setByPath(next, 'contact.address', getByPath(next, 'contact.address') || profile.address || '');
  setByPath(next, 'contact.wechat', getByPath(next, 'contact.wechat') || profile.wechat || '');

  setByPath(next, 'residency.currentAddress', getByPath(next, 'residency.currentAddress') || profile.address || '');
  setByPath(next, 'jobPreferences.expectedSalary', getByPath(next, 'jobPreferences.expectedSalary') || profile.jobPreferences?.expectedSalary || '');
  setByPath(next, 'jobPreferences.availableFrom', getByPath(next, 'jobPreferences.availableFrom') || profile.jobPreferences?.availableFrom || '');
  setByPath(next, 'jobPreferences.internshipDuration', getByPath(next, 'jobPreferences.internshipDuration') || profile.jobPreferences?.internshipDuration || '');
  if (!next.jobPreferences.expectedLocations.length) {
    next.jobPreferences.expectedLocations = normalizeStringList(profile.jobPreferences?.expectedCity);
  }

  next.education = normalizeArrayEntries(
    Array.isArray(profile.education) ? profile.education : (profile.education ? [profile.education] : []),
    ARRAY_DEFAULTS.education
  ).map(entry => ({
    ...entry,
    educationLevel: entry.educationLevel || entry.degree || '',
  }));
  next.experience = normalizeArrayEntries(profile.experience, ARRAY_DEFAULTS.experience);
  next.projects = normalizeArrayEntries(profile.projects, ARRAY_DEFAULTS.projects).map(entry => ({
    ...entry,
    techStack: Array.isArray(entry.techStack) ? entry.techStack.join(', ') : (entry.techStack || ''),
  }));
  next.awards = normalizeArrayEntries(profile.awards, ARRAY_DEFAULTS.awards);
  next.certificates = normalizeArrayEntries(profile.certificates, ARRAY_DEFAULTS.certificates);
  next.languages = normalizeArrayEntries(profile.languages, ARRAY_DEFAULTS.languages).map(entry => ({
    ...entry,
    language: entry.language || entry.name || '',
    proficiency: entry.proficiency || entry.level || '',
  }));
  next.familyMembers = normalizeArrayEntries(profile.familyMembers, ARRAY_DEFAULTS.familyMembers);
  next.skills = normalizeStringList(profile.skills);

  next.customFields = isPlainObject(profile.customFields) ? profile.customFields : {};
  next.links = mergeDefined(deepClone(DEFAULT_PROFILE.links), isPlainObject(profile.links) ? profile.links : {});
  next.graduationYear = profile.graduationYear || '';
  next.selfIntro = profile.selfIntro || '';
  next.meta.schemaVersion = 2;

  if (Array.isArray(next.jobPreferences.expectedLocations)) {
    next.jobPreferences.expectedLocations = next.jobPreferences.expectedLocations.filter(Boolean);
  } else {
    next.jobPreferences.expectedLocations = [];
  }
  if (Array.isArray(next.jobPreferences.expectedPositions)) {
    next.jobPreferences.expectedPositions = next.jobPreferences.expectedPositions.filter(Boolean);
  } else {
    next.jobPreferences.expectedPositions = normalizeStringList(profile.jobPreferences?.expectedPosition);
  }

  return next;
}

function addLegacyAliases(profile) {
  profile.name = profile.personal.fullName;
  profile.firstName = profile.personal.firstName;
  profile.lastName = profile.personal.lastName;
  profile.gender = profile.personal.gender;
  profile.birthday = profile.personal.birthDate;
  profile.ethnicity = profile.personal.ethnicity;
  profile.hometown = profile.personal.nativePlace;
  profile.politicalStatus = profile.personal.politicalStatus;
  profile.documentType = profile.identity.documentType;
  profile.idNumber = profile.identity.documentNumber;
  profile.phone = profile.contact.phone;
  profile.email = profile.contact.email;
  profile.address = profile.contact.address;
  profile.wechat = profile.contact.wechat;
  profile.jobPreferences.expectedCity = profile.jobPreferences.expectedLocations.join(', ');
  profile.skills = [...profile.skills];
  profile.links = profile.links || { github: '', linkedin: '', website: '' };
  return profile;
}

function normalizeProfile(profile = {}) {
  return addLegacyAliases(migrateLegacyProfile(profile));
}

function createEmptyProfile() {
  return deepClone(DEFAULT_PROFILE);
}

function getFieldSourceStrategy(path = '') {
  const normalized = path.replace(/\[\d+\]/g, '[]');
  return FIELD_SOURCE_STRATEGIES[path] || FIELD_SOURCE_STRATEGIES[normalized] || 'resume_extractable';
}

function isSensitiveFieldPath(path = '') {
  const normalized = path.replace(/\[\d+\]/g, '[]');
  return SENSITIVE_FIELD_PATHS.has(path) || SENSITIVE_FIELD_PATHS.has(normalized);
}

export {
  ARRAY_DEFAULTS,
  DEFAULT_PROFILE,
  FIELD_SOURCE_STRATEGIES,
  SENSITIVE_FIELD_PATHS,
  addLegacyAliases,
  createEmptyProfile,
  getByPath,
  getFieldSourceStrategy,
  isSensitiveFieldPath,
  mergeDefined,
  normalizeProfile,
  setByPath,
};
