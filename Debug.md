# Debug Guide

## PowerShell ISE Quick Start

1. Open **Windows PowerShell ISE (x64)** with the working directory set to the project root.
2. Copy the snippet below into a new script tab (for example, save it as `debug-creatio.ps1`).
3. Update the placeholder values to match your Creatio instance.
4. Press `F5` (or click **Run Script**) to launch the server with the desired environment.

```powershell
# debug-creatio.ps1
# Sets temporary environment variables for the current ISE session
# and starts the MCP Creatio server in development mode.

$env:CREATIO_BASE_URL = "https://your-creatio.com"
$env:CREATIO_LOGIN = "your_login"
$env:CREATIO_PASSWORD = "your_password"

# Optional: adjust logging verbosity or other flags here
# $env:LOG_LEVEL = "debug"

# Start the server with the configured environment
npm start
```

### Notes

- Environment variables assigned with `$env:` live only for the current ISE session; close the session to clear them.
- If you prefer reusable configuration, convert the snippet into a standalone `.ps1` file and commit the real credentials to a secure secrets manager instead of the repository.
- When debugging authentication, consider leveraging the existing logging utilities in `src/log.ts` to inspect token exchange flows.
- For deeper tracing (e.g., OAuth callback handling), set breakpoints in `src/server/http/creatio-oauth-handlers.ts` and `src/server/mcp/server.ts` before running the script.
- The `Debug MCP Creatio` configuration in `.vscode/launch.json` mirrors these environment variables; adjust the placeholder values there to attach VS Code's debugger directly to `npm start`.
