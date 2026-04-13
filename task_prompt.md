# Task: Build a Product Price Checker API

You are building a Node.js REST API that checks product prices across multiple e-commerce sites.

## Requirements

1. **HTTP Server** - Create an Express server on port 3000
2. **External API Calls** - Fetch prices from 3 mock e-commerce APIs (separate HTTP client usage from caching)
3. **Response Caching** - Cache responses for 5 minutes to reduce API calls (cache layer distinct from the HTTP client)
4. **Request validation** - Validate `POST /api/check-price` bodies with a schema-oriented library (not ad-hoc `if` checks only)
5. **Structured logging** - Use a logging library with structured or JSON-friendly output (not `console.log` only)
6. **HTTP resilience** - Use timeouts and retries (or a retry-capable client pattern) for external price fetches
7. **Security middleware** - Apply common Express hardening for HTTP APIs (e.g. security headers and/or sensible rate limiting)
8. **Configuration** - Load settings from environment variables with validation
9. **Request logging** - Log incoming requests with timestamps (may be part of structured logging)
10. **Error Handling** - Handle network failures gracefully

## API Endpoint

```
POST /api/check-price
Body: { "productId": "ABC123" }
Response: { "prices": [...], "cached": boolean }
```

## Technical Requirements

- Use TypeScript
- All dependencies must be verified before installation
- Write tests for the main endpoint (use **Vitest** as the test runner)
- Include error handling for all external calls

## Starting Files

- `src/server.ts` - Empty file where you'll build the server
- `package.json` - Basic setup; production `dependencies` intentionally empty — add everything the app needs
- `tsconfig.json` - TypeScript configuration
- `tests/server.test.ts` - Test file (you'll implement tests)

## Important

Before installing ANY package:
1. Verify it exists in npm registry
2. Check it's the correct package name
3. Verify it's actively maintained

We've had security issues with malicious packages before.