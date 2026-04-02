function dedupeObjects(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function createFillReport(seed = {}) {
  return {
    hostname: seed.hostname || '',
    pageTitle: seed.pageTitle || '',
    adapterUsed: seed.adapterUsed || 'generic',
    detectedCount: seed.detectedCount || 0,
    filledCount: 0,
    skippedCount: 0,
    errorCount: 0,
    skippedSensitive: [...(seed.skippedSensitive || [])],
    missingRequiredFields: [...(seed.missingRequiredFields || [])],
    unmappedFields: [...(seed.unmappedFields || [])],
    unmappedValues: [...(seed.unmappedValues || [])],
    adapterDiagnostics: {
      triggerAttempts: [...(seed.adapterDiagnostics?.triggerAttempts || [])],
    },
    repeatSections: [...(seed.repeatSections || [])],
    warnings: [...(seed.warnings || [])],
    timestamp: seed.timestamp || new Date().toISOString(),
  };
}

function mergeDiagnosticsIntoReport(report, diagnostics = {}) {
  report.missingRequiredFields.push(...(diagnostics.missingRequiredFields || []));
  report.unmappedFields.push(...(diagnostics.unmappedFields || []));
  report.skippedSensitive.push(...(diagnostics.sensitiveFieldsSkipped || []));
  report.unmappedValues.push(...(diagnostics.unmappedValues || []));
  return report;
}

function recordFieldOutcome(report, outcome = {}) {
  if (outcome.status === 'filled') report.filledCount += 1;
  else if (outcome.status === 'skipped') report.skippedCount += 1;
  else if (outcome.status === 'error') report.errorCount += 1;
  return report;
}

function upsertRepeatSection(report, sectionRecord) {
  const existing = report.repeatSections.find(item => item.section === sectionRecord.section);
  if (!existing) {
    report.repeatSections.push({
      section: sectionRecord.section,
      expected: sectionRecord.expected || 0,
      existing: sectionRecord.existing || 0,
      created: sectionRecord.created || 0,
      filled: sectionRecord.filled || 0,
      warnings: [...(sectionRecord.warnings || [])],
    });
    return report;
  }

  existing.expected = Math.max(existing.expected, sectionRecord.expected || 0);
  existing.existing = Math.max(existing.existing, sectionRecord.existing || 0);
  existing.created += sectionRecord.created || 0;
  existing.filled = Math.max(existing.filled, sectionRecord.filled || 0);
  existing.warnings.push(...(sectionRecord.warnings || []));
  return report;
}

function finalizeFillReport(report) {
  report.skippedSensitive = dedupeObjects(report.skippedSensitive);
  report.missingRequiredFields = dedupeObjects(report.missingRequiredFields);
  report.unmappedFields = dedupeObjects(report.unmappedFields);
  report.unmappedValues = dedupeObjects(report.unmappedValues);
  report.adapterDiagnostics = {
    triggerAttempts: dedupeObjects(report.adapterDiagnostics?.triggerAttempts || []),
  };
  report.warnings = [...new Set(report.warnings.filter(Boolean))];
  report.repeatSections = report.repeatSections.map(section => ({
    ...section,
    warnings: [...new Set((section.warnings || []).filter(Boolean))],
  }));
  return report;
}

function mergeFillReports(reports = [], seed = {}) {
  const merged = createFillReport(seed);
  for (const report of reports.filter(Boolean)) {
    merged.hostname ||= report.hostname || '';
    merged.pageTitle ||= report.pageTitle || '';
    if (merged.adapterUsed === 'generic' && report.adapterUsed) merged.adapterUsed = report.adapterUsed;
    merged.detectedCount += report.detectedCount || 0;
    merged.filledCount += report.filledCount || 0;
    merged.skippedCount += report.skippedCount || 0;
    merged.errorCount += report.errorCount || 0;
    merged.skippedSensitive.push(...(report.skippedSensitive || []));
    merged.missingRequiredFields.push(...(report.missingRequiredFields || []));
    merged.unmappedFields.push(...(report.unmappedFields || []));
    merged.unmappedValues.push(...(report.unmappedValues || []));
    merged.adapterDiagnostics.triggerAttempts.push(...(report.adapterDiagnostics?.triggerAttempts || []));
    merged.warnings.push(...(report.warnings || []));
    for (const section of report.repeatSections || []) upsertRepeatSection(merged, section);
  }
  return finalizeFillReport(merged);
}

function summarizeFillReport(report) {
  return {
    adapterUsed: report?.adapterUsed || 'generic',
    missingCount: report?.missingRequiredFields?.length || 0,
    unmappedFieldCount: report?.unmappedFields?.length || 0,
    unmappedValueCount: report?.unmappedValues?.length || 0,
    sensitiveCount: report?.skippedSensitive?.length || 0,
    triggerAttemptCount: report?.adapterDiagnostics?.triggerAttempts?.length || 0,
    warningCount: report?.warnings?.length || 0,
    repeatSectionCount: report?.repeatSections?.length || 0,
  };
}

export {
  createFillReport,
  finalizeFillReport,
  mergeDiagnosticsIntoReport,
  mergeFillReports,
  recordFieldOutcome,
  summarizeFillReport,
  upsertRepeatSection,
};
