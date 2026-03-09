#!/usr/bin/env node
/**
 * 同时启动 API 和 WebUI 开发服务，无需 concurrently 依赖。
 * Ctrl+C 会同时终止两个进程。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const api = spawn('npm', ['run', 'api:dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_ENV: 'development' },
});

setTimeout(() => {
  const web = spawn('npm', ['run', 'webui:dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });

  const kill = () => {
    api.kill();
    web.kill();
    process.exit();
  };
  process.on('SIGINT', kill);
  process.on('SIGTERM', kill);
}, 2000);
