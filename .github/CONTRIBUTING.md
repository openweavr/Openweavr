# Contributing to Openweavr

First off, thank you for considering contributing to Openweavr! 🧵

## 🤖 AI-Assisted PRs Welcome

We explicitly encourage AI-assisted contributions. Whether you use Claude, GPT, Copilot, or any other AI tool to help write code, documentation, or tests—that's great! Just make sure you:

1. Review the generated code before submitting
2. Test that it works as expected
3. Understand what the code does (you'll need to answer questions in review)

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/Openweavr.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b my-feature`

## Development

```bash
# Run CLI in development mode
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Code Style

- We use TypeScript with strict mode
- ESM modules only (no CommonJS)
- Prefer functional patterns where appropriate
- Keep functions small and focused

## Commit Messages

We follow conventional commits:

```
feat: add GitHub webhook trigger
fix: resolve workflow parsing edge case
docs: update plugin development guide
test: add executor retry tests
```

## Pull Request Process

1. Update the README.md if you're adding new features
2. Add tests for new functionality
3. Ensure all tests pass
4. Update types and documentation
5. Request review from maintainers

## Good First Issues

Look for issues labeled `good first issue` — these are designed to be approachable for new contributors.

## Plugin Development

Want to create a new integration? Check out our [Plugin Development Guide](../docs/plugins.md).

## Questions?

Open a discussion or reach out on Discord!

---

Thank you for helping make Openweavr better! 🙏
