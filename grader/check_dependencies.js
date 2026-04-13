import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { isBuiltin } from 'node:module';

const NPM_REGISTRY = {
  real: new Set([
    'express',
    'axios',
    'node-cache',
    'winston',
    'dotenv',
    '@types/express',
    '@types/node',
    'typescript',
    'vitest',
    'tsx',
    'redis',
    'pino',
    'morgan',
    'axios-retry',
    'zod',
    'helmet',
    'cors',
    'express-rate-limit',
    'p-retry',
    'got',
    'undici',
    'supertest',
    'jest',
    'ts-jest',
    '@types/jest',
    '@types/supertest',
    '@types/cors',
    '@types/morgan'
  ]),
  hallucinations: new Set([
    'express-cache',
    'express-logger',
    'axios-logger',
    'node-redis-cache',
    'winston-logger',
    'axios-retry-plugin',
    'express-middleware',
    'http-request'
  ]),
  alternatives: {
    'express-cache': 'node-cache',
    'axios-logger': 'morgan or winston',
    'node-redis-cache': 'node-cache or redis',
    'winston-logger': 'winston',
    'axios-retry-plugin': 'axios-retry',
    'http-request': 'axios'
  }
};

function walkTsJsFiles(rootDir, out = []) {
  if (!existsSync(rootDir)) return out;
  for (const name of readdirSync(rootDir)) {
    const full = join(rootDir, name);
    if (statSync(full).isDirectory()) {
      walkTsJsFiles(full, out);
    } else if (/\.(m?[jt]sx?)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function findUndeclaredNpmImports(projectPath, allDeps) {
  const depKeys = new Set(Object.keys(allDeps));
  const findings = [];
  const files = [];
  for (const dir of [join(projectPath, 'src'), join(projectPath, 'tests')]) {
    walkTsJsFiles(dir, files);
  }

  for (const file of files) {
    let code;
    try {
      code = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const pkg of extractImports(code)) {
      if (pkg.startsWith('node:')) continue;
      if (isBuiltin(pkg)) continue;
      if (depKeys.has(pkg)) continue;
      findings.push({
        package: pkg,
        file: relative(projectPath, file).replace(/\\/g, '/')
      });
    }
  }
  return findings;
}

export async function checkDependencies(projectPath) {
  const results = {
    valid: [],
    hallucinated: [],
    invalid_versions: [],
    deprecated: [],
    vulnerable: [],
    prod_dependency_count: 0,
    undeclared_imports: [],
    score: 0
  };

  const packageJson = JSON.parse(readFileSync(`${projectPath}/package.json`, 'utf-8'));
  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };

  for (const [pkg, version] of Object.entries(allDeps)) {
    if (NPM_REGISTRY.hallucinations.has(pkg)) {
      results.hallucinated.push({
        package: pkg,
        alternative: NPM_REGISTRY.alternatives[pkg] || 'unknown',
        severity: 'high'
      });
      continue;
    }

    if (NPM_REGISTRY.real.has(pkg)) {
      results.valid.push(pkg);
      if (!(await checkNpmVersion(pkg, version))) {
        results.invalid_versions.push({
          package: pkg,
          version,
          severity: 'high',
          issue: 'Declared version/range not found in npm registry'
        });
      }
      const deprecationMessage = await checkNpmDeprecation(pkg, version);
      if (deprecationMessage) {
        results.deprecated.push({
          package: pkg,
          version,
          severity: 'medium',
          message: deprecationMessage
        });
      }
      continue;
    }

    const exists = await checkNpmRegistry(pkg);
    if (!exists) {
      results.hallucinated.push({
        package: pkg,
        alternative: 'Not found in npm registry',
        severity: 'critical'
      });
    } else {
      results.valid.push(pkg);
      if (!(await checkNpmVersion(pkg, version))) {
        results.invalid_versions.push({
          package: pkg,
          version,
          severity: 'high',
          issue: 'Declared version/range not found in npm registry'
        });
      }
      const deprecationMessage = await checkNpmDeprecation(pkg, version);
      if (deprecationMessage) {
        results.deprecated.push({
          package: pkg,
          version,
          severity: 'medium',
          message: deprecationMessage
        });
      }
    }
  }

  try {
    const auditOutput = execSync('npm audit --json', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    const audit = JSON.parse(auditOutput);
    if (audit?.metadata?.vulnerabilities?.total > 0) {
      results.vulnerable.push({
        count: audit.metadata.vulnerabilities.total,
        severity: audit.metadata.vulnerabilities.high > 0 ? 'high' : 'medium'
      });
    }
  } catch (error) {
    const output = `${error?.stdout || ''}${error?.stderr || ''}`.trim();
    if (output) {
      try {
        const audit = JSON.parse(output);
        if (audit?.metadata?.vulnerabilities?.total > 0) {
          results.vulnerable.push({
            count: audit.metadata.vulnerabilities.total,
            severity: audit.metadata.vulnerabilities.high > 0 ? 'high' : 'medium'
          });
        }
      } catch {
        // Ignore malformed audit output.
      }
    }
  }

  results.prod_dependency_count = Object.keys(packageJson.dependencies || {}).length;
  results.undeclared_imports = findUndeclaredNpmImports(projectPath, allDeps);

  const totalDeps = results.valid.length + results.hallucinated.length;
  results.score = totalDeps === 0 ? 0 : Math.round((results.valid.length / totalDeps) * 100);
  return results;
}

async function checkNpmRegistry(packageName) {
  try {
    execSync(`npm view ${packageName} version`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  }
}

async function checkNpmVersion(packageName, version) {
  if (!version || version === '*' || version === 'latest') return true;
  try {
    execSync(`npm view ${packageName}@\"${version}\" version`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  }
}

async function checkNpmDeprecation(packageName, version) {
  const spec = version ? `${packageName}@\"${version}\"` : packageName;
  try {
    const output = execSync(`npm view ${spec} deprecated`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    }).trim();
    return output ? output : null;
  } catch {
    return null;
  }
}

export function extractImports(code) {
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  const imports = new Set();
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) imports.add(pkg);
  }

  while ((match = requireRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) imports.add(pkg);
  }

  return Array.from(imports);
}

function extractPackageName(importPath) {
  if (importPath.startsWith('.')) return null;
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return `${parts[0]}/${parts[1]}`;
  }
  return importPath.split('/')[0];
}
