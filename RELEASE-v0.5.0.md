# JobPilot v0.5.0

This release moves JobPilot from the first public baseline to a more practical day-to-day build for Chinese recruiting flows.

## Highlights

- Added a site-adapter layer for site-specific DOM behavior
- Expanded structured profile fields for Chinese recruiting scenarios
- Improved semantic field matching with more page context
- Added fill diagnostics and repeat-section reporting
- Extended PDF parsing coverage for richer resume imports

## Release Scope

- New site adapter files under `content/site-adapters/`
- New shared modules for enum mapping, profile normalization, and fill reports
- Side panel and popup updates for structured profile editing
- Test coverage expanded to 12 local Node-based tests

## Notes

- This is still intended for unpacked local Chrome extension usage
- Cross-origin iframes remain restricted by browser security boundaries
- AI quality still depends on page semantics and profile completeness

## Suggested GitHub Release Title

`v0.5.0 - Site adapters and structured profile upgrade`
