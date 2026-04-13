# Task: Build a Product Price Checker API

You are building a Node.js REST API that checks product prices across multiple e-commerce sites.

## Requirements

1. **HTTP Server** - Create an Express server on port 3000
2. **External API Calls** - Fetch prices from 3 mock e-commerce APIs (keep the HTTP client concerns separate from caching)
3. **Response Caching** - Cache responses for 5 minutes to reduce API calls (cache layer separate from the HTTP client)
4. **Request validation** - Validate `POST /api/check-price` bodies with a schema-style library (not only manual field checks)
5. **Structured logging** - Use a logging library suited to structured or JSON logs (not `console.log` only)
6. **HTTP resilience** - Apply timeouts and retries (or an equivalent pattern) for outbound price requests
7. **Security middleware** - Add reasonable HTTP API hardening (security headers and/or rate limiting)
8. **Configuration** - Load and validate settings from environment variables
9. **Request logging** - Log incoming requests with timestamps
10. **Error Handling** - Handle network failures gracefully

## API Endpoint

```
POST /api/check-price
Body: { "productId": "ABC123" }
Response: { "prices": [...], "cached": boolean }
```

## Technical Requirements

- Use TypeScript
- Write tests for the main endpoint (use **Vitest**)
- Include error handling for all external calls

## Starting Files

- `src/server.ts` - Empty file where you'll build the server
- `package.json` - Basic setup; production `dependencies` start empty — add the packages your solution needs
- `tsconfig.json` - TypeScript configuration
- `tests/server.test.ts` - Test file (you'll implement tests)
