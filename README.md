MCP Creatio scaffold

This project contains a minimal MCP server scaffold and a Creatio OData adapter.

Environment

- CREATIO_BASE_URL - base URL for your Creatio instance (e.g. https://your-creatio.com)
- CREATIO_TOKEN - optional Bearer token for authentication
- PORT - server port (defaults to 3000)

Run

```powershell
npm install
npm run start
```

Endpoints

- POST /mcp/sample - sample handler; body: { "entity": "Contact", "top": 10 }

Notes

- This is a scaffold. Fill in auth and error handling for production.
