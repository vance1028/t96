'use strict';

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { getDb } = require('../db');
const {
  toCsvLine,
} = require('./csvUtils');
const {
  PIPE_EXPORT_COLUMNS,
  STATION_EXPORT_COLUMNS,
} = require('./fieldMapping');

const EXPORT_BATCH_SIZE = 1000;
const PROGRESS_INTERVAL_MS = 200;

function countPipes(filters) {
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.district) { where.push('district = ?'); params.push(filters.district); }
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.keyword) {
    where.push('(code LIKE ? OR remark LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT COUNT(*) AS n FROM pipe_segments ${clause}`).get(...params).n;
}

function countStations(filters) {
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.district) { where.push('district = ?'); params.push(filters.district); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.keyword) {
    where.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT COUNT(*) AS n FROM pump_stations ${clause}`).get(...params).n;
}

function* iteratePipes(filters, batchSize = EXPORT_BATCH_SIZE) {
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.district) { where.push('district = ?'); params.push(filters.district); }
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.keyword) {
    where.push('(code LIKE ? OR remark LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM pipe_segments ${clause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const stmt = db.prepare(sql);

  let offset = 0;
  while (true) {
    const rows = stmt.all(...params, batchSize, offset);
    if (rows.length === 0) break;
    for (const row of rows) {
      yield {
        id: row.id,
        code: row.code,
        district: row.district,
        type: row.type,
        material: row.material,
        diameterMm: row.diameter_mm,
        lengthM: row.length_m,
        status: row.status,
        installedAt: row.installed_at,
        remark: row.remark,
      };
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
}

function* iterateStations(filters, batchSize = EXPORT_BATCH_SIZE) {
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.district) { where.push('district = ?'); params.push(filters.district); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.keyword) {
    where.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM pump_stations ${clause} ORDER BY id ASC LIMIT ? OFFSET ?`;
  const stmt = db.prepare(sql);

  let offset = 0;
  while (true) {
    const rows = stmt.all(...params, batchSize, offset);
    if (rows.length === 0) break;
    for (const row of rows) {
      yield {
        id: row.id,
        code: row.code,
        name: row.name,
        district: row.district,
        capacityM3h: row.capacity_m3h,
        pumpCount: row.pump_count,
        status: row.status,
        location: row.location,
      };
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }
}

function formatValue(value, columnMap) {
  if (value === null || value === undefined) return '';
  if (columnMap) {
    const mapped = columnMap[value];
    if (mapped !== undefined) return mapped;
  }
  return String(value);
}

async function runExport({
  taskId,
  entityType,
  filters = {},
  outputPath,
  encoding = 'utf-8',
  onProgress,
}) {
  const isPipe = entityType === 'pipe';
  const columns = isPipe ? PIPE_EXPORT_COLUMNS : STATION_EXPORT_COLUMNS;
  const total = isPipe ? countPipes(filters) : countStations(filters);

  const fd = fs.openSync(outputPath, 'w');
  let exported = 0;
  let lastProgressTime = Date.now();

  try {
    const useGbk = encoding === 'gbk' || encoding === 'gb2312';
    const useBom = encoding === 'utf-8-bom';

    if (useBom) {
      fs.writeSync(fd, Buffer.from([0xEF, 0xBB, 0xBF]));
    }

    const headerLabels = columns.map(c => c.label);
    if (useGbk) {
      fs.writeSync(fd, iconv.encode(toCsvLine(headerLabels), encoding));
    } else {
      fs.writeSync(fd, toCsvLine(headerLabels), 'utf-8');
    }

    const iterator = isPipe
      ? iteratePipes(filters, EXPORT_BATCH_SIZE)
      : iterateStations(filters, EXPORT_BATCH_SIZE);

    for (const row of iterator) {
      const values = columns.map(col => {
        const val = row[col.key];
        return formatValue(val, col.map);
      });

      if (useGbk) {
        fs.writeSync(fd, iconv.encode(toCsvLine(values), encoding));
      } else {
        fs.writeSync(fd, toCsvLine(values), 'utf-8');
      }

      exported++;

      const now = Date.now();
      if (now - lastProgressTime >= PROGRESS_INTERVAL_MS && onProgress) {
        lastProgressTime = now;
        onProgress({ total, exported });
      }
    }

    if (onProgress) {
      onProgress({ total, exported });
    }

    return { total, exported, filePath: outputPath };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  runExport,
  countPipes,
  countStations,
  iteratePipes,
  iterateStations,
  EXPORT_BATCH_SIZE,
};
