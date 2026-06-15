'use strict';

const { mapPipeType, mapPipeStatus, mapStationStatus } = require('./fieldMapping');

const PIPE_TYPES = ['rain', 'sewage', 'combined'];
const PIPE_STATUS = ['normal', 'warning', 'maintenance', 'abandoned'];
const STATION_STATUS = ['running', 'standby', 'fault', 'maintenance'];

class RowValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'RowValidationError';
    this.field = field;
  }
}

function requireField(row, mapping, fieldName, label) {
  const idx = mapping[fieldName];
  if (idx === undefined) {
    throw new RowValidationError(`缺少必填列「${label}」`, fieldName);
  }
  const value = row[idx];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new RowValidationError(`「${label}」不能为空`, fieldName);
  }
  return String(value).trim();
}

function optionalField(row, mapping, fieldName) {
  const idx = mapping[fieldName];
  if (idx === undefined) return null;
  const value = row[idx];
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return String(value).trim();
}

function parseInteger(value, label, { min } = {}) {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new RowValidationError(`「${label}」必须是整数`, label);
  }
  if (min !== undefined && n < min) {
    throw new RowValidationError(`「${label}」不能小于 ${min}`, label);
  }
  return n;
}

function parseNumber(value, label, { min } = {}) {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new RowValidationError(`「${label}」必须是数字`, label);
  }
  if (min !== undefined && n < min) {
    throw new RowValidationError(`「${label}」不能小于 ${min}`, label);
  }
  return n;
}

function validatePipeRow(row, mapping, { knownDistricts }) {
  const errors = [];
  const data = {};

  try {
    data.code = requireField(row, mapping, 'code', '编号');
    if (data.code.length > 64) {
      errors.push(new RowValidationError('「编号」长度不能超过 64 个字符', 'code'));
    }
  } catch (e) {
    errors.push(e);
  }

  try {
    data.district = requireField(row, mapping, 'district', '区域');
    if (knownDistricts && knownDistricts.size > 0 && !knownDistricts.has(data.district)) {
      errors.push(new RowValidationError(`「区域」未知：${data.district}`, 'district'));
    }
  } catch (e) {
    errors.push(e);
  }

  try {
    const typeRaw = requireField(row, mapping, 'type', '类型');
    const typeMapped = mapPipeType(typeRaw);
    if (!typeMapped) {
      errors.push(new RowValidationError(`「类型」无效：${typeRaw}，应为 雨水/污水/合流`, 'type'));
    } else {
      data.type = typeMapped;
    }
  } catch (e) {
    errors.push(e);
  }

  const statusRaw = optionalField(row, mapping, 'status');
  if (statusRaw !== null) {
    const statusMapped = mapPipeStatus(statusRaw);
    if (!statusMapped) {
      errors.push(new RowValidationError(`「状态」无效：${statusRaw}，应为 正常/预警/检修/废弃`, 'status'));
    } else {
      data.status = statusMapped;
    }
  } else {
    data.status = 'normal';
  }

  const materialRaw = optionalField(row, mapping, 'material');
  if (materialRaw !== null) {
    if (materialRaw.length > 64) {
      errors.push(new RowValidationError('「材质」长度不能超过 64 个字符', 'material'));
    }
    data.material = materialRaw;
  } else {
    data.material = null;
  }

  const diameterRaw = optionalField(row, mapping, 'diameterMm');
  try {
    data.diameterMm = parseInteger(diameterRaw, '管径', { min: 0 });
  } catch (e) {
    errors.push(e);
  }

  const lengthRaw = optionalField(row, mapping, 'lengthM');
  try {
    data.lengthM = parseNumber(lengthRaw, '长度', { min: 0 });
  } catch (e) {
    errors.push(e);
  }

  const installedRaw = optionalField(row, mapping, 'installedAt');
  if (installedRaw !== null) {
    if (installedRaw.length > 32) {
      errors.push(new RowValidationError('「安装时间」长度不能超过 32 个字符', 'installedAt'));
    }
    data.installedAt = installedRaw;
  } else {
    data.installedAt = null;
  }

  const remarkRaw = optionalField(row, mapping, 'remark');
  if (remarkRaw !== null) {
    if (remarkRaw.length > 500) {
      errors.push(new RowValidationError('「备注」长度不能超过 500 个字符', 'remark'));
    }
    data.remark = remarkRaw;
  } else {
    data.remark = null;
  }

  return { data, errors };
}

function validateStationRow(row, mapping, { knownDistricts }) {
  const errors = [];
  const data = {};

  try {
    data.code = requireField(row, mapping, 'code', '编号');
    if (data.code.length > 64) {
      errors.push(new RowValidationError('「编号」长度不能超过 64 个字符', 'code'));
    }
  } catch (e) {
    errors.push(e);
  }

  try {
    data.name = requireField(row, mapping, 'name', '名称');
    if (data.name.length > 128) {
      errors.push(new RowValidationError('「名称」长度不能超过 128 个字符', 'name'));
    }
  } catch (e) {
    errors.push(e);
  }

  try {
    data.district = requireField(row, mapping, 'district', '区域');
    if (knownDistricts && knownDistricts.size > 0 && !knownDistricts.has(data.district)) {
      errors.push(new RowValidationError(`「区域」未知：${data.district}`, 'district'));
    }
  } catch (e) {
    errors.push(e);
  }

  const statusRaw = optionalField(row, mapping, 'status');
  if (statusRaw !== null) {
    const statusMapped = mapStationStatus(statusRaw);
    if (!statusMapped) {
      errors.push(new RowValidationError(`「状态」无效：${statusRaw}，应为 运行/备用/故障/检修`, 'status'));
    } else {
      data.status = statusMapped;
    }
  } else {
    data.status = 'standby';
  }

  const capacityRaw = optionalField(row, mapping, 'capacityM3h');
  try {
    data.capacityM3h = parseNumber(capacityRaw, '排水能力', { min: 0 });
  } catch (e) {
    errors.push(e);
  }

  const pumpCountRaw = optionalField(row, mapping, 'pumpCount');
  try {
    const n = parseInteger(pumpCountRaw, '泵台数', { min: 0 });
    data.pumpCount = n === null ? 0 : n;
  } catch (e) {
    errors.push(e);
  }

  const locationRaw = optionalField(row, mapping, 'location');
  if (locationRaw !== null) {
    if (locationRaw.length > 255) {
      errors.push(new RowValidationError('「位置」长度不能超过 255 个字符', 'location'));
    }
    data.location = locationRaw;
  } else {
    data.location = null;
  }

  return { data, errors };
}

module.exports = {
  RowValidationError,
  validatePipeRow,
  validateStationRow,
  PIPE_TYPES,
  PIPE_STATUS,
  STATION_STATUS,
};
