# Coding Style Guide

This guide defines the class/member layout used across the project so every contributor (human or LLM) can keep the codebase consistent and easy to read.

## Class Member Ordering

Group class members in the following order. Within each group sort by access level: `private` → `protected` → `public`.

1. **Fields (readonly)** – immutable state declared with `readonly`.
2. **Fields** – mutable fields.
3. **Properties (getters only)**.
4. **Properties with setters** – getter/setter pairs.
5. **Constructors**.
6. **Methods** – regular functions (again `private`, `protected`, `public`).

Additional rules:

- Prefix all private fields and methods with `_` (e.g., `_cache`, `_buildRequest`).
- Prefer `protected` for members intended for subclasses, otherwise keep them `private` or `public`.
- Avoid interleaving unrelated helper functions; keep the order strict even when a method depends on another declared later.
- Use whitespace between groups to keep sections visually distinct.

## Clean Code Expectations

- Keep methods small and single-purpose. Extract helpers rather than nesting complex logic.
- Use descriptive names; avoid abbreviations unless they are domain-specific and already established.
- Log through the shared `log` helper. Never swallow errors silently.
- Adhere to existing TypeScript strictness (no implicit `any`).

When updating or creating a class, run through this list to ensure the structure matches before submitting changes.
