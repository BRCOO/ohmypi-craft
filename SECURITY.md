# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Use GitHub's private vulnerability reporting flow for this repository:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include the affected version, reproduction steps, impact, and any suggested fix.

If private vulnerability reporting is unavailable, open a minimal issue asking the maintainers to enable a private channel. Do not include exploit details or credentials in that issue.

## Scope

This policy covers the Oh My Pi Desktop application, its server and CLI packages, release workflows, and bundled runtime integrations.

Third-party dependencies should be reported to their respective maintainers.

## Supported versions

Only the latest published release receives security fixes. Keep the application updated and verify downloaded packages against the SHA256SUMS.txt file attached to each release.

## Security best practices

- Never commit `.env` files, API keys, tokens, certificates, or credential stores.
- Prefer the operating system credential store for provider credentials.
- Review permission prompts before allowing filesystem, network, or shell actions.
- Do not paste secrets into public issues, logs, screenshots, or release artifacts.
