# Changelog

## v1.2.3

### Improved

- Redesigned the top toolbar: **Add workspace** and **Favorite** are now direct, visible actions, while secondary controls are grouped in a compact “More” menu.
- Refreshed the default light and dark palettes, menus, focus states and responsive toolbar layout for a more consistent, modern reading interface.
- Recent-file entries now show just the file name; hover to view the normalized full path, or right-click / press `Shift+F10` to copy it.
- The release workflow now publishes the Windows portable executable alongside installers and includes it in `SHA256SUMS.txt` automatically.

### Fixed

- Normalize Windows extended-length paths such as `\\?\D:\...` before displaying or copying them from recent-file actions.

### Release note

- Windows v1.2.3 packages are intentionally unsigned because no signing certificate has been supplied. Verify every download with the attached `SHA256SUMS.txt`.

## v1.2.2

### Fixed

- Reclaim standalone-document authorization, resource scope and watcher state when a document is replaced or fails to open.
- Preserve valid nested-workspace resource scopes when a parent workspace is removed.
- Keep a newly requested document active when the remote-image preference changes during loading.
- Make workspace search cancellable and ignore stale scan results.
- Correct file-tree nesting classes, long-name truncation and selected-file synchronization.
- Render the outline once, keep it vertically scrollable, and present it as a keyboard-accessible drawer on narrow windows.

### Changed

- Supported local Markdown extensions are now consistently limited to `.md` and `.markdown`.
- The release workflow publishes a draft only after each platform build succeeds, then publishes it after SBOM and SHA-256 provenance generation succeeds.

### Release note

- Windows v1.2.2 packages are intentionally unsigned because no signing certificate has been supplied. Verify downloads with the attached `SHA256SUMS.txt`.
