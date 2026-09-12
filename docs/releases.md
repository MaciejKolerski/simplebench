# Releases

SimpleBench follows Simple Voice's distribution targets: GitHub Releases for
macOS Apple Silicon and Intel, Windows x64, and Linux x86_64; then AUR packages
`simplebench` and `simplebench-bin`. Flathub is a separate, opt-in integration
after an initial submission has been accepted. Simple Voice's Flathub repository
did not exist when this workflow was prepared on 2026-09-11.

## Release workflow

`.github/workflows/release.yml` is named **publish** and follows Simple Voice's
tag-triggered `publish-tauri` matrix:

1. Start four parallel jobs on `macos-latest` (Apple Silicon), `macos-15-intel`,
   `ubuntu-22.04`, and `windows-latest`.
2. Install pnpm from `package.json`, Node LTS, Rust stable, and the platform's
   build dependencies. Validate the tag, app versions, and Apache-2.0 metadata.
3. Install frontend dependencies with the frozen lockfile and run
   `tauri-apps/tauri-action@v0` through `pnpm tauri`, using the locked Rust
   dependencies. Tauri's frontend build includes TypeScript checking.
4. Sign and notarize the macOS apps using the Apple secrets. Build the native
   installers for each platform and upload them directly to the published
   `vX.Y.Z` GitHub release.
5. After all four builds succeed, publish `simplebench` and `simplebench-bin`
   to AUR. Retry temporary AUR failures up to three times; the **publish AUR**
   workflow can also be started independently for an existing release.
6. Notify Flathub only when `FLATHUB_TOKEN` is configured.

As in Simple Voice, the release becomes visible as platforms finish uploading;
it can be incomplete while other builds are running. This workflow does not
run Playwright, model tests, Clippy, or Rust tests. Run the relevant checks before
tagging, as described in the [development guide](../README.md#validation-and-builds).

SimpleBench selects Xcode 26.3 to compile its Icon Composer source and uses its
own pnpm version. It does not need Simple Voice's audio, Vulkan, or ONNX build
dependencies. Windows installers are not Authenticode-signed. SimpleBench has
no in-app updater, so it does not create `latest.json` or require a Tauri updater
key. macOS app archives are still published as downloads.

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
configure all listed Apple secrets before starting a release.

## Publish a version

SimpleBench uses Apache-2.0, with the license text in [`LICENSE`](../LICENSE)
and its SPDX identifier in `package.json` and `src-tauri/Cargo.toml`. The workflow
requires matching license identifiers and the license file before publication.
Both AUR recipes declare the same license.

1. Update the four app version entries together and prepare optional user-facing
   notes in `releases/vX.Y.Z.md`.
2. Run `pnpm release:check vX.Y.Z` and the checks appropriate to the changes.
3. Commit and push the release source to `main`.
4. Create and push the tag:

   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. Follow the **publish** workflow. Wait for all four platforms and AUR jobs to
   finish. Download and smoke-test the installers on the supported systems;
   successful CI builds do not establish native behavior on every operating
   system.
6. To replace the default release description with the prepared notes, run:

   ```sh
   gh release edit vX.Y.Z --notes-file releases/vX.Y.Z.md
   ```

Retry failed jobs when the failure was an external service or credential issue.
For a source change after publication, use a new version. Never move a tag already
used by a published release. The first Apple notarization can take considerably
longer than later submissions; Tauri waits for Apple's response.

If GitHub publication succeeded but AUR failed, run **publish AUR** with the
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
repository. Successful releases then dispatch `simplebench-release` with
`client_payload.tag` and `client_payload.commit`, matching Simple Voice. Leave
the token unset until the receiving workflow is ready; this hook alone does not
publish an application on Flathub.
