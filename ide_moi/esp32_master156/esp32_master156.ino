// ════════════════════════════════════════════════════════
//  ESP32 MASTER — PHIÊN BẢN HOÀN CHỈNH
//  ✓ Relay Active HIGH (HIGH=BẬT, LOW=TẮT) — khớp Slave Doc1
//  ✓ Latency & CMD Response cập nhật LCD ngay khi nhận ACK
//  ✓ sendPerformanceToWeb() gọi ngay sau updateCmdResponseStats()
//  ✓ 12 MCP Tools đầy đủ (bao gồm schedules HH:MM, xem_nguong, v.v.)
//  ✓ resetPerfStats() là function riêng
// ════════════════════════════════════════════════════════

#include "WebSocketMCP.h"
#include <WebSocketsServer.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <LoRa.h>
#include "RTClib.h"
#include <Preferences.h>
#include <ArduinoJson.h>

#define SCK  14
#define MISO 12
#define MOSI 13
#define SS    5
#define RST  26
#define DIO0 27

const int SW1 = 15, SW2 = 25, SW3 = 4, SW4 = 16;
const int LED_XANH = 18, LED_DO = 19;

const char* ssid        = "Duy";
const char* password    = "123456789";
const char* mcpEndpoint = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjkyNTQ3MCwiYWdlbnRJZCI6MTgwMzYzMywiZW5kcG9pbnRJZCI6ImFnZW50XzE4MDM2MzMiLCJwdXJwb3NlIjoibWNwLWVuZHBvaW50IiwiaWF0IjoxNzgwNTc3NzA0LCJleHAiOjE4MTIxMzUzMDR9.2VY4BhtTHAxfXJ7WpxpIoAb1mcWJ9qqBuQ_7ObsPa1jhxHpDe6cuRQER0IkoXQxpi7zT0dgJVPD3sg7-6GDSXA";

LiquidCrystal_I2C lcd(0x27, 16, 2);
RTC_DS3231 rtc;
Preferences prefs;
WebSocketMCP mcpClient;
WebSocketsServer webSocket = WebSocketsServer(8080);

float airTemp      = 0;
float airHum       = 0;
float lightLux     = 0;
int   soilMoisture = 0;

float dhtTemp = 0, dhtHumi = 0;
float shtTemp = 0, shtHumi = 0;
bool  dhtValid = false, shtValid = false;

int  setMinutes           = 5;
unsigned long timerStartTime[8] = {0};
bool isTimerActive[8]     = {false};

// ── HẸN GIỜ THEO GIỜ CỤ THỂ (HH:MM) ──────────────────
struct TimeSchedule {
  bool   active;
  int    onHour,  onMinute;
  int    offHour, offMinute;
  bool   hasOn,   hasOff;
};
TimeSchedule schedules[8];

int  displayMode    = 1;
bool isAutoMode     = true;
int  cursorRow      = 0;
unsigned long lastBlinkTime  = 0;
unsigned long lastWsSend     = 0;
String globalMsg    = "";

// ═══════════════════════════════════════════════════════
//  BIẾN ĐO HIỆU NĂNG
// ═══════════════════════════════════════════════════════
int    loraRSSI_last      = 0;
int    loraRSSI_min       = 0;
int    loraRSSI_max       = 0;
float  loraRSSI_avg       = 0;
long   loraRSSI_sum       = 0;
int    loraRSSI_count     = 0;

unsigned long loraSendTime     = 0;
unsigned long loraLatency_last = 0;
unsigned long loraLatency_min  = 99999;
unsigned long loraLatency_max  = 0;
float         loraLatency_avg  = 0;
unsigned long loraLatency_sum  = 0;
int           loraLatency_count= 0;
bool          waitingForAck    = false;

unsigned long cmdSendTime      = 0;
unsigned long cmdResponseTime  = 0;
unsigned long cmdResp_min      = 99999;
unsigned long cmdResp_max      = 0;
float         cmdResp_avg      = 0;
unsigned long cmdResp_sum      = 0;
int           cmdResp_count    = 0;
String        cmdResp_device   = "";
bool          waitingForCmdAck = false;

int loraPktTotal   = 0;
int loraPktData    = 0;
int loraPktAck     = 0;
int loraPktError   = 0;
// ═══════════════════════════════════════════════════════

enum MenuState {
  MENU_NONE = 0,
  MENU_MAIN,
  MENU_WIFI,
  MENU_WIFI_SSID,
  MENU_WIFI_PASS,
  MENU_WIFI_IP,
  MENU_THONGSO,
  MENU_TS_ANHS,
  MENU_TS_ANHS_LOW,
  MENU_TS_ANHS_HIGH,
  MENU_TS_NHIET,
  MENU_TS_NHIET_LOW,
  MENU_TS_NHIET_HIGH,
  MENU_TS_DOAM,
  MENU_TS_DOAM_LOW,
  MENU_TS_DOAM_HIGH,
  MENU_TS_THOIGIAN,
  MENU_CHEDO,
  MENU_MANUAL_DEV,
  MENU_PERFORMANCE,
};

MenuState menuState  = MENU_NONE;
int  menuCursor      = 0;
int  editValue       = 0;
bool inEditMode      = false;
unsigned long lastMenuBtn = 0;

const char* mainMenuItems[] = { "WIFI", "THONG SO", "CHE DO", "DO HIEU NANG" };
const char* wifiMenuItems[] = { "TEN WIFI", "MAT KHAU", "DIA CHI IP" };
const char* tsMenuItems[]   = { "ANH SANG", "NHIET DO", "DO AM", "THOI GIAN" };
const char* cheDoItems[]    = { "AUTO", "MANUAL" };

bool   s[8]     = {false, false, false, false, false, false, false, false};
String names[8] = {"DEN S1", "DEN S2", "QUAT1", "QUAT2", "DEN PH", "PHUN", "QUAT3", "DEV8"};

const char* wsKeys[8] = {
  "den_suoi1", "den_suoi2", "quat_hut1", "quat_hut2",
  "den_phong", "phun_suong", "quat_suong", "device8"
};

float threshTempLow  = 28.0;
float threshTempHot  = 32.0;
float threshHumLow   = 80.0;
float threshHumHigh  = 90.0;
int   threshLuxLow   = 500;
int   threshLuxHigh  = 1000;
int   threshSoilDry  = 40;
int   threshSoilWet  = 80;
float threshHumMist  = 80.0;
int   threshLuxDark  = 500;

String _pendingDevLabel = "";

// ═══════════════════════════════════════════════════════
//  RSSI / LATENCY / CMD RESPONSE STATS
// ═══════════════════════════════════════════════════════
void updateRSSIStats(int rssi) {
  loraRSSI_last = rssi;
  loraRSSI_count++;
  loraRSSI_sum += rssi;
  loraRSSI_avg = (float)loraRSSI_sum / loraRSSI_count;
  if (loraRSSI_count == 1) { loraRSSI_min = rssi; loraRSSI_max = rssi; }
  else { if (rssi < loraRSSI_min) loraRSSI_min = rssi; if (rssi > loraRSSI_max) loraRSSI_max = rssi; }
  Serial.printf("[RSSI] Gói #%d: %d dBm  |  Min=%d  Max=%d  Avg=%.1f dBm\n",
                loraPktTotal, rssi, loraRSSI_min, loraRSSI_max, loraRSSI_avg);
}

void updateLatencyStats(unsigned long latency) {
  loraLatency_last = latency;
  loraLatency_count++;
  loraLatency_sum += latency;
  loraLatency_avg = (float)loraLatency_sum / loraLatency_count;
  if (latency < loraLatency_min) loraLatency_min = latency;
  if (latency > loraLatency_max) loraLatency_max = latency;
  Serial.printf("[LATENCY] #%d: %lums  |  Min=%lu  Max=%lu  Avg=%.1f ms\n",
                loraLatency_count, latency, loraLatency_min, loraLatency_max, loraLatency_avg);
  // ✓ Cập nhật LCD ngay khi có latency mới
  if (displayMode == 3 && menuState == MENU_NONE) updateDisplay();
  if (menuState == MENU_PERFORMANCE) renderMenu();
}

