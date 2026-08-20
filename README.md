# MAserver - Server Room Physical Inventory & Asset Audit

ระบบเว็บแอปพลิเคชันสำหรับตรวจเช็กสภาพและตรวจนับครุภัณฑ์เซิร์ฟเวอร์ประจำงวด รองรับการทำงานแบบ **Real-time ข้ามอุปกรณ์** ผ่าน **Google Firebase** และ Deploy ขึ้น **GitHub Pages** ได้ฟรี 100%

---

## 🌟 ฟีเจอร์หลัก (Key Features)

1. **Dashboard & KPIs**: สรุปความคืบหน้าการตรวจเช็ก, รายการปกติ/ชำรุด/สูญหาย, อัตราความคลาดเคลื่อน และค่าตัวถ่วงน้ำหนักรวม
2. **Physical Checklist**: ตารางตรวจเช็กอุปกรณ์ 78 รายการ แยก 13 หมวดหมู่/ตู้ Rack
3. **2D Rack Elevation Map**: ผังจำลองหน้าตู้เซิร์ฟเวอร์ พร้อมระบบค้นหาและไฮไลต์ตำแหน่ง
4. **Audit History & Versioning**: จัดการรอบงวดการตรวจเช็ก (เช่น รอบปีงบประมาณ 2567, 2568) ดู Snapshot ย้อนหลัง และส่งออกข้อมูล
5. **Role-Based Google Authentication**:
   - **บุคคลทั่วไป (Visitor / Viewer)**: ดูข้อมูล, ดูภาพถ่าย, พิมพ์รายงานแบบ Read-Only ได้โดยไม่ต้องล็อกอิน
   - **ผู้ดูแลระบบ (Admin Whitelist)**: ยืนยันตัวตนด้วย **Google Account (Gmail: `suphalerk.chur@gmail.com`)** เพื่อสิทธิ์ในการบันทึกผลตรวจ, แก้ไขค่าตัวถ่วงน้ำหนัก, แนบภาพถ่าย, เพิ่มอุปกรณ์ใหม่ และสร้างรอบงวดใหม่
6. **Real-time Cloud Sync (Firebase)**:
   - ซิงค์ข้อมูลขึ้น **Cloud Firestore** และรูปภาพขึ้น **Firebase Storage** แบบ Real-time ข้ามทุกอุปกรณ์
7. **Progressive Web App (PWA)**:
   - รองรับการติดตั้งลงหน้าจอมือถือ/แท็บเล็ต/คอมพิวเตอร์ (Add to Home Screen) และทำงานแบบ Offline Caching

---

## 🚀 ขั้นตอนการติดตั้งและ Deploy สู่ GitHub Pages + Firebase (ละเอียดทุกขั้นตอน)

### ขั้นตอนที่ 1: ตั้งค่า Firebase Project (maserver-9fdf1)
1. เข้าไปที่ [Firebase Console](https://console.firebase.google.com/)
2. เปิดใช้งาน **Authentication**:
   - ไปที่ **Authentication** > แท็บ **Sign-in method** > กด **Add new provider**
   - เลือก **Google** > สับสวิตช์ **Enable** > เลือก Support Email เป็น `suphalerk.chur@gmail.com` > กด **Save**
3. **สำคัญมากสำหรับ GitHub Pages:**
   - ในเมนู **Authentication** > คลิกแท็บ **Settings** > เลือก **Authorized domains**
   - กด **Add domain** แล้วพิมพ์โดเมน GitHub Pages ของคุณ เช่น: `YOUR_GITHUB_USERNAME.github.io`
4. ตรวจสอบ **Firestore Database** และ **Storage** ว่าเปิดใช้งานแล้ว

---

### ขั้นตอนที่ 2: Deploy ขึ้น GitHub Pages (ฟรี 100%)

1. สร้าง Repository ใหม่บน [GitHub](https://github.com/new) เช่นชื่อ `server-audit-app` (ตั้งเป็น **Public**)
2. เปิดโปรแกรม Terminal / Command Prompt ในโฟลเดอร์นี้ แล้วรันคำสั่ง:
```bash
git init
git add .
git commit -m "Deploy MAserver to GitHub Pages with Firebase Google Auth & PWA"
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
* **ส่งลิงก์ GitHub Pages ให้ทุกคนเข้าดูได้ทันที**: ทุกคนจะเข้าสู่ระบบในฐานะ **"บุคคลทั่วไป (Viewer)"** ดูข้อมูล สรุปผล และรูปภาพแบบ Real-time
* **ผู้ดูแลระบบเข้าแก้ไขข้อมูล**: กดปุ่ม **"เข้าสู่ระบบ"** ที่มุมขวาบน -> กด **"เข้าสู่ระบบด้วย Google (Gmail)"** แล้วเลือกบัญชี `suphalerk.chur@gmail.com` เพื่อปลดล็อกสิทธิ์ Admin ทันที!
