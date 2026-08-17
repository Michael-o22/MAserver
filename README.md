# Server Room Physical Inventory & Asset Audit (Server Audit 70)

ระบบเว็บแอปพลิเคชันสำหรับตรวจเช็กสภาพและตรวจนับครุภัณฑ์เซิร์ฟเวอร์ประจำงวด (อ้างอิงไฟล์ข้อมูล `Checklist MAserver70.xlsx`) รองรับการทำงานแบบ **Real-time ข้ามอุปกรณ์** ผ่าน **Google Firebase** และ Deploy ขึ้น **GitHub Pages** ได้ฟรี 100%

---

## 🌟 ฟีเจอร์หลัก (Key Features)

1. **Dashboard & KPIs**: สรุปความคืบหน้าการตรวจเช็ก, รายการปกติ/ชำรุด/สูญหาย, อัตราความคลาดเคลื่อน และน้ำหนักรวม
2. **Physical Checklist**: ตารางตรวจเช็กอุปกรณ์ 78 รายการ แยก 13 หมวดหมู่/ตู้ Rack
3. **2D Rack Elevation Map**: ผังจำลองหน้าตู้เซิร์ฟเวอร์ พร้อมระบบค้นหาและไฮไลต์ตำแหน่ง
4. **Role-Based Authentication**:
   - **บุคคลทั่วไป (Visitor / Viewer)**: ดูข้อมูล, ดูภาพถ่าย, พิมพ์รายงานแบบ Read-Only
   - **เจ้าหน้าที่ (Staff / Admin)**: บันทึกผลตรวจ, แนบภาพถ่าย, เพิ่มอุปกรณ์ใหม่, ตรวจผ่านทั้งตู้ (Session 30 นาที)
5. **Real-time Cloud Sync (Firebase)**:
   - บันทึกข้อมูลขึ้น **Cloud Firestore**
   - หน้าจอของผู้ใช้ทุกคนจะอัปเดตสถานะทันทีแบบ Real-time โดยไม่ต้องกดรีเฟรชหน้าจอ
6. **Cloud Photo Storage (Firebase Storage)**:
   - บีบอัดรูปถ่ายอัตโนมัติบนเครื่องก่อนอัปโหลดขึ้น Firebase Cloud Storage

---

## 🚀 ขั้นตอนการติดตั้งและ Deploy สู่ GitHub Pages + Firebase (ละเอียดทุกขั้นตอน)

### ขั้นตอนที่ 1: สร้างโปรเจกต์ Firebase (ฟรี)
1. เข้าไปที่ [Firebase Console](https://console.firebase.google.com/) และล็อกอินด้วยบัญชี Google
2. กด **"Add project"** (หรือ "สร้างโครงการ")
3. ตั้งชื่อโปรเจกต์ เช่น `server-audit-70` -> กด Continue (ปิดหรือเปิด Google Analytics ก็ได้) -> กด **Create project**

### ขั้นตอนที่ 2: เปิดใช้งาน Cloud Firestore Database
1. ที่แถบเมนูด้านซ้าย เลือก **Build > Firestore Database**
2. กด **Create database** -> เลือก Location เป็น `asia-southeast1 (Singapore)`
3. ในหน้า Security Rules ให้เลือก **Start in test mode** -> กด **Create**
4. ไปที่แถบ **Rules** (ด้านบนของ Firestore) แล้วใส่ Rules สำหรับให้อ่านและเขียนได้:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
5. กด **Publish**

### ขั้นตอนที่ 3: เปิดใช้งาน Firebase Storage (สำหรับเก็บรูปถ่าย)
1. ที่แถบเมนูด้านซ้าย เลือก **Build > Storage**
2. กด **Get started** -> เลือก **Start in test mode** -> กด Next และ Done
3. ไปที่แถบ **Rules** (ด้านบนของ Storage) แล้วใส่ Rules สำหรับให้อ่านและอัปโหลดรูปภาพได้:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```
4. กด **Publish**

### ขั้นตอนที่ 4: คัดลอก Config มาใส่ในโปรเจกต์
1. ในหน้า Firebase Console กดที่รูป **ฟันเฟือง (Project settings)** ที่มุมซ้ายบน
2. เลื่อนลงมาด้านล่างที่หัวข้อ **"Your apps"** -> กดที่ไอคอนเว็บ `</>` (Web)
3. ตั้งชื่อแอป เช่น `server-audit-web` -> กด **Register app**
4. คัดลอกค่าในตัวแปร `firebaseConfig`
5. เปิดไฟล์ `firebase-config.js` ในโปรเจกต์นี้ แล้ววางทับค่าเดิม:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "server-audit-70.firebaseapp.com",
  projectId: "server-audit-70",
  storageBucket: "server-audit-70.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
```

---

### ขั้นตอนที่ 5: Deploy ขึ้น GitHub Pages (ฟรี 100%)

1. สร้าง Repository ใหม่บน [GitHub](https://github.com/new) เช่นชื่อ `server-audit-app` (ตั้งเป็น **Public**)
2. เปิดโปรแกรม Terminal / Command Prompt ในโฟลเดอร์นี้ แล้วรันคำสั่ง:
```bash
git init
git add .
git commit -m "Initial commit for Server Audit App with Firebase"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/server-audit-app.git
git push -u origin main
```
3. เมื่อ Push เสร็จแล้ว ให้เข้าไปที่หน้า GitHub Repository ของคุณ:
   - ไปที่แท็บ **Settings**
   - เมนูด้านซ้ายเลือก **Pages**
   - ที่หัวข้อ **Build and deployment > Branch** ให้เลือกเป็น `main` และโฟลเดอร์ `/ (root)` -> กด **Save**
4. รอประมาณ 1-2 นาที คุณจะได้ URL เช่น:
   `https://YOUR_GITHUB_USERNAME.github.io/server-audit-app/`

---

## 📱 การใช้งานข้ามอุปกรณ์ (Multi-device Real-time)
* **ส่งลิงก์ GitHub Pages ให้ทุกคนเข้าดูได้ทันที**: ทุกคนจะเข้าสู่ระบบในฐานะ **"บุคคลทั่วไป"** ดูข้อมูลและรูปภาพแบบ Real-time
* **เจ้าหน้าที่เข้าแก้ไขข้อมูล**: กดปุ่ม **"เข้าสู่ระบบ"** ที่มุมขวาบน
  - **Username**: `admin`
  - **Password**: `admin1234`
  - เมื่อบันทึกผลตรวจหรืออัปโหลดรูป หน้าจอของทุกคนที่เปิดเว็บอยู่จะเปลี่ยนและแสดงผลทันทีแบบ Real-time!
