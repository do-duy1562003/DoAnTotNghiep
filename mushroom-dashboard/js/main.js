/* NấmSmart — main.js v3.2 FIXED
 * SỬA: 1) IP config qua UI  2) map đủ fields từ ESP32
 */

// ═══════════════════════════════════════════════════════════════
// [FIX 1] IP CONFIG — đổi IP ở đây hoặc qua ô nhập trên web
// Mở Serial Monitor ESP32, copy IP hiện ra (vd: 192.168.1.105)
// ═══════════════════════════════════════════════════════════════
let ESP32_IP = localStorage.getItem('ESP32_IP') || "172.20.10.6";
const ESP32_PORT = 8080;

// Gọi hàm này để đổi IP không cần sửa code:
// updateESP32IP("192.168.x.x")  — gõ vào Console F12
window.updateESP32IP = function(newIP) {
  ESP32_IP = newIP.trim();
  localStorage.setItem('ESP32_IP', ESP32_IP);
  addLog('IP ESP32 cập nhật: ' + ESP32_IP, 'info');
  if (ws) ws.close();
  setTimeout(initWebSocket, 600);
};

// ─── DỮ LIỆU PHÒNG ────────────────────────────────────────────
const rooms = { A: { temp: 0, humi: 0 } };

// ─── TRẠNG THÁI 8 THIẾT BỊ ───────────────────────────────────
const devices = {
  den_suoi1:  { name: 'Đèn sưởi 1',       state: false, icon: '🔆', id: 'device-den_suoi1' },
  den_suoi2:  { name: 'Đèn sưởi 2',       state: false, icon: '🔆', id: 'device-den_suoi2' },
  quat_hut1:  { name: 'Quạt hút 1',        state: false, icon: '🌀', id: 'device-quat_hut1' },
  quat_hut2:  { name: 'Quạt hút 2',        state: false, icon: '🌀', id: 'device-quat_hut2' },
  den_phong:  { name: 'Đèn phòng',         state: false, icon: '💡', id: 'device-den_phong' },
  phun_suong: { name: 'Phun sương',        state: false, icon: '💧', id: 'device-phun_suong' },
  quat_suong: { name: 'Quạt thổi sương',   state: false, icon: '🌬️', id: 'device-quat_suong' },
  device8:    { name: 'Thiết bị 8',        state: false, icon: '⚙️', id: 'device-device8' }
};

let isAutoMode = true;

// ─── NGƯỠNG CẢNH BÁO ─────────────────────────────────────────
let THRESHOLDS = {
  temp: { min: 28, max: 35, danger: 38 },
  humi: { min: 80, max: 95, danger: 98 }
};

// ─── PRESET CÁC LOẠI NẤM ─────────────────────────────────────
const PRESETS = {
  romStraw: { name: '🌾 Nấm rơm',      temp: { min: 28, max: 35, danger: 38 }, humi: { min: 80, max: 95, danger: 98 } },
  oyster:   { name: '🍄 Nấm sò',       temp: { min: 20, max: 28, danger: 32 }, humi: { min: 80, max: 95, danger: 98 } },
  shiitake: { name: '🌸 Nấm hương',    temp: { min: 18, max: 25, danger: 28 }, humi: { min: 75, max: 90, danger: 95 } },
  enoki:    { name: '🌿 Nấm kim châm', temp: { min: 8,  max: 15, danger: 18 }, humi: { min: 85, max: 95, danger: 98 } },
  button:   { name: '⚪ Nấm mỡ',       temp: { min: 15, max: 22, danger: 26 }, humi: { min: 70, max: 90, danger: 95 } },
  custom:   { name: '✏️ Tùy chỉnh',    temp: { min: 20, max: 35, danger: 40 }, humi: { min: 70, max: 95, danger: 99 } }
};
let activePreset = 'romStraw';

// ─── NODE STATES ──────────────────────────────────────────────
const nodeState    = { A: 'online' };
const nodeLastSeen = { A: Date.now() };

