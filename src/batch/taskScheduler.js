'use strict';

const path = require('path');
const fs = require('fs');
const {
  updateImportTask,
  updateExportTask,
  getImportTask,
  getExportTask,
} = require('./taskManager');
const { runImport, generateErrorCsv, detectEncoding } = require('./importEngine');
const { runExport } = require('./exportEngine');

const MAX_PARALLEL_TASKS = 2;
let runningCount = 0;
const queue = [];

const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');

function scheduleImport(taskId) {
  queue.push({ type: 'import', taskId });
  processQueue();
}

function scheduleExport(taskId) {
  queue.push({ type: 'export', taskId });
  processQueue();
}

function processQueue() {
  if (runningCount >= MAX_PARALLEL_TASKS) return;
  if (queue.length === 0) return;

  const task = queue.shift();
  runningCount++;

  if (task.type === 'import') {
    runImportTask(task.taskId).finally(() => {
      runningCount--;
      processQueue();
    });
  } else {
    runExportTask(task.taskId).finally(() => {
      runningCount--;
      processQueue();
    });
  }
}

async function runImportTask(taskId) {
  const task = getImportTask(taskId);
  if (!task) return;

  let encoding = task.encoding;

  try {
    updateImportTask(taskId, { status: 'processing' });

    if (!encoding) {
      encoding = await detectEncoding(task.filePath);
      updateImportTask(taskId, { encoding });
    }

    const { result, failedRows, headerRow } = await runImport({
      taskId,
      entityType: task.entityType,
      filePath: task.filePath,
      encoding,
      options: task.options,
      onProgress: (stats) => {
        updateImportTask(taskId, {
          totalRows: stats.total,
          processedRows: stats.processed,
          insertedCount: stats.inserted,
          updatedCount: stats.updated,
          skippedCount: stats.skipped,
          failedCount: stats.failed,
        });
      },
    });

    let errorCsvPath = null;
    if (failedRows && failedRows.length > 0) {
      const errorFileName = `errors_${taskId}.csv`;
      errorCsvPath = path.join(EXPORT_DIR, errorFileName);
      generateErrorCsv(task.filePath, encoding, headerRow, failedRows, errorCsvPath);
    }

    const fullResult = {
      ...result,
      errorCsvPath,
      errorCsvFileName: errorCsvPath ? path.basename(errorCsvPath) : null,
    };

    updateImportTask(taskId, {
      status: 'completed',
      result: fullResult,
      totalRows: result.stats.total,
      processedRows: result.stats.processed,
      insertedCount: result.stats.inserted,
      updatedCount: result.stats.updated,
      skippedCount: result.stats.skipped,
      failedCount: result.stats.failed,
    });
  } catch (err) {
    console.error(`Import task ${taskId} failed:`, err.message);

    if (err.isRollback && err.failedRows && err.headerRow) {
      let errorCsvPath = null;
      if (err.failedRows.length > 0) {
        const errorFileName = `errors_${taskId}.csv`;
        errorCsvPath = path.join(EXPORT_DIR, errorFileName);
        try {
          generateErrorCsv(task.filePath, encoding, err.headerRow, err.failedRows, errorCsvPath);
        } catch (e) {
          console.error('生成错误 CSV 失败:', e);
        }
      }

      const result = {
        stats: err.stats || {},
        headerRow: err.headerRow,
        unknownColumns: err.unknownColumns || [],
        failedRows: err.failedRows.map(f => ({
          rowNumber: f.rowNumber,
          reason: f.reason,
        })),
        errorCsvPath,
        errorCsvFileName: errorCsvPath ? path.basename(errorCsvPath) : null,
      };

      updateImportTask(taskId, {
        status: 'failed',
        errorMessage: err.message || String(err),
        result,
        totalRows: err.stats ? err.stats.total : 0,
        processedRows: err.stats ? err.stats.processed : 0,
        failedCount: err.stats ? err.stats.failed : 0,
      });
    } else {
      updateImportTask(taskId, {
        status: 'failed',
        errorMessage: err.message || String(err),
      });
    }
  }
}

async function runExportTask(taskId) {
  const task = getExportTask(taskId);
  if (!task) return;

  try {
    updateExportTask(taskId, { status: 'processing' });

    const fileName = `${task.entityType}_export_${taskId}.csv`;
    const outputPath = path.join(EXPORT_DIR, fileName);
    const filters = task.options.filters || {};

    const { total, exported } = await runExport({
      taskId,
      entityType: task.entityType,
      filters,
      outputPath,
      encoding: task.encoding || 'utf-8',
      onProgress: (stats) => {
        updateExportTask(taskId, {
          totalRows: stats.total,
          exportedRows: stats.exported,
        });
      },
    });

    updateExportTask(taskId, {
      status: 'completed',
      totalRows: total,
      exportedRows: exported,
      filePath: outputPath,
      fileName,
    });
  } catch (err) {
    console.error(`Export task ${taskId} failed:`, err);
    updateExportTask(taskId, {
      status: 'failed',
      errorMessage: err.message || String(err),
    });
  }
}

module.exports = {
  scheduleImport,
  scheduleExport,
};
