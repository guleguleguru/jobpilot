# Privacy Policy

## Summary

JobPilot is a local-first Chrome extension for filling job application forms. The extension does not include a backend service and does not transmit user data to any self-hosted server operated by the project.

User data is stored in the browser and only sent to third-party AI providers when the user explicitly enables AI features and configures an API key.

## What Data Is Stored

JobPilot stores the following data in `chrome.storage.local`:

- User profile data entered in the side panel
- Multiple resume/profile templates
- AI provider settings
- API keys entered by the user
- Uploaded resume file data
- Fill history metadata

Fill history stores page URL and aggregate counts such as filled fields and failed fields. It does not store the full content written into every field.

## What Data Is Sent Over the Network

JobPilot does not send data to a project-owned server.

When AI-assisted features are enabled, the extension may send the following data directly to the AI provider selected by the user:

- A sanitized subset of the user profile
- Unmatched form field metadata such as labels, placeholders, field names, and options
- Resume text extracted from a PDF when the user invokes AI resume parsing

The exact destination depends on the provider configured by the user, such as DeepSeek, Google Gemini, Qwen, Zhipu, Moonshot, Anthropic, or a locally running Ollama instance.

## Permissions

JobPilot currently requests these permissions:

- `storage`
- `activeTab`
- `scripting`
- `sidePanel`
- `host_permissions: <all_urls>`

`<all_urls>` is required because the extension is designed to detect and fill job application forms across many different recruiting websites and ATS systems instead of a fixed allowlist.

## User Control

Users can control their data in these ways:

- Edit or remove stored profile data from the extension UI
- Replace or remove API keys from settings
- Clear fill history
- Disable AI-assisted filling
- Remove the extension to delete local extension storage

## Limitations

When AI features are enabled, data handling by the selected AI provider is governed by that provider's own terms and privacy policy. Users should review those policies before use.

## Contact

If this project is published publicly, replace this section with the maintainer's preferred contact method.