// ─── LỊCH SỬ DỮ LIỆU ─────────────────────────────────────────
const labels12h = ['12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];
const labels24h = ['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'];

function randHistory(base, delta, n) {
  return Array.from({length: n}, (_, i) =>
    +(base + (Math.random()-0.5)*delta + Math.sin(i/3)*delta*0.4).toFixed(1)
  );
}

const hist = {
  A: { temp: randHistory(30, 1.5, 12), humi: randHistory(85, 4, 12) }
};

const sparkData = {
  A: { temp: randHistory(30, 1.2, 30), humi: randHistory(85, 3, 30) }
};

// ─── SENSOR REALTIME (từ ESP32) ───────────────────────────────
let sensorHistory = {
  labels: [],
  temp: [],
  humi: [],
  lux: [],
  soil: []
};
const MAX_HISTORY = 20;

const currentMetrics = {
  dht: { temp: null, humi: null, valid: false },
  sht: { temp: null, humi: null, valid: false },
  rssi: { last: null, min: null, max: null, avg: null },
  latency: { last: null, min: null, max: null, avg: null },
  cmd: { last: null, min: null, max: null, avg: null, device: '' },
  packets: { total: 0, data: 0, ack: 0, error: 0 }
};
let activeGaugeKey = null;
const pendingExcelEvents = [];
const commandHistory = [];
let gaugeAnimationFrame = null;

// ─── EVENT LOG ────────────────────────────────────────────────
const eventLog = [];
const MAX_LOG  = 50;

function addLog(msg, type = 'info', room = null) {
  const now  = new Date();
  const time = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = { iso: now.toISOString(), time, msg, type, room };
  eventLog.unshift(entry);
  if (eventLog.length > MAX_LOG) eventLog.pop();
  pendingExcelEvents.push(entry);
  if (pendingExcelEvents.length > 200) pendingExcelEvents.shift();
  renderLogs();
}

function recordExcelEvent(msg, type = 'info', room = null) {
  const now = new Date();
  pendingExcelEvents.push({
    iso: now.toISOString(),
    time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    msg,
    type,
    room
  });
  if (pendingExcelEvents.length > 200) pendingExcelEvents.shift();
}

function renderLogs() {
  const el = document.getElementById('event-log-list');
  if (!el) return;
  el.innerHTML = eventLog.slice(0, 20).map(e =>
    `<div class="log-item ${e.type}">
      <span class="log-time">${e.time}</span>
      <span class="log-msg">${e.msg}</span>
    </div>`
  ).join('') || '<div class="log-item info"><span class="log-time">--:--</span><span class="log-msg">Chưa có sự kiện</span></div>';
  const pill = document.getElementById('log-count-pill');
  if (pill) pill.textContent = eventLog.length + ' sự kiện';
}

// ─── CHART INSTANCES ──────────────────────────────────────────
let charts = {};

// ─── SPARKLINE ────────────────────────────────────────────────
function drawSparkline(svgId, data, color) {
  const svg = document.getElementById(svgId);
  if (!svg) return;
  const w = svg.parentElement?.clientWidth || 120;
  const h = 28;
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  svg.innerHTML =
    '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
}

function updateSparklines() {
  drawSparkline('spark-a-temp', sparkData.A.temp, '#2d7a4a');
  drawSparkline('spark-a-humi', sparkData.A.humi, '#4361ee');
}

// ─── CHART INITIALIZATION ─────────────────────────────────────
function initCharts() {
  try {
    Chart.defaults.font.family = "'Be Vietnam Pro', sans-serif";
    Chart.defaults.font.size   = 12;
    Chart.defaults.font.weight = '500';
    Chart.defaults.color = '#666';
    
    var gridColor = 'rgba(0,0,0,0.08)';
    var tickColor = '#888';
    var waveIntensity = 0.85; // Hiệu ứng parabol/cung cơ

    // ═══ FULL-SIZE CHARTS (View Charts) ═══
    
    // Destroy existing charts before creating new ones
    if (charts.sensorHistoryFull) charts.sensorHistoryFull.destroy();
    if (charts.soilLuxFull) charts.soilLuxFull.destroy();
    
    // Full sensor history
    var elHistoryFull = document.getElementById('chart-sensor-history-full');
    if (elHistoryFull) {
      var ctx = elHistoryFull.getContext('2d');
      
      var gradientTemp = ctx.createLinearGradient(0, 0, 0, 400);
      gradientTemp.addColorStop(0, 'rgba(45,122,74,0.25)');
      gradientTemp.addColorStop(1, 'rgba(45,122,74,0.01)');
      
      var gradientHumi = ctx.createLinearGradient(0, 0, 0, 400);
      gradientHumi.addColorStop(0, 'rgba(67,97,238,0.15)');
      gradientHumi.addColorStop(1, 'rgba(67,97,238,0.01)');
      
      charts.sensorHistoryFull = new Chart(elHistoryFull, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { 
              label: 'Nhiệt độ (°C)', 
              data: [], 
              borderColor: '#2d7a4a', 
              backgroundColor: gradientTemp, 
              borderWidth: 4, 
              fill: true, 
              yAxisID: 'y',
              tension: waveIntensity,
              pointRadius: 6,
              pointBackgroundColor: '#2d7a4a',
              pointBorderColor: '#fff',
              pointBorderWidth: 3,
              pointHoverRadius: 8,
              pointHoverBackgroundColor: '#1a4d2e',
              pointHoverBorderWidth: 4
            },
            { 
              label: 'Độ ẩm (%)',     
              data: [], 
              borderColor: '#4361ee', 
              backgroundColor: gradientHumi, 
              borderWidth: 4, 
              borderDash: [6,4],
              fill: false, 
              yAxisID: 'y1',
              tension: waveIntensity,
              pointRadius: 6,
              pointBackgroundColor: '#4361ee',
              pointBorderColor: '#fff',
              pointBorderWidth: 3,
              pointHoverRadius: 8,
              pointHoverBackgroundColor: '#2d4ab8',
              pointHoverBorderWidth: 4
            }
          ]
        },
        options: {
          responsive: true, 
          maintainAspectRatio: false,
          plugins: { 
            legend: { 
              display: true, 
              position: 'top',
              labels: { 
                boxWidth: 14, 
                padding: 20, 
                color: '#333',
                font: { size: 14, weight: 'bold' },
                usePointStyle: true,
                pointStyle: 'circle'
              } 
            }, 
            tooltip: { 
              mode: 'index', 
              intersect: false,
              backgroundColor: 'rgba(0,0,0,0.85)',
              padding: 15,
              titleFont: { size: 15, weight: 'bold' },
              bodyFont: { size: 13 },
              displayColors: true,
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + (context.datasetIndex === 0 ? '°C' : '%');
                }
              }
            } 
          },
          scales: {
            x:  { 
              grid: { color: gridColor, drawBorder: false }, 
              ticks: { color: tickColor, maxRotation: 45, minRotation: 0, font: { size: 12 } } 
            },
            y:  { 
              position: 'left',  
              grid: { color: gridColor, drawBorder: false }, 
              ticks: { color: tickColor, font: { size: 12 } }, 
              title: { display: true, text: '°C', color: tickColor, font: { size: 13, weight: 'bold' } } 
            },
            y1: { 
              position: 'right', 
              grid: { drawOnChartArea: false, drawBorder: false }, 
              ticks: { color: tickColor, font: { size: 12 } }, 
              title: { display: true, text: '%',  color: tickColor, font: { size: 13, weight: 'bold' } } 
            }
          },
          interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
      });
    }

    // Full soil + lux
    var elSoilLuxFull = document.getElementById('chart-soil-lux-full');
    if (elSoilLuxFull) {
      var ctx2 = elSoilLuxFull.getContext('2d');
      
      var gradientSoil = ctx2.createLinearGradient(0, 0, 0, 400);
      gradientSoil.addColorStop(0, 'rgba(245,158,11,0.25)');
      gradientSoil.addColorStop(1, 'rgba(245,158,11,0.01)');
      
      var gradientLux = ctx2.createLinearGradient(0, 0, 0, 400);
      gradientLux.addColorStop(0, 'rgba(20,184,166,0.15)');
      gradientLux.addColorStop(1, 'rgba(20,184,166,0.01)');
      
      charts.soilLuxFull = new Chart(elSoilLuxFull, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { 
              label: 'Ẩm đất (%)',    
              data: [], 
              borderColor: '#f59e0b', 
              backgroundColor: gradientSoil, 
              borderWidth: 4, 
              fill: true,  
              yAxisID: 'y',
              tension: waveIntensity,
              pointRadius: 6,
              pointBackgroundColor: '#f59e0b',
              pointBorderColor: '#fff',
              pointBorderWidth: 3,
              pointHoverRadius: 8,
              pointHoverBackgroundColor: '#d97706',
              pointHoverBorderWidth: 4
            },
            { 
              label: 'Ánh sáng (lux)',
              data: [], 
              borderColor: '#14b8a6', 
              backgroundColor: gradientLux, 
              borderWidth: 4, 
              fill: false, 
              yAxisID: 'y1',
              tension: waveIntensity,
              pointRadius: 6,
              pointBackgroundColor: '#14b8a6',
              pointBorderColor: '#fff',
              pointBorderWidth: 3,
              pointHoverRadius: 8,
              pointHoverBackgroundColor: '#0d9488',
              pointHoverBorderWidth: 4
            }
          ]
        },
        options: {
          responsive: true, 
          maintainAspectRatio: false,
          plugins: { 
            legend: { 
              display: true, 
              position: 'top',
              labels: { 
                boxWidth: 14, 
                padding: 20, 
                color: '#333',
                font: { size: 14, weight: 'bold' },
                usePointStyle: true,
                pointStyle: 'circle'
              } 
            }, 
            tooltip: { 
              mode: 'index', 
              intersect: false,
              backgroundColor: 'rgba(0,0,0,0.85)',
              padding: 15,
              titleFont: { size: 15, weight: 'bold' },
              bodyFont: { size: 13 },
              displayColors: true,
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + (context.datasetIndex === 0 ? '%' : ' lux');
                }
              }
            } 
          },
          scales: {
            x:  { 
              grid: { color: gridColor, drawBorder: false }, 
              ticks: { color: tickColor, maxRotation: 45, minRotation: 0, font: { size: 12 } } 
            },
            y:  { 
              position: 'left',  
              grid: { color: gridColor, drawBorder: false }, 
              ticks: { color: tickColor, font: { size: 12 } }, 
              title: { display: true, text: '%',  color: tickColor, font: { size: 13, weight: 'bold' } } 
            },
            y1: { 
              position: 'right', 
              grid: { drawOnChartArea: false, drawBorder: false }, 
              ticks: { color: tickColor, font: { size: 12 } }, 
              title: { display: true, text: 'lux', color: tickColor, font: { size: 13, weight: 'bold' } } 
            }
          },
          interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
      });
    }

    console.log('[Charts] Initialized OK');
  } catch(e) {
    console.error('[Charts] Error:', e);
  }
}

// ─── NODE STATUS ──────────────────────────────────────────────
function metricNumber(v, digits) {
  var n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return digits === 0 ? Math.round(n) : Number(n.toFixed(digits || 1));
}

function formatMetric(value, unit, digits) {
  var n = metricNumber(value, digits);
  return n === null ? '--' : n + unit;
}

function formatRange(obj, unit) {
  if (!obj || obj.min === null || obj.max === null) return '--/--';
  return Math.round(obj.min) + '/' + Math.round(obj.max) + unit;
}

function makeFlatSeries(value) {
  return sensorHistory.labels.map(function() {
    return value === null || value === undefined ? null : Number(value);
  });
}

