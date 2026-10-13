# Public-repository activation checklist

The preparation files are local proposals. They do not change GitHub visibility,
permissions, releases, billing or credentials. As inspected during preparation,
`superb43/direct_pump` was PRIVATE with ADMIN access; the ruleset/protection API
returned HTTP 403 requiring GitHub Pro or public visibility. Private vulnerability
reporting was unavailable through its API. Those responses do not prove that all
remote security settings are disabled.

## Local readiness

- [ ] Review commercial GPL-3.0-only licensing and the third-party/source notices.
- [ ] Review private-data scans and publication paths. Revoke any discovered real
  credential; history rewrite or deletion needs a separate decision.
- [ ] Review source files, images and existing private issues, PRs, discussions,
  wiki, workflow logs/artifacts and other metadata before changing visibility.
  A Git source scan does not inspect those external surfaces.
- [ ] Commit only reviewed, named files and preserve intentional internal-doc
  removals. Verify a fresh clone with Node.js 24, npm ci and the documented checks.
- [ ] Review security/community contact routes and supported-version policy.
- [ ] Review the locally prepared preview artifacts; they are not official releases.

## GitHub activation — explicit approval required

1. Obtain approval for the particular source commit/push and for making this
   repository public. Public copies/forks can persist after a later visibility
   change. Do not treat local preparation as authorization to publish.
2. Apply the reviewed settings proposal in `.github/publication-settings.json`
   only once the repository is eligible. It contains no visibility-change field
   and requests no paid private-security entitlement.
3. GitHub enables **Private vulnerability reporting** for public repositories.
   Enable it immediately after the visibility change and before inviting
   participation. Confirm the security advisory reporting form is
   available; the presence of SECURITY.md alone does not activate it.
4. Let the new CI workflows run. Confirm the actual GitHub Actions check names and
   GitHub Actions app ID before applying `.github/publication-ruleset.json`.
   The proposed required contexts are `verify` and `Secret scan`; CodeQL runs only
   on a public repository and should be confirmed separately.
5. The maintainer operates this repository alone. The proposed ruleset requires
   a PR, successful strict CI checks and resolved conversations, with no bypass
   actors. It blocks force pushes and branch deletion. Mandatory reviewer count
   is zero; code-owner and last-push approvals are disabled because an author
   cannot approve their own PR. CODEOWNERS still routes sensitive changes to the
   maintainer. This configuration does not provide an independent human approval
   gate. Keep evidence of independent review for security-sensitive changes;
   do not describe self-review as independent. When a trusted second reviewer is
   approved and has write access, add them to all protected CODEOWNERS entries and
   explicitly enable the one-approval, owner-review and last-push requirements.
6. Confirm ruleset enforcement, blocked force/deletion pushes, Dependabot, private
   reporting, secret scanning/push protection and public CodeQL results. Prefer
   hosted ephemeral CI; never add the personal signer host as a public PR runner.

Prepared API payloads can be applied by an authorized maintainer with `gh api`
after the above review. They are intentionally not executed by any repo script
or CI workflow. No release, store upload, deployment or live alert is part of
repository activation; those each need their own authorized delivery step.

Use [release policy](RELEASING.md) for versioned binaries and matching source.

GitHub documents the public-repository requirement for this reporting channel in
[private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting).
