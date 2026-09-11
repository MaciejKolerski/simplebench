# Releases

SimpleBench follows Simple Voice's distribution targets: GitHub Releases for
macOS Apple Silicon and Intel, Windows x64, and Linux x86_64; then AUR packages
`simplebench` and `simplebench-bin`. Flathub is a separate, opt-in integration
after an initial submission has been accepted. Simple Voice's Flathub repository
did not exist when this workflow was prepared on 2026-09-11.

## Release workflow

`.github/workflows/release.yml` runs for a stable `vX.Y.Z` tag. It can also be
started manually with an existing tag to retry an unpublished release.

1. Validate the tag against `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and the app entry in `src-tauri/Cargo.lock`. Require
   matching project licenses in the package manifests and a root `LICENSE`.
2. Require the Apple signing, notarization, and AUR secrets before building.
3. Run formatting, frontend build, model tests, and the Playwright interface
   suite with mocked native commands.
4. Create a draft GitHub release, or reuse the draft for this tag. A published
   release cannot be overwritten by rerunning the workflow.
5. Run native formatting, Clippy, and Rust tests on each build runner. Produce
   signed and notarized macOS apps and DMGs, Windows NSIS and MSI installers,
   and Linux AppImage, DEB, and RPM packages.
6. Verify both macOS apps with `codesign`, `stapler`, and Gatekeeper. Keep the
   release in draft if any build or signature check fails.
7. Verify all nine downloads, upload `SHA256SUMS`, and publish the release.
8. Publish AUR packages, using checksums of the published assets and tagged
   source. This step can be retried independently through **Publish AUR**.

The macOS runners explicitly select Xcode 26.3 for the Icon Composer source.
The Linux runner uses Ubuntu 22.04 for the same base compatibility as Simple
Voice. Windows installers are not Authenticode-signed. SimpleBench has no
in-app updater, so this workflow does not create `latest.json` or require an
unrelated Tauri updater key. macOS app archives are still published as downloads.

## Apple Developer configuration

Use a **Developer ID Application** certificate for direct distribution. The
workflow uses the [Tauri macOS signing and notarization flow](https://v2.tauri.app/distribute/sign/macos/):
the action imports the certificate into a temporary runner keychain, and Tauri
signs with the Hardened Runtime, submits to Apple, waits, and staples the ticket.
No App Store sandbox or microphone entitlements are needed for SimpleBench.

Configure these repository Actions secrets:

| Secret                       | Value                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64-encoded `.p12` containing the Developer ID certificate and its private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting that `.p12` export                                            |
| `APPLE_SIGNING_IDENTITY`     | Full `Developer ID Application: ...` identity                                     |
| `APPLE_ID`                   | Apple account used for notarization                                               |
| `APPLE_PASSWORD`             | An Apple app-specific password, not the normal account password                   |
| `APPLE_TEAM_ID`              | Apple Developer team identifier                                                   |
| `AUR_SSH_PRIVATE_KEY`        | Unencrypted dedicated SSH private key registered with the AUR maintainer account  |

Repository secrets are configured at
[SimpleBench Actions secrets](https://github.com/MaciejKolerski/simplebench/settings/secrets/actions).
The corresponding secrets in Simple Voice are not automatically available to
SimpleBench. Keep their values out of source files, commits, and logs.

For a local signed and notarized build, make the same Apple account variables
available in the shell and install the Developer ID identity in Keychain Access,
then run `pnpm tauri build --bundles app,dmg -- --locked`. A locally installed
identity does not require `APPLE_CERTIFICATE` or its export password. Omitting
the notarization credentials can produce a signed app without notarization;
the release workflow rejects that situation before publication.

## Publish a version

Before the first release, the owner must choose the project license. Add the
selected license text to `LICENSE` and its SPDX identifier to `package.json`
and `src-tauri/Cargo.toml`. The workflow refuses publication until these agree;
the AUR recipes receive that same license during package preparation.

1. Update the four app version entries together and add user-facing notes in
   `releases/vX.Y.Z.md`. Without that notes file, GitHub generates release notes.
2. Run `pnpm release:check vX.Y.Z` and the checks appropriate to the changes.
3. Commit and push the release source to `main`.
4. Create and push the tag:

   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Follow the **Release** workflow. Its draft stays unpublished until every
   platform is ready. Download and smoke-test the installers on the supported
   systems; CI builds and mocked UI tests do not establish native behavior on
   every operating system.

For a failed build, fix the problem in source. Use a new version for a published
release. For an unpublished draft, retry failed jobs when the failure was only
an external service or credential issue. Never move a tag already used by a
published release. The very first Apple notarization can take considerably
longer than later submissions; the workflow deliberately waits for acceptance.

If GitHub publication succeeded but AUR failed, run **Publish AUR** with the
same tag. It only accepts the latest stable release, avoiding an accidental
package downgrade. The `SKIP` checksums in the upstream PKGBUILD templates are
replaced before anything is sent to AUR; published package recipes contain the
real SHA-256 values. Arch's standard package hooks maintain desktop and icon
caches without custom install scripts.

## Flathub

Flathub is not an automatic first-release destination: its
[initial submission process](https://docs.flathub.org/docs/for-app-authors/submission/)
requires a Flatpak manifest, upstream application metadata, a tested sandbox,
and review. A terminal application must also design and verify host-shell and
project-folder access before claiming Flatpak support.

After a dedicated `flathub/io.github.MaciejKolerski.simplebench` repository and
its maintenance workflow exist, configure `FLATHUB_TOKEN` with access to that
repository and set the upstream variable `FLATHUB_ENABLED=true`. Successful
releases then dispatch `simplebench-release` with `client_payload.tag`, matching
the handoff used by Simple Voice. Leave the variable unset until the receiving
workflow is ready; this hook alone does not publish an application on Flathub.
