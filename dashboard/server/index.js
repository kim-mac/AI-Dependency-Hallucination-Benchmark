import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import treeKill from 'tree-kill';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MODELS_PATH = path.join(DASHBOARD_ROOT, 'config', 'models.json');
const JOB_LOG_PATH = path.join(DASHBOARD_ROOT, 'config', 'job_log.json');

const PYTHON = process.env.PYTHON || 'python';
const API_HOST = process.env.DASHBOARD_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.DASHBOARD_API_PORT || 5174);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const jobs = new Map();
let jobIdCounter = 1;

function broadcastSse(job) {
  if (!job._sse?.size) return;
  const payload = JSON.stringify({
    logText: job.logText,
    status: job.status,
    exitCode: job.exitCode
  });
  for (const res of job._sse) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      job._sse.delete(res);
    }
  }
}

function appendJobLog(job, chunk, stream) {
  const s = chunk.toString();
  job.logText += s;
  if (job.logText.length > 2_000_000) {
    job.logText = job.logText.slice(-1_500_000);
  }
  broadcastSse(job);
}

function persistJobRecord(job) {
  try {
    const tail = job.logText.slice(-8000);
    const entry = {
      id: job.id,
      type: job.type,
      status: job.status,
      config: job.config,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      exitCode: job.exitCode,
      logTail: tail
    };
    let list = [];
    if (fs.existsSync(JOB_LOG_PATH)) {
      list = JSON.parse(fs.readFileSync(JOB_LOG_PATH, 'utf-8'));
      if (!Array.isArray(list)) list = [];
    }
    list.push(entry);
    const max = 200;
    if (list.length > max) list = list.slice(-max);
    fs.writeFileSync(JOB_LOG_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('persistJobRecord', e);
  }
}

function finishJob(job, status, exitCode) {
  if (job.status === 'stopped') return;
  job.status = status;
  job.exitCode = exitCode;
  job.endedAt = new Date().toISOString();
  job.child = null;
  broadcastSse(job);
  persistJobRecord(job);
}

function spawnJob(job, command, args, extraEnv = {}) {
  job.status = 'running';
  const child = spawn(command, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...extraEnv },
    windowsHide: true
  });
  job.child = child;
  job.pid = child.pid;

  child.stdout?.on('data', (d) => appendJobLog(job, d, 'stdout'));
  child.stderr?.on('data', (d) => appendJobLog(job, d, 'stderr'));
  child.on('error', (err) => {
    appendJobLog(job, Buffer.from(`\n[spawn error] ${err.message}\n`), 'stderr');
    finishJob(job, 'failed', -1);
  });
  child.on('close', (code) => {
    job.child = null;
    if (job.status === 'stopped') return;
    finishJob(job, code === 0 ? 'completed' : 'failed', code ?? -1);
  });
}

function safeTranscriptFilename(name) {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  if (!name.endsWith('.json')) return null;
  if (!/^[\w.\-]+\.json$/.test(name)) return null;
  return name;
}

function safeSnapshotBasename(name) {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  if (!/^[\w.\-]+$/.test(name)) return null;
  return name;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    projectRoot: PROJECT_ROOT,
    anthropicKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
    nvidiaKeySet: Boolean(process.env.NVIDIA_API_KEY)
  });
});

app.get('/api/prompts', (req, res) => {
  try {
    const files = fs.readdirSync(PROJECT_ROOT).filter((f) => f.endsWith('.md') && f.startsWith('task_prompt'));
    const builtin = ['task_prompt.md', 'task_prompt_minimal.md'];
    const merged = [...new Set([...builtin.filter((f) => files.includes(f)), ...files.sort()])];
    res.json({ prompts: merged.map((f) => ({ name: f, path: f })) });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/models', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(MODELS_PATH, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.put('/api/models', (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid body' });
    }
    if (!Array.isArray(body.anthropic) || !Array.isArray(body.nvidia)) {
      return res.status(400).json({ error: 'Expected { anthropic: string[], nvidia: string[] }' });
    }
    fs.writeFileSync(MODELS_PATH, JSON.stringify(body, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/jobs', (req, res) => {
  const active = [...jobs.values()].map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    config: j.config,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    exitCode: j.exitCode,
    pid: j.pid
  }));
  let history = [];
  try {
    if (fs.existsSync(JOB_LOG_PATH)) {
      history = JSON.parse(fs.readFileSync(JOB_LOG_PATH, 'utf-8'));
      if (!Array.isArray(history)) history = [];
    }
  } catch {
    history = [];
  }
  res.json({ active, history: history.slice().reverse() });
});

