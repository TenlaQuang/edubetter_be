const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Thay UID này bằng UID tài khoản bạn đang đăng nhập trên App
// Bạn có thể xem UID này trong Firebase Console -> Authentication
const TARGET_UID = "fporxTgfWudMr7Zsc3ADXx7yEkt2"; 

async function setAdminRole() {
  try {
    const userRef = db.collection('users').doc(TARGET_UID);
    const doc = await userRef.get();

    if (!doc.exists) {
        console.log("❌ Không tìm thấy User này trong Firestore (bảng users).");
        console.log("👉 Hãy đăng nhập vào App ít nhất 1 lần để hệ thống tạo profile.");
        return;
    }

    await userRef.update({
      role: 'admin'
    });

    console.log(`✅ Thành công! User ${TARGET_UID} đã lên chức Admin.`);
  } catch (error) {
    console.error("Lỗi:", error);
  }
}

setAdminRole();