void updateCmdResponseStats(unsigned long t, const String& device) {
  cmdResponseTime = t;
  cmdResp_device  = device;
  cmdResp_count++;
  cmdResp_sum += t;
  cmdResp_avg = (float)cmdResp_sum / cmdResp_count;
  if (t < cmdResp_min) cmdResp_min = t;
  if (t > cmdResp_max) cmdResp_max = t;
  Serial.printf("[CMD_RESP] %s: %lums  |  Min=%lu  Max=%lu  Avg=%.1f ms\n",
                device.c_str(), t, cmdResp_min, cmdResp_max, cmdResp_avg);
  // ✓ Cập nhật LCD ngay khi có cmd response mới
  if (displayMode == 3 && menuState == MENU_NONE) updateDisplay();
  if (menuState == MENU_PERFORMANCE) renderMenu();
}

void resetPerfStats() {
  loraRSSI_last = loraRSSI_min = loraRSSI_max = 0;
  loraRSSI_avg = 0; loraRSSI_sum = loraRSSI_count = 0;
  loraLatency_last = loraLatency_max = loraLatency_sum = loraLatency_count = 0;
  loraLatency_min = 99999;
  cmdResponseTime = cmdResp_max = cmdResp_sum = cmdResp_count = 0;
  cmdResp_min = 99999; cmdResp_device = "";
  loraPktTotal = loraPktData = loraPktAck = loraPktError = 0;
  Serial.println("[PERF] Da reset thong ke hieu nang");
}

// ═══════════════════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════════════════
void sendPerformanceToWeb() {
  DynamicJsonDocument doc(512);
  doc["type"] = "performance";

  JsonObject rssi = doc.createNestedObject("rssi");
  rssi["last"]  = loraRSSI_last;
  rssi["min"]   = loraRSSI_min;
  rssi["max"]   = loraRSSI_max;
  rssi["avg"]   = (int)loraRSSI_avg;
  rssi["count"] = loraRSSI_count;

  JsonObject lat = doc.createNestedObject("latency_ms");
  lat["last"]  = (int)loraLatency_last;
  lat["min"]   = loraLatency_min == 99999 ? 0 : (int)loraLatency_min;
  lat["max"]   = (int)loraLatency_max;
  lat["avg"]   = (int)loraLatency_avg;
  lat["count"] = loraLatency_count;

  JsonObject cmd = doc.createNestedObject("cmd_response_ms");
  cmd["last"]   = (int)cmdResponseTime;
  cmd["device"] = cmdResp_device;
  cmd["min"]    = cmdResp_min == 99999 ? 0 : (int)cmdResp_min;
  cmd["max"]    = (int)cmdResp_max;
  cmd["avg"]    = (int)cmdResp_avg;
  cmd["count"]  = cmdResp_count;

  JsonObject pkt = doc.createNestedObject("packets");
  pkt["total"] = loraPktTotal;
  pkt["data"]  = loraPktData;
  pkt["ack"]   = loraPktAck;
  pkt["error"] = loraPktError;

  String json;
  serializeJson(doc, json);
  webSocket.broadcastTXT(json);
}

void sendStatusToWeb() {
  DynamicJsonDocument doc(768);
  doc["type"]       = "status";
  doc["den_suoi1"]  = s[0];
  doc["den_suoi2"]  = s[1];
  doc["quat_hut1"]  = s[2];
  doc["quat_hut2"]  = s[3];
  doc["den_phong"]  = s[4];
  doc["phun_suong"] = s[5];
  doc["quat_suong"] = s[6];
  doc["device8"]    = s[7];
  doc["temp"]      = airTemp;
  doc["humi"]      = (int)airHum;
  doc["lux"]       = (int)lightLux;
  doc["soil"]      = soilMoisture;
  doc["sht_temp"]  = shtTemp;
  doc["sht_humi"]  = (int)shtHumi;
  doc["dht_temp"]  = dhtTemp;
  doc["dht_humi"]  = (int)dhtHumi;
  doc["sht_valid"] = shtValid;
  doc["dht_valid"] = dhtValid;
  doc["mode"]      = isAutoMode ? "AUTO" : "MANUAL";
  doc["rssi_last"] = loraRSSI_last;
  doc["latency_last_ms"] = (int)loraLatency_last;
  doc["timestamp"] = millis();
  String json;
  serializeJson(doc, json);
  webSocket.broadcastTXT(json);
}

void sendLoRaControl() {
  String packet = "";
  for (int i = 0; i < 8; i++) {
    packet += s[i] ? "1" : "0";
    if (i < 7) packet += ",";
  }
  loraSendTime     = millis();
  waitingForAck    = true;
  waitingForCmdAck = true;
  cmdSendTime      = loraSendTime;
  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();
  Serial.println("[LoRa] Gui lenh: " + packet);
}

void handleWebCommand(JsonDocument& doc) {
  if (doc["action"] == "control") {
    String device = doc["device"].as<String>();
    bool   state  = doc["state"].as<bool>();
    int idx = -1;
    for (int i = 0; i < 8; i++) {
      if (device == wsKeys[i]) { idx = i; break; }
    }
    if (idx != -1) {
      if (isAutoMode) isAutoMode = false;
      s[idx] = state;
      isTimerActive[idx] = false;
      _pendingDevLabel = names[idx]; _pendingDevLabel.trim();
      sendLoRaControl();
      String msg = names[idx]; msg.trim();
      msg += state ? ":BAT" : ":TAT";
      globalMsg = msg; updateDisplay(); delay(800); globalMsg = ""; updateDisplay();
    }
    sendStatusToWeb();
  }
  else if (doc["action"] == "allControl") {
    bool state = doc["state"].as<bool>();
    if (isAutoMode) isAutoMode = false;
    for (int i = 0; i < 8; i++) { s[i] = state; isTimerActive[i] = false; }
    _pendingDevLabel = state ? "TAT_CA_BAT" : "TAT_CA_TAT";
    sendLoRaControl();
    globalMsg = state ? "TAT CA:BAT" : "TAT CA:TAT";
    updateDisplay(); delay(800); globalMsg = ""; updateDisplay();
    sendStatusToWeb();
  }
  else if (doc["action"] == "setMode") {
    String mode = doc["mode"].as<String>();
    isAutoMode = (mode == "AUTO");
    if (!isAutoMode) {
      for (int i = 0; i < 8; i++) { s[i] = false; isTimerActive[i] = false; }
      _pendingDevLabel = "SET_MODE";
      sendLoRaControl();
    }
    globalMsg = isAutoMode ? "CHE DO:AUTO" : "CHE DO:MANUAL";
    updateDisplay(); delay(800); globalMsg = ""; updateDisplay();
    sendStatusToWeb();
  }
  else if (doc["action"] == "resetPerf") {
    resetPerfStats();
    sendPerformanceToWeb();
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[WebSocket] Client %u ket noi tu %s\n", num, ip.toString().c_str());
      sendStatusToWeb();
      sendPerformanceToWeb();
      break;
    }
    case WStype_DISCONNECTED:
      Serial.printf("[WebSocket] Client %u ngat ket noi\n", num);
      break;
    case WStype_TEXT: {
      DynamicJsonDocument doc(256);
      if (!deserializeJson(doc, payload)) handleWebCommand(doc);
      break;
    }
    default: break;
  }
}

void initWebSocketServer() {
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("[WebSocket] Server khoi dong port 8080");
}

void updateWebSocket() {
  webSocket.loop();
  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate > 2000) {
    lastUpdate = millis();
    if (webSocket.connectedClients() > 0) {
      sendStatusToWeb();
      sendPerformanceToWeb();
    }
  }
}

uint8_t getConnectedClients() { return webSocket.connectedClients(); }

// ═══════════════════════════════════════════════════════
//  PARSE GÓI LORA
// ═══════════════════════════════════════════════════════
void handleLoRaPacket(String incoming, int rssi) {
  loraPktTotal++;
  updateRSSIStats(rssi);

  if (incoming.startsWith("ACK:")) {
    loraPktAck++;
    if (waitingForAck) {
      unsigned long latency = millis() - loraSendTime;
      waitingForAck = false;
      updateLatencyStats(latency);  // ✓ gọi updateDisplay bên trong
    }
    if (waitingForCmdAck) {
      unsigned long respTime = millis() - cmdSendTime;
      waitingForCmdAck = false;
      String devLabel = _pendingDevLabel.length() > 0 ? _pendingDevLabel : "unknown";
      _pendingDevLabel = "";
      updateCmdResponseStats(respTime, devLabel);  // ✓ gọi updateDisplay bên trong
      sendPerformanceToWeb();                       // ✓ đẩy lên web ngay
    }
    Serial.printf("[ACK] Nhan ACK tu Slave — RSSI=%d dBm\n", rssi);

  } else if (incoming.startsWith("DATA:")) {
    loraPktData++;
    parseSensorData(incoming.substring(5));
    updateDisplay();
    if (millis() - lastWsSend >= 2000) {
      lastWsSend = millis();
      sendStatusToWeb();
    }
  } else {
    loraPktError++;
    Serial.println("[LoRa] Goi khong nhan dang duoc: " + incoming);
  }
}

