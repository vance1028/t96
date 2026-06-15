'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, HttpError } = require('../utils/http');
const {
  createImportTask,
  getImportTask,
  listImportTasks,
} = require('../batch/taskManager');
const { scheduleImport } = require('../batch/taskScheduler');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const ext = path.extname(file.originalname);
    cb(null, `import_${timestamp}_${random}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv' || ext === '.txt') {
      cb(null, true);
    } else {
      cb(new HttpError(400, '只支持 CSV 文件'));
    }
  },
});

router.use(authRequired);

router.post('/pipes', requireRole('admin', 'operator'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 400, '请上传 CSV 文件');
    }

    const dryRun = req.body.dryRun === 'true' || req.body.dryRun === true;
    const upsert = req.body.upsert !== 'false' && req.body.upsert !== false;
    const onError = req.body.onError === 'rollback' ? 'rollback' : 'skip';
    const encoding = req.body.encoding || null;

    const task = createImportTask({
      entityType: 'pipe',
      options: { dryRun, upsert, onError },
      filePath: req.file.path,
      fileName: req.file.originalname,
      createdBy: req.user ? req.user.id : null,
    });

    if (encoding) {
      const { updateImportTask } = require('../batch/taskManager');
      updateImportTask(task.taskId, { encoding });
    }

    scheduleImport(task.taskId);

    return sendData(res, 202, {
      taskId: task.taskId,
      status: 'pending',
      message: '导入任务已提交，正在后台处理',
    });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.post('/stations', requireRole('admin', 'operator'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return sendError(res, 400, '请上传 CSV 文件');
    }

    const dryRun = req.body.dryRun === 'true' || req.body.dryRun === true;
    const upsert = req.body.upsert !== 'false' && req.body.upsert !== false;
    const onError = req.body.onError === 'rollback' ? 'rollback' : 'skip';
    const encoding = req.body.encoding || null;

    const task = createImportTask({
      entityType: 'station',
      options: { dryRun, upsert, onError },
      filePath: req.file.path,
      fileName: req.file.originalname,
      createdBy: req.user ? req.user.id : null,
    });

    if (encoding) {
      const { updateImportTask } = require('../batch/taskManager');
      updateImportTask(task.taskId, { encoding });
    }

    scheduleImport(task.taskId);

    return sendData(res, 202, {
      taskId: task.taskId,
      status: 'pending',
      message: '导入任务已提交，正在后台处理',
    });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.get('/tasks', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;
    const tasks = listImportTasks({ limit, offset });
    return sendData(res, 200, tasks, { total: tasks.length });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.get('/tasks/:taskId', (req, res) => {
  try {
    const task = getImportTask(req.params.taskId);
    if (!task) return sendError(res, 404, '任务不存在');

    const result = {
      taskId: task.taskId,
      type: task.type,
      entityType: task.entityType,
      status: task.status,
      totalRows: task.totalRows,
      processedRows: task.processedRows,
      insertedCount: task.insertedCount,
      updatedCount: task.updatedCount,
      skippedCount: task.skippedCount,
      failedCount: task.failedCount,
      encoding: task.encoding,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      errorMessage: task.errorMessage,
    };

    if (task.status === 'completed' && task.result) {
      result.result = {
        stats: task.result.stats,
        unknownColumns: task.result.unknownColumns,
        failedRows: task.result.failedRows ? task.result.failedRows.slice(0, 100) : [],
        hasErrorCsv: !!task.result.errorCsvPath,
      };
    }

    return sendData(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.get('/tasks/:taskId/errors', (req, res) => {
  try {
    const task = getImportTask(req.params.taskId);
    if (!task) return sendError(res, 404, '任务不存在');

    if (!task.result || !task.result.errorCsvPath) {
      return sendError(res, 404, '没有错误文件');
    }

    const filePath = task.result.errorCsvPath;
    if (!fs.existsSync(filePath)) {
      return sendError(res, 404, '错误文件不存在');
    }

    const fileName = task.result.errorCsvFileName || `errors_${task.taskId}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

module.exports = router;