function getGaugeConfig(key) {
  var lastLabel = sensorHistory.labels[sensorHistory.labels.length - 1] || '--';
  var configs = {
    dht: {
      title: 'DHT22',
      sub: 'Nhiệt độ và độ ẩm cảm biến DHT22',
      value: metricNumber(currentMetrics.dht.temp, 1),
      unit: '°C',
      min: 0,
      max: 50,
      color: '#2d7a4a',
      range: '--/--',
      avg: currentMetrics.dht.humi !== null ? Math.round(currentMetrics.dht.humi) + '%' : '--',
      labels: sensorHistory.labels,
      datasets: [
        { label: 'Nhiệt độ', data: sensorHistory.temp, borderColor: '#2d7a4a', backgroundColor: 'rgba(45,122,74,.12)', tension: .45 },
        { label: 'Độ ẩm', data: sensorHistory.humi, borderColor: '#4361ee', backgroundColor: 'rgba(67,97,238,.08)', tension: .45 }
      ]
    },
    sht: {
      title: 'SHT30',
      sub: 'Nhiệt độ và độ ẩm cảm biến SHT30',
      value: metricNumber(currentMetrics.sht.temp, 1),
      unit: '°C',
      min: 0,
      max: 50,
      color: '#14b8a6',
      range: '--/--',
      avg: currentMetrics.sht.humi !== null ? Math.round(currentMetrics.sht.humi) + '%' : '--',
      labels: sensorHistory.labels,
      datasets: [
        { label: 'Nhiệt độ', data: sensorHistory.temp, borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,.12)', tension: .45 },
        { label: 'Độ ẩm', data: sensorHistory.humi, borderColor: '#4361ee', backgroundColor: 'rgba(67,97,238,.08)', tension: .45 }
      ]
    },
    rssi: {
      title: 'RSSI (dBm)',
      sub: 'Cường độ tín hiệu LoRa',
      value: metricNumber(currentMetrics.rssi.last, 0),
      unit: 'dBm',
      min: -120,
      max: -30,
      color: '#8b5cf6',
      range: formatRange(currentMetrics.rssi, ' dBm'),
      avg: formatMetric(currentMetrics.rssi.avg, ' dBm', 0),
      labels: sensorHistory.labels,
      datasets: [{ label: 'RSSI', data: makeFlatSeries(currentMetrics.rssi.last), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,.12)', tension: .35 }]
    },
    latency: {
      title: 'Latency (ms)',
      sub: 'Thời gian phản hồi ACK LoRa',
      value: metricNumber(currentMetrics.latency.last, 0),
      unit: 'ms',
      min: 0,
      max: 500,
      color: '#f59e0b',
      range: formatRange(currentMetrics.latency, ' ms'),
      avg: formatMetric(currentMetrics.latency.avg, ' ms', 0),
      labels: sensorHistory.labels,
      datasets: [{ label: 'Latency', data: makeFlatSeries(currentMetrics.latency.last), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.14)', tension: .35 }]
    },
    cmd: {
      title: 'CMD Response (ms)',
      sub: currentMetrics.cmd.device ? 'Lệnh gần nhất: ' + currentMetrics.cmd.device : 'Thời gian phản hồi lệnh điều khiển',
      value: metricNumber(currentMetrics.cmd.last, 0),
      unit: 'ms',
      min: 0,
      max: 500,
      color: '#22c55e',
      range: formatRange(currentMetrics.cmd, ' ms'),
      avg: formatMetric(currentMetrics.cmd.avg, ' ms', 0),
      labels: sensorHistory.labels,
      datasets: [{ label: 'CMD Response', data: makeFlatSeries(currentMetrics.cmd.last), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.12)', tension: .35 }]
    },
    packets: {
      title: 'Gói tin LoRa',
      sub: 'Tổng DATA / ACK / lỗi',
      value: currentMetrics.packets.total || 0,
      unit: 'gói',
      min: 0,
      max: Math.max(10, (currentMetrics.packets.total || 0) * 1.15),
      color: '#0d9488',
      range: (currentMetrics.packets.data || 0) + '/' + (currentMetrics.packets.ack || 0) + '/' + (currentMetrics.packets.error || 0),
      avg: currentMetrics.packets.error ? currentMetrics.packets.error + ' lỗi' : '0 lỗi',
      labels: sensorHistory.labels,
      datasets: [{ label: 'Tổng gói', data: makeFlatSeries(currentMetrics.packets.total || 0), borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,.12)', tension: .35 }]
    }
  };
  var cfg = configs[key];
  if (cfg) cfg.time = lastLabel;
  return cfg;
}

function openGauge(key) {
  var cfg = getGaugeConfig(key);
  var modal = document.getElementById('gauge-modal');
  if (!cfg || !modal || typeof Chart === 'undefined') return;
  activeGaugeKey = key;
  ensureGaugeDownloadButton();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  updateGaugeModal(key, true);
}

function closeGauge() {
  var modal = document.getElementById('gauge-modal');
  if (gaugeAnimationFrame) {
    cancelAnimationFrame(gaugeAnimationFrame);
    gaugeAnimationFrame = null;
  }
  if (modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
  activeGaugeKey = null;
}

function setGaugeDisplayValue(value, unit) {
  var numberEl = document.getElementById('gauge-main-value');
  var unitEl = document.getElementById('gauge-main-unit');
  if (numberEl) numberEl.textContent = value === null || value === undefined ? '--' : value;
  if (unitEl) unitEl.textContent = unit || '';
}

function ensureGaugeDownloadButton() {
  if (document.getElementById('gauge-download-btn')) return;
  var head = document.querySelector('.gauge-head');
  var closeBtn = document.querySelector('.gauge-close');
  if (!head || !closeBtn) return;

  var actions = document.createElement('div');
  actions.className = 'gauge-head-actions';

  var downloadBtn = document.createElement('button');
  downloadBtn.id = 'gauge-download-btn';
  downloadBtn.className = 'gauge-download';
  downloadBtn.type = 'button';
  downloadBtn.textContent = 'Tải Excel';
  downloadBtn.onclick = downloadGaugeExcel;

  closeBtn.parentNode.insertBefore(actions, closeBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(closeBtn);
}

function updateGaugeDownloadButton(key) {
  var btn = document.getElementById('gauge-download-btn');
  if (!btn) return;
  var labels = {
    rssi: 'Tải Excel RSSI',
    latency: 'Tải Excel Latency',
    cmd: 'Tải Excel CMD'
  };
  if (labels[key]) {
    btn.style.display = 'inline-flex';
    btn.textContent = labels[key];
    btn.disabled = false;
  } else {
    btn.style.display = 'none';
  }
}

function animateGaugeTo(chart, cfg, targetFilled, targetEmpty, targetValue) {
  if (gaugeAnimationFrame) cancelAnimationFrame(gaugeAnimationFrame);
  var start = performance.now();
  var duration = 900;
  var startValue = cfg.min;
  var valueRange = targetValue === null ? 0 : targetValue - startValue;

  function step(now) {
    var progress = Math.min(1, (now - start) / duration);
    var eased = 1 - Math.pow(1 - progress, 3);
    var currentFilled = targetFilled * eased;
    var currentValue = targetValue === null ? null : +(startValue + valueRange * eased).toFixed(1);

    chart.data.datasets[0].data = [currentFilled, Math.max(0, cfg.max - cfg.min - currentFilled)];
    chart.update('none');
    setGaugeDisplayValue(currentValue, cfg.unit);

    if (progress < 1) {
      gaugeAnimationFrame = requestAnimationFrame(step);
    } else {
      chart.data.datasets[0].data = [targetFilled, targetEmpty];
      chart.update('none');
      setGaugeDisplayValue(targetValue, cfg.unit);
      gaugeAnimationFrame = null;
    }
  }

  gaugeAnimationFrame = requestAnimationFrame(step);
}

function updateGaugeModal(key, animate) {
  var cfg = getGaugeConfig(key);
  if (!cfg || typeof Chart === 'undefined') return;

  setVal('gauge-title', cfg.title);
  setVal('gauge-sub', cfg.sub);
  setGaugeDisplayValue(animate && cfg.value !== null ? cfg.min : cfg.value, cfg.unit);
  setVal('gauge-current', cfg.value === null ? '--' : cfg.value + ' ' + cfg.unit);
  setVal('gauge-range', cfg.range);
  setVal('gauge-avg', cfg.avg);
  setVal('gauge-time', cfg.time);
  updateGaugeDownloadButton(key);

  var clamped = Math.max(cfg.min, Math.min(cfg.max, cfg.value === null ? cfg.min : cfg.value));
  var filled = Math.max(0, clamped - cfg.min);
  var empty = Math.max(0, cfg.max - clamped);

  var gaugeEl = document.getElementById('gauge-main-chart');
  if (gaugeEl) {
    if (gaugeAnimationFrame) cancelAnimationFrame(gaugeAnimationFrame);
    if (charts.gaugeMain) charts.gaugeMain.destroy();
    charts.gaugeMain = new Chart(gaugeEl, {
      type: 'doughnut',
      data: { datasets: [{ data: [animate ? 0 : filled, animate ? Math.max(0, cfg.max - cfg.min) : empty], backgroundColor: [cfg.color, '#d9e2d9'], borderWidth: 0, cutout: '70%' }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        rotation: -90,
        circumference: 180,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      }
    });
    if (animate) animateGaugeTo(charts.gaugeMain, cfg, filled, empty, cfg.value);
  }

  var historyEl = document.getElementById('gauge-history-chart');
  if (historyEl) {
    if (charts.gaugeHistory) charts.gaugeHistory.destroy();
    charts.gaugeHistory = new Chart(historyEl, {
      type: 'line',
      data: { labels: cfg.labels.slice(), datasets: cfg.datasets.map(function(ds) {
        return Object.assign({ borderWidth: 3, fill: true, pointRadius: 3 }, ds, { data: ds.data.slice ? ds.data.slice() : ds.data });
      }) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'top' } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: false } }
      }
    });
  }
}

function initMetricCards() {
  document.querySelectorAll('.metric-clickable[data-gauge]').forEach(function(card) {
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', function() { openGauge(card.dataset.gauge); });
    card.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openGauge(card.dataset.gauge);
      }
    });
  });
  document.querySelectorAll('[data-close-gauge]').forEach(function(el) {
    el.addEventListener('click', closeGauge);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeGauge();
  });
}

function updateNodeStatus() {
  var room = 'A';
  var dot   = document.getElementById('node-' + room.toLowerCase() + '-dot');
  var latEl = document.getElementById('node-' + room.toLowerCase() + '-latency');
  if (!dot) return;
  var age   = Date.now() - nodeLastSeen[room];
  var state = age > 15000 ? 'offline' : age > 7000 ? 'warn' : 'online';
  nodeState[room]   = state;
  dot.className     = 'node-dot ' + state;
  if (latEl) {
    if (state === 'offline')   latEl.textContent = 'Mất kết nối';
    else if (state === 'warn') latEl.textContent = '>5s';
    else                       latEl.textContent = Math.round(10 + Math.random() * 20) + 'ms';
  }
}

// ─── ALERT LOGIC (tách riêng hoàn toàn) ──────────────────────
var lastAlertState = { A: 'ok', B: 'ok' };

function checkAlerts() {
  var newAlerts = [];
  var room = 'A';
  var d = rooms[room];
  var n = 'Phòng ' + room;
  if (d.temp > 0) { // có dữ liệu thật
    if (d.temp >= THRESHOLDS.temp.danger) newAlerts.push({ room: room, type: 'temp', level: 'danger', msg: n + ': Nhiệt độ NGUY HIỂM ' + d.temp.toFixed(1) + '°C!' });
    else if (d.temp > THRESHOLDS.temp.max) newAlerts.push({ room: room, type: 'temp', level: 'warn',   msg: n + ': Nhiệt độ cao ' + d.temp.toFixed(1) + '°C' });
    else if (d.temp < THRESHOLDS.temp.min) newAlerts.push({ room: room, type: 'temp', level: 'warn',   msg: n + ': Nhiệt độ thấp ' + d.temp.toFixed(1) + '°C' });
  }
  if (d.humi >= THRESHOLDS.humi.danger)  newAlerts.push({ room: room, type: 'humi', level: 'danger', msg: n + ': Độ ẩm NGUY HIỂM ' + d.humi + '%!' });
  else if (d.humi > THRESHOLDS.humi.max) newAlerts.push({ room: room, type: 'humi', level: 'warn',   msg: n + ': Độ ẩm cao ' + d.humi + '%' });
  else if (d.humi < THRESHOLDS.humi.min) newAlerts.push({ room: room, type: 'humi', level: 'warn',   msg: n + ': Độ ẩm thấp ' + d.humi + '%' });
  if (nodeState[room] === 'offline')     newAlerts.push({ room: room, type: 'node', level: 'danger', msg: 'Slave 1: Mất kết nối!' });

  newAlerts.forEach(function(a) {
    if (lastAlertState[a.room] === 'ok') addLog(a.msg, a.level === 'danger' ? 'danger' : 'warn', a.room);
  });

  var banner    = document.getElementById('alert-banner');
  var bannerTxt = document.getElementById('alert-banner-text');
  var notifDot  = document.getElementById('notif-dot');
  var notifBtn  = document.getElementById('notif-btn');
  var totalEl   = document.getElementById('total-alert');

  if (newAlerts.length > 0) {
    if (bannerTxt) bannerTxt.textContent = newAlerts.length + ' cảnh báo: ' + newAlerts[0].msg;
    if (banner)    banner.classList.add('show');
    if (notifDot)  { notifDot.style.display = 'flex'; notifDot.textContent = newAlerts.length; }
    if (notifBtn)  notifBtn.classList.add('alert-active');
    if (totalEl)   { totalEl.textContent = newAlerts.length; totalEl.style.background = '#fee2e2'; totalEl.style.color = '#b91c1c'; }
  } else {
    if (banner)   banner.classList.remove('show');
    if (notifDot) notifDot.style.display = 'none';
    if (notifBtn) notifBtn.classList.remove('alert-active');
    if (totalEl)  { totalEl.textContent = '0'; totalEl.style.background = ''; totalEl.style.color = ''; }
  }

  var hasAlert = newAlerts.some(function(a) { return a.room === room; });
  var isDanger = newAlerts.some(function(a) { return a.room === room && a.level === 'danger'; });
  lastAlertState[room] = isDanger ? 'danger' : hasAlert ? 'warn' : 'ok';
}

function dismissAlert() { var b = document.getElementById('alert-banner'); if (b) b.classList.remove('show'); }
window.dismissAlert = dismissAlert;

// ─── SETTINGS & PRESETS ───────────────────────────────────────
window.applyPreset = function(key) {
  var preset = PRESETS[key]; if (!preset) return;
  activePreset = key;
  var set = function(id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  set('th-temp-min',    preset.temp.min);
  set('th-temp-max',    preset.temp.max);
  set('th-temp-danger', preset.temp.danger);
  set('th-humi-min',    preset.humi.min);
  set('th-humi-max',    preset.humi.max);
  set('th-humi-danger', preset.humi.danger);
  document.querySelectorAll('.preset-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('[data-preset="' + key + '"]').forEach(function(b) { b.classList.add('active'); });
  var label = document.getElementById('preset-active-label');
  if (label) label.textContent = 'Đã chọn: ' + preset.name;
  updateThresholdVisual();
};

window.saveSettings = function() {
  var tempMin    = parseFloat(document.getElementById('th-temp-min').value);
  var tempMax    = parseFloat(document.getElementById('th-temp-max').value);
  var tempDanger = parseFloat(document.getElementById('th-temp-danger').value);
  var humiMin    = parseFloat(document.getElementById('th-humi-min').value);
  var humiMax    = parseFloat(document.getElementById('th-humi-max').value);
  var humiDanger = parseFloat(document.getElementById('th-humi-danger').value);
  if (tempMin >= tempMax || tempMax >= tempDanger) { alert('Lỗi: Cần Min < Max < Nguy hiểm cho nhiệt độ!'); return; }
  if (humiMin >= humiMax || humiMax >= humiDanger) { alert('Lỗi: Cần Min < Max < Nguy hiểm cho độ ẩm!'); return; }
  THRESHOLDS.temp = { min: tempMin, max: tempMax, danger: tempDanger };
  THRESHOLDS.humi = { min: humiMin, max: humiMax, danger: humiDanger };
  updateThresholdDisplays(); updateThresholdVisual(); checkAlerts();
  addLog('Ngưỡng đã cập nhật: Nhiệt ' + tempMin + '–' + tempMax + '°C, Ẩm ' + humiMin + '–' + humiMax + '%', 'info');
  var saved = document.getElementById('settings-saved');
  if (saved) { saved.classList.add('show'); setTimeout(function() { saved.classList.remove('show'); }, 3000); }
};

window.resetSettings = function() { window.applyPreset('romStraw'); };

function updateThresholdDisplays() {
  var set = function(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
  set('curr-temp-range',  THRESHOLDS.temp.min + ' – ' + THRESHOLDS.temp.max + '°C');
  set('curr-temp-danger', '⚠ Nguy hiểm: ' + THRESHOLDS.temp.danger + '°C');
  set('curr-humi-range',  THRESHOLDS.humi.min + ' – ' + THRESHOLDS.humi.max + '%');
  set('curr-humi-danger', '⚠ Nguy hiểm: ' + THRESHOLDS.humi.danger + '%');
  var name = (PRESETS[activePreset] ? PRESETS[activePreset].name : 'Tùy chỉnh').replace(/^[^ ]+ /, '');
  set('curr-mushroom', name);
}

function updateThresholdVisual() {
  var tv = function(id, val, unit) { var el = document.getElementById(id); if (el) el.textContent = val + unit; };
  tv('tv-temp-min', THRESHOLDS.temp.min, '°C'); tv('tv-temp-max', THRESHOLDS.temp.max, '°C'); tv('tv-temp-danger', THRESHOLDS.temp.danger, '°C ⚠');
  tv('tv-humi-min', THRESHOLDS.humi.min, '%');  tv('tv-humi-max', THRESHOLDS.humi.max, '%');  tv('tv-humi-danger', THRESHOLDS.humi.danger, '% ⚠');
}

// ─── ĐỒNG HỒ ─────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  var timeEl = document.getElementById('clock');
  var dateEl = document.getElementById('date-disp');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('vi-VN', { hour12: false });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).toUpperCase();
}
setInterval(updateClock, 1000);
updateClock();

// ─── ĐỒNG HỒ RTC DS3231 ───────────────────────────────────────
function updateRTC() {
  var rtcEl = document.getElementById('dash-rtc');
  if (rtcEl && rtcEl.textContent === '--:--:--') {
    var now = new Date();
    var rtcTime = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    rtcEl.textContent = rtcTime;
  }
}
setInterval(updateRTC, 1000);
updateRTC();

// ─── ĐIỀU HƯỚNG ──────────────────────────────────────────────
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  var t = document.getElementById('view-' + viewId);
  if (t) t.classList.add('active');
  var titles = { dashboard: 'Tổng quan hệ thống', devices: 'Điều khiển thiết bị', schedule: 'Lịch hẹn giờ', charts: 'Biểu đồ phân tích', settings: 'Cài đặt ngưỡng thông số' };
  var titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[viewId] || viewId;
  setTimeout(updateSparklines, 100);
}

document.querySelectorAll('.nav-link[data-view]').forEach(function(link) {
  link.addEventListener('click', function(e) {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach(function(l) { l.classList.remove('active'); });
    link.classList.add('active');
    switchView(link.dataset.view);
  });
});

// ─── GỬI LỆNH ĐẾN ESP32 ──────────────────────────────────────
function sendCommand(action, extra) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    addLog('Chưa kết nối ESP32! Kiểm tra IP và WiFi.', 'warn'); return;
  }
  var payload = JSON.stringify(Object.assign({ action: action }, extra || {}));
  ws.send(payload);
  recordExcelEvent('Gui lenh ESP32: ' + payload, 'send');
  console.log('[WS→ESP32]', payload);
}

