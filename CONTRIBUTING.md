# Contributing

Contributions are welcome through focused issues and pull requests.

## Development

The project requires Node.js 22 or later and pnpm 11.

```bash
pnpm install
pnpm run check
```

`pnpm run check` verifies formatting, readability constraints, TypeScript types, behavioral tests, the tsdown package build, and the demo production build.

Use `pnpm demo` to run the Pi/OpenRouter validation lab locally. Provider credentials must remain in browser storage or local environment variables and must never be committed.

## Pull requests

- Keep changes scoped to one observable behavior or architectural concern.
- Add behavior-oriented regression tests when changing public contracts.
- Update the README when public APIs, lifecycle semantics, or adapter requirements change.
- Preserve the append-only prefix and token-attribution invariants unless the proposal explicitly revises them.
- Run `pnpm run check` before requesting review.

By contributing, you agree that your contribution is licensed under the MIT License.
