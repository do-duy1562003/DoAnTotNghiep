/**
 * NấmSmart Server
 * - Xác thực người dùng
 * - Phục vụ static files
 * - Proxy WebSocket đến ESP32
 * 
 * Cài đặt:
 *   npm install express cors http-proxy-ws jsonwebtoken
 * 
 * Chạy:
 *   node server.js
 * 
 * Truy cập:
 *   http://localhost:3000
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const httpProxy = require('http-proxy-ws');
const ExcelJS = require('exceljs');

const app = express();
const server = http.createServer(app);

// ════════════════════════════════════════════════════════════
// ⚙️  CONFIG
// ════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const ESP32_IP = process.env.ESP32_IP || 'localhost';
const ESP32_PORT = process.env.ESP32_PORT || 8080;

// Tải danh sách người dùng từ file (có thể là database sau)
let USERS = {};
const AUTH_FILE = path.join(__dirname, 'auth.json');

function loadUsers() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      USERS = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    } else {
      // Tài khoản mặc định
      USERS = {
        admin: { password: '123456', name: 'Admin' },
        user1: { password: 'password123', name: 'Người Dùng 1' }
      };
      fs.writeFileSync(AUTH_FILE, JSON.stringify(USERS, null, 2));
    }
  } catch (error) {
    console.error('Lỗi tải auth.json:', error);
  }
}

loadUsers();

// ════════════════════════════════════════════════════════════
// 📊 SENSOR DATA STORAGE
// ════════════════════════════════════════════════════════════

let sensorDataLog = [];
const MAX_LOG_ENTRIES = 10000;
const SENSOR_LOG_FILE = path.join(__dirname, 'data', 'sensor_log.json');
const DEVICE_LABELS = {
  den_suoi1: 'Đèn sưởi 1',
  den_suoi2: 'Đèn sưởi 2',
  quat_hut1: 'Quạt hút 1',
  quat_hut2: 'Quạt hút 2',
  den_phong: 'Đèn phòng',
  phun_suong: 'Phun sương',
  quat_suong: 'Quạt sương',
  device8: 'Thiết bị 8'
};

function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadSensorLog() {
  ensureDataDir();
  try {
    if (fs.existsSync(SENSOR_LOG_FILE)) {
      sensorDataLog = JSON.parse(fs.readFileSync(SENSOR_LOG_FILE, 'utf8'));
    }
  } catch (error) {
    console.log('Tạo log cảm biến mới...');
    sensorDataLog = [];
  }
}

function saveSensorLog() {
  try {
    ensureDataDir();
    fs.writeFileSync(SENSOR_LOG_FILE, JSON.stringify(sensorDataLog, null, 2));
  } catch (error) {
    console.error('Lỗi lưu sensor log:', error);
  }
}

loadSensorLog();

// ════════════════════════════════════════════════════════════
// 🔧 MIDDLEWARE
// ════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // Phục vụ file tĩnh

// ════════════════════════════════════════════════════════════
// 🔐 AUTHENTICATION
// ════════════════════════════════════════════════════════════

function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'Không có token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
}

// ════════════════════════════════════════════════════════════
// 📝 API ENDPOINTS
// ════════════════════════════════════════════════════════════

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Thiếu tài khoản hoặc mật khẩu' });
  }

  const user = USERS[username];
  
  if (!user || user.password !== password) {
    return res.status(401).json({ message: 'Tài khoản hoặc mật khẩu không chính xác' });
  }

  const token = jwt.sign(
    { username, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { username, name: user.name }
  });
});

// Logout (phía client xóa token)
app.post('/api/logout', verifyToken, (req, res) => {
  res.json({ message: 'Đã đăng xuất' });
});

// Kiểm tra token
app.get('/api/verify', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// Danh sách người dùng (chỉ admin)
app.get('/api/users', verifyToken, (req, res) => {
  if (req.user.username !== 'admin') {
    return res.status(403).json({ message: 'Không có quyền' });
  }
  res.json(Object.keys(USERS).map(username => ({
    username,
    name: USERS[username].name
  })));
});

// Thêm người dùng (chỉ admin)
app.post('/api/users', verifyToken, (req, res) => {
  const { username, password, name } = req.body;

  if (req.user.username !== 'admin') {
    return res.status(403).json({ message: 'Không có quyền' });
  }

  if (!username || !password) {
    return res.status(400).json({ message: 'Thiếu thông tin' });
  }

  if (USERS[username]) {
    return res.status(409).json({ message: 'Tài khoản đã tồn tại' });
  }

  USERS[username] = { password, name: name || username };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(USERS, null, 2));

  res.status(201).json({ message: 'Tài khoản tạo thành công' });
});

// ════════════════════════════════════════════════════════════
// 📊 LƯU DỮ LIỆU CẢM BIẾN
// ════════════════════════════════════════════════════════════

app.post('/api/sensor-data', verifyToken, (req, res) => {
  const { temp, humi, lux, soil, roomA_status, devices, performance, events, commandHistory } = req.body;
  
  const entry = {
    timestamp: new Date().toISOString(),
    temp: temp || 0,
    humi: humi || 0,
    lux: lux || 0,
    soil: soil || 0,
    roomA_status: roomA_status || 'offline',
    devices: devices || {},
    performance: performance || {},
    events: Array.isArray(events) ? events : [],
    commandHistory: Array.isArray(commandHistory) ? commandHistory : [],
    user: req.user.username
  };

  sensorDataLog.push(entry);

  // Giữ số lượng log hợp lý
  if (sensorDataLog.length > MAX_LOG_ENTRIES) {
    sensorDataLog = sensorDataLog.slice(-MAX_LOG_ENTRIES);
  }

  // Lưu vào file
  saveSensorLog();

  res.json({ message: 'Dữ liệu đã lưu', count: sensorDataLog.length });
});

function styleExcelHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a4d2e' } };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function writeMetricWorkbook(res, workbook, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return workbook.xlsx.write(res).then(() => res.end());
}

function getUniqueCommandRows() {
  const commandMap = new Map();
  sensorDataLog.forEach(entry => {
    (entry.commandHistory || []).forEach(cmd => {
      const id = cmd.id || `${cmd.iso || entry.timestamp}-${cmd.deviceKey || cmd.deviceName}-${cmd.command}`;
      commandMap.set(id, cmd);
    });
  });
  return Array.from(commandMap.values()).slice(-300);
}

app.get('/api/export-metric-excel/:metric', verifyToken, async (req, res) => {
  try {
    const metric = String(req.params.metric || '').toLowerCase();
    const metricMap = {
      rssi: { sheet: 'RSSI', title: 'RSSI', perfKey: 'rssi', unit: 'dBm' },
      latency: { sheet: 'Latency', title: 'Latency', perfKey: 'latency', unit: 'ms' }
    };

    const workbook = new ExcelJS.Workbook();

    if (metric === 'cmd') {
      const sheet = workbook.addWorksheet('CMD Response');
      sheet.columns = [
        { header: 'STT', key: 'index', width: 8 },
        { header: 'Thiết bị', key: 'device', width: 24 },
        { header: 'Lệnh', key: 'command', width: 12 },
        { header: 'Nguồn', key: 'source', width: 12 },
        { header: 'Thời gian bấm', key: 'commandAt', width: 22 },
        { header: 'Thời gian phản hồi', key: 'response', width: 22 },
        { header: 'ms', key: 'responseMs', width: 10 },
        { header: 'Kết quả', key: 'result', width: 16 }
      ];
      styleExcelHeader(sheet.getRow(1));

      let rows = getUniqueCommandRows();
      const latest = sensorDataLog[sensorDataLog.length - 1];
      if (!rows.length && latest) {
        rows = Object.keys(DEVICE_LABELS).map(key => ({
          deviceKey: key,
          command: latest.devices?.[key] === 'ON' ? 'BAT' : 'TAT',
          responseMs: latest.performance?.cmd?.last,
          source: 'CMD',
          iso: latest.timestamp,
          result: 'Chua co lenh'
        }));
      }

      const resultMap = {
        Dat: 'Đạt',
        'Khong dat': 'Không đạt',
        'Dang cho': 'Đang chờ',
        'Chua co lenh': 'Chưa có lệnh'
      };

      rows.forEach((cmd, index) => {
        const responseMs = Number.isFinite(Number(cmd.responseMs)) ? Math.round(Number(cmd.responseMs)) : null;
        sheet.addRow({
          index: index + 1,
          device: DEVICE_LABELS[cmd.deviceKey] || cmd.deviceName || cmd.deviceKey || '--',
          command: cmd.command === 'BAT' ? 'BẬT' : cmd.command === 'TAT' ? 'TẮT' : (cmd.command || '--'),
          source: cmd.source || cmd.responseType || 'CMD',
          commandAt: cmd.iso ? new Date(cmd.iso).toLocaleString('vi-VN') : '--',
          response: responseMs !== null ? `~${responseMs}ms` : '--',
          responseMs,
          result: resultMap[cmd.result] || cmd.result || '--'
        });
      });

      sheet.eachRow((row, rowNumber) => {
        row.alignment = { horizontal: 'center', vertical: 'middle' };
        if (rowNumber > 1) row.font = { size: 11 };
      });

      return await writeMetricWorkbook(res, workbook, `NamSmart_CMD_Response_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }

    const cfg = metricMap[metric];
    if (!cfg) {
      return res.status(400).json({ message: 'Metric không hợp lệ' });
    }

    const sheet = workbook.addWorksheet(cfg.sheet);
    sheet.columns = [
      { header: 'STT', key: 'index', width: 8 },
      { header: 'Ngày giờ', key: 'datetime', width: 22 },
      { header: 'Hiện tại', key: 'last', width: 14 },
      { header: 'Min', key: 'min', width: 14 },
      { header: 'Max', key: 'max', width: 14 },
      { header: 'Trung bình', key: 'avg', width: 14 },
      { header: 'Đơn vị', key: 'unit', width: 10 },
      { header: 'Người nhập', key: 'user', width: 14 }
    ];
    styleExcelHeader(sheet.getRow(1));

    sensorDataLog.forEach((entry, index) => {
      const perf = entry.performance || {};
      const data = perf[cfg.perfKey] || {};
      sheet.addRow({
        index: index + 1,
        datetime: new Date(entry.timestamp).toLocaleString('vi-VN'),
        last: data.last ?? '',
        min: data.min ?? '',
        max: data.max ?? '',
        avg: data.avg ?? '',
        unit: cfg.unit,
        user: entry.user || ''
      });
    });

    sheet.eachRow((row, rowNumber) => {
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      if (rowNumber > 1) row.font = { size: 11 };
    });

    return await writeMetricWorkbook(res, workbook, `NamSmart_${cfg.title}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (error) {
    console.error('Lỗi xuất Excel metric:', error);
    res.status(500).json({ message: 'Lỗi xuất Excel metric', error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// 📥 XUẤT EXCEL
// ════════════════════════════════════════════════════════════

app.get('/api/export-excel', verifyToken, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Dữ Liệu Cảm Biến');

    // Tạo header
    worksheet.columns = [
      { header: 'Thứ tự', key: 'index', width: 8 },
      { header: 'Ngày Giờ', key: 'datetime', width: 22 },
      { header: 'Nhiệt độ (°C)', key: 'temp', width: 15 },
      { header: 'Độ ẩm (%)', key: 'humi', width: 12 },
      { header: 'Ánh sáng (Lux)', key: 'lux', width: 15 },
      { header: 'Độ ẩm đất (%)', key: 'soil', width: 15 },
      { header: 'Phòng A', key: 'roomA_status', width: 12 },
      { header: DEVICE_LABELS.den_suoi1, key: 'den_suoi1', width: 12 },
      { header: DEVICE_LABELS.den_suoi2, key: 'den_suoi2', width: 12 },
      { header: DEVICE_LABELS.quat_hut1, key: 'quat_hut1', width: 12 },
      { header: DEVICE_LABELS.quat_hut2, key: 'quat_hut2', width: 12 },
      { header: DEVICE_LABELS.den_phong, key: 'den_phong', width: 12 },
      { header: DEVICE_LABELS.phun_suong, key: 'phun_suong', width: 12 },
      { header: DEVICE_LABELS.quat_suong, key: 'quat_suong', width: 12 },
      { header: DEVICE_LABELS.device8, key: 'device8', width: 12 },
      { header: 'Người nhập', key: 'user', width: 12 }
    ];

    // Thiết kế header
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a4d2e' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    // Thêm dữ liệu
    sensorDataLog.forEach((entry, index) => {
      const date = new Date(entry.timestamp);
      const dateStr = date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      worksheet.addRow({
        index: index + 1,
        datetime: dateStr,
        temp: entry.temp,
        humi: entry.humi,
        lux: entry.lux,
        soil: entry.soil,
        roomA_status: entry.roomA_status,
        den_suoi1: entry.devices?.den_suoi1 || 'OFF',
        den_suoi2: entry.devices?.den_suoi2 || 'OFF',
        quat_hut1: entry.devices?.quat_hut1 || 'OFF',
        quat_hut2: entry.devices?.quat_hut2 || 'OFF',
        den_phong: entry.devices?.den_phong || 'OFF',
        phun_suong: entry.devices?.phun_suong || 'OFF',
        quat_suong: entry.devices?.quat_suong || 'OFF',
        device8: entry.devices?.device8 || 'OFF',
        user: entry.user
      });
    });

    // Căn chỉnh dữ liệu
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { horizontal: 'center', vertical: 'middle' };
        row.font = { size: 11 };
      }
    });

    // Thêm trang tóm tắt
    const summarySheet = workbook.addWorksheet('Tóm Tắt');
    summarySheet.columns = [
      { header: 'Thông số', key: 'metric', width: 20 },
      { header: 'Giá trị', key: 'value', width: 20 }
    ];

    const summaryHeader = summarySheet.getRow(1);
    summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a4d2e' } };

    if (sensorDataLog.length > 0) {
      const temps = sensorDataLog.map(e => e.temp);
      const humis = sensorDataLog.map(e => e.humi);
      const luxes = sensorDataLog.map(e => e.lux);
      const soils = sensorDataLog.map(e => e.soil);

      const avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(2);
      const avgHumi = (humis.reduce((a, b) => a + b, 0) / humis.length).toFixed(2);
      const avgLux = (luxes.reduce((a, b) => a + b, 0) / luxes.length).toFixed(2);
      const avgSoil = (soils.reduce((a, b) => a + b, 0) / soils.length).toFixed(2);

      const summaryData = [
        { metric: 'Tổng số bản ghi', value: sensorDataLog.length },
        { metric: 'Thời gian', value: new Date(sensorDataLog[0].timestamp).toLocaleString('vi-VN') + ' → ' + new Date(sensorDataLog[sensorDataLog.length - 1].timestamp).toLocaleString('vi-VN') },
        { metric: 'Nhiệt độ TB (°C)', value: avgTemp },
        { metric: 'Nhiệt độ Min (°C)', value: Math.min(...temps).toFixed(2) },
        { metric: 'Nhiệt độ Max (°C)', value: Math.max(...temps).toFixed(2) },
        { metric: 'Độ ẩm TB (%)', value: avgHumi },
        { metric: 'Độ ẩm Min (%)', value: Math.min(...humis).toFixed(2) },
        { metric: 'Độ ẩm Max (%)', value: Math.max(...humis).toFixed(2) },
        { metric: 'Ánh sáng TB (Lux)', value: avgLux },
        { metric: 'Độ ẩm đất TB (%)', value: avgSoil }
      ];

      summaryData.forEach(data => {
        summarySheet.addRow(data);
      });

      summarySheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    }

    // Current status sheet: latest sensor, network, mode, and every device.
    const statusSheet = workbook.addWorksheet('Current Status');
    statusSheet.columns = [
      { header: 'Group', key: 'group', width: 18 },
      { header: 'Item', key: 'item', width: 24 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Value', key: 'value', width: 22 },
      { header: 'Updated At', key: 'updatedAt', width: 22 }
    ];

    const statusHeader = statusSheet.getRow(1);
    statusHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    statusHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a4d2e' } };
    statusHeader.alignment = { horizontal: 'center', vertical: 'middle' };

    const latest = sensorDataLog[sensorDataLog.length - 1];
    if (latest) {
      const updatedAt = new Date(latest.timestamp).toLocaleString('vi-VN');
      const perf = latest.performance || {};
      const statusRows = [
        { group: 'Sensor', item: 'Nhiet do', status: latest.temp > 0 ? 'OK' : 'NO DATA', value: latest.temp + ' C', updatedAt },
        { group: 'Sensor', item: 'Do am khong khi', status: latest.humi > 0 ? 'OK' : 'NO DATA', value: latest.humi + ' %', updatedAt },
        { group: 'Sensor', item: 'Anh sang', status: latest.lux > 0 ? 'OK' : 'NO DATA', value: latest.lux + ' lux', updatedAt },
        { group: 'Sensor', item: 'Do am dat', status: latest.soil > 0 ? 'OK' : 'NO DATA', value: latest.soil + ' %', updatedAt },
        { group: 'System', item: 'Phong A', status: latest.roomA_status || 'offline', value: perf.nodeA || '', updatedAt },
        { group: 'System', item: 'Che do', status: perf.mode || 'UNKNOWN', value: '', updatedAt }
      ];

      Object.keys(DEVICE_LABELS).forEach(key => {
        const state = latest.devices?.[key] || 'OFF';
        statusRows.push({
          group: 'Device',
          item: DEVICE_LABELS[key],
          status: state,
          value: state === 'ON' ? 'Dang bat' : 'Dang tat',
          updatedAt
        });
      });

      if (perf.dht) {
        statusRows.push({ group: 'Performance', item: 'DHT22', status: perf.dht.valid ? 'OK' : 'NO DATA', value: `Temp ${perf.dht.temp ?? '--'} C / Humi ${perf.dht.humi ?? '--'} %`, updatedAt });
      }
      if (perf.sht) {
        statusRows.push({ group: 'Performance', item: 'SHT30', status: perf.sht.valid ? 'OK' : 'NO DATA', value: `Temp ${perf.sht.temp ?? '--'} C / Humi ${perf.sht.humi ?? '--'} %`, updatedAt });
      }
      if (perf.rssi) {
        statusRows.push({ group: 'Performance', item: 'RSSI', status: 'INFO', value: `${perf.rssi.last ?? '--'} dBm`, updatedAt });
      }
      if (perf.latency) {
        statusRows.push({ group: 'Performance', item: 'Latency', status: 'INFO', value: `${perf.latency.last ?? '--'} ms`, updatedAt });
      }

      statusRows.forEach(row => statusSheet.addRow(row));
      statusSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.alignment = { horizontal: 'center', vertical: 'middle' };
        const status = String(row.getCell('status').value || '').toUpperCase();
        if (status === 'ON' || status === 'OK' || status.includes('ONLINE')) {
          row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEFE4' } };
          row.getCell('status').font = { bold: true, color: { argb: 'FF1a4d2e' } };
        } else if (status === 'OFF' || status.includes('NO DATA') || status.includes('OFFLINE')) {
          row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE2E2' } };
          row.getCell('status').font = { bold: true, color: { argb: 'FF9B1C1C' } };
        }
      });
    }

    // Manual command response sheet, formatted like the report table.
    const cmdSheet = workbook.addWorksheet('CMD Manual');
    cmdSheet.columns = [
      { header: 'STT', key: 'index', width: 8 },
      { header: 'Thiết bị', key: 'device', width: 24 },
      { header: 'Lệnh', key: 'command', width: 14 },
      { header: 'Nguồn', key: 'source', width: 12 },
      { header: 'Thời gian bấm', key: 'commandAt', width: 22 },
      { header: 'Thời gian phản hồi', key: 'response', width: 22 },
      { header: 'ms', key: 'responseMs', width: 10 },
      { header: 'Kết quả', key: 'result', width: 16 }
    ];

    const cmdHeader = cmdSheet.getRow(1);
    cmdHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cmdHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a4d2e' } };
    cmdHeader.alignment = { horizontal: 'center', vertical: 'middle' };

    const commandMap = new Map();
    sensorDataLog.forEach(entry => {
      (entry.commandHistory || []).forEach(cmd => {
        const id = cmd.id || `${cmd.iso || entry.timestamp}-${cmd.deviceKey || cmd.deviceName}-${cmd.command}`;
        commandMap.set(id, cmd);
      });
    });

    let commandRows = Array.from(commandMap.values()).slice(-100);
    if (!commandRows.length && latest) {
      commandRows = Object.keys(DEVICE_LABELS).map(key => ({
        deviceKey: key,
        command: latest.devices?.[key] === 'ON' ? 'BAT' : 'TAT',
        responseMs: null,
        source: 'CMD',
        iso: latest.timestamp,
        result: 'Chua co lenh'
      }));
    }

    commandRows.forEach((cmd, index) => {
      const deviceKey = cmd.deviceKey;
      const device = DEVICE_LABELS[deviceKey] || cmd.deviceName || deviceKey || '--';
      const command = cmd.command === 'BAT' ? 'BẬT' : cmd.command === 'TAT' ? 'TẮT' : (cmd.command || '--');
      const responseMs = Number.isFinite(Number(cmd.responseMs)) ? Math.round(Number(cmd.responseMs)) : null;
      const response = responseMs !== null ? `~${responseMs}ms` : '--';
      const source = cmd.source || cmd.responseType || 'CMD';
      const commandAt = cmd.iso ? new Date(cmd.iso).toLocaleString('vi-VN') : '--';
      const resultMap = {
        Dat: 'Đạt',
        'Khong dat': 'Không đạt',
        'Dang cho': 'Đang chờ',
        'Chua co lenh': 'Chưa có lệnh'
      };
      cmdSheet.addRow({
        index: index + 1,
        device,
        command,
        source,
        commandAt,
        response,
        responseMs,
        result: resultMap[cmd.result] || cmd.result || '--'
      });
    });

    cmdSheet.eachRow((row, rowNumber) => {
      row.alignment = { horizontal: 'center', vertical: 'middle' };
      row.height = rowNumber === 1 ? 24 : 22;
      row.eachCell(cell => {
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };
      });
      if (rowNumber > 1) {
        const result = String(row.getCell('result').value || '');
        if (result === 'Đạt') {
          row.getCell('result').font = { bold: true, color: { argb: 'FF1a4d2e' } };
        } else if (result === 'Không đạt') {
          row.getCell('result').font = { bold: true, color: { argb: 'FF9B1C1C' } };
        }
      }
    });

    // Gửi file
    const filename = `NamSmart_Data_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Lỗi xuất Excel:', error);
    res.status(500).json({ message: 'Lỗi xuất Excel', error: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// 🌐 WEBSOCKET PROXY (ESP32 WebSocket)
// ════════════════════════════════════════════════════════════

const proxy = httpProxy.createProxyServer({ 
  target: `ws://${ESP32_IP}:${ESP32_PORT}`,
  ws: true
});

proxy.on('error', (error, req, socket) => {
  console.error('WebSocket proxy error:', error);
});

server.on('upgrade', (req, socket, head) => {
  // Kiểm tra token nếu cần bảo vệ WebSocket
  // const token = new URL(`ws://localhost${req.url}`).searchParams.get('token');
  // if (!token) return socket.destroy();
  
  proxy.ws(req, socket, head);
});

// ════════════════════════════════════════════════════════════
// 🚀 START SERVER
// ════════════════════════════════════════════════════════════

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`NamSmart may already be running at http://localhost:${PORT}`);
    console.error('Close the existing server before starting another instance.\n');
    process.exit(1);
  }

  console.error('Server error:', error);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════╗
║       🍄 NấmSmart Server Ready        ║
╠═══════════════════════════════════════╣
║ 🌐 URL: http://localhost:${PORT}${' '.repeat(3)}║
║ 📡 ESP32: ws://${ESP32_IP}:${ESP32_PORT}${' '.repeat(10)}║
║ 🔐 JWT: Có bảo vệ                    ║
╚═══════════════════════════════════════╝

📝 Tài khoản mặc định:
   - admin / 123456
   - user1 / password123

⚙️  Thay đổi auth.json để quản lý user
  `);
});

process.on('SIGINT', () => {
  console.log('\n✓ Server đã tắt');
  process.exit();
});
