MCP Creatio scaffold

This project contains a minimal MCP server scaffold and a Creatio OData adapter.

Environment

- CREATIO_BASE_URL - base URL for your Creatio instance (e.g. https://your-creatio.com)
- CREATIO_TOKEN - optional Bearer token for authentication
- PORT - server port (defaults to 3000)

Run

````markdown
MCP Creatio — мінімальне рішення (scaffold)

## Коротко

Цей репозиторій містить мінімальну реалізацію MCP (Model Context Provider) сервера з адаптером до Creatio OData API. Мета — надати простий стартовий шаблон для інтеграції сторонніх сервісів з платформою Creatio через MCP-протокол.

## Для чого це потрібно

- Швидкий старт для розробки розширень/інтеграцій, які потребують доступу до даних Creatio.
- Демонстрація базової структури сервера, маршрутизації та викликів OData.

## Як це працює (високо рівнем)

1. MCP-сервер приймає HTTP-запити на визначені ендпоїнти (наприклад, `/mcp/*`).
2. Сервер обробляє тіло запиту, будує запити до Creatio OData через `src/creatio/odataClient.ts`.
3. Отримані дані повертаються клієнту у форматі MCP відповіді.

## Серед файлів/модулів

- `src/server` — HTTP-сервер і маршрути MCP.
- `src/creatio` — клієнт для викликів Creatio OData та допоміжні методи.
- `src/utils` — утиліти (мережа, логування).
- `src/index.ts`, `src/version.ts` — точка входу та версія.

## Налаштування оточення

- `CREATIO_BASE_URL` — URL вашого інстансу Creatio (наприклад: `https://your-creatio.com`).
- `CREATIO_TOKEN` — опціональний Bearer token (якщо Creatio використовує токенну автентифікацію).
- `PORT` — порт, на якому слухає сервер (за замовчуванням `3000`).

## Установка та запуск

# MCP Creatio (scaffold)

## Overview

This repository contains a minimal MCP (Model Context Provider) server scaffold and a small adapter for Creatio OData. It is intended as a starter template to integrate external services with Creatio via MCP.

## Purpose

- Provide a simple starting point for building integrations with Creatio.
- Demonstrate a minimal server structure, routing, and how to call Creatio OData endpoints.

## How it works (high level)

1. The MCP server exposes HTTP endpoints (e.g. `/mcp/*`).
2. The server parses the request body and constructs requests to Creatio OData using `src/creatio/odataClient.ts`.
3. Responses from Creatio are returned to the client in an MCP-compatible format.

## Project structure

- `src/server` — HTTP server and MCP routes.
- `src/creatio` — Creatio OData client and helpers.
- `src/utils` — utility modules (network, logging).
- `src/index.ts`, `src/version.ts` — entry point and version.

## Environment variables

- `CREATIO_BASE_URL` — base URL for your Creatio instance (for example: `https://your-creatio.com`).
- `CREATIO_TOKEN` — optional Bearer token for authentication.
- `PORT` — port the server listens on (default: `3000`).

## Install and run

PowerShell:

```powershell
npm install
npm run start
```

## Endpoints

- `POST /mcp/sample` — example handler. Example request body:

```json
{ "entity": "Contact", "top": 10 }
```

## Example usage

Send a POST request:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/mcp/sample" -Body (@{ entity = 'Contact'; top = 5 } | ConvertTo-Json) -ContentType 'application/json'
```

The server will query the Creatio OData endpoint (via `src/creatio/odataClient.ts`) and return the result in the response.

## Security and production notes

- This project is a scaffold. For production use, add proper authentication, validation, error handling and logging.
- Do not commit secrets to the repository. Use environment variables and your CI/CD secret storage.

## Next steps

- Add CI (GitHub Actions) for build, lint and tests.
- Add unit tests and examples.
- Extend the Creatio adapter to support CRUD operations and pagination.

## Contributing

Open issues or PRs if you want to contribute or need help.
````
