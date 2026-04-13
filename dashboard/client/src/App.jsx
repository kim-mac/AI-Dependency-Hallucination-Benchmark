import { useCallback, useEffect, useRef, useState } from 'react';

async function api(path, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(`/api${path}`, { ...opts, headers });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!r.ok) throw new Error(data.error || r.statusText || 'Request failed');
  return data;
}

const TABS = [
  {
    id: 'run',
    label: 'Run',
    hint: 'Start the agent on the price-checker task. Output is saved as transcripts + workspace snapshots.'
  },
  {
    id: 'grade',
    label: 'Grade',
    hint: 'Score every transcript in analysis/transcripts/ (npm checks, tests, LLM rubric).'
  },
  {
    id: 'results',
    label: 'Results',
    hint: 'Read summary.json and the per-run grading table after you run the grader.'
  },
  {
    id: 'transcripts',
    label: 'Transcripts',
    hint: 'Browse, inspect JSON, and delete old runs.'
  },
  {
    id: 'models',
    label: 'Models',
    hint: 'Edit the dropdown presets used on the Run tab.'
  },
  {
    id: 'history',
    label: 'History',
    hint: 'Jobs from this server session and the last 200 finished jobs (survives refresh).'
  }
];

const METRIC_LABELS = {
  avg_score: 'Average final score',
  total_runs: 'Transcripts graded',
  hallucination_rate: 'Any name/version issue (rate)',
  name_hallucination_rate: 'Fake package names (rate)',
  version_hallucination_rate: 'Bad semver / install (rate)',
  deprecated_dependency_rate: 'Runs with deprecated deps',
  undeclared_import_rate: 'Imports not in package.json',
  avg_prod_dependency_count: 'Avg production dependencies',
  success_rate: 'Runs scoring ≥ 70 (rate)'
};

