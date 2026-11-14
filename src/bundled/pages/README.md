# Pages

Create live Markdown documents with people and agents. Pages is bundled with Buzz
and can be disabled in Settings → Plugins.

## Getting started

Open Pages from the dock to create a document or find a page you can access.
Edits save automatically after a pause; Page actions → Revision history lets you
turn auto-save off and use Save instead. Browsing within Pages retains unsaved
drafts for the connected session. Unsaved work is not a synced or permanent backup.

Share page controls membership and general access. New pages are private. View only
lets community members read, while editors can change content. Links grant no
access. Sharing includes retained revisions, and the relay operator can read the
content; Pages is not end-to-end encrypted.

Page actions also provides Markdown source, export, retained revisions and
recoverable deletion. Restore creates a new current revision while retaining history.
Conflicting saves preserve your draft and require reconciliation with the latest page.

Page links open beside the conversation. Back and Forward restore the document;
explicitly closing its tab retires that visit. A standalone link opens Pages.

Agents use `page_help`, `page_get`, `page_set`, `page_history`, `page_delete` and
`page_share`. They verify a save, return its Page reference and update that same
address on follow-ups. Creating a page does not post a message or change sharing.
Tools must be available on the device running the agent. Canvas and the separate
Shared notes reader use different content and tools; Pages does not migrate them.

Saving requires a community that advertises NIP-AR page-record support. Signing,
access checks and revision confirmation remain with the host and relay. A link
from another community requires connecting there with suitable access.
