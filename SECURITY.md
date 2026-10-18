# Security Policy

## Reporting a Security Vulnerability

If you discover a security vulnerability in 4evergent, please report it responsibly.

**Do NOT open a public issue for security vulnerabilities.**

Instead, use one of these channels:

1. **GitHub Private Vulnerability Reporting** (preferred — if enabled on this repository)
   - Go to the repository Security tab → "Report a vulnerability"
   - This creates a private advisory visible only to maintainers

2. **GitHub Security Advisory draft** — if private reporting is not available,
   open a draft security advisory on the repository, or contact the maintainer,
   @naninu123, directly on GitHub

### What to include

- Description of the vulnerability
- Steps to reproduce (minimal test case if possible)
- Potential impact assessment
- Suggested fix (if any)

### What NOT to include

- Private keys, seeds, or mnemonics (the project never handles these in issues)
- Production credentials
- Exploit code that could be used against live systems

### Response

- You will receive an acknowledgment within 48 hours
- The maintainer will assess impact and coordinate a fix if needed
- You will be credited in the advisory (unless you request anonymity)

## Security Model

See [docs/security-model.md](docs/security-model.md) for the full security architecture, threat model, and known limitations.