function getDeviceName(deviceKey) {
  return devices[deviceKey] ? devices[deviceKey].name : deviceKey;
}

function recordDeviceCommand(deviceKey, state, source) {
  var now = new Date();
  var row = {
    id: now.getTime() + '-' + deviceKey + '-' + (source || 'CMD'),
    iso: now.toISOString(),
    deviceKey: deviceKey,
    deviceName: getDeviceName(deviceKey),
    command: state ? 'BAT' : 'TAT',
    responseMs: null,
    responseType: source || 'CMD',
    result: 'Dang cho',
    source: source || 'CMD'
  };
  commandHistory.push(row);
  if (commandHistory.length > 200) commandHistory.shift();
  return row;
}

function recordManualCommand(deviceKey, state) {
  return recordDeviceCommand(deviceKey, state, 'CMD');
}

function updateManualCommandResponse(cmd) {
  var responseMs = null;
  if (cmd && cmd.last !== undefined) responseMs = Number(cmd.last);
  if (!Number.isFinite(responseMs)) responseMs = null;

  var deviceKey = cmd && cmd.device ? String(cmd.device) : '';
  var row = null;
  if (deviceKey) {
    row = commandHistory.slice().reverse().find(function(item) {
      return item.result === 'Dang cho' && (item.deviceKey === deviceKey || item.deviceName === deviceKey);
    });
  }
  if (!row) {
    row = commandHistory.slice().reverse().find(function(item) { return item.result === 'Dang cho'; });
  }
  if (!row) return;

  if (responseMs === null) {
    responseMs = Date.now() - new Date(row.iso).getTime();
  }
  row.responseMs = Math.round(responseMs);
  row.result = row.responseMs <= 200 ? 'Dat' : 'Khong dat';
}