app.post('/api/jobs/single', (req, res) => {
  const { provider, model, prompt, taskPromptPath } = req.body || {};
  if (!provider || !['anthropic', 'nvidia'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be anthropic or nvidia' });
  }
  const p = prompt === 'minimal' ? 'minimal' : 'strict';
  const job = {
    id: String(jobIdCounter++),
    type: 'single',
    status: 'pending',
    config: { provider, model: model || null, prompt: p, taskPromptPath: taskPromptPath || null },
    logText: '',
    pid: null,
    child: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    _sse: new Set()
  };
  jobs.set(job.id, job);

  const args = ['execution/run_agent.py', provider];
  if (model && String(model).trim()) args.push(String(model).trim());
  args.push('--prompt', p);

  const extraEnv = {};
  if (taskPromptPath && String(taskPromptPath).trim()) {
    const raw = String(taskPromptPath).trim();
    extraEnv.TASK_PROMPT_PATH = path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  }

  spawnJob(job, PYTHON, args, extraEnv);
  res.json({ jobId: job.id });
});

app.post('/api/jobs/batch', (req, res) => {
  const { provider, models, runs, pause, prompt, taskPromptPath } = req.body || {};
  if (!provider || !['anthropic', 'nvidia'].includes(provider)) {
    return res.status(400).json({ error: 'provider must be anthropic or nvidia' });
  }
  if (!Array.isArray(models) || models.length === 0) {
    return res.status(400).json({ error: 'models must be a non-empty array' });
  }
  const r = Number(runs);
  const pauseSec = Number(pause);
  if (!Number.isFinite(r) || r < 1 || r > 500) {
    return res.status(400).json({ error: 'runs must be 1–500' });
  }
  const p = prompt === 'minimal' ? 'minimal' : 'strict';
  const job = {
    id: String(jobIdCounter++),
    type: 'batch',
    status: 'pending',
    config: { provider, models, runs: r, pause: Number.isFinite(pauseSec) ? pauseSec : 3, prompt: p, taskPromptPath: taskPromptPath || null },
    logText: '',
    pid: null,
    child: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    _sse: new Set()
  };
  jobs.set(job.id, job);

  const args = [
    'execution/run_batch.py',
    '--provider',
    provider,
    '--models',
    ...models.map((m) => String(m).trim()).filter(Boolean),
    '--runs',
    String(r),
    '--pause',
    String(Number.isFinite(pauseSec) ? pauseSec : 3),
    '--prompt',
    p
  ];

  const extraEnv = {};
  if (taskPromptPath && String(taskPromptPath).trim()) {
    const raw = String(taskPromptPath).trim();
    extraEnv.TASK_PROMPT_PATH = path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  }

  spawnJob(job, PYTHON, args, extraEnv);
  res.json({ jobId: job.id });
});

app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!job.child || !job.pid) {
    job.status = 'stopped';
    job.endedAt = new Date().toISOString();
    broadcastSse(job);
    persistJobRecord(job);
    return res.json({ ok: true });
  }
  job.status = 'stopped';
  treeKill(job.pid, 'SIGTERM', (err) => {
    if (err) {
      treeKill(job.pid, 'SIGKILL', () => {});
    }
    job.child = null;
    job.endedAt = new Date().toISOString();
    job.exitCode = -1;
    appendJobLog(job, Buffer.from('\n[stopped by user]\n'), 'stderr');
    broadcastSse(job);
    persistJobRecord(job);
  });
  res.json({ ok: true });
});

