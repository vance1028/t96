'use strict';

process.env.DB_FILE = ':memory:';
process.env.SEED_ON_START = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const { createApp } = require('../src/app');
const { getDb, resetAll } = require('../src/db');
const { seed } = require('../src/seed');
const { toCsvLine } = require('../src/batch/csvUtils');

getDb();
const app = createApp();

const TEST_DIR = path.join(__dirname, '..', 'data', 'test_api');

function ensureDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

async function login(username, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
  assert.equal(res.status, 200, `登录应成功: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

function createTestCsv(fileName, header, rows) {
  const filePath = path.join(TEST_DIR, fileName);
  const fd = fs.openSync(filePath, 'w');
  try {
    fs.writeSync(fd, toCsvLine(header), 'utf-8');
    for (const row of rows) {
      fs.writeSync(fd, toCsvLine(row), 'utf-8');
    }
  } finally {
    fs.closeSync(fd);
  }
  return filePath;
}

test.beforeEach(() => {
  resetAll();
  seed({ force: true });
  ensureDir();
});

test('导入管段：提交任务返回 202 和 taskId', async () => {
  const token = await login('admin', 'admin123');

  const csvPath = createTestCsv('api_pipes.csv',
    ['编号', '区域', '类型', '管径'],
    [
      ['API-001', '东湖区', '雨水', '500'],
      ['API-002', '西湖区', '污水', '600'],
    ]
  );

  const res = await request(app)
    .post('/api/import/pipes')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', csvPath)
    .field('dryRun', 'false')
    .field('upsert', 'true');

  assert.equal(res.status, 202);
  assert.ok(res.body.data.taskId, '应返回 taskId');
  assert.equal(res.body.data.status, 'pending');
});

test('未登录查询导入任务返回 401', async () => {
  const res = await request(app).get('/api/import/tasks');
  assert.equal(res.status, 401);
});

test('查询导入任务状态', async () => {
  const token = await login('admin', 'admin123');

  const csvPath = createTestCsv('api_status.csv',
    ['编号', '区域', '类型'],
    [
      ['ST-001', '东湖区', '雨水'],
      ['ST-002', '西湖区', '污水'],
      ['ST-003', '南岗区', '合流'],
    ]
  );

  const submitRes = await request(app)
    .post('/api/import/pipes')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', csvPath);

  const taskId = submitRes.body.data.taskId;
  assert.ok(taskId);

  await new Promise(resolve => setTimeout(resolve, 500));

  const statusRes = await request(app)
    .get(`/api/import/tasks/${taskId}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.data.status, 'completed');
  assert.equal(statusRes.body.data.totalRows, 3);
  assert.equal(statusRes.body.data.insertedCount, 3);
});

test('导出管段：提交导出任务', async () => {
  const token = await login('operator', 'operator123');

  const res = await request(app)
    .post('/api/export/pipes')
    .set('Authorization', `Bearer ${token}`)
    .send({ encoding: 'utf-8' });

  assert.equal(res.status, 202);
  assert.ok(res.body.data.taskId);
  assert.equal(res.body.data.status, 'pending');
});

test('导出任务完成后可以下载', async () => {
  const token = await login('operator', 'operator123');

  const submitRes = await request(app)
    .post('/api/export/pipes')
    .set('Authorization', `Bearer ${token}`)
    .send({ encoding: 'utf-8' });

  const taskId = submitRes.body.data.taskId;

  await new Promise(resolve => setTimeout(resolve, 500));

  const downloadRes = await request(app)
    .get(`/api/export/tasks/${taskId}/download`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(downloadRes.status, 200);
  assert.ok(downloadRes.headers['content-type'].includes('text/csv'));
  assert.ok(downloadRes.text.includes('编号'));
  assert.ok(downloadRes.text.includes('YS-DX-001'));
});

test('导入任务列表', async () => {
  const token = await login('admin', 'admin123');

  const csvPath = createTestCsv('api_list.csv',
    ['编号', '区域', '类型'],
    [['L-001', '东湖区', '雨水']]
  );

  await request(app)
    .post('/api/import/pipes')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', csvPath);

  await new Promise(resolve => setTimeout(resolve, 300));

  const res = await request(app)
    .get('/api/import/tasks')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 1);
});
