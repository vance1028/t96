'use strict';

const fs = require('fs');
const iconv = require('iconv-lite');
const { StringDecoder } = require('string_decoder');

const BUFFER_SIZE = 64 * 1024;
const CHUNK_SIZE = 1000;

const DETECT_ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'gbk', 'gb2312', 'big5'];

function detectEncoding(filePath) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.alloc(BUFFER_SIZE);
    fs.open(filePath, 'r', (err, fd) => {
      if (err) return reject(err);
      fs.read(fd, buf, 0, BUFFER_SIZE, 0, (err, bytesRead) => {
        if (err) {
          fs.close(fd, () => reject(err));
          return;
        }
        fs.close(fd, () => {});
        const sample = buf.slice(0, bytesRead);

        if (sample.length >= 3 && sample[0] === 0xEF && sample[1] === 0xBB && sample[2] === 0xBF) {
          return resolve('utf-8-bom');
        }
        if (sample.length >= 2 && sample[0] === 0xFF && sample[1] === 0xFE) {
          return resolve('utf-16le');
        }
        if (sample.length >= 2 && sample[0] === 0xFE && sample[1] === 0xFF) {
          return resolve('utf-16be');
        }

        let bestEncoding = 'utf-8';
        let bestScore = -Infinity;

        for (const enc of DETECT_ENCODINGS) {
          try {
            const decoded = iconv.decode(sample, enc);
            const score = scoreDecoding(decoded, enc);
            if (score > bestScore) {
              bestScore = score;
              bestEncoding = enc;
            }
          } catch (e) {
            // skip
          }
        }

        resolve(bestEncoding);
      });
    });
  });
}

function scoreDecoding(text, encoding) {
  let score = 0;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  score -= replacementCount * 10;

  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseChars > 0 && (encoding.startsWith('gb') || encoding === 'big5')) {
    score += chineseChars * 0.5;
  }

  const commonCnWords = ['编号', '名称', '区域', '状态', '类型', '管径', '长度', '雨水', '污水', '泵站'];
  for (const word of commonCnWords) {
    if (text.includes(word)) score += 5;
  }

  if (encoding === 'utf-8') score += 1;

  return score;
}

function decodeBuffer(buffer, encoding) {
  if (encoding === 'utf-8-bom') {
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      buffer = buffer.slice(3);
    }
    return buffer.toString('utf-8');
  }
  if (encoding === 'utf-8') {
    return buffer.toString('utf-8');
  }
  return iconv.decode(buffer, encoding);
}

function* readCsvRows(filePath, encoding, { skipHeader = true } = {}) {
  const fd = fs.openSync(filePath, 'r');
  const bufSize = 256 * 1024;
  const buf = Buffer.alloc(bufSize);
  let leftover = '';
  let rowNumber = 0;
  let headerYielded = false;

  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, bufSize, null)) > 0) {
      const chunk = decodeBuffer(buf.slice(0, bytesRead), encoding);
      leftover += chunk;

      let newlineIdx;
      while ((newlineIdx = findNewline(leftover)) !== -1) {
        const rawLine = leftover.slice(0, newlineIdx);
        leftover = leftover.slice(newlineIdx + (leftover[newlineIdx] === '\r' && leftover[newlineIdx + 1] === '\n' ? 2 : 1));

        rowNumber++;
        if (rowNumber === 1 && skipHeader) {
          headerYielded = true;
          continue;
        }

        const trimmed = rawLine.replace(/\r$/, '');
        if (trimmed === '' && leftover === '') continue;

        const row = parseCsvLine(trimmed);
        yield { rowNumber, row };
      }
    }

    if (leftover.trim() !== '') {
      rowNumber++;
      if (!(skipHeader && !headerYielded)) {
        const row = parseCsvLine(leftover.replace(/\r$/, ''));
        yield { rowNumber, row };
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function findNewline(str) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\n') return i;
    if (str[i] === '\r') return i;
  }
  return -1;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        result.push(current);
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  result.push(current);
  return result;
}

function readHeader(filePath, encoding) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(64 * 1024);
  let headerLine = '';
  let leftover = '';

  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, 64 * 1024, null)) > 0) {
      const chunk = decodeBuffer(buf.slice(0, bytesRead), encoding);
      leftover += chunk;

      const nlIdx = findNewline(leftover);
      if (nlIdx !== -1) {
        headerLine = leftover.slice(0, nlIdx).replace(/\r$/, '');
        break;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return parseCsvLine(headerLine);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsvLine(values) {
  return values.map(escapeCsvValue).join(',') + '\r\n';
}

module.exports = {
  detectEncoding,
  decodeBuffer,
  readCsvRows,
  readHeader,
  parseCsvLine,
  escapeCsvValue,
  toCsvLine,
  CHUNK_SIZE,
};