app.get('/api/jobs/:id/stream', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const send = () => {
    const payload = JSON.stringify({
      logText: job.logText,
      status: job.status,
      exitCode: job.exitCode
    });
    res.write(`data: ${payload}\n\n`);
  };

  job._sse.add(res);
  send();

  const interval = setInterval(send, 2000);
  req.on('close', () => {
    clearInterval(interval);
    job._sse.delete(res);
  });
});

app.post('/api/grade', (req, res) => {
  const job = {
    id: String(jobIdCounter++),
    type: 'grade',
    status: 'pending',
    config: {},
    logText: '',
    pid: null,
    child: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    _sse: new Set()
  };
  jobs.set(job.id, job);
  spawnJob(job, process.execPath, ['analysis/grade_all.js']);
  res.json({ jobId: job.id });
});

app.get('/api/results/summary', (req, res) => {
  const p = path.join(PROJECT_ROOT, 'analysis', 'summary.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'No summary.json yet. Run the grader first.' });
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/results/grading', (req, res) => {
  const p = path.join(PROJECT_ROOT, 'analysis', 'grading_results.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'No grading_results.json yet.' });
  try {
    const limit = req.query.limit ? Number(req.query.limit) : null;
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (Array.isArray(data) && limit && Number.isFinite(limit) && limit > 0) {
      return res.json(data.slice(0, limit));
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/transcripts', (req, res) => {
  const dir = path.join(PROJECT_ROOT, 'analysis', 'transcripts');
  if (!fs.existsSync(dir)) return res.json({ transcripts: [] });
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const list = names.map((name) => {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    let meta = {};
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.meta) {
        meta = raw.meta;
      }
    } catch {
      meta = {};
    }
    return {
      name,
      mtime: st.mtime.toISOString(),
      size: st.size,
      prompt_variant: meta.prompt_variant,
      workspace_snapshot: meta.workspace_snapshot
    };
  });
  list.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  res.json({ transcripts: list });
});

app.get('/api/transcripts/:name', (req, res) => {
  const name = safeTranscriptFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid transcript name' });
  const fp = path.join(PROJECT_ROOT, 'analysis', 'transcripts', name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.delete('/api/transcripts/:name', (req, res) => {
  const name = safeTranscriptFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid transcript name' });
  const fp = path.join(PROJECT_ROOT, 'analysis', 'transcripts', name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(fp);
  const base = name.replace(/\.json$/, '');
  const snapDir = path.join(PROJECT_ROOT, 'analysis', 'workspace_snapshots', base);
  if (fs.existsSync(snapDir)) {
    fs.rmSync(snapDir, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

app.get('/api/snapshots/:basename', (req, res) => {
  const base = safeSnapshotBasename(req.params.basename);
  if (!base) return res.status(400).json({ error: 'Invalid snapshot name' });
  const snapDir = path.join(PROJECT_ROOT, 'analysis', 'workspace_snapshots', base);
  if (!fs.existsSync(snapDir)) return res.status(404).json({ error: 'Snapshot not found' });
  const walk = (d) => {
    const out = [];
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = path.relative(snapDir, path.join(d, ent.name));
      if (ent.isDirectory()) out.push(...walk(path.join(d, ent.name)));
      else out.push(rel.replace(/\\/g, '/'));
    }
    return out;
  };
  const files = walk(snapDir);
  let packageJson = null;
  const pj = path.join(snapDir, 'package.json');
  if (fs.existsSync(pj)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pj, 'utf-8'));
    } catch {
      packageJson = { error: 'unreadable' };
    }
  }
  res.json({ basename: base, files, packageJson });
});

app.listen(API_PORT, API_HOST, () => {
  console.log(`Dashboard API http://${API_HOST}:${API_PORT}`);
  console.log(`Project root: ${PROJECT_ROOT}`);
});