window.toggleDevice = function(deviceKey) {
  var dev = devices[deviceKey]; if (!dev) return;
  var newState = !dev.state;
  recordManualCommand(deviceKey, newState);
  sendCommand('control', { device: deviceKey, state: newState });
  addLog(dev.name + ': ' + (newState ? 'Bật' : 'Tắt'), 'info');
};

window.controlAll = function(state) {
  Object.keys(devices).forEach(function(deviceKey) {
    recordManualCommand(deviceKey, state);
  });
  sendCommand('allControl', { state: state });
  addLog('Tất cả thiết bị: ' + (state ? 'Bật' : 'Tắt'), 'info');
};

window.toggleMode = function() { window.setMode(isAutoMode ? 'MANUAL' : 'AUTO'); };

window.setMode = function(mode) {
  sendCommand('setMode', { mode: mode });
  addLog('Chuyển chế độ: ' + mode, 'info');
};

// ─── CẬP NHẬT UI THIẾT BỊ ────────────────────────────────────
function updateDeviceUI() {
  Object.keys(devices).forEach(function(key) {
    var dev = devices[key];

    // Dashboard quick-view card
    var card     = document.getElementById(dev.id);
    var statusEl = document.getElementById(dev.id + '-status');
    if (card) {
      if (dev.state) { card.classList.add('on'); }
      else           { card.classList.remove('on'); }
    }
    if (statusEl) statusEl.textContent = dev.state ? 'BẬT' : 'TẮT';

    // Device control view card
    var dccCard   = document.getElementById('dcc-' + key);
    var dccState  = document.getElementById('dcc-' + key + '-st');
    if (dccCard) {
      if (dev.state) dccCard.classList.add('on'); else dccCard.classList.remove('on');
    }
    if (dccState) dccState.textContent = dev.state ? 'BẬT' : 'TẮT';
  });

  // Mode badge
  var badge = document.getElementById('devices-mode-badge');
  if (badge) {
    badge.innerHTML = 'CHẾ ĐỘ: <strong>' + (isAutoMode ? 'AUTO' : 'MANUAL') + '</strong>';
    badge.className = 'devices-mode-badge' + (isAutoMode ? '' : ' manual');
  }

  // Mode button
  var modeBtn = document.getElementById('mode-toggle-btn');
  if (modeBtn) modeBtn.textContent = isAutoMode ? '🔄 Chuyển MANUAL' : '🤖 Chuyển AUTO';

  // Mode cards highlight
  var mcAuto   = document.getElementById('mc-auto');
  var mcManual = document.getElementById('mc-manual');
  if (mcAuto && mcManual) {
    mcAuto.style.borderColor   = isAutoMode ? 'var(--c-green-m)' : '';
    mcManual.style.borderColor = !isAutoMode ? 'var(--c-green-m)' : '';
    mcAuto.style.background    = isAutoMode ? 'var(--c-green-l)' : '';
    mcManual.style.background  = !isAutoMode ? 'var(--c-green-l)' : '';
  }
}

