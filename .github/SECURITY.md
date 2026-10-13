# Security policy

## Supported versions

Before the first tagged release, security reports are accepted for the current
`main` commit on a best-effort basis. Include the affected commit SHA. Once tagged
releases are published, the latest tagged release is the security-maintenance
target; fixes for older versions are at maintainer discretion. Development code
and previews are not a production-safety or long-term-support commitment.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting form](https://github.com/superb43/direct_pump/security/advisories/new),
or select **Security → Advisories → Report a vulnerability**.
Do not report exploit details, credentials or wallet records in public issues,
pull requests, discussions or the public feedback channel. If the private form
is unavailable, wait for a confirmed private reporting channel.

Include the affected version or commit, Basic/Pro mode, platform/site, expected
and actual behavior, potential impact, and reproduction steps or a minimal proof
of concept using synthetic data and unfunded test identities. Remove private
keys, seed phrases, API keys, pairing codes, authentication tokens, wallet
databases and unrelated personal data.

The maintainer aims to acknowledge reports within seven days, subject to
availability. Follow-up, remediation and coordinated disclosure depend on severity
and a verified fix; no guaranteed deadline, service SLA or paid bounty is offered.
Coordinate public disclosure with the maintainer through the private report.

## Safe research and additional guidance

Test only environments and identities you own or are authorized to assess. Do
not trade or sign with funded accounts, move other users' assets, bypass wallet
approval, send live alerts, or delete recovery journals or uncertainty locks.

See the [project security guidance](../Docs/PROJECT.md#security),
[known dependency findings](../Docs/PROJECT.md#known-dependency-findings--2026-10-13),
and [Pro recovery procedure](../Docs/PROJECT.md#orders-and-recovery). Security
fixes require independent review and relevant regression evidence before release.
