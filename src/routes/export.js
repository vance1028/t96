'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, HttpError } = require('../utils/http');
const {
  createExportTask,
  getExportTask,
  listExportTasks,
} = require('../batch/taskManager');
const { scheduleExport } = require('../batch/taskScheduler');

const router = express.Router();

const EXPORT_DIR = path.join(__dirname, '..', '..', 'data', 'exports');

if (!fs.existsSync(EXPORT_DIR)) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

router.use(authRequired);

router.post('/pipes', (req, res) => {
  try {
    const filters = {
      district: req.body.district || null,
      type: req.body.type || null,
      status: req.body.status || null,
      keyword: req.body.keyword || null,
    };

    const encoding = req.body.encoding || 'utf-8';
    const validEncodings = ['utf-8', 'utf-8-bom', 'gbk'];
    if (!validEncodings.includes(encoding)) {
      return sendError(res, 400, `编码只能是 ${validEncodings.join(' / ')} 之一`);
    }

    const task = createExportTask({
      entityType: 'pipe',
      options: { filters },
      encoding,
      createdBy: req.user ? req.user.id : null,
    });

    scheduleExport(task.taskId);

    return sendData(res, 202, {
      taskId: task.taskId,
      status: 'pending',
      message: '导出任务已提交，正在后台处理',
    });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.post('/stations', (req, res) => {
  try {
    const filters = {
      district: req.body.district || null,
      status: req.body.status || null,
      keyword: req.body.keyword || null,
    };

    const encoding = req.body.encoding || 'utf-8';
    const validEncodings = ['utf-8', 'utf-8-bom', 'gbk'];
    if (!validEncodings.includes(encoding)) {
      return sendError(res, 400, `编码只能是 ${validEncodings.join(' / ')} 之一`);
    }

    const task = createExportTask({
      entityType: 'station',
      options: { filters },
      encoding,
      createdBy: req.user ? req.user.id : null,
    });

    scheduleExport(task.taskId);

    return sendData(res, 202, {
      taskId: task.taskId,
      status: 'pending',
      message: '导出任务已提交，正在后台处理',
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
    const tasks = listExportTasks({ limit, offset });
    return sendData(res, 200, tasks, { total: tasks.length });
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.get('/tasks/:taskId', (req, res) => {
  try {
    const task = getExportTask(req.params.taskId);
    if (!task) return sendError(res, 404, '任务不存在');

    const result = {
      taskId: task.taskId,
      type: task.type,
      entityType: task.entityType,
      status: task.status,
      totalRows: task.totalRows,
      exportedRows: task.exportedRows,
      encoding: task.encoding,
      fileName: task.fileName,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      errorMessage: task.errorMessage,
    };

    if (task.status === 'completed' && task.filePath) {
      result.downloadAvailable = true;
    }

    return sendData(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message, err.details);
    console.error(err);
    return sendError(res, 500, '服务器内部错误');
  }
});

router.get('/tasks/:taskId/download', (req, res) => {
  try {
    const task = getExportTask(req.params.taskId);
    if (!task) return sendError(res, 404, '任务不存在');

    if (task.status !== 'completed' || !task.filePath) {
      return sendError(res, 400, '导出尚未完成或文件不存在');
    }

    const filePath = task.filePath;
    if (!fs.existsSync(filePath)) {
      return sendError(res, 404, '导出文件不存在');
    }

    const fileName = task.fileName || `export_${task.taskId}.csv`;

    const contentType = task.encoding === 'gbk' || task.encoding === 'gb2312'
      ? 'text/csv; charset=gbk'
      : 'text/csv; charset=utf-8';

    res.setHeader('Content-Type', contentType);
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
