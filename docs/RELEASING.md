# Release and support policy

The latest tagged release is the supported security target. `main` is development
code, and preview packages are review artifacts. No trading return, custody,
execution price, SLA or independent security audit is implied.

The maintenance and delivery procedure below incorporates official guidance
checked on **2026-10-13**. GitHub settings described as proposals are not enabled
by these files; verify the actual repository configuration before relying on them.

## Before opening the repository

1. Review `LICENSE`, `COPYRIGHT`, the dependency inventory and third-party notices.
   Keep GPL/LGPL source obligations and all upstream notices with distributed
   artifacts. Some publishers ship only SPDX declarations/README notices; those
   entries are explicitly identified in `licenses/upstream-evidence.json` and
   require maintainer review, not an invented copyright grant.
2. The unused locked `chain` dependency has no reviewed license grant. It is not
   included in the application graph and must not be redistributed wholesale.
   Any future import must resolve its license before a release can pass.
3. Review vendored IDL and asset provenance in `src/vendor/NOTICE.md`, font/icon
   license files and the third-party notices. Names/logos do not imply endorsement.
4. Scan all reachable Git history and the candidate source tree with redacted
   secret output. Check runtime/key/database/browser files and attachments. A
   scanner cannot prove the absence of every credential or proprietary key format.
   Revoke exposed credentials before considering an approved history rewrite.
5. Commit the reviewed source and preparation files with named staging. Preserve
   intentional removals of internal docs; do not add ignored local state.
6. Apply the proposed GitHub settings in [publication checklist](PUBLICATION.md)
   only after approval. Enable private vulnerability reporting immediately after
   public visibility becomes available and before inviting participation.
   Confirm all required checks are available on the actual repository plan.

## Build review artifacts locally

Use Node.js 24 LTS, `npm ci`, then:

```sh
npm run check:publication
npm run prepare:release -- --preview
```

The preview command checks publication inputs/notices, runs `npm run verify` and
builds extension/server archives, accompanying source and SHA-256 checksums in
ignored `output/releases/`. Preview names and metadata identify the uncommitted
working tree; never label them as an official release.

The source package includes project source, lockfile, build instructions, and
dependency source/notices for the conservative distribution closure. This
includes WXT's injected runtime even when its npm package is marked development,
and the production closure to retain modules prebundled inside upstream SDKs.
Versioned upstream source-map modules must match reviewed lock/source coverage.
Verify that
the preferred source for every GPL/LGPL component is complete, including any
needed build scripts. Keep equivalent source access beside binary downloads for
as long as required; a source link to an unrelated branch is insufficient.

GPL/LGPL upstream repositories are included as full pinned source archives,
verified against `licenses/preferred-sources.json`. Raydium's 0.2.73-alpha source
was matched against all 129 distributed TypeScript source files; rpc-websockets
uses its published version/gitHead. A dependency update must review and update
this evidence rather than silently package a different upstream revision.

## Official release

- Review a clean committed tree, version change, changelog and relevant recovery
  regressions. Check actual supported-site/browser behavior separately; live
  network tests stay opt-in and no funded signing/trading is a release test.
- Create a version tag matching `package.json` through the authorized maintainer
  workflow. Run the manual **Release build** workflow for that existing tag, or
  `npm run prepare:release` from the clean exact-tag checkout.
- The workflow only uploads build artifacts for review. It does not publish a
  GitHub Release, change visibility, deploy Pro or upload to a browser store.
- Inspect archives and checksums, licenses/source pairing, build metadata and
  limitations. Run a clean-source rebuild before publication. Publish only with
  explicit approval, retaining the matching source archive and notices.
- Release notes identify the commit, version, changes, supported environments,
  known provider limits, security fixes and skipped checks. Do not include real
  wallet balances, keys, pairing data or private diagnostics.

Maintainers may decline features outside the three supported sites or protected
financial architecture. Dependabot/security updates are reviewed rather than
automatically merged; SDK and financial changes need regression evidence.

Release version changes update both package.json and package-lock.json version
fields. Extension/server operational diagnostics use the shared build-time
application version; publication gates reject version drift before packaging.

## Routine maintenance and dependency decisions

Triage ordinary issues and PRs weekly; handle vulnerability reports privately
under SECURITY.md. Keep one concrete change per PR, with compatibility notes,
regression evidence and actual skipped checks. Follow CONTRIBUTING.md and the
existing site, wallet, target-binding and recovery boundaries.

Review dependency updates in bounded batches, keeping the manifest and lockfile
together. Inspect changed install/build scripts and licensing before installation.
At release time and after dependency changes, collect both reports:

```sh
npm audit --json
npm audit --omit=dev --json
```

