'use strict';

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { getDb } = require('../db');
const store = require('../data/store');
const {
  detectEncoding,
  readCsvRows,
  readHeader,
  toCsvLine,
  CHUNK_SIZE,
} = require('./csvUtils');
const {
  buildHeaderMapping,
  PIPE_FIELD_ALIASES,
  STATION_FIELD_ALIASES,
} = require('./fieldMapping');
const {
  validatePipeRow,
  validateStationRow,
  RowValidationError,
} = require('./rowValidator');

const BATCH_SIZE = 500;
const PROGRESS_INTERVAL_MS = 200;

function getKnownDistricts(entityType) {
  const db = getDb();
  const districts = new Set();
  const pipeRows = db.prepare('SELECT DISTINCT district FROM pipe_segments').all();
  for (const r of pipeRows) districts.add(r.district);
  const stationRows = db.prepare('SELECT DISTINCT district FROM pump_stations').all();
  for (const r of stationRows) districts.add(r.district);
  return districts;
}

function generateErrorCsv(filePath, encoding, headerRow, failedRows, outputPath) {
  const fd = fs.openSync(outputPath, 'w');

  try {
    const headerCsv = toCsvLine([...headerRow, '错误原因']);
    if (encoding === 'gbk' || encoding === 'gb2312') {
      fs.writeSync(fd, iconv.encode(headerCsv, encoding));
    } else {
      if (encoding === 'utf-8-bom') {
        fs.writeSync(fd, Buffer.from([0xEF, 0xBB, 0xBF]));
      }
      fs.writeSync(fd, headerCsv, 'utf-8');
    }

    for (const item of failedRows) {
      const lineData = [...item.rawRow, item.reason];
      const lineCsv = toCsvLine(lineData);
      if (encoding === 'gbk' || encoding === 'gb2312') {
        fs.writeSync(fd, iconv.encode(lineCsv, encoding));
      } else {
        fs.writeSync(fd, lineCsv, 'utf-8');
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function validateAndCount({
  filePath,
  encoding,
  mapping,
  validateRow,
  knownDistricts,
  onProgress,
  stats,
  collectFailed = true,
}) {
  const failedRows = [];
  const fileCodeSet = new Set();
  let lastProgressTime = Date.now();
  let validCount = 0;

  for (const { rowNumber, row } of readCsvRows(filePath, encoding)) {
    stats.total++;
    stats.processed++;
    const rawRow = row;
    const { data, errors } = validateRow(row, mapping, { knownDistricts });

    if (errors.length > 0) {
      stats.failed++;
      if (collectFailed) {
        const reason = errors.map(e => e.message).join('；');
        failedRows.push({ rowNumber, rawRow, reason });
      } else {
        return { hasError: true, failedRows, validCount, fileCodeSet };
      }
    } else if (fileCodeSet.has(data.code)) {
      stats.failed++;
      if (collectFailed) {
        failedRows.push({
          rowNumber,
          rawRow,
          reason: `编号「${data.code}」在文件中重复`,
        });
      } else {
        return { hasError: true, failedRows, validCount, fileCodeSet };
      }
    } else {
      fileCodeSet.add(data.code);
      validCount++;
    }

    const now = Date.now();
    if (now - lastProgressTime >= PROGRESS_INTERVAL_MS && onProgress) {
      lastProgressTime = now;
      onProgress({ ...stats });
    }
  }

  return { hasError: failedRows.length > 0, failedRows, validCount, fileCodeSet };
}

function applyPipeItem(data, stats, upsert) {
  const existing = store.getPipeByCode(data.code);
  if (existing) {
    if (!upsert) {
      stats.skipped++;
      return;
    }
    store.updatePipe(existing.id, data);
    stats.updated++;
  } else {
    store.createPipe(data);
    stats.inserted++;
  }
}

function applyStationItem(data, stats, upsert) {
  const existing = store.getStationByCode(data.code);
  if (existing) {
    if (!upsert) {
      stats.skipped++;
      return;
    }
    store.updateStation(existing.id, data);
    stats.updated++;
  } else {
    store.createStation(data);
    stats.inserted++;
  }
}

async function runImport({
  taskId,
  entityType,
  filePath,
  encoding,
  options = {},
  onProgress,
}) {
  const {
    dryRun = false,
    upsert = true,
    onError = 'skip',
  } = options;

  const db = getDb();
  const isPipe = entityType === 'pipe';
  const aliases = isPipe ? PIPE_FIELD_ALIASES : STATION_FIELD_ALIASES;
  const validateRow = isPipe ? validatePipeRow : validateStationRow;
  const applyItem = isPipe ? applyPipeItem : applyStationItem;

  const headerRow = readHeader(filePath, encoding);
  const { mapping, unknown } = buildHeaderMapping(headerRow, aliases);

  const requiredFields = isPipe
    ? ['code', 'district', 'type']
    : ['code', 'name', 'district'];
  const missingRequired = requiredFields.filter(f => mapping[f] === undefined);

  if (missingRequired.length > 0) {
    throw new Error(`缺少必填列：${missingRequired.join('、')}`);
  }

  const knownDistricts = getKnownDistricts(entityType);

  const stats = {
    total: 0,
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  function reportProgress() {
    if (onProgress) onProgress({ ...stats });
  }

  let failedRows = [];

  try {
    if (onError === 'rollback' && !dryRun) {
      const validation = validateAndCount({
        filePath,
        encoding,
        mapping,
        validateRow,
        knownDistricts,
        onProgress,
        stats,
        collectFailed: true,
      });

      if (validation.hasError) {
        failedRows = validation.failedRows;
        reportProgress();
        const err = new Error(`导入失败，共 ${failedRows.length} 行有错误，已全部回滚`);
        err.isRollback = true;
        err.failedRows = failedRows;
        err.headerRow = headerRow;
        err.stats = { ...stats };
        err.unknownColumns = unknown.map(u => u.header);
        throw err;
      }

      stats.processed = 0;
      stats.total = 0;
      stats.failed = 0;

      const trx = db.transaction(() => {
        for (const { rowNumber, row } of readCsvRows(filePath, encoding)) {
          stats.total++;
          stats.processed++;
          const { data, errors } = validateRow(row, mapping, { knownDistricts });
          if (errors.length > 0) continue;
          applyItem(data, stats, upsert);
        }
      });
      trx();

      failedRows = [];
    } else {
      const fileCodeSet = new Set();
      let batchBuffer = [];

      function flushBatch() {
        if (batchBuffer.length === 0) return;
        if (!dryRun) {
          const trx = db.transaction(() => {
            for (const data of batchBuffer) {
              applyItem(data, stats, upsert);
            }
          });
          trx();
        } else {
          for (const data of batchBuffer) {
            const existing = isPipe
              ? store.getPipeByCode(data.code)
              : store.getStationByCode(data.code);
            if (existing) {
              if (!upsert) {
                stats.skipped++;
              } else {
                stats.updated++;
              }
            } else {
              stats.inserted++;
            }
          }
        }
        batchBuffer = [];
      }

      let lastProgressTime = Date.now();

      for (const { rowNumber, row } of readCsvRows(filePath, encoding)) {
        stats.total++;
        stats.processed++;
        const rawRow = row;
        const { data, errors } = validateRow(row, mapping, { knownDistricts });

        if (errors.length > 0) {
          stats.failed++;
          const reason = errors.map(e => e.message).join('；');
          failedRows.push({ rowNumber, rawRow, reason });
        } else if (fileCodeSet.has(data.code)) {
          stats.failed++;
          failedRows.push({
            rowNumber,
            rawRow,
            reason: `编号「${data.code}」在文件中重复`,
          });
        } else {
          fileCodeSet.add(data.code);
          batchBuffer.push(data);

          if (batchBuffer.length >= BATCH_SIZE) {
            flushBatch();
            const now = Date.now();
            if (now - lastProgressTime >= PROGRESS_INTERVAL_MS && onProgress) {
              lastProgressTime = now;
              onProgress({ ...stats });
            }
          }
        }
      }

      flushBatch();
    }

    reportProgress();

    const result = {
      stats: { ...stats },
      headerRow,
      unknownColumns: unknown.map(u => u.header),
      failedRows: failedRows.map(f => ({
        rowNumber: f.rowNumber,
        reason: f.reason,
      })),
    };

    return { result, failedRows, headerRow };
  } catch (err) {
    reportProgress();
    throw err;
  }
}

module.exports = {
  runImport,
  generateErrorCsv,
  detectEncoding,
  BATCH_SIZE,
};
