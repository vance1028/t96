'use strict';

const PIPE_FIELD_ALIASES = {
  code: ['编号', '管段编号', '管段号', 'code', 'Code', 'CODE', '编号_管段', '管段编码'],
  district: ['区域', '所属区域', '辖区', 'district', 'District', 'DISTRICT', '区域名称'],
  type: ['类型', '管道类型', '排水类型', 'type', 'Type', 'TYPE', '管网类型'],
  material: ['材质', '管材', '材料', 'material', 'Material', 'MATERIAL', '管道材质'],
  diameterMm: ['管径', '管径mm', '直径', '公称直径', 'diameter', 'Diameter', 'DIAMETER', 'diameter_mm', '管径(mm)'],
  lengthM: ['长度', '管长', '长度m', 'length', 'Length', 'LENGTH', 'length_m', '长度(米)'],
  status: ['状态', '运行状态', 'status', 'Status', 'STATUS'],
  installedAt: ['安装时间', '投用时间', '建成时间', '安装日期', 'installed_at', 'installedAt', 'InstalledAt'],
  remark: ['备注', '说明', 'remark', 'Remark', 'REMARK', '备注说明'],
};

const STATION_FIELD_ALIASES = {
  code: ['编号', '泵站编号', '泵站号', 'code', 'Code', 'CODE', '编号_泵站', '泵站编码'],
  name: ['名称', '泵站名称', '站名', 'name', 'Name', 'NAME', '泵站名'],
  district: ['区域', '所属区域', '辖区', 'district', 'District', 'DISTRICT', '区域名称'],
  capacityM3h: ['排水能力', '流量', '设计流量', 'capacity', 'Capacity', 'CAPACITY', 'capacity_m3h', '排水能力(m3/h)', '流量(m3/h)'],
  pumpCount: ['泵台数', '水泵数量', '泵数', 'pump_count', 'pumpCount', 'PumpCount', '水泵台数', '台数'],
  status: ['状态', '运行状态', 'status', 'Status', 'STATUS'],
  location: ['位置', '地址', '地理位置', 'location', 'Location', 'LOCATION', '所在地址'],
};

const PIPE_TYPE_MAP = {
  '雨水': 'rain',
  '污水': 'sewage',
  '合流': 'combined',
  '雨污合流': 'combined',
  'rain': 'rain',
  'sewage': 'sewage',
  'combined': 'combined',
  'RAIN': 'rain',
  'SEWAGE': 'sewage',
  'COMBINED': 'combined',
};

const PIPE_STATUS_MAP = {
  '正常': 'normal',
  '预警': 'warning',
  '检修': 'maintenance',
  '废弃': 'abandoned',
  '在用': 'normal',
  '停用': 'abandoned',
  'normal': 'normal',
  'warning': 'warning',
  'maintenance': 'maintenance',
  'abandoned': 'abandoned',
  'NORMAL': 'normal',
  'WARNING': 'warning',
  'MAINTENANCE': 'maintenance',
  'ABANDONED': 'abandoned',
};

const STATION_STATUS_MAP = {
  '运行': 'running',
  '备用': 'standby',
  '故障': 'fault',
  '检修': 'maintenance',
  '运行中': 'running',
  '停用': 'fault',
  'running': 'running',
  'standby': 'standby',
  'fault': 'fault',
  'maintenance': 'maintenance',
  'RUNNING': 'running',
  'STANDBY': 'standby',
  'FAULT': 'fault',
  'MAINTENANCE': 'maintenance',
};

const PIPE_TYPE_REVERSE = {
  rain: '雨水',
  sewage: '污水',
  combined: '合流',
};

const PIPE_STATUS_REVERSE = {
  normal: '正常',
  warning: '预警',
  maintenance: '检修',
  abandoned: '废弃',
};

const STATION_STATUS_REVERSE = {
  running: '运行',
  standby: '备用',
  fault: '故障',
  maintenance: '检修',
};

const PIPE_EXPORT_COLUMNS = [
  { key: 'code', label: '编号' },
  { key: 'district', label: '区域' },
  { key: 'type', label: '类型', map: PIPE_TYPE_REVERSE },
  { key: 'material', label: '材质' },
  { key: 'diameterMm', label: '管径(mm)' },
  { key: 'lengthM', label: '长度(米)' },
  { key: 'status', label: '状态', map: PIPE_STATUS_REVERSE },
  { key: 'installedAt', label: '安装时间' },
  { key: 'remark', label: '备注' },
];

const STATION_EXPORT_COLUMNS = [
  { key: 'code', label: '编号' },
  { key: 'name', label: '名称' },
  { key: 'district', label: '区域' },
  { key: 'capacityM3h', label: '排水能力(m³/h)' },
  { key: 'pumpCount', label: '泵台数' },
  { key: 'status', label: '状态', map: STATION_STATUS_REVERSE },
  { key: 'location', label: '位置' },
];

function buildHeaderMapping(headerRow, aliases) {
  const mapping = {};
  const unknown = [];

  for (let i = 0; i < headerRow.length; i++) {
    const rawHeader = headerRow[i];
    const header = rawHeader.trim();
    if (header === '') continue;

    let matched = null;
    for (const [field, aliasList] of Object.entries(aliases)) {
      if (aliasList.some(alias => alias.toLowerCase() === header.toLowerCase())) {
        matched = field;
        break;
      }
    }

    if (matched) {
      mapping[matched] = i;
    } else {
      unknown.push({ index: i, header: rawHeader });
    }
  }

  return { mapping, unknown };
}

function mapPipeType(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  return PIPE_TYPE_MAP[v] || null;
}

function mapPipeStatus(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  return PIPE_STATUS_MAP[v] || null;
}

function mapStationStatus(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  return STATION_STATUS_MAP[v] || null;
}

function getPipeExportColumns() {
  return PIPE_EXPORT_COLUMNS;
}

function getStationExportColumns() {
  return STATION_EXPORT_COLUMNS;
}

module.exports = {
  PIPE_FIELD_ALIASES,
  STATION_FIELD_ALIASES,
  PIPE_TYPE_MAP,
  PIPE_STATUS_MAP,
  STATION_STATUS_MAP,
  PIPE_TYPE_REVERSE,
  PIPE_STATUS_REVERSE,
  STATION_STATUS_REVERSE,
  PIPE_EXPORT_COLUMNS,
  STATION_EXPORT_COLUMNS,
  buildHeaderMapping,
  mapPipeType,
  mapPipeStatus,
  mapStationStatus,
  getPipeExportColumns,
  getStationExportColumns,
};