// ═══════════════════════════════════════════════════════════════
// [FIX 3] updateFromESP32 — map ĐỦ tất cả fields từ ESP32
// ESP32 gửi: temp, humi, lux, soil, mode, den_suoi1..device8
// ═══════════════════════════════════════════════════════════════
function updateFromESP32(data) {
  console.log('[ESP32 data]', JSON.stringify(data));
  recordExcelEvent('Nhan tin hieu ESP32: ' + (data.type || 'data'), 'receive');

  // 1. Trạng thái 8 relay
  var keyMap = {
    den_suoi1: 'den_suoi1', den_suoi2: 'den_suoi2',
    quat_hut1: 'quat_hut1', quat_hut2: 'quat_hut2',
    den_phong: 'den_phong', phun_suong: 'phun_suong',
    quat_suong: 'quat_suong', device8: 'device8'
  };
  Object.keys(keyMap).forEach(function(k) {
    if (data[k] !== undefined && devices[keyMap[k]]) {
      devices[keyMap[k]].state = !!data[k];
    }
  });

  // 2. Cảm biến — map vào rooms và stat cards
  if (data.temp !== undefined) {
    var t = parseFloat(data.temp);
    rooms.A.temp = t;
    sparkData.A.temp.push(t); sparkData.A.temp.shift();
  }
  if (data.humi !== undefined) {
    var h = parseFloat(data.humi);
    rooms.A.humi = h;
    sparkData.A.humi.push(h); sparkData.A.humi.shift();
  }

  // 3. Cập nhật stat cards trực tiếp
  if (data.temp !== undefined) {
    setVal('dash-temp', parseFloat(data.temp).toFixed(1));
    setBar('bar-temp', (parseFloat(data.temp) / 50) * 100);
  }
  if (data.humi !== undefined) {
    setVal('dash-humi', Math.round(parseFloat(data.humi)));
    setBar('bar-humi', parseFloat(data.humi));
  }
  if (data.lux !== undefined) {
    setVal('dash-lux', Math.round(parseFloat(data.lux)));
    setBar('bar-lux', Math.min(100, parseFloat(data.lux) / 10));
  }
  if (data.soil !== undefined) {
    setVal('dash-soil', Math.round(parseFloat(data.soil)));
    setBar('bar-soil', parseFloat(data.soil));
  }

  // 4. Cập nhật RTC từ ESP32 timestamp (nếu có) hoặc giữ đồng hồ web
  if (data.rtc !== undefined) {
    setVal('dash-rtc', data.rtc);
  } else if (data.time !== undefined) {
    setVal('dash-rtc', data.time);
  } else {
    // Nếu ESP32 không gửi RTC, dùng thời gian web
    var now = new Date();
    var rtcDisplay = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setVal('dash-rtc', rtcDisplay);
  }

  // 5. Lịch sử sensor cho chart realtime
  var label = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (sensorHistory.labels.length >= MAX_HISTORY) {
    sensorHistory.labels.shift();
    sensorHistory.temp.shift();
    sensorHistory.humi.shift();
    sensorHistory.lux.shift();
    sensorHistory.soil.shift();
  }
  sensorHistory.labels.push(label);
  sensorHistory.temp.push(data.temp  !== undefined ? parseFloat(data.temp)  : null);
  sensorHistory.humi.push(data.humi  !== undefined ? parseFloat(data.humi)  : null);
  sensorHistory.lux.push(data.lux    !== undefined ? parseFloat(data.lux)   : null);
  sensorHistory.soil.push(data.soil  !== undefined ? parseFloat(data.soil)  : null);

  // 6. Cập nhật chart realtime (Room A only)
  if (charts.sensorHistory) {
    charts.sensorHistory.data.labels = sensorHistory.labels.slice();
    charts.sensorHistory.data.datasets[0].data = sensorHistory.temp.slice();
    charts.sensorHistory.data.datasets[1].data = sensorHistory.humi.slice();
    charts.sensorHistory.update('none');
  }
  if (charts.soilLux) {
    charts.soilLux.data.labels = sensorHistory.labels.slice();
    charts.soilLux.data.datasets[0].data = sensorHistory.soil.slice();
    charts.soilLux.data.datasets[1].data = sensorHistory.lux.slice();
    charts.soilLux.update('none');
  }
  // Update full-size charts (View Charts)
  if (charts.sensorHistoryFull) {
    charts.sensorHistoryFull.data.labels = sensorHistory.labels.slice();
    charts.sensorHistoryFull.data.datasets[0].data = sensorHistory.temp.slice();
    charts.sensorHistoryFull.data.datasets[1].data = sensorHistory.humi.slice();
    charts.sensorHistoryFull.update('none');
  }
  if (charts.soilLuxFull) {
    charts.soilLuxFull.data.labels = sensorHistory.labels.slice();
    charts.soilLuxFull.data.datasets[0].data = sensorHistory.soil.slice();
    charts.soilLuxFull.data.datasets[1].data = sensorHistory.lux.slice();
    charts.soilLuxFull.update('none');
  }

  // 7. Chế độ AUTO/MANUAL
  if (data.mode !== undefined) isAutoMode = (data.mode === 'AUTO');

  // 7b. CẬP NHẬT TỔNG QUAN CHI TIẾT — Cảm biến
  // DHT22
  if (data.dht_temp !== undefined && data.dht_humi !== undefined) {
    currentMetrics.dht.temp = parseFloat(data.dht_temp);
    currentMetrics.dht.humi = parseFloat(data.dht_humi);
    currentMetrics.dht.valid = !!data.dht_valid;
    setVal('detail-dht-temp', parseFloat(data.dht_temp).toFixed(1) + '°C');
    setVal('detail-dht-humi', Math.round(parseFloat(data.dht_humi)) + '%');
    var dhtStatus = document.getElementById('detail-dht-status');
    if (dhtStatus) {
      if (data.dht_valid) {
        dhtStatus.textContent = '🟢 Đang hoạt động';
        dhtStatus.className = 'detail-status connected';
      } else {
        dhtStatus.textContent = '🔴 Chưa kết nối';
        dhtStatus.className = 'detail-status';
      }
    }
  }
  
  // SHT30
  if (data.sht_temp !== undefined && data.sht_humi !== undefined) {
    currentMetrics.sht.temp = parseFloat(data.sht_temp);
    currentMetrics.sht.humi = parseFloat(data.sht_humi);
    currentMetrics.sht.valid = !!data.sht_valid;
    setVal('detail-sht-temp', parseFloat(data.sht_temp).toFixed(1) + '°C');
    setVal('detail-sht-humi', Math.round(parseFloat(data.sht_humi)) + '%');
    var shtStatus = document.getElementById('detail-sht-status');
    if (shtStatus) {
      if (data.sht_valid) {
        shtStatus.textContent = '🟢 Đang hoạt động';
        shtStatus.className = 'detail-status connected';
      } else {
        shtStatus.textContent = '🔴 Chưa kết nối';
        shtStatus.className = 'detail-status';
      }
    }
  }

  // 7c. CẬP NHẬT HIỆU NĂNG — RSSI
  if (data.rssi !== undefined) {
    var rssi = data.rssi;
    Object.assign(currentMetrics.rssi, rssi);
    if (rssi.last !== undefined) setVal('detail-rssi-last', rssi.last + ' dBm');
    if (rssi.min !== undefined && rssi.max !== undefined) {
      setVal('detail-rssi-range', rssi.min + '/' + rssi.max + ' dBm');
    }
    if (rssi.avg !== undefined) setVal('detail-rssi-avg', Math.round(rssi.avg) + ' dBm');
  }

  // 7d. CẬP NHẬT LATENCY
  if (data.latency_ms !== undefined) {
    var lat = data.latency_ms;
    Object.assign(currentMetrics.latency, lat);
    if (lat.last !== undefined) setVal('detail-latency-last', lat.last + ' ms');
    if (lat.min !== undefined && lat.max !== undefined) {
      setVal('detail-latency-range', lat.min + '/' + lat.max + ' ms');
    }
    if (lat.avg !== undefined) setVal('detail-latency-avg', Math.round(lat.avg) + ' ms');
  }

  // 7e. CẬP NHẬT CMD RESPONSE
  var cmd = data.cmd_response_ms || data.cmd_ms;
  if (cmd !== undefined) {
    Object.assign(currentMetrics.cmd, cmd);
    updateManualCommandResponse(cmd);
    if (cmd.last !== undefined) setVal('detail-cmd-last', cmd.last + ' ms');
    if (cmd.min !== undefined && cmd.max !== undefined) {
      setVal('detail-cmd-range', cmd.min + '/' + cmd.max + ' ms');
    }
    if (cmd.avg !== undefined) setVal('detail-cmd-avg', Math.round(cmd.avg) + ' ms');
    if (cmd.device) console.log('[CMD Response]', cmd.device, cmd.last + 'ms');
  }

  // 7f. CẬP NHẬT PACKETS
  if (data.packets !== undefined) {
    var pkt = data.packets;
    Object.assign(currentMetrics.packets, pkt);
    if (pkt.total !== undefined) setVal('detail-pkt-total', pkt.total);
    if (pkt.data !== undefined && pkt.ack !== undefined && pkt.error !== undefined) {
      setVal('detail-pkt-breakdown', pkt.data + '/' + pkt.ack + '/' + pkt.error);
    }
  }

  // 8. Đánh dấu slave còn sống
  nodeLastSeen.A = Date.now();

  // 9. Cập nhật last-update và ws-status
  setVal('last-update', new Date().toLocaleTimeString('vi-VN', { hour12: false }));
  setVal('ws-status-txt', '🟢 Đã kết nối ESP32');

  // 10. Cập nhật toàn bộ UI
  updateDeviceUI();
  checkAlerts();
  updateNodeStatus();
  updateSparklines();
  if (activeGaugeKey) updateGaugeModal(activeGaugeKey, false);
}

