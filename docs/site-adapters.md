# Site Adapters

JobPilot keeps the existing detector / matcher / filler pipeline and inserts a thin site-adapter layer for site-specific DOM behavior.

## Files

- `content/site-adapters/base-adapter.js`
- `content/site-adapters/index.js`
- `content/site-adapters/china-taiping.js`

## Adapter contract

An adapter can override these hooks:

- `matches(location, document)`
- `beforeFill(context)`
- `afterFill(context)`
- `ensureRepeatItem(sectionKey, index, context)`
- `setSelectValue({ element, field, value, context, utils })`
- `setDateValue({ element, field, value, context, utils })`
- `setRadioValue({ element, field, value, context, utils })`
- `mapEnumValue(fieldKey, value, context)`
- `getDiagnosticsHints(context)`

## Current repeatable sections

The generic filler currently asks adapters to extend page-side DOM for:

- `languages`
- `familyMembers`

Rules:

- creation is bounded by adapter safety limits
- every add action is followed by re-detect + re-match
- if creation stalls, the fill report records the expected count, existing count, created count, and warning reason

## China Taiping

`china-taiping.js` is the first real adapter. It currently targets:

- site detection for China Taiping recruiting pages
- custom select / date / radio heuristics
- repeat-item creation for language ability and family member sections
- common Chinese enum value mapping such as `是/否`, `有/无`, `应届/往届`, `已婚/未婚`, `中共党员/共青团员/群众`

Limitations:

- selectors are heuristic, not site-source verified
- when add buttons or custom widgets are not reliably recognized, the adapter reports warnings instead of claiming success
- unsupported cases should stay isolated in adapter TODOs instead of leaking site-specific logic into the generic filler
