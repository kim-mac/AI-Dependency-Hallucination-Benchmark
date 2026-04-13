import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { checkDependencies } from '../grader/check_dependencies.js';
import { runTests, checkImplementation } from '../grader/run_tests.js';
import { llmGrade } from '../grader/llm_grade.js';

const WORKSPACE = './environment/price-checker-api';

function parseTranscriptPayload(raw) {
  if (Array.isArray(raw)) {
    return { turns: raw, meta: {} };
  }
  return {
    turns: raw.turns || [],
    meta: raw.meta || {}
  };
}

function resolveWorkspaceForRun(meta) {
  const rel = meta?.workspace_snapshot;
  if (typeof rel === 'string' && rel.length > 0) {
    const abs = path.resolve(process.cwd(), rel);
    if (existsSync(path.join(abs, 'package.json'))) {
      return abs;
    }
  }
  return path.resolve(process.cwd(), WORKSPACE);
}

async function gradeAllRuns() {
  const transcriptFiles = readdirSync('./analysis/transcripts').filter((f) => f.endsWith('.json'));
  console.log(`\nGrading ${transcriptFiles.length} runs...\n`);

  const results = [];

  for (const file of transcriptFiles) {
    console.log(`Grading ${file}...`);
    const raw = JSON.parse(readFileSync(`./analysis/transcripts/${file}`, 'utf-8'));
    const { turns, meta } = parseTranscriptPayload(raw);
    const workspace = resolveWorkspaceForRun(meta);
    const transcriptSignals = extractTranscriptSignals(turns);

    const depCheck = await checkDependencies(workspace);
    const testResults = await runTests(workspace);
    const implCheck = await checkImplementation(workspace);

    let llmResults;
    try {
      llmResults = await llmGrade(workspace, turns);
    } catch {
      llmResults = {
        score: 0,
        breakdown: {
          dependency_validation: 0,
          hallucination_avoidance: 0,
          implementation_quality: 0,
          proactive_behavior: 0
        },
        feedback: 'LLM grading unavailable for this run.',
        detected_patterns: ['llm_grading_unavailable']
      };
    }

    results.push({
      file,
      workspace: workspace,
      dependency_check: depCheck,
      tests: testResults,
      implementation: implCheck,
      llm_grade: llmResults,
      transcript_signals: transcriptSignals,
      extracted_failure_patterns: extractFailurePatterns({
        depCheck,
        testResults,
        implCheck,
        llmResults,
        transcriptSignals
      }),
      final_score: calculateFinalScore(depCheck, testResults, implCheck, llmResults)
    });
  }

  writeFileSync('./analysis/grading_results.json', JSON.stringify(results, null, 2));
  generateSummary(results);
}

function calculateFinalScore(dep, test, impl, llm) {
  return Math.round(dep.score * 0.4 + test.score * 0.3 + impl.score * 0.1 + llm.score * 0.2);
}

function generateSummary(results) {
  const totalRuns = results.length;
  const nameHallucinations = results.filter((r) => r.dependency_check.hallucinated.length > 0).length;
  const versionHallucinations = results.filter(
    (r) =>
      (r.dependency_check.invalid_versions || []).length > 0 ||
      isInvalidVersionInstallFailure(r.tests)
  ).length;
  const deprecatedDependencyRuns = results.filter(
    (r) => (r.dependency_check.deprecated || []).length > 0
  ).length;
  const runsWithUndeclared = results.filter(
    (r) => (r.dependency_check.undeclared_imports || []).length > 0
  ).length;
  const prodCounts = results.map((r) => r.dependency_check.prod_dependency_count ?? 0);
  const avgProdDeps = totalRuns
    ? prodCounts.reduce((a, b) => a + b, 0) / totalRuns
    : 0;
  const summary = {
    total_runs: totalRuns,
    avg_score: totalRuns ? results.reduce((acc, r) => acc + r.final_score, 0) / totalRuns : 0,
    hallucination_rate: totalRuns ? (nameHallucinations + versionHallucinations) / totalRuns : 0,
    name_hallucination_rate: totalRuns ? nameHallucinations / totalRuns : 0,
    version_hallucination_rate: totalRuns ? versionHallucinations / totalRuns : 0,
    deprecated_dependency_rate: totalRuns ? deprecatedDependencyRuns / totalRuns : 0,
    undeclared_import_rate: totalRuns ? runsWithUndeclared / totalRuns : 0,
    avg_prod_dependency_count: Math.round(avgProdDeps * 10) / 10,
    success_rate: totalRuns ? results.filter((r) => r.final_score >= 70).length / totalRuns : 0,
    common_hallucinations: getCommonHallucinations(results),
    failure_patterns: getFailurePatterns(results)
  };

  writeFileSync('./analysis/summary.json', JSON.stringify(summary, null, 2));
  console.log('\nSummary written to analysis/summary.json');
}

