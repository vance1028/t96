'use strict';

process.env.DB_FILE = ':memory:';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { getDb, resetAll } = require('../src/db');
const { seed } = require('../src/seed');
const store = require('../src/data/store');

function resetAndSeed() {
  resetAll();
  seed({ force: true });
}
const { runImport, generateErrorCsv, detectEncoding } = require('../src/batch/importEngine');
const { runExport } = require('../src/batch/exportEngine');
const { toCsvLine } = require('../src/batch/csvUtils');

const TEST_DIR = path.join(__dirname, '..', 'data', 'test_tmp');

function ensureDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
}

function writeCsv(fileName, header, rows, encoding = 'utf-8') {
  const filePath = path.join(TEST_DIR, fileName);
  const fd = fs.openSync(filePath, 'w');
  try {
    if (encoding === 'utf-8-bom') {
      fs.writeSync(fd, Buffer.from([0xEF, 0xBB, 0xBF]));
    }
    const headerLine = toCsvLine(header);
    if (encoding === 'gbk') {
      const iconv = require('iconv-lite');
      fs.writeSync(fd, iconv.encode(headerLine, 'gbk'));
      for (const row of rows) {
        fs.writeSync(fd, iconv.encode(toCsvLine(row), 'gbk'));
      }
    } else {
      fs.writeSync(fd, headerLine, 'utf-8');
      for (const row of rows) {
        fs.writeSync(fd, toCsvLine(row), 'utf-8');
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return filePath;
}

async function testBasicImport() {
  console.log('\n=== 测试：基础导入（skip 模式） ===');
  getDb();
  resetAndSeed();

  const beforeCount = store.listPipes().length;

  const filePath = writeCsv('test_pipes.csv',
    ['编号', '区域', '类型', '材质', '管径', '长度', '状态', '备注'],
    [
      ['TEST-001', '东湖区', '雨水', 'PVC', '300', '50.5', '正常', '测试管段1'],
      ['TEST-002', '西湖区', '污水', 'HDPE', '500', '120', '预警', '测试管段2'],
      ['TEST-003', '南岗区', '合流', '钢筋混凝土', '800', '200.5', '检修', '测试管段3'],
      ['YS-DX-001', '东湖区', '雨水', 'PVC', '600', '100', '正常', '已存在的编号'],
    ]
  );

  const { result } = await runImport({
    taskId: 'test-001',
    entityType: 'pipe',
    filePath,
    encoding: 'utf-8',
    options: { dryRun: false, upsert: true, onError: 'skip' },
  });

  console.log('统计:', result.stats);
  console.log('未知列:', result.unknownColumns);
  console.log('错误行数:', result.failedRows.length);

  assert.strictEqual(result.stats.inserted, 3, '应该新增 3 条');
  assert.strictEqual(result.stats.updated, 1, '应该更新 1 条（已存在的编号）');
  assert.strictEqual(result.stats.failed, 0, '应该没有失败的');
  assert.strictEqual(store.listPipes().length, beforeCount + 3, '库中应该新增 3 条');

  const pipe = store.getPipeByCode('TEST-001');
  assert.strictEqual(pipe.district, '东湖区');
  assert.strictEqual(pipe.type, 'rain');
  assert.strictEqual(pipe.diameterMm, 300);
  assert.strictEqual(pipe.lengthM, 50.5);
  assert.strictEqual(pipe.status, 'normal');

  console.log('✓ 基础导入测试通过');
}

async function testDryRun() {
  console.log('\n=== 测试：dryRun 模式 ===');
  getDb();
  resetAndSeed();

  const beforeCount = store.listPipes().length;

  const filePath = writeCsv('test_dryrun.csv',
    ['code', 'district', 'type', 'diameterMm'],
    [
      ['DRY-001', '东湖区', 'rain', '400'],
      ['DRY-002', '西湖区', 'sewage', '600'],
    ]
  );

  const { result } = await runImport({
    taskId: 'test-dryrun',
    entityType: 'pipe',
    filePath,
    encoding: 'utf-8',
    options: { dryRun: true, upsert: true, onError: 'skip' },
  });

  assert.strictEqual(result.stats.inserted, 2, 'dryRun 应该报告新增 2 条');
  assert.strictEqual(store.listPipes().length, beforeCount, 'dryRun 不应该实际写入数据库');

  console.log('✓ dryRun 测试通过');
}

async function testValidationErrors() {
  console.log('\n=== 测试：校验错误 ===');
  getDb();
  resetAndSeed();

  const filePath = writeCsv('test_errors.csv',
    ['编号', '区域', '类型', '管径'],
    [
      ['', '东湖区', '雨水', '300'],
      ['ERR-002', '', '雨水', '300'],
      ['ERR-003', '东湖区', '未知类型', '300'],
      ['ERR-004', '东湖区', '雨水', '不是数字'],
      ['ERR-005', '东湖区', '雨水', '300'],
      ['ERR-005', '东湖区', '雨水', '400'],
    ]
  );

  const { result, failedRows } = await runImport({
    taskId: 'test-errors',
    entityType: 'pipe',
    filePath,
    encoding: 'utf-8',
    options: { dryRun: false, upsert: true, onError: 'skip' },
  });

  console.log('统计:', result.stats);
  console.log('失败行:', result.failedRows);

  assert.strictEqual(result.stats.failed, 5, '应该有 5 行失败');
  assert.strictEqual(result.stats.inserted, 1, '应该成功 1 条');

  console.log('✓ 校验错误测试通过');
}

async function testRollbackMode() {
  console.log('\n=== 测试：rollback 模式 ===');
  getDb();
  resetAndSeed();

  const beforeCount = store.listPipes().length;

  const filePath = writeCsv('test_rollback.csv',
    ['编号', '区域', '类型'],
    [
      ['RB-001', '东湖区', '雨水'],
      ['RB-002', '西湖区', '污水'],
      ['RB-003', '南岗区', '无效类型'],
      ['RB-004', '东湖区', '雨水'],
    ]
  );

  try {
    await runImport({
      taskId: 'test-rollback',
      entityType: 'pipe',
      filePath,
      encoding: 'utf-8',
      options: { dryRun: false, upsert: true, onError: 'rollback' },
    });
    assert.fail('应该抛出错误');
  } catch (err) {
    console.log('错误消息:', err.message);
    assert.ok(err.isRollback, '应该是回滚错误');
  }

  assert.strictEqual(store.listPipes().length, beforeCount, 'rollback 后数据量应该不变');

  console.log('✓ rollback 模式测试通过');
}

async function testStationImport() {
  console.log('\n=== 测试：泵站导入 ===');
  getDb();
  resetAndSeed();

  const filePath = writeCsv('test_stations.csv',
    ['泵站编号', '名称', '区域', '排水能力', '泵台数', '状态', '位置'],
    [
      ['ST-NEW-01', '测试泵站一号', '东湖区', '2000', '3', '运行', '测试路1号'],
      ['ST-NEW-02', '测试泵站二号', '西湖区', '3500', '4', '备用', '测试路2号'],
      ['ST-NEW-03', '测试泵站三号', '南岗区', '1000', '2', '故障', '测试路3号'],
    ]
  );

  const { result } = await runImport({
    taskId: 'test-stations',
    entityType: 'station',
    filePath,
    encoding: 'utf-8',
    options: { dryRun: false, upsert: true, onError: 'skip' },
  });

  console.log('统计:', result.stats);

  assert.strictEqual(result.stats.inserted, 3, '应该新增 3 个泵站');

  const st = store.getStationByCode('ST-NEW-01');
  assert.strictEqual(st.name, '测试泵站一号');
  assert.strictEqual(st.capacityM3h, 2000);
  assert.strictEqual(st.pumpCount, 3);
  assert.strictEqual(st.status, 'running');

  console.log('✓ 泵站导入测试通过');
}

async function testExport() {
  console.log('\n=== 测试：导出 ===');
  getDb();
  resetAndSeed();

  const outputPath = path.join(TEST_DIR, 'export_test.csv');

  const { total, exported } = await runExport({
    taskId: 'test-export',
    entityType: 'pipe',
    filters: {},
    outputPath,
    encoding: 'utf-8',
  });

  console.log(`导出 ${exported}/${total} 条`);

  assert.strictEqual(exported, 3, '应该导出 3 条');
  assert.ok(fs.existsSync(outputPath), '导出文件应该存在');

  const content = fs.readFileSync(outputPath, 'utf-8');
  const lines = content.trim().split('\n');
  assert.strictEqual(lines.length, 4, '应该是 3 条数据 + 1 行表头');
  assert.ok(lines[0].includes('编号'), '表头应该包含 编号');
  assert.ok(lines[0].includes('类型'), '表头应该包含 类型');

  console.log('✓ 导出测试通过');
}

async function testErrorCsv() {
  console.log('\n=== 测试：错误 CSV 生成 ===');
  getDb();
  resetAndSeed();

  const filePath = writeCsv('test_err_csv.csv',
    ['编号', '区域', '类型', '管径'],
    [
      ['OK-001', '东湖区', '雨水', '300'],
      ['', '东湖区', '雨水', '300'],
      ['ERR-002', '未知区', '雨水', '300'],
    ]
  );

  const { result, failedRows, headerRow } = await runImport({
    taskId: 'test-err-csv',
    entityType: 'pipe',
    filePath,
    encoding: 'utf-8',
    options: { dryRun: false, upsert: true, onError: 'skip' },
  });

  const errorPath = path.join(TEST_DIR, 'errors.csv');
  generateErrorCsv(filePath, 'utf-8', headerRow, failedRows, errorPath);

  assert.ok(fs.existsSync(errorPath), '错误 CSV 应该存在');

  const content = fs.readFileSync(errorPath, 'utf-8');
  console.log('错误文件内容:');
  console.log(content);

  assert.ok(content.includes('错误原因'), '应该有错误原因列');
  assert.ok(content.includes('「编号」不能为空'), '应该包含第一条错误信息');

  console.log('✓ 错误 CSV 生成测试通过');
}

async function main() {
  ensureDir();

  try {
    await testBasicImport();
    await testDryRun();
    await testValidationErrors();
    await testRollbackMode();
    await testStationImport();
    await testExport();
    await testErrorCsv();

    console.log('\n✅ 所有测试通过！');
  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