void parseSensorData(String data) {
  int p1 = data.indexOf(',');
  int p2 = data.indexOf(',', p1 + 1);
  int p3 = data.indexOf(',', p2 + 1);
  int p4 = data.indexOf(',', p3 + 1);
  int p5 = data.indexOf(',', p4 + 1);
  if (p1 == -1 || p2 == -1 || p3 == -1) return;

  float raw_dht_t = data.substring(0, p1).toFloat();
  float raw_dht_h = data.substring(p1 + 1, p2).toFloat();
  lightLux        = data.substring(p2 + 1, p3).toFloat();
  soilMoisture    = data.substring(p3 + 1, (p4 != -1 ? p4 : data.length())).toInt();

  dhtValid = (raw_dht_t > -0.5);
  dhtTemp  = dhtValid ? raw_dht_t : dhtTemp;
  dhtHumi  = dhtValid ? raw_dht_h : dhtHumi;

  if (p4 != -1 && p5 != -1) {
    float raw_sht_t = data.substring(p4 + 1, p5).toFloat();
    float raw_sht_h = data.substring(p5 + 1).toFloat();
    shtValid = (raw_sht_t > -0.5);
    shtTemp  = shtValid ? raw_sht_t : shtTemp;
    shtHumi  = shtValid ? raw_sht_h : shtHumi;
  }

  if (shtValid && dhtValid) {
    airTemp = (shtTemp * 7.0 + dhtTemp * 3.0) / 10.0;
    airHum  = (shtHumi * 7.0 + dhtHumi * 3.0) / 10.0;
  } else if (shtValid) {
    airTemp = shtTemp; airHum = shtHumi;
  } else if (dhtValid) {
    airTemp = dhtTemp; airHum = dhtHumi;
  }
}

// ═══════════════════════════════════════════════════════
//  KIỂM TRA LỊCH HẸN GIỜ THEO HH:MM
// ═══════════════════════════════════════════════════════
void checkTimeSchedules() {
  DateTime now = rtc.now();
  int nowH = now.hour(), nowM = now.minute(), nowS = now.second();
  if (nowS != 0) return;
  bool changed = false;
  for (int i = 0; i < 8; i++) {
    if (!schedules[i].active) continue;
    if (schedules[i].hasOn && nowH == schedules[i].onHour && nowM == schedules[i].onMinute) {
      if (!s[i]) { s[i] = true; changed = true; Serial.printf("[SCHEDULE] Dev%d BAT luc %02d:%02d\n", i, nowH, nowM); }
    }
    if (schedules[i].hasOff && nowH == schedules[i].offHour && nowM == schedules[i].offMinute) {
      if (s[i]) { s[i] = false; changed = true; Serial.printf("[SCHEDULE] Dev%d TAT luc %02d:%02d\n", i, nowH, nowM); }
    }
  }
  if (changed) {
    _pendingDevLabel = "SCHEDULE";
    sendLoRaControl(); sendStatusToWeb(); updateDisplay();
  }
}

void runSmartSchedule(DateTime t) {
  bool old_s[8];
  for (int i = 0; i < 8; i++) old_s[i] = s[i];

  if (lightLux > 0) {
    if (lightLux < threshLuxLow)       { s[0] = true;  s[1] = true;  }
    else if (lightLux > threshLuxHigh) { s[0] = false; s[1] = false; }
  }
  if (airTemp > 0) {
    if (airTemp < threshTempLow)      { s[0]=true; s[1]=true; s[2]=false; s[3]=false; }
    else if (airTemp > threshTempHot) { s[0]=false; s[1]=false; s[2]=true; s[3]=true; }
    else                              { s[2]=false; s[3]=false; }
  }
  if (airHum > 0) {
    if (airHum < threshHumLow)        { s[5]=true; s[6]=true; }
    else if (airHum > threshHumHigh)  { s[5]=false; s[6]=false; s[4]=true; s[2]=true; s[3]=true; }
    else                              { s[5]=false; s[6]=false; }
  }
  if (soilMoisture > 0 && soilMoisture < threshSoilDry) s[7] = true;
  else if (soilMoisture > threshSoilWet)                 s[7] = false;

  bool changed = false;
  for (int i = 0; i < 8; i++) if (s[i] != old_s[i]) { changed = true; break; }
  if (changed) {
    _pendingDevLabel = "AUTO";
    sendLoRaControl(); updateDisplay(); sendStatusToWeb();
  }
}

// ═══════════════════════════════════════════════════════
//  DISPLAY / LCD
// ═══════════════════════════════════════════════════════
void showMsg(String line1, String line2 = "", int holdMs = 1000) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(line1.substring(0, 16));
  if (line2 != "") { lcd.setCursor(0, 1); lcd.print(line2.substring(0, 16)); }
  delay(holdMs);
}

void updateDisplay() {
  if (menuState != MENU_NONE) return;
  lcd.clear();
  if (displayMode == 1) {
    lcd.setCursor(0, 0);
    lcd.print("T:"); lcd.print(airTemp, 1); lcd.print("C ");
    lcd.print("H:"); lcd.print(airHum, 0); lcd.print("%");
    lcd.setCursor(0, 1);
    lcd.print(isAutoMode ? "AUTO " : "MAN ");
    lcd.print(shtValid ? "S+" : "S-");
    lcd.print(dhtValid ? "D+" : "D-");
  } else if (displayMode == 2) {
    lcd.setCursor(0, 0); lcd.print("Lux:"); lcd.print(lightLux, 0);
    lcd.setCursor(0, 1);
    lcd.print("S:"); lcd.print(shtTemp, 1);
    lcd.print(" D:"); lcd.print(dhtTemp, 1);
  } else if (displayMode == 3) {
    lcd.setCursor(0, 0);
    lcd.print("R:"); lcd.print(loraRSSI_last);
    lcd.print(" L:");
    if (loraLatency_last > 0) { lcd.print(loraLatency_last); lcd.print("ms"); }
    else lcd.print("--ms");
    lcd.setCursor(0, 1);
    lcd.print("C:");
    if (cmdResponseTime > 0) { lcd.print(cmdResponseTime); lcd.print("ms"); }
    else lcd.print("--ms");
    lcd.print(" P:"); lcd.print(loraPktTotal);
  } else if (displayMode == 4) {
    if (!isAutoMode) {
      if (globalMsg != "") { lcd.print(globalMsg); }
      else {
        int next = (cursorRow + 1) % 8;
        lcd.setCursor(0, 0); lcd.print(">"); lcd.print(names[cursorRow]);
        lcd.print(":"); lcd.print(s[cursorRow] ? "ON " : "OFF");
        lcd.setCursor(0, 1); lcd.print(" "); lcd.print(names[next]);
        lcd.print(":"); lcd.print(s[next] ? "ON " : "OFF");
      }
    } else {
      DateTime now = rtc.now();
      lcd.print("Time: "); lcd.print(now.hour()); lcd.print(":");
      if (now.minute() < 10) lcd.print("0");
      lcd.print(now.minute());
      lcd.setCursor(0, 1);
      lcd.print("WS:"); lcd.print(webSocket.connectedClients());
      lcd.print(" Timer:"); lcd.print(setMinutes); lcd.print("p");
    }
  }
}

void printPerformanceReport() {
  Serial.println("╔═══════════════════════════════════════╗");
  Serial.println("║      BAO CAO HIEU NANG HE THONG       ║");
  Serial.println("╠═══════════════════════════════════════╣");
  Serial.printf( "║ Tong goi LoRa: %4d (DATA:%d ACK:%d Loi:%d)\n",
                 loraPktTotal, loraPktData, loraPktAck, loraPktError);
  Serial.println("╠═══════════════════════════════════════╣");
  Serial.printf( "║ RSSI (dBm)    Last:%4d  Min:%4d  Max:%4d  Avg:%5.1f\n",
                 loraRSSI_last, loraRSSI_min, loraRSSI_max, loraRSSI_avg);
  Serial.println("╠═══════════════════════════════════════╣");
  if (loraLatency_count > 0) {
    Serial.printf("║ Latency (ms)  Last:%4lu  Min:%4lu  Max:%4lu  Avg:%5.1f\n",
                  loraLatency_last, loraLatency_min, loraLatency_max, loraLatency_avg);
  } else {
    Serial.println("║ Latency (ms)  Chua co du lieu (can ACK tu Slave)");
  }
  Serial.println("╠═══════════════════════════════════════╣");
  if (cmdResp_count > 0) {
    Serial.printf("║ CMD Resp (ms) Last:%4lu  Min:%4lu  Max:%4lu  Avg:%5.1f\n",
                  cmdResponseTime, cmdResp_min, cmdResp_max, cmdResp_avg);
    Serial.printf("║ Thiet bi cuoi: %s\n", cmdResp_device.c_str());
  } else {
    Serial.println("║ CMD Response  Chua co lenh nao duoc do");
  }
  Serial.println("╚═══════════════════════════════════════╝");
}