// ─── HELPERS ─────────────────────────────────────────────────
function setVal(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
function setBar(id, pct) { var el = document.getElementById(id); if (el) el.style.width = Math.min(100, Math.max(0, pct)) + '%'; }

function updateUI() {
  if (rooms.A.temp > 0) {
    setVal('dash-temp', rooms.A.temp.toFixed(1));
    setBar('bar-temp', (rooms.A.temp / 50) * 100);
  }
  if (rooms.A.humi > 0) {
    setVal('dash-humi', Math.round(rooms.A.humi));
    setBar('bar-humi', rooms.A.humi);
  }
  setVal('last-update', new Date().toLocaleTimeString('vi-VN', { hour12: false }));
  checkAlerts(); updateNodeStatus(); updateSparklines();
}

// ─── SCHEDULER ────────────────────────────────────────────────
var schedules = {};

window.toggleSchedEnable = function(device, el) {
  el.classList.toggle('on');
  schedules[device] = schedules[device] || {};
  schedules[device].enabled = el.classList.contains('on');
  var statusEl = document.getElementById('sched-status-' + device);
  if (statusEl) statusEl.textContent = schedules[device].enabled ? 'Đã bật lịch' : '—';
};

window.setNowAsStart = function(device) {
  var now = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : n; };
  var dateStr = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());
  var timeStr = pad(now.getHours()) + ':' + pad(now.getMinutes());
  var sdEl = document.getElementById('sch-sd-' + device);
  var stEl = document.getElementById('sch-st-' + device);
  if (sdEl) sdEl.value = dateStr;
  if (stEl) stEl.value = timeStr;
};

window.applySchedule = function(device) {
  var sd = document.getElementById('sch-sd-' + device);
  var st = document.getElementById('sch-st-' + device);
  var ed = document.getElementById('sch-ed-' + device);
  var et = document.getElementById('sch-et-' + device);
  if (!sd || !st || !ed || !et || !sd.value || !st.value || !ed.value || !et.value) {
    addLog('Lịch ' + device + ': Vui lòng điền đủ ngày giờ bắt đầu và kết thúc!', 'warn'); return;
  }
  var start = new Date(sd.value + 'T' + st.value);
  var end   = new Date(ed.value + 'T' + et.value);
  if (end <= start) { addLog('Lịch ' + device + ': Giờ kết thúc phải sau giờ bắt đầu!', 'warn'); return; }
  schedules[device] = { enabled: true, start: start, end: end };
  var statusEl = document.getElementById('sched-status-' + device);
  if (statusEl) {
    statusEl.textContent = 'Bắt đầu: ' + start.toLocaleString('vi-VN') + ' → ' + end.toLocaleString('vi-VN');
    statusEl.className = 'sched-status sched-waiting';
  }
  addLog('Đã lên lịch ' + (devices[device] ? devices[device].name : device), 'ok');
};

// Kiểm tra lịch mỗi 10 giây
setInterval(function() {
  var now = new Date();
  Object.keys(schedules).forEach(function(device) {
    var sch = schedules[device]; if (!sch || !sch.enabled) return;
    var statusEl = document.getElementById('sched-status-' + device);
    if (now >= sch.start && now < sch.end) {
      if (devices[device] && !devices[device].state) {
        recordDeviceCommand(device, true, 'L');
        sendCommand('control', { device: device, state: true });
        addLog('Lịch tự bật: ' + (devices[device] ? devices[device].name : device), 'ok');
      }
      if (statusEl) statusEl.className = 'sched-status sched-active';
    } else if (now >= sch.end) {
      if (devices[device] && devices[device].state) {
        recordDeviceCommand(device, false, 'L');
        sendCommand('control', { device: device, state: false });
        addLog('Lịch tự tắt: ' + (devices[device] ? devices[device].name : device), 'info');
      }
      sch.enabled = false;
      if (statusEl) { statusEl.className = 'sched-status sched-done'; statusEl.textContent = 'Đã hoàn thành'; }
    }
  });
}, 10000);

// ─── WEBSOCKET ────────────────────────────────────────────────
var ws = null;
var wsReconnectTimer = null;

