# 🖥️ Server Room Asset & Physical Inventory Audit App (MAserver70)

ระบบเว็บแอปพลิเคชันสำหรับจัดเก็บ ตรวจเช็ก และบันทึกสภาพครุภัณฑ์อุปกรณ์คอมพิวเตอร์ในห้อง Server Room อ้างอิงจากไฟล์ข้อมูล `Checklist MAserver70.xlsx` รองรับการซิงค์ข้อมูล Real-time และแชร์รูปถ่ายผ่าน **Firebase Cloud** พร้อมระบบพิมพ์รายงานเอกสารเป็น PDF หลายหน้า

---

## ✨ คุณสมบัติหลัก (Key Features)

1. **Dashboard สรุปผลภาพรวม:** แสดงผลความคืบหน้าการตรวจเช็ก, จำนวนอุปกรณ์ปกติ (Pass), ชำรุด/สูญหาย (Issues) และอุปกรณ์ไม่ใช้งาน (Unused)
2. **รายการตรวจเช็ก (Physical Audit Checklist):** ลงบันทึกตรวจนับ สภาพความสมบูรณ์ หมายเหตุ และรูปถ่ายอุปกรณ์ สามารถแก้ไขชื่ออุปกรณ์, S/N, เลขครุภัณฑ์ และค่าน้ำหนักได้
3. **ผังจำลองตู้ 2D Rack Elevation Map:** แสดงผลสถานะอุปกรณ์รายตู้แบบ Interactive พร้อมระบบค้นหาที่จะทำ Highlight เน้นตู้ที่ตรงตามคำค้นหา
4. **Firebase Cloud Sync & Storage:**
   - อัปโหลดและแชร์ลิงก์รูปถ่ายอุปกรณ์แบบออนไลน์ผ่าน **Firebase Storage**
   - ซิงค์ข้อมูลตรวจเช็กแบบ Real-time ระหว่างผู้ใช้ทุกคนผ่าน **Cloud Firestore & Realtime Database**
5. **รายงานตรวจเช็กแบบเป็นทางการ (Print PDF):** รูปแบบแบบฟอร์มรายงานพร้อมช่องลงนาม สามารถพิมพ์ออกทางเครื่องพิมพ์ หรือบันทึกเป็น PDF หลายหน้าได้อย่างสมบูรณ์
6. **Export Data:** ส่งออกข้อมูลการตรวจเช็กเป็นไฟล์ **CSV** (รองรับภาษาไทยสำหรับ Excel) และไฟล์ **JSON**

---

## 🚀 ขั้นตอนการติดตั้งและเริ่มใช้งาน (Getting Started)

### 1. เรียกใช้งานแบบเปิดไฟล์ตรงผ่าน Browser
สามารถเปิดไฟล์ `index.html` ผ่านเว็บเบราว์เซอร์ได้ทันที

### 2. หรือเรียกใช้งานผ่าน Node.js Local Server
```bash
# สตาร์ทเซิร์ฟเวอร์
npm start
# หรือ
node server.js
```
เปิดเบราว์เซอร์ไปที่: `http://localhost:3000`

---

## ☁️ การตั้งค่า Firebase Cloud Sync (masever-f8d93)

ไฟล์ `app.js` ได้รับการตั้งค่าเชื่อมต่อกับ Firebase Project `masever-f8d93` เรียบร้อยแล้ว:

* **Firebase Storage Bucket:** `masever-f8d93.firebasestorage.app`
* **Realtime Database URL:** `https://masever-f8d93-default-rtdb.asia-southeast1.firebasedatabase.app`

> ⚠️ **คำแนะนำความปลอดภัย:** อย่าลืมตั้งค่า Security Rules ใน Firebase Console (ทั้ง Storage และ Database) ให้รัดกุมก่อนนำไปใช้งานจริงในระบบ Production

---

## 🛠️ โครงสร้างไฟล์ในโปรเจกต์ (File Structure)

```
server_audit_app/
├── index.html          # หน้าเว็บหลัก UI (Tailwind CSS, FontAwesome, Modals, Print View)
├── style.css           # สไตล์ custom, 2D Rack, LED indicators และ @media print
├── app.js              # ลอจิกแอปพลิเคชัน, Firebase Sync, LocalStorage, Event Listeners
├── data.js             # ข้อมูลครุภัณฑ์ตั้งต้น 13 หมวดหมู่ (MASTER_INVENTORY)
├── convert_data.js     # สคริปต์แปลงไฟล์ JSON เป็น data.js
├── server.js           # Node.js HTTP static server & upload handler
├── package.json        # การตั้งค่า NPM package
├── .gitignore          # ไฟล์ละเว้นโฟลเดอร์ขยะสำหรับ Git
└── image/              # โฟลเดอร์จัดเก็บรูปภาพอัปโหลด
```

---

## 📜 License
MIT License
