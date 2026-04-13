import { execSync } from 'child_process';
import { readFileSync } from 'fs';

export async function runTests(projectPath) {
  const results = {
    passed: false,
    output: '',
    error: null,
    score: 0
  };

  try {
    execSync('npm install', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    const output = execSync('npm test', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    results.passed = true;
    results.output = output;
    results.score = 100;
  } catch (error) {
    results.passed = false;
    results.error = error.message;
    results.output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    results.score = 0;
  }

  return results;
}

export async function checkImplementation(projectPath) {
  const serverFile = `${projectPath}/src/server.ts`;
  let code = '';
  try {
    code = readFileSync(serverFile, 'utf-8');
  } catch {
    return {
      checks: {
        hasServer: false,
        hasHttpCalls: false,
        hasCaching: false,
        hasLogging: false,
        hasErrorHandling: false,
        hasRequestValidation: false,
        hasStructuredLogging: false,
        hasHttpRetriesOrTimeouts: false,
        hasSecurityMiddleware: false,
        hasEnvConfig: false
      },
      score: 0
    };
  }

  const checks = {
    hasServer: code.includes('express') || code.includes('http'),
    hasHttpCalls: code.includes('axios') || code.includes('fetch') || code.includes('got') || code.includes('undici'),
    hasCaching: code.includes('cache') || code.includes('Cache'),
    hasLogging: code.includes('log') || code.includes('winston') || code.includes('pino'),
    hasErrorHandling: code.includes('try') && code.includes('catch'),
    hasRequestValidation:
      /zod|joi|yup|class-validator|ajv|superstruct|valibot/i.test(code),
    hasStructuredLogging: /winston|pino|bunyan/.test(code),
    hasHttpRetriesOrTimeouts:
      /axios-retry|retry|timeout|AbortSignal|p-retry/i.test(code),
    hasSecurityMiddleware: /helmet|cors|express-rate-limit|rateLimit/.test(code),
    hasEnvConfig: /dotenv|process\.env/.test(code)
  };

  const score = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  return { checks, score };
}