function initWebSocket() {
  var wsUrl = 'ws://' + ESP32_IP + ':' + ESP32_PORT;
  console.log('[WebSocket] Kết nối:', wsUrl);
  setVal('ws-status-txt', '🟡 Đang kết nối ' + wsUrl + '...');

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      console.log('✅ [WebSocket] Đã kết nối ESP32!');
      addLog('✅ Kết nối WebSocket thành công: ' + wsUrl, 'ok');
      setVal('ws-status-txt', '🟢 Đã kết nối ESP32');
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    };

    ws.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        updateFromESP32(data);
      } catch(e) {
        console.error('[WebSocket] Lỗi parse:', e, 'Raw:', event.data);
      }
    };

    ws.onclose = function() {
      console.log('❌ [WebSocket] Mất kết nối, thử lại sau 5 giây...');
      setVal('ws-status-txt', '🔴 Mất kết nối — đang thử lại...');
      addLog('Mất kết nối WebSocket, thử lại sau 5s...', 'warn');
      wsReconnectTimer = setTimeout(initWebSocket, 5000);
    };

    ws.onerror = function(err) {
      console.error('[WebSocket] Lỗi:', err);
      setVal('ws-status-txt', '🔴 Lỗi kết nối — kiểm tra IP: ' + ESP32_IP);
    };

  } catch(e) {
    console.error('[WebSocket] Không tạo được:', e.message);
    wsReconnectTimer = setTimeout(initWebSocket, 5000);
  }
}

// ─── KHỞI ĐỘNG ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  initCharts();
  initMetricCards();
  window.applyPreset('romStraw');
  updateThresholdDisplays();
  updateThresholdVisual();
  updateDeviceUI();
  updateUI();
  updateSparklines();

  addLog('NấmSmart v3.2 khởi động OK', 'ok');
  addLog('IP ESP32 hiện tại: ' + ESP32_IP + ' — đổi qua updateESP32IP("x.x.x.x") trong Console', 'info');

  initWebSocket();

  // Cập nhật node status mỗi 3.5s
  setInterval(function() {
    updateNodeStatus();
    var cpuVal = Math.round(20 + Math.random() * 40);
    var cpuBar = document.getElementById('cpu-bar');
    var cpuTxt = document.getElementById('cpu-val');
    if (cpuBar) cpuBar.style.width = cpuVal + '%';
    if (cpuTxt) cpuTxt.textContent = cpuVal + '%';
  }, 3500);

  // ─── USER MENU DROPDOWN ───────────────────────────────────
  var avatarBtn = document.getElementById('avatarBtn');
  var userMenuDropdown = document.getElementById('userMenuDropdown');
  
  if (avatarBtn && userMenuDropdown) {
    avatarBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('show');
    });

    // Cập nhật thông tin user
    var user = nasSmartAuth.getCurrentUser();
    if (user) {
      var userNameMenu = document.getElementById('userNameMenu');
      var userIdMenu = document.getElementById('userIdMenu');
      if (userNameMenu) userNameMenu.textContent = user.name || user.username;
      if (userIdMenu) userIdMenu.textContent = user.username;
    }

    // Đóng menu khi click ngoài
    document.addEventListener('click', function(e) {
      if (!userMenuDropdown.contains(e.target) && !avatarBtn.contains(e.target)) {
        userMenuDropdown.classList.remove('show');
      }
    });

    // ═══════════════════════════════════════════════════════════
    // 📊 LƯU DỮ LIỆU CẢM BIẾN ĐỀU ĐẶN
    // ═══════════════════════════════════════════════════════════
    setInterval(() => {
      saveSensorData();
    }, 10000); // Lưu mỗi 10 giây
  }
});

// ═══════════════════════════════════════════════════════════
// 💾 SAVE SENSOR DATA
// ═══════════════════════════════════════════════════════════
function saveSensorData() {
  const temp = parseFloat(document.getElementById('dash-temp')?.innerText) || 0;
  const humi = parseFloat(document.getElementById('dash-humi')?.innerText) || 0;
  const soil = parseFloat(document.getElementById('dash-soil')?.innerText) || 0;
  const lux = parseFloat(document.getElementById('dash-lux')?.innerText) || 0;

  const roomA_status = nodeState.A === 'online' ? '🟢 Online' : '🔴 Offline';

  // Trạng thái các thiết bị
  const deviceStatuses = {};
  for (const [key, device] of Object.entries(devices)) {
    deviceStatuses[key] = device.state ? 'ON' : 'OFF';
  }

  const payload = {
    temp,
    humi,
    lux,
    soil,
    roomA_status,
    devices: deviceStatuses,
    performance: {
      dht: currentMetrics.dht,
      sht: currentMetrics.sht,
      rssi: currentMetrics.rssi,
      latency: currentMetrics.latency,
      cmd: currentMetrics.cmd,
      packets: currentMetrics.packets,
      mode: isAutoMode ? 'AUTO' : 'MANUAL',
      nodeA: nodeState.A
    },
    events: pendingExcelEvents.slice(),
    commandHistory: commandHistory.slice()
  };

  // Gửi lên server
  const token = localStorage.getItem('nasmart_token');
  if (token) {
    return fetch('/api/sensor-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    })
    .catch(error => console.log('Lưu dữ liệu:', error));
  }
  return Promise.resolve();
}

// ═══════════════════════════════════════════════════════════
// 📥 DOWNLOAD EXCEL
// ═══════════════════════════════════════════════════════════
function downloadExcel() {
  const token = localStorage.getItem('nasmart_token');
  if (!token) {
    alert('Vui lòng đăng nhập lại');
    return;
  }

  const btn = document.getElementById('export-excel-btn');
  const originalText = btn.innerText;
  btn.innerText = '⏳';
  btn.disabled = true;

  Promise.resolve(saveSensorData()).then(() => fetch('/api/export-excel', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }))
  .then(response => {
    if (!response.ok) {
      throw new Error('Lỗi tải file');
    }
    return response.blob();
  })
  .then(blob => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NamSmart_Data_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    addLog('✅ Tải Excel thành công', 'success');
    btn.innerText = originalText;
    btn.disabled = false;
  })
  .catch(error => {
    console.error('Lỗi tải Excel:', error);
    alert('❌ Lỗi tải Excel: ' + error.message);
    btn.innerText = originalText;
    btn.disabled = false;
  });
}

function downloadGaugeExcel() {
  const token = localStorage.getItem('nasmart_token');
  const metric = activeGaugeKey;
  const allowed = { rssi: true, latency: true, cmd: true };
  if (!token) {
    alert('Vui lòng đăng nhập lại');
    return;
  }
  if (!allowed[metric]) {
    alert('Chỉ hỗ trợ tải Excel cho RSSI, Latency và CMD Response');
    return;
  }

  const btn = document.getElementById('gauge-download-btn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Đang tải...';
    btn.disabled = true;
  }

  Promise.resolve(saveSensorData()).then(() => fetch('/api/export-metric-excel/' + metric, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }))
  .then(response => {
    if (!response.ok) {
      return response.text().then(function(text) {
        var msg = text;
        try {
          var data = JSON.parse(text);
          msg = data.message || data.error || text;
        } catch (e) {}
        if (response.status === 404) {
          msg = 'Server chưa cập nhật API mới. Hãy tắt node server.js và chạy lại.';
        }
        throw new Error(msg || ('HTTP ' + response.status));
      });
    }
    return response.blob();
  })
  .then(blob => {
    const names = { rssi: 'RSSI', latency: 'Latency', cmd: 'CMD_Response' };
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NamSmart_${names[metric]}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    addLog('Tải Excel ' + names[metric] + ' thành công', 'success');
  })
  .catch(error => {
    console.error('Lỗi tải Excel metric:', error);
    alert('Lỗi tải Excel: ' + error.message);
  })
  .finally(() => {
    if (btn) {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}
