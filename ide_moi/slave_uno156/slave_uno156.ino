#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>
#include <Wire.h>
#include <BH1750.h>
#include <Adafruit_SHT31.h>

#define DHTPIN 3
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);
BH1750 lightMeter;
Adafruit_SHT31 sht30;

// 8 chân relay (Active HIGH: HIGH = BẬT, LOW = TẮT)
const int relayPins[8] = {4, 5, 6, 7, A1, A2, A3, 8};
const int soilPin = A0;

unsigned long lastSend    = 0;
unsigned long lastCmdTime = 0;
int           cmdCount    = 0;

int pktTotal   = 0;
int pktControl = 0;
int pktError   = 0;

void setup() {
  Serial.begin(9600);
  dht.begin();
  Wire.begin();
  lightMeter.begin();

  if (!sht30.begin(0x44)) {
    Serial.println("[SHT30] Loi khoi tao! Kiem tra day ket noi.");
  } else {
    Serial.println("[SHT30] Khoi tao thanh cong");
  }

  for (int i = 0; i < 8; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], LOW);  // LOW = TẮT (Active High)
  }

  if (!LoRa.begin(433E6)) {
    Serial.println("[LoRa] Loi khoi tao!");
    while (1);
  }
  Serial.println("[LoRa] Khoi tao thanh cong -- 433MHz");
  Serial.println("[UNO] San sang nhan lenh tu ESP32 Master");
  Serial.println("[UNO] Active HIGH: HIGH=BAT LOW=TAT");
}

void loop() {

  // 1. ── NHẬN & XỬ LÝ GÓI LORA ──────────────────────
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String cmd = "";
    while (LoRa.available()) cmd += (char)LoRa.read();
    int rssi = LoRa.packetRssi();
    pktTotal++;

    Serial.print("[LoRa] Nhan (");
    Serial.print(packetSize);
    Serial.print(" bytes) RSSI=");
    Serial.print(rssi);
    Serial.print(" dBm: ");
    Serial.println(cmd);

    if (!cmd.startsWith("DATA:")) {
      unsigned long t0 = millis();
      controlRelays(cmd);
      unsigned long execTime = millis() - t0;
      pktControl++;
      cmdCount++;
      lastCmdTime = millis();

      // ── GỬI ACK NGAY SAU KHI THỰC THI ──
      String ack = "ACK:" + String(millis());
      LoRa.beginPacket();
      LoRa.print(ack);
      LoRa.endPacket();

      Serial.print("[UNO] Lenh #");
      Serial.print(cmdCount);
      Serial.print(" -- Thuc thi: ");
      Serial.print(execTime);
      Serial.print("ms -- Da gui ACK: ");
      Serial.println(ack);

    } else {
      pktError++;
      Serial.println("[UNO] Got DATA packet (unexpected)");
    }
  }

  // 2. ── ĐỌC CẢM BIẾN & GỬI DATA ──────────────────────
  if (millis() - lastSend > 2000) {

    float dht_t = dht.readTemperature();
    float dht_h = dht.readHumidity();

    float sht_t = sht30.readTemperature();
    float sht_h = sht30.readHumidity();
    if (isnan(sht_t) || isnan(sht_h)) {
      Serial.println("[SHT30] Loi doc du lieu!");
      sht_t = NAN; sht_h = NAN;
    }

    float lx  = lightMeter.readLightLevel();
    int sRaw  = analogRead(soilPin);
    int sPct  = map(sRaw, 1023, 200, 0, 100);
    sPct = constrain(sPct, 0, 100);

    String dataStr = "DATA:";
    dataStr += isnan(dht_t) ? "-1" : String(dht_t, 1); dataStr += ",";
    dataStr += isnan(dht_h) ? "-1" : String(dht_h, 1); dataStr += ",";
    dataStr += String(lx, 1);                           dataStr += ",";
    dataStr += String(sPct);                            dataStr += ",";
    dataStr += isnan(sht_t) ? "-1" : String(sht_t, 1); dataStr += ",";
    dataStr += isnan(sht_h) ? "-1" : String(sht_h, 1);

    LoRa.beginPacket();
    LoRa.print(dataStr);
    LoRa.endPacket();

    Serial.print("[DATA] Gui: ");
    Serial.println(dataStr);
    Serial.print("[DATA] DHT22: ");
    Serial.print(isnan(dht_t) ? -1 : dht_t, 1);
    Serial.print("C  ");
    Serial.print(isnan(dht_h) ? -1 : dht_h, 1);
    Serial.print("%  |  SHT30: ");
    Serial.print(isnan(sht_t) ? -1 : sht_t, 1);
    Serial.print("C  ");
    Serial.print(isnan(sht_h) ? -1 : sht_h, 1);
    Serial.print("%  |  Lux: ");
    Serial.print(lx, 0);
    Serial.print("  |  Soil: ");
    Serial.print(sPct);
    Serial.print("% (raw ");
    Serial.print(sRaw);
    Serial.println(")");

    static int sendCount = 0;
    sendCount++;
    if (sendCount % 10 == 0) {
      Serial.println("┌─────────────────────────────────────┐");
      Serial.print(  "│ Tong goi nhan:      "); Serial.println(pktTotal);
      Serial.print(  "│ Goi lenh hop le:    "); Serial.println(pktControl);
      Serial.print(  "│ Goi khong hop le:   "); Serial.println(pktError);
      Serial.print(  "│ Tong lenh thuc thi: "); Serial.println(cmdCount);
      Serial.println("└─────────────────────────────────────┘");
    }

    lastSend = millis();
  }
}

// ─── ĐIỀU KHIỂN 8 RELAY ─────────────────────────────
// Format lệnh nhận: "1,0,1,0,0,0,0,0"
// 1 = Master muốn BẬT → relay HIGH (Active High)
// 0 = Master muốn TẮT → relay LOW
void controlRelays(String msg) {
  int idx = 0;
  int startP = 0;
  int commaP = msg.indexOf(',');

  while (commaP != -1 && idx < 8) {
    int val = msg.substring(startP, commaP).toInt();
    // [SỬA] Active HIGH: val=1 → BẬT → HIGH;  val=0 → TẮT → LOW
    digitalWrite(relayPins[idx], (val == 1) ? HIGH : LOW);
    startP = commaP + 1;
    commaP = msg.indexOf(',', startP);
    idx++;
  }
  if (idx < 8) {
    int val = msg.substring(startP).toInt();
    digitalWrite(relayPins[idx], (val == 1) ? HIGH : LOW);
  }

  // [SỬA] In đúng trạng thái: HIGH=BAT, LOW=TAT
  Serial.print("[Relay] Trang thai: ");
  for (int i = 0; i < 8; i++) {
    // digitalRead HIGH → relay đóng → thiết bị BẬT → in "ON"
    Serial.print(digitalRead(relayPins[i]) == HIGH ? "ON" : "OFF");
    if (i < 7) Serial.print("|");
  }
  Serial.println();

  // In thêm dạng số 1/0 cho dễ so sánh với lệnh nhận
  Serial.print("[Relay] Bit (1=ON): ");
  for (int i = 0; i < 8; i++) {
    Serial.print(digitalRead(relayPins[i]) == HIGH ? "1" : "0");
    if (i < 7) Serial.print(",");
  }
  Serial.println();
}