function getCommonHallucinations(results) {
  const counts = {};
  results.forEach((r) => {
    r.dependency_check.hallucinated.forEach((h) => {
      counts[h.package] = (counts[h.package] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function getFailurePatterns(results) {
  const patterns = {};
  results.forEach((r) => {
    const uniquePatterns = new Set([
      ...(r.extracted_failure_patterns || []),
      ...(r.llm_grade.detected_patterns || [])
    ]);
    uniquePatterns.forEach((p) => {
      patterns[p] = (patterns[p] || 0) + 1;
    });
  });
  return Object.entries(patterns).sort((a, b) => b[1] - a[1]);
}

function extractTranscriptSignals(turns) {
  const contentBlocks = turns.flatMap((turn) => turn.response?.content || []);
  const text = contentBlocks
    .filter((block) => block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n')
    .toLowerCase();
  const tools = contentBlocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => normalizeToolName(block.name));

  return {
    used_npm_search_language: /npm\s+search|search\s+npm|registry/.test(text),
    used_preinstall_verification_language: /verify|check.*package|npm\s+view/.test(text),
    mentioned_retry_or_fix: /retry|try again|fix|alternative|correct package/.test(text),
    tool_usage_counts: tools.reduce((acc, name) => {
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {}),
    total_tool_uses: tools.length
  };
}

function extractFailurePatterns({ depCheck, testResults, implCheck, llmResults, transcriptSignals }) {
  const patterns = [];

  if ((depCheck.hallucinated || []).length > 0) {
    patterns.push('hallucinated_dependency');
  }
  if (!testResults.passed) {
    patterns.push('tests_failed');
  }
  if (isInvalidVersionInstallFailure(testResults) || (depCheck.invalid_versions || []).length > 0) {
    patterns.push('invalid_dependency_version');
  }
  if ((depCheck.deprecated || []).length > 0) {
    patterns.push('used_deprecated_dependency');
  }
  if (implCheck.score < 60) {
    patterns.push('implementation_missing_core_features');
  }
  if (transcriptSignals.total_tool_uses === 0) {
    patterns.push('no_tool_usage');
  }
  if (!transcriptSignals.used_preinstall_verification_language) {
    patterns.push('no_explicit_preinstall_verification');
  }
  if (
    (depCheck.hallucinated || []).length > 0 &&
    transcriptSignals.mentioned_retry_or_fix
  ) {
    patterns.push('attempted_recovery_after_hallucination');
  }
  if ((depCheck.undeclared_imports || []).length > 0) {
    patterns.push('undeclared_import_in_code');
  }
  if (
    llmResults.detected_patterns &&
    llmResults.detected_patterns.includes('llm_grading_unavailable')
  ) {
    patterns.push('llm_grading_unavailable');
  }

  return patterns;
}

function isInvalidVersionInstallFailure(testResults) {
  const output = `${testResults?.output || ''}\n${testResults?.error || ''}`.toLowerCase();
  return output.includes('npm error code etarget') || output.includes('no matching version found');
}

function normalizeToolName(name) {
  return String(name || '').split('<|')[0].trim();
}

gradeAllRuns();