// ═══════════════════════════════════════════════════════
//  MCP TOOLS — 12 TOOLS ĐẦY ĐỦ
// ═══════════════════════════════════════════════════════
void onConnectionStatus(bool connected) {
  if (connected) {
    Serial.println("[MCP] Da ket noi Xiaozhi!");
    showMsg("Xiaozhi Online", "Voice Ready!", 1500);
    registerMcpTools();
    updateDisplay();
  } else {
    Serial.println("[MCP] Mat ket noi Xiaozhi!");
  }
}

int findDeviceIndex(const String& ten) {
  if (ten == "den_suoi_1")  return 0;
  if (ten == "den_suoi_2")  return 1;
  if (ten == "quat_hut_1")  return 2;
  if (ten == "quat_hut_2")  return 3;
  if (ten == "den_phong")   return 4;
  if (ten == "phun_suong")  return 5;
  if (ten == "quat_suong")  return 6;
  if (ten == "device_8")    return 7;
  return -1;
}

void registerMcpTools() {

  // TOOL 1: ĐỌC CẢM BIẾN
  mcpClient.registerTool(
    "doc_cam_bien",
    "Đọc toàn bộ giá trị cảm biến nhà nấm: nhiệt độ phòng trung bình, độ ẩm trung bình, riêng DHT22, riêng SHT30, ánh sáng lux, độ ẩm đất",
    "{\"type\":\"object\",\"properties\":{},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(512);
      doc["nhiet_do_trung_binh_C"] = (int)(airTemp * 10) / 10.0;
      doc["do_am_trung_binh_pct"]  = (int)airHum;
      doc["dht22_nhiet_do_C"]      = dhtValid ? (int)(dhtTemp * 10) / 10.0 : -1;
      doc["dht22_do_am_pct"]       = dhtValid ? (int)dhtHumi : -1;
      doc["dht22_hoat_dong"]       = dhtValid;
      doc["sht30_nhiet_do_C"]      = shtValid ? (int)(shtTemp * 10) / 10.0 : -1;
      doc["sht30_do_am_pct"]       = shtValid ? (int)shtHumi : -1;
      doc["sht30_hoat_dong"]       = shtValid;
      doc["anh_sang_lux"]          = (int)lightLux;
      doc["do_am_dat_pct"]         = soilMoisture;
      doc["che_do"]                = isAutoMode ? "TU_DONG" : "THU_CONG";
      String json; serializeJson(doc, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 2: XEM TRẠNG THÁI THIẾT BỊ
  mcpClient.registerTool(
    "xem_trang_thai",
    "Xem trạng thái bật/tắt của tất cả 8 thiết bị và chế độ hoạt động",
    "{\"type\":\"object\",\"properties\":{},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(512);
      doc["den_suoi_1"]  = s[0] ? "BAT" : "TAT";
      doc["den_suoi_2"]  = s[1] ? "BAT" : "TAT";
      doc["quat_hut_1"]  = s[2] ? "BAT" : "TAT";
      doc["quat_hut_2"]  = s[3] ? "BAT" : "TAT";
      doc["den_phong"]   = s[4] ? "BAT" : "TAT";
      doc["phun_suong"]  = s[5] ? "BAT" : "TAT";
      doc["quat_suong"]  = s[6] ? "BAT" : "TAT";
      doc["device_8"]    = s[7] ? "BAT" : "TAT";
      doc["che_do"]      = isAutoMode ? "TU_DONG" : "THU_CONG";
      String json; serializeJson(doc, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 3: XEM HIỆU NĂNG LORA
  mcpClient.registerTool(
    "xem_hieu_nang_lora",
    "Xem thống kê hiệu năng LoRa đầy đủ: RSSI, độ trễ, thời gian phản hồi lệnh, số gói tin",
    "{\"type\":\"object\",\"properties\":{},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(512);
      JsonObject rssi = doc.createNestedObject("rssi_dBm");
      rssi["hien_tai"]   = loraRSSI_last;
      rssi["min"]        = loraRSSI_min;
      rssi["max"]        = loraRSSI_max;
      rssi["trung_binh"] = (int)loraRSSI_avg;
      rssi["so_mau"]     = loraRSSI_count;
      JsonObject lat = doc.createNestedObject("latency_ms");
      lat["hien_tai"]   = (int)loraLatency_last;
      lat["min"]        = loraLatency_min == 99999 ? 0 : (int)loraLatency_min;
      lat["max"]        = (int)loraLatency_max;
      lat["trung_binh"] = (int)loraLatency_avg;
      lat["so_mau"]     = loraLatency_count;
      JsonObject cmd = doc.createNestedObject("cmd_response_ms");
      cmd["hien_tai"]      = (int)cmdResponseTime;
      cmd["min"]           = cmdResp_min == 99999 ? 0 : (int)cmdResp_min;
      cmd["max"]           = (int)cmdResp_max;
      cmd["trung_binh"]    = (int)cmdResp_avg;
      cmd["so_lenh"]       = cmdResp_count;
      cmd["thiet_bi_cuoi"] = cmdResp_device;
      JsonObject pkt = doc.createNestedObject("goi_tin");
      pkt["tong_cong"] = loraPktTotal;
      pkt["data"]      = loraPktData;
      pkt["ack"]       = loraPktAck;
      pkt["loi"]       = loraPktError;
      String json; serializeJson(doc, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 4: ĐIỀU KHIỂN 1 THIẾT BỊ
  mcpClient.registerTool(
    "dieu_khien_thiet_bi",
    "Bật hoặc tắt một thiết bị cụ thể",
    "{\"type\":\"object\",\"properties\":{\"thiet_bi\":{\"type\":\"string\",\"enum\":[\"den_suoi_1\",\"den_suoi_2\",\"quat_hut_1\",\"quat_hut_2\",\"den_phong\",\"phun_suong\",\"quat_suong\",\"device_8\"]},\"trang_thai\":{\"type\":\"string\",\"enum\":[\"bat\",\"tat\"]}},\"required\":[\"thiet_bi\",\"trang_thai\"]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, args);
      String ten   = doc["thiet_bi"].as<String>();
      String trang = doc["trang_thai"].as<String>();
      int idx = findDeviceIndex(ten);
      if (idx == -1) return WebSocketMCP::ToolResponse("{\"loi\":\"Ten thiet bi khong hop le\"}");
      if (isAutoMode) isAutoMode = false;
      bool newState = (trang == "bat");
      s[idx] = newState;
      isTimerActive[idx] = false;
      _pendingDevLabel = names[idx]; _pendingDevLabel.trim();
      sendLoRaControl(); sendStatusToWeb();
      String msg = names[idx]; msg.trim();
      msg += newState ? ":BAT" : ":TAT";
      globalMsg = msg; updateDisplay(); delay(1200); globalMsg = ""; updateDisplay();
      DynamicJsonDocument res(256);
      res["thanh_cong"] = true;
      res["thiet_bi"]   = ten;
      res["trang_thai"] = newState ? "BAT" : "TAT";
      String json; serializeJson(res, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 5: ĐIỀU KHIỂN TẤT CẢ
  mcpClient.registerTool(
    "dieu_khien_tat_ca",
    "Bật hoặc tắt toàn bộ 8 thiết bị cùng lúc",
    "{\"type\":\"object\",\"properties\":{\"trang_thai\":{\"type\":\"string\",\"enum\":[\"bat\",\"tat\"]}},\"required\":[\"trang_thai\"]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(128);
      deserializeJson(doc, args);
      bool newState = (doc["trang_thai"].as<String>() == "bat");
      if (isAutoMode) isAutoMode = false;
      for (int i = 0; i < 8; i++) { s[i] = newState; isTimerActive[i] = false; }
      _pendingDevLabel = newState ? "TAT_CA_BAT" : "TAT_CA_TAT";
      sendLoRaControl(); sendStatusToWeb();
      globalMsg = newState ? "TAT CA:BAT" : "TAT CA:TAT";
      updateDisplay(); delay(1200); globalMsg = ""; updateDisplay();
      String json = "{\"thanh_cong\":true,\"trang_thai\":\"" + String(newState ? "TAT_CA_BAT" : "TAT_CA_TAT") + "\"}";
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 6: HẸN GIỜ TẮT
  mcpClient.registerTool(
    "hen_gio_tat",
    "Bật một thiết bị và tự động tắt sau số phút chỉ định (1-120 phút)",
    "{\"type\":\"object\",\"properties\":{\"thiet_bi\":{\"type\":\"string\",\"enum\":[\"den_suoi_1\",\"den_suoi_2\",\"quat_hut_1\",\"quat_hut_2\",\"den_phong\",\"phun_suong\",\"quat_suong\",\"device_8\"]},\"so_phut\":{\"type\":\"number\"}},\"required\":[\"thiet_bi\",\"so_phut\"]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, args);
      String ten  = doc["thiet_bi"].as<String>();
      int    phut = doc["so_phut"].as<int>();
      if (phut < 1) phut = 1; if (phut > 120) phut = 120;
      int idx = findDeviceIndex(ten);
      if (idx == -1) return WebSocketMCP::ToolResponse("{\"loi\":\"Ten thiet bi khong hop le\"}");
      if (isAutoMode) isAutoMode = false;
      s[idx] = true; isTimerActive[idx] = true;
      timerStartTime[idx] = millis(); setMinutes = phut;
      _pendingDevLabel = names[idx]; _pendingDevLabel.trim();
      sendLoRaControl(); sendStatusToWeb();
      globalMsg = "T-ON " + String(phut) + "P";
      updateDisplay(); delay(1200); globalMsg = ""; updateDisplay();
      DynamicJsonDocument res(256);
      res["thanh_cong"] = true; res["thiet_bi"] = ten; res["se_tat_sau_phut"] = phut;
      String json; serializeJson(res, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 7: ĐẶT GIỜ BẬT/TẮT THEO HH:MM
  mcpClient.registerTool(
    "dat_gio_bat_tat",
    "Cài đặt lịch tự động bật/tắt thiết bị theo giờ cụ thể trong ngày",
    "{\"type\":\"object\",\"properties\":{"
      "\"thiet_bi\":{\"type\":\"string\",\"enum\":[\"den_suoi_1\",\"den_suoi_2\",\"quat_hut_1\",\"quat_hut_2\",\"den_phong\",\"phun_suong\",\"quat_suong\",\"device_8\"]},"
      "\"gio_bat\":{\"type\":\"string\",\"description\":\"Giờ bật HH:MM\"},"
      "\"gio_tat\":{\"type\":\"string\",\"description\":\"Giờ tắt HH:MM\"},"
      "\"xoa_lich\":{\"type\":\"boolean\"}"
    "},\"required\":[\"thiet_bi\"]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, args);
      String ten = doc["thiet_bi"].as<String>();
      int idx = findDeviceIndex(ten);
      if (idx == -1) return WebSocketMCP::ToolResponse("{\"loi\":\"Ten thiet bi khong hop le\"}");
      if (doc["xoa_lich"].as<bool>()) {
        schedules[idx] = {false, 0, 0, 0, 0, false, false};
        return WebSocketMCP::ToolResponse("{\"thanh_cong\":true,\"thong_bao\":\"Da xoa lich\"}");
      }
      schedules[idx].active = true;
      schedules[idx].hasOn  = false;
      schedules[idx].hasOff = false;
      String gioBat = doc["gio_bat"].as<String>();
      if (gioBat.length() >= 4 && gioBat.indexOf(':') != -1) {
        int c = gioBat.indexOf(':');
        schedules[idx].onHour   = gioBat.substring(0, c).toInt();
        schedules[idx].onMinute = gioBat.substring(c + 1).toInt();
        schedules[idx].hasOn    = true;
      }
      String gioTat = doc["gio_tat"].as<String>();
      if (gioTat.length() >= 4 && gioTat.indexOf(':') != -1) {
        int c = gioTat.indexOf(':');
        schedules[idx].offHour   = gioTat.substring(0, c).toInt();
        schedules[idx].offMinute = gioTat.substring(c + 1).toInt();
        schedules[idx].hasOff    = true;
      }
      if (!schedules[idx].hasOn && !schedules[idx].hasOff) {
        schedules[idx].active = false;
        return WebSocketMCP::ToolResponse("{\"loi\":\"Phai co it nhat gio_bat hoac gio_tat\"}");
      }
      globalMsg = "LICH " + String(names[idx]);
      updateDisplay(); delay(1200); globalMsg = ""; updateDisplay();
      DynamicJsonDocument res(256);
      res["thanh_cong"] = true; res["thiet_bi"] = ten;
      if (schedules[idx].hasOn) {
        char buf[6]; sprintf(buf, "%02d:%02d", schedules[idx].onHour, schedules[idx].onMinute);
        res["gio_bat"] = String(buf);
      }
      if (schedules[idx].hasOff) {
        char buf[6]; sprintf(buf, "%02d:%02d", schedules[idx].offHour, schedules[idx].offMinute);
        res["gio_tat"] = String(buf);
      }
      String json; serializeJson(res, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 8: CHUYỂN CHẾ ĐỘ
  mcpClient.registerTool(
    "chuyen_che_do",
    "Chuyển hệ thống giữa chế độ tự động (AUTO) và thủ công (MANUAL)",
    "{\"type\":\"object\",\"properties\":{\"che_do\":{\"type\":\"string\",\"enum\":[\"tu_dong\",\"thu_cong\"]}},\"required\":[\"che_do\"]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(128);
      deserializeJson(doc, args);
      bool newAuto = (doc["che_do"].as<String>() == "tu_dong");
      isAutoMode = newAuto;
      if (!newAuto) {
        for (int i = 0; i < 8; i++) { s[i] = false; isTimerActive[i] = false; }
        _pendingDevLabel = "SET_MANUAL";
        sendLoRaControl();
      }
      sendStatusToWeb();
      globalMsg = newAuto ? "CHE DO:AUTO" : "CHE DO:MANUAL";
      updateDisplay(); delay(1200); globalMsg = ""; updateDisplay();
      String json = "{\"thanh_cong\":true,\"che_do\":\"" + String(newAuto ? "TU_DONG" : "THU_CONG") + "\"}";
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 9: CÀI ĐẶT NGƯỠNG
  mcpClient.registerTool(
    "cai_dat_nguong",
    "Cài đặt ngưỡng điều khiển tự động: nhiệt độ, độ ẩm, ánh sáng, đất",
    "{\"type\":\"object\",\"properties\":{"
      "\"nhiet_do_thap\":{\"type\":\"number\"},"
      "\"nhiet_do_cao\":{\"type\":\"number\"},"
      "\"do_am_thap\":{\"type\":\"number\"},"
      "\"do_am_cao\":{\"type\":\"number\"},"
      "\"lux_thap\":{\"type\":\"number\"},"
      "\"lux_cao\":{\"type\":\"number\"},"
      "\"dat_kho_bat_bom\":{\"type\":\"number\"}"
    "},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(512);
      deserializeJson(doc, args);
      if (doc.containsKey("nhiet_do_thap"))   threshTempLow  = doc["nhiet_do_thap"].as<float>();
      if (doc.containsKey("nhiet_do_cao"))    threshTempHot  = doc["nhiet_do_cao"].as<float>();
      if (doc.containsKey("do_am_thap"))      threshHumLow   = doc["do_am_thap"].as<float>();
      if (doc.containsKey("do_am_cao"))       threshHumHigh  = doc["do_am_cao"].as<float>();
      if (doc.containsKey("lux_thap"))        threshLuxLow   = doc["lux_thap"].as<int>();
      if (doc.containsKey("lux_cao"))         threshLuxHigh  = doc["lux_cao"].as<int>();
      if (doc.containsKey("dat_kho_bat_bom")) threshSoilDry  = doc["dat_kho_bat_bom"].as<int>();
      threshHumMist = threshHumLow; threshLuxDark = threshLuxLow;
      prefs.putFloat("tTmpLow", threshTempLow); prefs.putFloat("tTmpHot", threshTempHot);
      prefs.putFloat("tHumLow", threshHumLow);  prefs.putFloat("tHumHigh", threshHumHigh);
      prefs.putInt("tLuxLow", threshLuxLow);    prefs.putInt("tLuxHigh", threshLuxHigh);
      prefs.putInt("tSoil", threshSoilDry);
      globalMsg = "NGUONG OK"; updateDisplay(); delay(1200); globalMsg = ""; updateDisplay();
      DynamicJsonDocument res(512);
      res["thanh_cong"]    = true;
      res["nhiet_do_thap"] = threshTempLow; res["nhiet_do_cao"]  = threshTempHot;
      res["do_am_thap"]    = threshHumLow;  res["do_am_cao"]     = threshHumHigh;
      res["lux_thap"]      = threshLuxLow;  res["lux_cao"]       = threshLuxHigh;
      res["dat_kho"]       = threshSoilDry;
      String json; serializeJson(res, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 10: XEM NGƯỠNG HIỆN TẠI
  mcpClient.registerTool(
    "xem_nguong",
    "Xem tất cả ngưỡng điều khiển tự động đang được cài đặt",
    "{\"type\":\"object\",\"properties\":{},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DynamicJsonDocument doc(512);
      doc["nhiet_do_thap_C"]       = threshTempLow;
      doc["nhiet_do_cao_C"]        = threshTempHot;
      doc["do_am_thap_pct"]        = threshHumLow;
      doc["do_am_cao_pct"]         = threshHumHigh;
      doc["anh_sang_thap_lux"]     = threshLuxLow;
      doc["anh_sang_cao_lux"]      = threshLuxHigh;
      doc["dat_kho_bat_bom_pct"]   = threshSoilDry;
      doc["dat_uot_ngung_bom_pct"] = threshSoilWet;
      String json; serializeJson(doc, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 11: XEM GIỜ RTC
  mcpClient.registerTool(
    "xem_gio",
    "Xem giờ và ngày tháng hiện tại trên đồng hồ RTC DS3231",
    "{\"type\":\"object\",\"properties\":{},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      DateTime now = rtc.now();
      DynamicJsonDocument doc(256);
      doc["gio"] = now.hour(); doc["phut"] = now.minute(); doc["giay"] = now.second();
      doc["ngay"] = now.day(); doc["thang"] = now.month(); doc["nam"] = now.year();
      char buf[20];
      sprintf(buf, "%02d:%02d:%02d %02d/%02d/%04d",
              now.hour(), now.minute(), now.second(), now.day(), now.month(), now.year());
      doc["hien_thi"] = String(buf);
      String json; serializeJson(doc, json);
      return WebSocketMCP::ToolResponse(json);
    }
  );

  // TOOL 12: RESET THỐNG KÊ
  mcpClient.registerTool(
    "reset_hieu_nang",
    "Reset toàn bộ thống kê hiệu năng LoRa về 0",
    "{\"type\":\"object\",\"properties\":{},\"required\":[]}",
    [](const String& args) -> WebSocketMCP::ToolResponse {
      resetPerfStats();
      sendPerformanceToWeb();
      return WebSocketMCP::ToolResponse("{\"thanh_cong\":true,\"thong_bao\":\"Da reset toan bo thong ke\"}");
    }
  );

  Serial.println("[MCP] Da dang ky 12 tools!");
}

// ─── MENU ─────────────────────────────────────────────
void renderMenu() {
  lcd.clear();
  switch (menuState) {
    case MENU_MAIN: {
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(mainMenuItems[menuCursor]);
      int next = (menuCursor + 1) % 4;
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(mainMenuItems[next]);
      break;
    }
    case MENU_PERFORMANCE: {
      lcd.setCursor(0, 0);
      lcd.print("R:"); lcd.print(loraRSSI_last);
      lcd.print(" L:");
      if (loraLatency_last > 0) { lcd.print(loraLatency_last); lcd.print("ms"); }
      else lcd.print("--ms");
      lcd.setCursor(0, 1);
      lcd.print("C:");
      if (cmdResponseTime > 0) { lcd.print(cmdResponseTime); lcd.print("ms"); }
      else lcd.print("--ms");
      lcd.print(" N:"); lcd.print(loraPktTotal);
      break;
    }
    case MENU_WIFI: {
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(wifiMenuItems[menuCursor]);
      int next = (menuCursor + 1) % 3;
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(wifiMenuItems[next]);
      break;
    }
    case MENU_WIFI_SSID:
      lcd.setCursor(0, 0); lcd.print("TEN WIFI:");
      lcd.setCursor(0, 1); lcd.print(ssid); break;
    case MENU_WIFI_PASS:
      lcd.setCursor(0, 0); lcd.print("MAT KHAU:");
      lcd.setCursor(0, 1);
      for (int i = 0; i < min((int)strlen(password), 16); i++) lcd.print('*'); break;
    case MENU_WIFI_IP:
      lcd.setCursor(0, 0); lcd.print("DIA CHI IP:");
      lcd.setCursor(0, 1);
      if (WiFi.status() == WL_CONNECTED) lcd.print(WiFi.localIP().toString());
      else lcd.print("Chua ket noi"); break;
    case MENU_THONGSO: {
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(tsMenuItems[menuCursor]);
      int next = (menuCursor + 1) % 4;
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(tsMenuItems[next]); break;
    }
    case MENU_TS_ANHS: {
      const char* sub[] = { "LUX THAP", "LUX CAO" };
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(sub[menuCursor % 2]);
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(sub[(menuCursor + 1) % 2]); break;
    }
    case MENU_TS_ANHS_LOW:
      lcd.setCursor(0, 0); lcd.print("LUX THAP:");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print(editValue); lcd.print("] S3+S4-"); }
      else { lcd.print(threshLuxLow); lcd.print(" SW4=SUA"); } break;
    case MENU_TS_ANHS_HIGH:
      lcd.setCursor(0, 0); lcd.print("LUX CAO:");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print(editValue); lcd.print("] S3+S4-"); }
      else { lcd.print(threshLuxHigh); lcd.print(" SW4=SUA"); } break;
    case MENU_TS_NHIET: {
      const char* sub[] = { "NHIET THAP", "NHIET CAO" };
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(sub[menuCursor % 2]);
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(sub[(menuCursor + 1) % 2]); break;
    }
    case MENU_TS_NHIET_LOW:
      lcd.setCursor(0, 0); lcd.print("NHIET THAP (C):");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print((float)editValue/10.0,1); lcd.print("] S3+S4-"); }
      else { lcd.print(threshTempLow, 1); lcd.print(" SW4=SUA"); } break;
    case MENU_TS_NHIET_HIGH:
      lcd.setCursor(0, 0); lcd.print("NHIET CAO (C):");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print((float)editValue/10.0,1); lcd.print("] S3+S4-"); }
      else { lcd.print(threshTempHot, 1); lcd.print(" SW4=SUA"); } break;
    case MENU_TS_DOAM: {
      const char* sub[] = { "AM THAP", "AM CAO" };
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(sub[menuCursor % 2]);
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(sub[(menuCursor + 1) % 2]); break;
    }
    case MENU_TS_DOAM_LOW:
      lcd.setCursor(0, 0); lcd.print("AM THAP (%):");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print(editValue); lcd.print("] S3+S4-"); }
      else { lcd.print((int)threshHumLow); lcd.print(" SW4=SUA"); } break;
    case MENU_TS_DOAM_HIGH:
      lcd.setCursor(0, 0); lcd.print("AM CAO (%):");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print(editValue); lcd.print("] S3+S4-"); }
      else { lcd.print((int)threshHumHigh); lcd.print(" SW4=SUA"); } break;
    case MENU_TS_THOIGIAN:
      lcd.setCursor(0, 0); lcd.print("TIMER (Phut):");
      lcd.setCursor(0, 1);
      if (inEditMode) { lcd.print("["); lcd.print(editValue); lcd.print("] S3+S4-"); }
      else { lcd.print(setMinutes); lcd.print(" SW4=SUA"); } break;
    case MENU_CHEDO: {
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(cheDoItems[menuCursor % 2]);
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(cheDoItems[(menuCursor + 1) % 2]); break;
    }
    case MENU_MANUAL_DEV: {
      int nxt = (menuCursor + 1) % 8;
      lcd.setCursor(0, 0); lcd.print(">"); lcd.print(names[menuCursor]);
      lcd.print(":"); lcd.print(s[menuCursor] ? "ON " : "OFF");
      lcd.setCursor(0, 1); lcd.print(" "); lcd.print(names[nxt]);
      lcd.print(":"); lcd.print(s[nxt] ? "ON " : "OFF"); break;
    }
    default: break;
  }
}

void saveEditValue() {
  switch (menuState) {
    case MENU_TS_ANHS_LOW:  threshLuxLow=editValue;  threshLuxDark=threshLuxLow;  prefs.putInt("tLuxLow",threshLuxLow);   break;
    case MENU_TS_ANHS_HIGH: threshLuxHigh=editValue; prefs.putInt("tLuxHigh",threshLuxHigh); break;
    case MENU_TS_NHIET_LOW: threshTempLow=editValue/10.0; prefs.putFloat("tTmpLow",threshTempLow); break;
    case MENU_TS_NHIET_HIGH:threshTempHot=editValue/10.0; prefs.putFloat("tTmpHot",threshTempHot); break;
    case MENU_TS_DOAM_LOW:  threshHumLow=editValue;  threshHumMist=threshHumLow;  prefs.putFloat("tHumLow",threshHumLow);  break;
    case MENU_TS_DOAM_HIGH: threshHumHigh=editValue; prefs.putFloat("tHumHigh",threshHumHigh); break;
    case MENU_TS_THOIGIAN:  setMinutes=editValue;    prefs.putInt("timer",setMinutes); break;
    default: break;
  }
  showMsg("DA LUU!", "", 600);
}

void handleMenuButtons() {
  static bool sw1Prev=HIGH, sw3Prev=HIGH, sw4Prev=HIGH;
  static unsigned long sw4PressTime=0;
  static bool sw4Held=false;
  bool sw1=digitalRead(SW1), sw3=digitalRead(SW3), sw4=digitalRead(SW4);
  unsigned long now=millis();

  if (sw3==LOW && sw3Prev==HIGH && now-lastMenuBtn>200) {
    lastMenuBtn=now;
    if (inEditMode) { editValue++; renderMenu(); }
    else {
      menuCursor++;
      int maxC=0;
      if (menuState==MENU_MAIN) maxC=3;
      else if (menuState==MENU_WIFI) maxC=2;
      else if (menuState==MENU_THONGSO) maxC=3;
      else if (menuState==MENU_CHEDO) maxC=1;
      else if (menuState==MENU_TS_ANHS||menuState==MENU_TS_NHIET||menuState==MENU_TS_DOAM) maxC=1;
      else if (menuState==MENU_MANUAL_DEV) maxC=7;
      if (menuCursor>maxC) menuCursor=0;
      renderMenu();
    }
  }

  if (sw4==LOW) {
    if (!sw4Held) { sw4PressTime=now; sw4Held=true; }
  } else {
    if (sw4Held) {
      sw4Held=false;
      unsigned long held=now-sw4PressTime;
      if (now-lastMenuBtn<150) goto sw4Done;
      lastMenuBtn=now;
      if (inEditMode) {
        if (held<600) { editValue--; renderMenu(); }
      } else {
        switch (menuState) {
          case MENU_MAIN:
            if (menuCursor==0)      { menuState=MENU_WIFI;    menuCursor=0; }
            else if (menuCursor==1) { menuState=MENU_THONGSO; menuCursor=0; }
            else if (menuCursor==2) { menuState=MENU_CHEDO;   menuCursor=0; }
            else if (menuCursor==3) { menuState=MENU_PERFORMANCE; menuCursor=0; }
            renderMenu(); break;
          case MENU_PERFORMANCE:
            resetPerfStats();
            showMsg("RESET OK","", 600);
            sendPerformanceToWeb();
            renderMenu(); break;
          case MENU_WIFI:
            if (menuCursor==0) menuState=MENU_WIFI_SSID;
            else if (menuCursor==1) menuState=MENU_WIFI_PASS;
            else if (menuCursor==2) menuState=MENU_WIFI_IP;
            renderMenu(); break;
          case MENU_WIFI_SSID: case MENU_WIFI_PASS: case MENU_WIFI_IP: break;
          case MENU_THONGSO:
            if (menuCursor==0) { menuState=MENU_TS_ANHS;     menuCursor=0; }
            else if (menuCursor==1) { menuState=MENU_TS_NHIET; menuCursor=0; }
            else if (menuCursor==2) { menuState=MENU_TS_DOAM;  menuCursor=0; }
            else if (menuCursor==3) { menuState=MENU_TS_THOIGIAN; editValue=setMinutes; }
            renderMenu(); break;
          case MENU_TS_ANHS:
            menuState=(menuCursor%2==0)?MENU_TS_ANHS_LOW:MENU_TS_ANHS_HIGH;
            editValue=(menuState==MENU_TS_ANHS_LOW)?threshLuxLow:threshLuxHigh;
            renderMenu(); break;
          case MENU_TS_NHIET:
            menuState=(menuCursor%2==0)?MENU_TS_NHIET_LOW:MENU_TS_NHIET_HIGH;
            editValue=(menuState==MENU_TS_NHIET_LOW)?(int)(threshTempLow*10):(int)(threshTempHot*10);
            renderMenu(); break;
          case MENU_TS_DOAM:
            menuState=(menuCursor%2==0)?MENU_TS_DOAM_LOW:MENU_TS_DOAM_HIGH;
            editValue=(menuState==MENU_TS_DOAM_LOW)?(int)threshHumLow:(int)threshHumHigh;
            renderMenu(); break;
          case MENU_TS_ANHS_LOW: case MENU_TS_ANHS_HIGH:
          case MENU_TS_NHIET_LOW: case MENU_TS_NHIET_HIGH:
          case MENU_TS_DOAM_LOW: case MENU_TS_DOAM_HIGH:
          case MENU_TS_THOIGIAN:
            if (!inEditMode) { inEditMode=true; renderMenu(); }
            else { saveEditValue(); inEditMode=false; renderMenu(); } break;
          case MENU_CHEDO:
            if (menuCursor==0) {
              isAutoMode=true; sendStatusToWeb();
              showMsg("CHE DO:","AUTO",700);
              menuState=MENU_NONE; updateDisplay();
            } else {
              isAutoMode=false;
              for (int i=0;i<8;i++){s[i]=false;isTimerActive[i]=false;}
              _pendingDevLabel="SET_MANUAL";
              sendLoRaControl(); sendStatusToWeb();
              showMsg("CHE DO:","MANUAL",700);
              menuState=MENU_MANUAL_DEV; menuCursor=0;
            }
            renderMenu(); break;
          case MENU_MANUAL_DEV:
            s[menuCursor]=!s[menuCursor];
            isTimerActive[menuCursor]=false;
            _pendingDevLabel = names[menuCursor]; _pendingDevLabel.trim();
            sendLoRaControl(); sendStatusToWeb();
            renderMenu(); break;
          default: break;
        }
      }
    }
    sw4Done:;
  }

  if (sw1==LOW && sw1Prev==HIGH && now-lastMenuBtn>200) {
    lastMenuBtn=now;
    if (inEditMode) { inEditMode=false; renderMenu(); }
    else {
      switch (menuState) {
        case MENU_MAIN: menuState=MENU_NONE; menuCursor=0; updateDisplay(); break;
        case MENU_WIFI: case MENU_THONGSO: case MENU_CHEDO: case MENU_PERFORMANCE:
          menuState=MENU_MAIN; menuCursor=0; renderMenu(); break;
        case MENU_WIFI_SSID: case MENU_WIFI_PASS: case MENU_WIFI_IP:
          menuState=MENU_WIFI; menuCursor=0; renderMenu(); break;
        case MENU_TS_ANHS: case MENU_TS_NHIET: case MENU_TS_DOAM: case MENU_TS_THOIGIAN:
          menuState=MENU_THONGSO; menuCursor=0; renderMenu(); break;
        case MENU_TS_ANHS_LOW: case MENU_TS_ANHS_HIGH:
          menuState=MENU_TS_ANHS; menuCursor=0; renderMenu(); break;
        case MENU_TS_NHIET_LOW: case MENU_TS_NHIET_HIGH:
          menuState=MENU_TS_NHIET; menuCursor=0; renderMenu(); break;
        case MENU_TS_DOAM_LOW: case MENU_TS_DOAM_HIGH:
          menuState=MENU_TS_DOAM; menuCursor=0; renderMenu(); break;
        case MENU_MANUAL_DEV:
          menuState=MENU_CHEDO; menuCursor=1; renderMenu(); break;
        default: menuState=MENU_NONE; updateDisplay(); break;
      }
    }
  }
  sw1Prev=sw1; sw3Prev=sw3;
}

void checkButtonSW2_Menu() {
  static bool sw2Prev=HIGH;
  static unsigned long pressStart=0;
  static bool entered=false;
  bool sw2=digitalRead(SW2);
  if (sw2==LOW) {
    if (sw2Prev==HIGH) { pressStart=millis(); entered=false; }
    if (!entered && millis()-pressStart>=2000 && menuState==MENU_NONE) {
      entered=true; menuState=MENU_MAIN; menuCursor=0; renderMenu();
    }
  } else {
    if (sw2Prev==LOW && !entered && menuState==MENU_NONE) {
      isAutoMode=!isAutoMode;
      if (!isAutoMode) {
        for (int i=0;i<8;i++){s[i]=false;isTimerActive[i]=false;}
        _pendingDevLabel="SET_MODE";
        sendLoRaControl();
      }
      sendStatusToWeb();
      globalMsg=isAutoMode?"AUTO MODE":"MANUAL MODE";
      updateDisplay(); delay(800); globalMsg=""; updateDisplay();
    }
    entered=false;
  }
  sw2Prev=sw2;
}

void checkButtonSW1() {
  if (menuState!=MENU_NONE) return;
  static bool isP=false; static unsigned long startP=0;
  if (digitalRead(SW1)==LOW) { if (!isP) { startP=millis(); isP=true; } }
  else if (isP) {
    displayMode++; if (displayMode>4) displayMode=1;
    updateDisplay(); isP=false;
  }
}

void checkButtonSW3() {
  if (menuState!=MENU_NONE) return;
  static bool lastS=HIGH; bool curr=digitalRead(SW3);
  if (curr==LOW && lastS==HIGH) { cursorRow++; if (cursorRow>7) cursorRow=0; updateDisplay(); delay(150); }
  lastS=curr;
}

void checkButtonSW4() {
  if (menuState!=MENU_NONE) return;
  static bool isP=false; static unsigned long startP=0; static int action=0;
  if (digitalRead(SW4)==LOW) {
    if (!isP) { startP=millis(); isP=true; action=0; }
    unsigned long hold=millis()-startP;
    if (hold>=5000) {
      if (action!=2) {
        for (int i=0;i<8;i++){s[i]=false;isTimerActive[i]=false;}
        action=2; _pendingDevLabel="ALL_OFF";
        sendLoRaControl(); sendStatusToWeb();
        globalMsg="ALL OFF"; updateDisplay();
      }
    }
    else if (hold>=2500) {
      if (action!=1) {
        for (int i=0;i<8;i++) s[i]=true;
        action=1; _pendingDevLabel="ALL_ON";
        sendLoRaControl(); sendStatusToWeb();
        globalMsg="ALL ON"; updateDisplay();
      }
    }
    else if (hold>=800) {
      if (action!=3) {
        s[cursorRow]=true; isTimerActive[cursorRow]=true;
        timerStartTime[cursorRow]=millis(); action=3;
        _pendingDevLabel = names[cursorRow]; _pendingDevLabel.trim();
        sendLoRaControl(); sendStatusToWeb();
        globalMsg="T-ON "+String(setMinutes)+"P"; updateDisplay();
      }
    }
  } else if (isP) {
    if ((millis()-startP)<800 && action==0) {
      s[cursorRow]=!s[cursorRow];
      isTimerActive[cursorRow]=false;
      _pendingDevLabel = names[cursorRow]; _pendingDevLabel.trim();
      sendLoRaControl(); sendStatusToWeb(); updateDisplay();
    }
    isP=false;
  }
}

void checkCountdown() {
  bool changed=false;
  unsigned long durationMs=(unsigned long)setMinutes*60*1000;
  for (int i=0;i<8;i++) {
    if (isTimerActive[i] && millis()-timerStartTime[i]>=durationMs) {
      s[i]=false; isTimerActive[i]=false; changed=true;
    }
  }
  if (changed) {
    _pendingDevLabel="TIMER_OFF";
    sendLoRaControl(); sendStatusToWeb(); updateDisplay();
  }
}

void handleModeLEDs() {
  if (!isAutoMode) {
    digitalWrite(LED_XANH, LOW);
    if (millis()-lastBlinkTime>=500) { lastBlinkTime=millis(); digitalWrite(LED_DO,!digitalRead(LED_DO)); }
  } else { digitalWrite(LED_XANH,HIGH); digitalWrite(LED_DO,HIGH); }
}

// ═══════════════════════════════════════════════════════
//  SETUP & LOOP
// ═══════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  pinMode(SW1,INPUT_PULLUP); pinMode(SW2,INPUT_PULLUP);
  pinMode(SW3,INPUT_PULLUP); pinMode(SW4,INPUT_PULLUP);
  pinMode(LED_XANH,OUTPUT);  pinMode(LED_DO,OUTPUT);

  for (int i = 0; i < 8; i++) schedules[i] = {false, 0, 0, 0, 0, false, false};

  rtc.begin();
  prefs.begin("mushroom", false);
  setMinutes    = prefs.getInt("timer",    5);
  threshTempLow = prefs.getFloat("tTmpLow",  28.0);
  threshTempHot = prefs.getFloat("tTmpHot",  32.0);
  threshHumLow  = prefs.getFloat("tHumLow",  80.0);
  threshHumHigh = prefs.getFloat("tHumHigh", 90.0);
  threshLuxLow  = prefs.getInt("tLuxLow",   500);
  threshLuxHigh = prefs.getInt("tLuxHigh",  1000);
  threshSoilDry = prefs.getInt("tSoil",      40);
  threshSoilWet = 80;
  threshHumMist = threshHumLow;
  threshLuxDark = threshLuxLow;

  SPI.begin(SCK, MISO, MOSI, SS);
  LoRa.setPins(SS, RST, DIO0);
  if (!LoRa.begin(433E6)) Serial.println("[LoRa] KHOI DONG THAT BAI!");
  else                     Serial.println("[LoRa] OK - 433MHz");

  lcd.begin(); lcd.backlight();
  showMsg("Nha Nam Thong", "Khoi dong...", 1000);
  lcd.clear(); lcd.print("Ket noi WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  int retry=0;
  while (WiFi.status()!=WL_CONNECTED && retry<60) { delay(500); Serial.print("."); retry++; }

  if (WiFi.status()==WL_CONNECTED) {
    Serial.println("\n[WiFi] OK: " + WiFi.localIP().toString());
    showMsg("WiFi OK!", WiFi.localIP().toString(), 1500);
    initWebSocketServer();
    lcd.clear();
    lcd.setCursor(0,0); lcd.print("WS: port 8080");
    lcd.setCursor(0,1); lcd.print(WiFi.localIP().toString());
    delay(2000);
    mcpClient.begin(mcpEndpoint, onConnectionStatus);
  } else {
    Serial.println("\n[WiFi] Khong ket noi duoc!");
    showMsg("WiFi FAILED!", "Chi co LoRa", 1500);
  }

  updateDisplay();
  Serial.println("[SYS] He thong san sang!");
}

void loop() {
  updateWebSocket();
  mcpClient.loop();

  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String incoming = "";
    while (LoRa.available()) incoming += (char)LoRa.read();
    int rssi = LoRa.packetRssi();
    Serial.printf("[LoRa] Nhan (%d bytes) RSSI=%d dBm: %s\n", packetSize, rssi, incoming.c_str());
    handleLoRaPacket(incoming, rssi);
  }

  if (waitingForAck && millis()-loraSendTime > 5000) {
    waitingForAck    = false;
    waitingForCmdAck = false;
    _pendingDevLabel = "";
    Serial.println("[WARN] Timeout: khong nhan duoc ACK tu Slave sau 5s");
  }

  if (millis()-lastWsSend>=3000 && webSocket.connectedClients()>0) {
    lastWsSend=millis();
    sendStatusToWeb();
  }

  static unsigned long lastReport=0;
  if (millis()-lastReport>=60000) {
    lastReport=millis();
    printPerformanceReport();
    if (webSocket.connectedClients()>0) sendPerformanceToWeb();
  }

  DateTime now = rtc.now();

  checkTimeSchedules();

  if (menuState!=MENU_NONE) {
    handleMenuButtons();
    checkButtonSW2_Menu();
    return;
  }

  if (isAutoMode) runSmartSchedule(now);
  else checkCountdown();

  checkButtonSW1();
  checkButtonSW2_Menu();
  if (!isAutoMode) { checkButtonSW3(); checkButtonSW4(); }
  handleModeLEDs();
}