An audit exit code can reflect inherited findings; it is not permission to ignore
them or proof of app exploitability. New Critical findings, reachable High findings
and unresolved signing/key-authority exposure block release. Accepted exceptions
record advisory, affected build/runtime path, mitigation, reviewer, review date
and re-review trigger in the release review. Keep residual findings visible in
release notes; do not use forced fixes or broad allowlists to hide them.
[npm audit guidance](https://docs.npmjs.com/cli/v11/commands/npm-audit/).

## Version and release sequence

1. Prepare a scoped candidate PR: code, tests, numeric version, lockfile root entry,
   user-visible release notes and required notice/source updates. Before 1.0, this
   project's convention is PATCH for compatible fixes and MINOR for features or
   compatibility changes. Explicitly disclose breaking changes; 0.x is not a
   stability promise. After 1.0, apply normal SemVer.
2. Merge only after the configured checks and resolved conversations. Solo
   operation requires PR/CI gates with zero mandatory approving reviewers.
   Security-sensitive changes still require recorded independent review; the
   platform settings alone do not prove that review occurred. Check actual CI
   context names; do not label self-review as independent or bypass the ruleset.
3. Resolve the reviewed public commit SHA, create its annotated `vX.Y.Z` tag within
   release authorization, and build from a clean exact-tag checkout. `npm ci`
   installs the locked tree; a dirty preview is never an official candidate.
4. Run the existing build/publication gates and affected browser checks. Verify
   package, lockfile, manifest and application version displays agree. API v1/v2
   paths and persisted schema versions are separate contracts. Chrome's manifest
   stays numeric; mark candidates through GitHub's prerelease flag.
5. Inspect the final extension/server/source archives, paired licenses and source,
   `*-SHA256SUMS` and `*-PREPARATION.json`. Confirm version, commit, clean-tree state,
   toolchain and archive contents. Do not zip the whole working directory or
   redistribute node_modules wholesale. Rebuild the accompanying source in isolation.
6. Create a GitHub draft release for the existing verified tag and attach all assets
   before publication. Review changes, fixes, client/server and data compatibility,
   update steps, verification, skipped checks and dependency exceptions. Publish
   only within existing task-specific authorization; do not ask again when that
   authorization already covers the step. Passing CI alone does not grant it.
7. Keep published tags and assets unchanged; enable GitHub immutable releases when
   approved and available. Corrections use a new version. Keep matching source
   accessible while distributing binaries. Initial history/visibility migration,
   browser-store submission, npm publication and funded Pro deployment remain
   separate delivery decisions. Keep package.json private; no store channel is
   implied by WXT's packaging capability.

[SemVer](https://semver.org/spec/v2.0.0.html),
[Chrome version fields](https://developer.chrome.com/docs/extensions/reference/manifest/version),
[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/),
[GitHub draft and immutable releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
For covered binaries, check the required Corresponding Source rather than assuming
any source ZIP is sufficient; see [GNU distribution guidance](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites).

## CI trust and artifact provenance

Ordinary PR verification uses read-only credentials and GitHub-hosted runners.
Never execute fork code with privileged tokens, publish/deploy secrets or access
to a signer host. Review workflow changes as code. Keep Actions pinned to verified
upstream full SHAs with readable version comments until supported dependency
lockfiles are explicitly adopted. Expand permissions only in trusted jobs that
need them; the current Release build workflow is artifact-only.
[GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

If a future workflow generates artifact attestations, verify them against this
repository/workflow before publishing. Checksums detect changed bytes but do not
establish provenance or software safety. Attestation and immutable-release settings
must be verified, never inferred from documentation. No attestation workflow is
claimed to exist today.
[GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

## Pro upgrades, incidents and rollback

Server maintenance requires deployment authorization. Obtain acknowledged pause
of new orders, lock the signer on its private console, and stop the API/signer
gracefully before replacing code or taking a consistent full-state backup. Keep
encrypted wallet backups/passphrases separate. Preserve signing/authentication
journals and SQLite recovery files; confirm no live signer before touching a
process lock. Signed/UNKNOWN attempts retain reservations and recorded bytes.

Install the reviewed artifact only after checking its digest and compatibility.
Retain OS-user/socket separation, HTTPS and wallet identity. Start locked,
reconcile existing attempts, and explicitly unlock/resume only when authorized
by the operator. Individually paused orders still require their own resume.

On incidents, privately triage and rotate exposed credentials with the owner.
Never erase journals, restore old financial snapshots over newer attempts or send
compensating trades. Roll back code only after checking schema/API compatibility;
do not silently downgrade data. Fix extensions with a higher numeric version and
reload the existing installation rather than uninstalling its receipts/settings.
Preserve matching source and mark bad releases clearly instead of overwriting them.
Follow [Pro recovery](PRO.md#orders-and-recovery) and [private security reporting](../SECURITY.md).
