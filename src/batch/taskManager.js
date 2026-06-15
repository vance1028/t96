'use strict';

const crypto = require('crypto');
const { getDb } = require('../db');

function generateTaskId() {
  return 'task_' + crypto.randomBytes(12).toString('hex');
}

function mapImportTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    entityType: row.entity_type,
    status: row.status,
    totalRows: row.total_rows,
    processedRows: row.processed_rows,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    options: row.options_json ? JSON.parse(row.options_json) : {},
    filePath: row.file_path,
    fileName: row.file_name,
    encoding: row.encoding,
    errorMessage: row.error_message,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExportTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type,
    entityType: row.entity_type,
    status: row.status,
    totalRows: row.total_rows,
    exportedRows: row.exported_rows,
    options: row.options_json ? JSON.parse(row.options_json) : {},
    filePath: row.file_path,
    fileName: row.file_name,
    encoding: row.encoding,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createImportTask({ entityType, options, filePath, fileName, createdBy }) {
  const taskId = generateTaskId();
  const db = getDb();
  db.prepare(
    `INSERT INTO import_tasks
       (task_id, type, entity_type, status, options_json, file_path, file_name, created_by)
     VALUES (?, 'import', ?, 'pending', ?, ?, ?, ?)`,
  ).run(taskId, entityType, JSON.stringify(options || {}), filePath, fileName, createdBy || null);
  return getImportTask(taskId);
}

function getImportTask(taskId) {
  const row = getDb().prepare('SELECT * FROM import_tasks WHERE task_id = ?').get(taskId);
  return mapImportTask(row);
}

function updateImportTask(taskId, fields) {
  const db = getDb();
  const allowed = {
    status: 'status',
    totalRows: 'total_rows',
    processedRows: 'processed_rows',
    insertedCount: 'inserted_count',
    updatedCount: 'updated_count',
    skippedCount: 'skipped_count',
    failedCount: 'failed_count',
    encoding: 'encoding',
    errorMessage: 'error_message',
    result: 'result_json',
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(key === 'result' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }
  if (sets.length === 0) return getImportTask(taskId);
  sets.push("updated_at = datetime('now')");
  params.push(taskId);
  db.prepare(`UPDATE import_tasks SET ${sets.join(', ')} WHERE task_id = ?`).run(...params);
  return getImportTask(taskId);
}

function listImportTasks({ limit = 20, offset = 0 } = {}) {
  const rows = getDb()
    .prepare('SELECT * FROM import_tasks ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  return rows.map(mapImportTask);
}

function createExportTask({ entityType, options, encoding, createdBy }) {
  const taskId = generateTaskId();
  const db = getDb();
  db.prepare(
    `INSERT INTO export_tasks
       (task_id, type, entity_type, status, options_json, encoding, created_by)
     VALUES (?, 'export', ?, 'pending', ?, ?, ?)`,
  ).run(taskId, entityType, JSON.stringify(options || {}), encoding || 'utf-8', createdBy || null);
  return getExportTask(taskId);
}

function getExportTask(taskId) {
  const row = getDb().prepare('SELECT * FROM export_tasks WHERE task_id = ?').get(taskId);
  return mapExportTask(row);
}

function updateExportTask(taskId, fields) {
  const db = getDb();
  const allowed = {
    status: 'status',
    totalRows: 'total_rows',
    exportedRows: 'exported_rows',
    filePath: 'file_path',
    fileName: 'file_name',
    encoding: 'encoding',
    errorMessage: 'error_message',
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return getExportTask(taskId);
  sets.push("updated_at = datetime('now')");
  params.push(taskId);
  db.prepare(`UPDATE export_tasks SET ${sets.join(', ')} WHERE task_id = ?`).run(...params);
  return getExportTask(taskId);
}

function listExportTasks({ limit = 20, offset = 0 } = {}) {
  const rows = getDb()
    .prepare('SELECT * FROM export_tasks ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  return rows.map(mapExportTask);
}

module.exports = {
  generateTaskId,
  createImportTask,
  getImportTask,
  updateImportTask,
  listImportTasks,
  createExportTask,
  getExportTask,
  updateExportTask,
  listExportTasks,
};
