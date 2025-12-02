const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Hàm xóa tất cả documents trong một collection
async function deleteCollection(collectionPath, batchSize) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

async function seedDatabase() {
  console.log("⚠️  ĐANG CẬP NHẬT LẠI DỮ LIỆU...");
  
  try {
    // 1. Xóa dữ liệu cũ
    await deleteCollection('subjects', 50);
    await deleteCollection('lessons', 50);
    await deleteCollection('quizzes', 50); 

    console.log("✔ Đã xóa dữ liệu cũ.");
    console.log("\n🚀 ĐANG TẠO DỮ LIỆU MỚI VỚI ẢNH FIX LỖI...");

    // 2. DANH SÁCH MÔN HỌC (Dùng ảnh Placeholder an toàn)
    const subjectsData = [
      {
        id: 'geo12',
        name: 'Địa Lí 12',
        // Ảnh màu xanh dương
        thumbnailUrl: 'https://placehold.co/600x400/2196F3/FFFFFF.png?text=DIA+LI+12',
        description: 'Địa lí tự nhiên và kinh tế - xã hội Việt Nam (Kết nối tri thức).'
      },
      {
        id: 'hist12',
        name: 'Lịch Sử 12',
        // Ảnh màu đỏ
        thumbnailUrl: 'https://placehold.co/600x400/F44336/FFFFFF.png?text=LICH+SU+12',
        description: 'Thế giới và Việt Nam trong bối cảnh lịch sử mới.'
      },
      {
        id: 'civic12',
        name: 'GDCD 12',
        // Ảnh màu xanh lá
        thumbnailUrl: 'https://placehold.co/600x400/4CAF50/FFFFFF.png?text=GDCD+12',
        description: 'Pháp luật và đời sống, Công dân với pháp luật.'
      }
    ];

    for (const subject of subjectsData) {
      await db.collection('subjects').doc(subject.id).set(subject);
      console.log(`-> Đã tạo môn: ${subject.name}`);
    }

    // 3. DANH SÁCH BÀI HỌC (Giữ nguyên nội dung text của bạn)
    const lessonsData = [
      // --- ĐỊA LÍ 12 ---
      {
        subjectId: 'geo12',
        title: 'Bài 1: Vị trí địa lí và phạm vi lãnh thổ',
        videoUrl: '', 
        duration: 0,
        orderIndex: 1,
        textContent: `
          I. PHẠM VI LÃNH THỔ
          Lãnh thổ Việt Nam là một khối thống nhất và toàn vẹn, bao gồm vùng đất, vùng biển và vùng trời.
          1. Vùng đất
          - Gồm toàn bộ phần đất liền và các hải đảo.
          - Diện tích đất liền khoảng 331.212 km².
          - Đường biên giới trên đất liền dài hơn 4.600 km, giáp Trung Quốc, Lào, Campuchia.
          2. Vùng biển
          - Thuộc Biển Đông, diện tích khoảng 1 triệu km².
          - Bao gồm 5 bộ phận: Nội thủy, lãnh hải, vùng tiếp giáp lãnh hải, vùng đặc quyền kinh tế và thềm lục địa.
          - Có hai quần đảo lớn là Hoàng Sa và Trường Sa.
          3. Vùng trời
          - Là khoảng không gian bao trùm lên vùng đất và vùng biển.

          II. VỊ TRÍ ĐỊA LÍ
          - Nằm ở rìa đông của bán đảo Đông Dương, gần trung tâm khu vực Đông Nam Á.
          - Hệ tọa độ trên đất liền:
            + Điểm cực Bắc: 23°23'B (Hà Giang).
            + Điểm cực Nam: 8°34'B (Cà Mau).
            + Điểm cực Tây: 102°09'Đ (Điện Biên).
            + Điểm cực Đông: 109°24'Đ (Khánh Hòa).
          - Nằm hoàn toàn trong vùng nội chí tuyến bán cầu Bắc, khu vực hoạt động của gió mùa châu Á.

          III. Ý NGHĨA CỦA VỊ TRÍ ĐỊA LÍ VÀ PHẠM VI LÃNH THỔ
          1. Ý nghĩa tự nhiên
          - Quy định thiên nhiên nước ta mang tính chất nhiệt đới ẩm gió mùa.
          - Tài nguyên khoáng sản và sinh vật phong phú.
          - Tuy nhiên cũng chịu ảnh hưởng của nhiều thiên tai (bão, lũ...).
          2. Ý nghĩa kinh tế - xã hội
          - Thuận lợi giao lưu kinh tế với các nước trong khu vực và thế giới.
          - Là cửa ngõ ra biển của Lào, Đông Bắc Thái Lan, Tây Nam Trung Quốc.
          - Có ý nghĩa quan trọng về an ninh quốc phòng.
        `
      },
      {
        subjectId: 'geo12',
        title: 'Bài 2: Thiên nhiên nhiệt đới ẩm gió mùa',
        videoUrl: '',
        duration: 0,
        orderIndex: 2,
        textContent: `
          I. KHÍ HẬU NHIỆT ĐỚI ẨM GIÓ MÙA
          1. Tính chất nhiệt đới
          - Tổng bức xạ lớn, cân bằng bức xạ dương quanh năm.
          - Nhiệt độ trung bình năm trên 20°C (trừ vùng núi cao).
          - Số giờ nắng nhiều (1400 - 3000 giờ/năm).
          2. Tính chất ẩm
          - Lượng mưa lớn (1500 - 2000 mm/năm).
          - Độ ẩm không khí cao (trên 80%).
          3. Tính chất gió mùa
          - Gió mùa mùa đông: Từ tháng 11 đến tháng 4, lạnh khô đầu mùa, lạnh ẩm cuối mùa (miền Bắc).
          - Gió mùa mùa hạ: Từ tháng 5 đến tháng 10, nóng ẩm, mưa nhiều.
        `
      },
      // --- LỊCH SỬ 12 ---
      {
        subjectId: 'hist12',
        title: 'Bài 1: Liên hợp quốc',
        videoUrl: '',
        duration: 0,
        orderIndex: 1,
        textContent: `
          1. Sự thành lập
          - Thành lập năm 1945 sau Chiến tranh thế giới thứ hai.
          - Mục đích: Duy trì hòa bình và an ninh thế giới, thúc đẩy quan hệ hữu nghị giữa các dân tộc.
          2. Các cơ quan chính
          - Đại hội đồng, Hội đồng Bảo an, Hội đồng Kinh tế và Xã hội, Hội đồng Quản thác, Tòa án Quốc tế, Ban Thư ký.
          3. Vai trò
          - Giải quyết các xung đột quốc tế.
          - Thúc đẩy hợp tác phát triển kinh tế, văn hóa, xã hội.
          - Việt Nam gia nhập LHQ năm 1977.
        `
      },
      // --- GDCD 12 ---
      {
        subjectId: 'civic12',
        title: 'Bài 1: Pháp luật và đời sống',
        videoUrl: '',
        duration: 0,
        orderIndex: 1,
        textContent: `
          1. Khái niệm pháp luật
          - Là hệ thống các quy tắc xử sự chung do Nhà nước ban hành và được bảo đảm thực hiện bằng quyền lực nhà nước.
          2. Đặc trưng của pháp luật
          - Tính quy phạm phổ biến.
          - Tính quyền lực, bắt buộc chung.
          - Tính xác định chặt chẽ về mặt hình thức.
          3. Vai trò của pháp luật
          - Là phương tiện để Nhà nước quản lý xã hội.
          - Là phương tiện để công dân thực hiện và bảo vệ quyền, lợi ích hợp pháp của mình.
        `
      }
    ];

    for (const lesson of lessonsData) {
      await db.collection('lessons').add(lesson);
    }
    console.log(`-> Đã thêm ${lessonsData.length} bài học mẫu.`);

    console.log("\n✅ HOÀN TẤT! Database đã được cập nhật ảnh mới.");

  } catch (error) {
    console.error("❌ Lỗi seed data:", error);
  }
}

seedDatabase();