function FormSection({ step, title, hint, children }) {
  return (
    <div className="form-section">
      <div className="section-head">
        <span className="step-num">{step}</span>
        <div>
          <h3 className="section-title">{title}</h3>
          {hint && <p className="section-hint">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {hint && <span className="field-hint">{hint}</span>}
      {children}
    </div>
  );
}

function statusPillClass(status) {
  if (!status || status === 'idle') return 'status-pill';
  if (status === 'running' || status === 'starting' || status === 'pending') return 'status-pill running';
  if (status === 'completed') return 'status-pill completed';
  if (status === 'failed' || status === 'stopped') return 'status-pill failed';
  return 'status-pill';
}

function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('run');
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState(null);

  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [prompt, setPrompt] = useState('strict');
  const [taskPromptPath, setTaskPromptPath] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [modelsList, setModelsList] = useState('');
  const [runs, setRuns] = useState(20);
  const [pause, setPause] = useState(3);

  const [presets, setPresets] = useState({ anthropic: [], nvidia: [] });
  const [modelsJson, setModelsJson] = useState('');
  const [modelsSaveMsg, setModelsSaveMsg] = useState(null);

  const [jobId, setJobId] = useState(null);
  const [logText, setLogText] = useState('');
  const [jobStatus, setJobStatus] = useState(null);
  const esRef = useRef(null);

  const [summary, setSummary] = useState(null);
  const [grading, setGrading] = useState(null);
  const [resultsErr, setResultsErr] = useState(null);

  const [transcripts, setTranscripts] = useState([]);
  const [selTranscript, setSelTranscript] = useState(null);
  const [transcriptBody, setTranscriptBody] = useState(null);
  const [snapshot, setSnapshot] = useState(null);

  const [jobsData, setJobsData] = useState({ active: [], history: [] });
  const [promptFiles, setPromptFiles] = useState([]);

  const activeTabMeta = TABS.find((t) => t.id === tab);

  const loadHealth = useCallback(() => {
    setHealthErr(null);
    api('/health')
      .then(setHealth)
      .catch((e) => setHealthErr(String(e.message)));
  }, []);

  const loadPresets = useCallback(() => {
    api('/models')
      .then((d) => {
        setPresets(d);
        setModelsJson(JSON.stringify(d, null, 2));
      })
      .catch(() => {});
  }, []);

  const loadTranscripts = useCallback(() => {
    api('/transcripts')
      .then((d) => setTranscripts(d.transcripts || []))
      .catch(() => setTranscripts([]));
  }, []);

  const loadJobs = useCallback(() => {
    api('/jobs')
      .then(setJobsData)
      .catch(() => setJobsData({ active: [], history: [] }));
  }, []);

  useEffect(() => {
    loadHealth();
    loadPresets();
    api('/prompts')
      .then((d) => setPromptFiles(d.prompts || []))
      .catch(() => setPromptFiles([]));
  }, [loadHealth, loadPresets]);

  useEffect(() => {
    if (tab === 'transcripts') loadTranscripts();
    if (tab === 'history' || tab === 'run') loadJobs();
  }, [tab, loadTranscripts, loadJobs]);

  useEffect(() => {
    if (!jobId) return;
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.logText != null) setLogText(d.logText);
        if (d.status) setJobStatus(d.status);
      } catch {
        /* ignore */
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId]);

  const startSingle = async () => {
    try {
      setLogText('');
      setJobStatus('starting');
      let m = model.trim();
      if (!useCustomModel && !m && presets[provider]?.length) {
        m = presets[provider][0];
      }
      const body = {
        provider,
        prompt,
        taskPromptPath: taskPromptPath.trim() || undefined,
        model: m || undefined
      };
      const { jobId: id } = await api('/jobs/single', { method: 'POST', body });
      setJobId(id);
    } catch (e) {
      setLogText(String(e.message));
      setJobStatus('failed');
    }
  };

  const startBatch = async () => {
    try {
      const parts = modelsList
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        setLogText('Add at least one model (comma or newline separated).');
        return;
      }
      setLogText('');
      setJobStatus('starting');
      const { jobId: id } = await api('/jobs/batch', {
        method: 'POST',
        body: {
          provider,
          models: parts,
          runs,
          pause,
          prompt,
          taskPromptPath: taskPromptPath.trim() || undefined
        }
      });
      setJobId(id);
    } catch (e) {
      setLogText(String(e.message));
      setJobStatus('failed');
    }
  };

  const stopJob = async () => {
    if (!jobId) return;
    try {
      await api(`/jobs/${jobId}/stop`, { method: 'POST' });
      setJobStatus('stopped');
    } catch (e) {
      setLogText((prev) => `${prev}\n[stop] ${e.message}`);
    }
  };

  const runGrade = async () => {
    try {
      setLogText('');
      setJobStatus('starting');
      const { jobId: id } = await api('/grade', { method: 'POST' });
      setJobId(id);
    } catch (e) {
      setLogText(String(e.message));
      setJobStatus('failed');
    }
  };

  const loadResults = async () => {
    setResultsErr(null);
    try {
      const s = await api('/results/summary');
      setSummary(s);
    } catch (e) {
      setSummary(null);
      setResultsErr(String(e.message));
    }
    try {
      const g = await api('/results/grading?limit=500');
      setGrading(Array.isArray(g) ? g : []);
    } catch {
      setGrading(null);
    }
  };

  const openTranscript = async (name) => {
    setSelTranscript(name);
    setTranscriptBody(null);
    setSnapshot(null);
    try {
      const data = await api(`/transcripts/${encodeURIComponent(name)}`);
      setTranscriptBody(data);
      const base = name.replace(/\.json$/, '');
      try {
        const sn = await api(`/snapshots/${encodeURIComponent(base)}`);
        setSnapshot(sn);
      } catch {
        setSnapshot(null);
      }
    } catch (e) {
      setTranscriptBody({ error: String(e.message) });
    }
  };

  const deleteTranscript = async (name) => {
    if (!confirm(`Delete "${name}" and its snapshot folder (if any)?`)) return;
    await api(`/transcripts/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadTranscripts();
    if (selTranscript === name) {
      setSelTranscript(null);
      setTranscriptBody(null);
      setSnapshot(null);
    }
  };

  const saveModels = async () => {
    setModelsSaveMsg(null);
    try {
      const parsed = JSON.parse(modelsJson);
      await api('/models', { method: 'PUT', body: parsed });
      setPresets(parsed);
      setModelsSaveMsg('Saved. Run tab presets updated.');
    } catch (e) {
      setModelsSaveMsg(String(e.message));
    }
  };

  const testPassLabel = (passed) => (passed ? 'Passed' : 'Failed');

  return (
    <>
      <header className="app-header">
        <h1>Benchmark control</h1>
        <p className="tagline">
          Run dependency-hallucination trials locally. API keys are read from your terminal environment only — this app never
          stores them.
        </p>
        <div className="workflow-callout" role="note">
          <strong>Typical flow:</strong>
          <span>Run</span>
          <span className="arrow" aria-hidden>
            →
          </span>
          <span>Grade</span>
          <span className="arrow" aria-hidden>
            →
          </span>
          <span>Results</span>
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· Use Transcripts to inspect or clean up files</span>
        </div>
        <div className="status-strip">
          {healthErr && <span className="error" style={{ padding: '0.35rem 0.65rem', margin: 0 }}>API: {healthErr}</span>}
          {health && !healthErr && (
            <>
              <span className={health.anthropicKeySet ? 'badge ok' : 'badge bad'} title="ANTHROPIC_API_KEY in environment">
                Anthropic {health.anthropicKeySet ? 'ready' : 'missing'}
              </span>
              <span className={health.nvidiaKeySet ? 'badge ok' : 'badge bad'} title="NVIDIA_API_KEY in environment">
                NVIDIA {health.nvidiaKeySet ? 'ready' : 'missing'}
              </span>
              <span className="badge" title="Working directory for python / node">
                {health.projectRoot}
              </span>
            </>
          )}
          <button type="button" className="btn-ghost" onClick={loadHealth}>
            Refresh status
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Main sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <p className="tab-hint">{activeTabMeta?.hint}</p>

      {tab === 'run' && (
        <div className="panel">
          <h2 className="panel-title">Run agent</h2>
          <p className="panel-lead">
            Spawns <code>python execution/run_agent.py</code> (single) or <code>run_batch.py</code> (batch) in your project
            folder. Logs stream below; transcripts appear under <code>analysis/transcripts/</code>.
          </p>

          <FormSection
            step={1}
            title="Provider & model"
            hint="Choose who bills the request. Pick a saved preset or type any model id your account supports."
          >
            <div className="row">
              <Field label="LLM provider" hint="Which API to call">
                <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="LLM provider">
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="nvidia">NVIDIA (OpenAI-compatible)</option>
                </select>
              </Field>
              {!batchMode && (
                <>
                  <div className="field" style={{ alignSelf: 'flex-end' }}>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={useCustomModel}
                        onChange={(e) => setUseCustomModel(e.target.checked)}
                      />
                      <span>Type model id manually</span>
                    </label>
                  </div>
                  {!useCustomModel && (
                    <Field label="Model preset" hint="From Models tab · leave default to use first preset">
                      <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model preset">
                        <option value="">Default (first preset in list)</option>
                        {(presets[provider] || []).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {useCustomModel && (
                    <Field label="Model id" hint="Exact string the API expects">
                      <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. claude-sonnet-4-20250514" />
                    </Field>
                  )}
                </>
              )}
            </div>
          </FormSection>

          <FormSection
            step={2}
            title="Instructions (prompt)"
            hint="Strict includes “verify dependencies”; minimal is the same task without that wording — for A/B comparison."
          >
            <div className="row">
              <Field label="Prompt variant" hint="Which baseline markdown unless you override with a file below">
                <select value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Prompt variant">
                  <option value="strict">Strict — includes verify-before-install</option>
                  <option value="minimal">Minimal — no verify instructions</option>
                </select>
              </Field>
              <Field label="Override with a .md file" hint="Sets TASK_PROMPT_PATH; wins over the variant above">
                <select
                  value={promptFiles.some((p) => p.path === taskPromptPath) ? taskPromptPath : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__clear__') setTaskPromptPath('');
                    else if (v) setTaskPromptPath(v);
                  }}
                  aria-label="Pick prompt file"
                >
                  <option value="">No file override — use variant only</option>
                  {promptFiles.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.name}
                    </option>
                  ))}
                  <option value="__clear__">Clear override</option>
                </select>
              </Field>
              <Field label="Or type a path" hint="Relative to project root, or absolute path">
                <input
                  type="text"
                  value={taskPromptPath}
                  onChange={(e) => setTaskPromptPath(e.target.value)}
                  placeholder="e.g. task_prompt_minimal.md"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            step={3}
            title="Single run or batch"
            hint="Batch runs each model multiple times with a pause between trials (rate limits / cost control)."
          >
            <label className="toggle-row">
              <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
              <span>Batch mode — several models × many runs each</span>
            </label>
            {!batchMode && <p className="toggle-desc">One agent session, one transcript when it finishes.</p>}
            {batchMode && (
              <>
                <p className="toggle-desc">List every model id to test. Each gets the same number of runs.</p>
                <Field label="Model ids" hint="One per line or comma-separated">
                  <textarea value={modelsList} onChange={(e) => setModelsList(e.target.value)} placeholder={'claude-sonnet-4-20250514\nopenai/gpt-oss-20b'} />
                </Field>
                <div className="row">
                  <Field label="Runs per model" hint="1–500">
                    <input type="number" min={1} max={500} value={runs} onChange={(e) => setRuns(Number(e.target.value))} />
                  </Field>
                  <Field label="Pause between runs (sec)" hint="0 allowed">
                    <input type="number" min={0} value={pause} onChange={(e) => setPause(Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}
          </FormSection>

          <div className="actions-bar">
            <button type="button" className="primary" onClick={() => (batchMode ? startBatch() : startSingle())}>
              {batchMode ? 'Start batch' : 'Start single run'}
            </button>
            <button type="button" className="danger" onClick={stopJob} disabled={!jobId}>
              Stop job
            </button>
            <span className={statusPillClass(jobStatus)} title="Current job state">
              <span className="status-dot" aria-hidden />
              {jobStatus || 'idle'}
            </span>
          </div>
          <div className="log-wrap">
            <div className="log-label">Live output</div>
            <div className={`log ${!logText ? 'log--empty' : ''}`} aria-live="polite">
              {logText || 'Start a run to see Python output here.'}
            </div>
          </div>
        </div>
      )}

      {tab === 'grade' && (
        <div className="panel">
          <h2 className="panel-title">Grade transcripts</h2>
          <p className="panel-lead">
            Runs <code>node analysis/grade_all.js</code>. Each JSON file in <code>analysis/transcripts/</code> is scored using
            its saved workspace snapshot when available. This can take several minutes if you have many transcripts.
          </p>
          <ol className="info-box" style={{ marginBottom: '1rem' }}>
            <li>Finish at least one agent run (Run tab).</li>
            <li>Click below — progress appears in the log.</li>
            <li>Open Results for <code>summary.json</code>.</li>
          </ol>
          <div className="actions-bar" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
            <button type="button" className="primary" onClick={runGrade}>
              Run grader on all transcripts
            </button>
            <button type="button" className="secondary" onClick={stopJob} disabled={!jobId}>
              Stop
            </button>
            <span className={statusPillClass(jobStatus)}>
              <span className="status-dot" aria-hidden />
              {jobStatus || 'idle'}
            </span>
          </div>
          <div className="log-wrap">
            <div className="log-label">Grader log</div>
            <div className={`log ${!logText ? 'log--empty' : ''}`}>{logText || 'Grader output will appear here.'}</div>
          </div>
        </div>
      )}

      {tab === 'results' && (
        <div className="panel">
          <h2 className="panel-title">Results</h2>
          <p className="panel-lead">
            Loads <code>analysis/summary.json</code> and the first 500 rows of <code>grading_results.json</code>. Click Refresh
            after grading.
          </p>
          <div className="actions-bar" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
            <button type="button" className="primary" onClick={loadResults}>
              Load / refresh results
            </button>
          </div>
          {resultsErr && <p className="error">{resultsErr}</p>}
          {!summary && !resultsErr && (
            <EmptyState title="No summary loaded yet">Run the grader, then click “Load / refresh results”.</EmptyState>
          )}
          {summary && (
            <>
              <h2 className="section-heading">Aggregate metrics</h2>
              <p className="section-hint" style={{ margin: '-0.35rem 0 0.75rem' }}>
                Rates are 0–1 unless noted (e.g. 0.2 = 20% of runs).
              </p>
              <div className="cards">
                {Object.entries(METRIC_LABELS).map(([key, label]) => (
                  <div key={key} className="card">
                    <div className="k">{label}</div>
                    <div className="v">{summary[key] == null ? '—' : String(summary[key])}</div>
                  </div>
                ))}
              </div>
              <h2 className="section-heading">Per transcript</h2>
              <p className="section-hint" style={{ margin: '-0.35rem 0 0.5rem' }}>
                Showing up to 100 rows. Full data is in <code>grading_results.json</code>.
              </p>
              {grading && grading.length > 0 ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Transcript file</th>
                        <th>Score</th>
                        <th>Bad names</th>
                        <th>Bad versions</th>
                        <th>Undeclared imports</th>
                        <th>Tests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grading.slice(0, 100).map((r) => (
                        <tr key={r.file}>
                          <td className="mono-cell">{r.file}</td>
                          <td>{r.final_score}</td>
                          <td>{(r.dependency_check?.hallucinated || []).length}</td>
                          <td>{(r.dependency_check?.invalid_versions || []).length}</td>
                          <td>{(r.dependency_check?.undeclared_imports || []).length}</td>
                          <td>{testPassLabel(r.tests?.passed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No grading rows">Grading file empty or not loaded.</EmptyState>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'transcripts' && (
        <div className="panel">
          <h2 className="panel-title">Transcripts</h2>
          <p className="panel-lead">
            Each row is one agent run. Open to see JSON; snapshot shows <code>package.json</code> from that run if it was saved.
          </p>
          <button type="button" className="secondary" onClick={loadTranscripts} style={{ marginBottom: '0.85rem' }}>
            Refresh list
          </button>
          {transcripts.length === 0 ? (
            <EmptyState title="No transcripts yet">Run the agent from the Run tab, then refresh.</EmptyState>
          ) : (
            <div className="transcripts-layout">
              <div>
                <h2 className="section-heading" style={{ marginTop: 0 }}>
                  All runs ({transcripts.length})
                </h2>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Prompt</th>
                        <th>Modified</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transcripts.map((t) => (
                        <tr key={t.name}>
                          <td className="mono-cell">
                            <button type="button" className="linkish" onClick={() => openTranscript(t.name)}>
                              {t.name}
                            </button>
                          </td>
                          <td>{t.prompt_variant || '—'}</td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{t.mtime}</td>
                          <td>
                            <button type="button" className="danger" onClick={() => deleteTranscript(t.name)} style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem' }}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="detail-panel">
                {!selTranscript && (
                  <EmptyState title="Nothing selected">Click a file name to preview JSON and snapshot.</EmptyState>
                )}
                {selTranscript && (
                  <>
                    <h3>{selTranscript}</h3>
                    {snapshot?.packageJson && (
                      <div style={{ marginBottom: '0.85rem' }}>
                        <div className="log-label">Snapshot package.json</div>
                        <pre className="json-view">{JSON.stringify(snapshot.packageJson, null, 2)}</pre>
                      </div>
                    )}
                    <div className="log-label">Transcript JSON</div>
                    <pre className="json-view">{JSON.stringify(transcriptBody, null, 2)}</pre>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'models' && (
        <div className="panel">
          <h2 className="panel-title">Model presets</h2>
          <p className="panel-lead">
            These lists populate the Run tab dropdowns. Use valid model ids for your Anthropic or NVIDIA account.
          </p>
          <ul className="info-box">
            <li>
              <code>anthropic</code> — Claude model strings
            </li>
            <li>
              <code>nvidia</code> — OpenAI-compatible model ids on your endpoint
            </li>
          </ul>
          <Field label="JSON" hint="Must be valid JSON with two arrays">
            <textarea value={modelsJson} onChange={(e) => setModelsJson(e.target.value)} aria-label="Models JSON" />
          </Field>
          <div className="actions-bar" style={{ borderTop: 'none', paddingTop: '0.75rem', marginTop: 0 }}>
            <button type="button" className="primary" onClick={saveModels}>
              Save presets
            </button>
            {modelsSaveMsg && <span className="section-hint" style={{ margin: 0 }}>{modelsSaveMsg}</span>}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="panel">
          <h2 className="panel-title">Job history</h2>
          <p className="panel-lead">
            <strong>Active</strong> jobs exist only while this dashboard server is running. <strong>Persisted</strong> keeps the last
            200 finished jobs (including log tail) so you still see something after a restart.
          </p>
          <button type="button" className="secondary" onClick={loadJobs} style={{ marginBottom: '0.85rem' }}>
            Refresh
          </button>
          <h2 className="section-heading">Active (this session)</h2>
          {jobsData.active.length === 0 ? (
            <EmptyState title="No active jobs">Start a run or grader from Run / Grade.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsData.active.map((j) => (
                    <tr key={j.id}>
                      <td className="mono-cell">{j.id}</td>
                      <td>{j.type}</td>
                      <td>{j.status}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{j.startedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2 className="section-heading">Persisted (last 200)</h2>
          {jobsData.history.length === 0 ? (
            <EmptyState title="No history file yet">Complete a job once; entries append to dashboard/config/job_log.json.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Exit</th>
                    <th>Log tail</th>
                  </tr>
                </thead>
                <tbody>
                  {jobsData.history.map((j) => (
                    <tr key={`${j.id}-${j.startedAt}`}>
                      <td className="mono-cell">{j.id}</td>
                      <td>{j.type}</td>
                      <td>{j.status}</td>
                      <td>{j.exitCode}</td>
                      <td style={{ fontSize: '0.72rem', maxWidth: '360px', wordBreak: 'break-word', color: 'var(--muted)' }}>
                        {(j.logTail || '').slice(0, 240)}
                        {(j.logTail || '').length > 240 ? '…' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
