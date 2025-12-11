// server.js

const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios'); // Dùng để gọi sang Python Server

// --- 1. CÀI ĐẶT FIREBASE ---
const serviceAccount = require('./service-account.json');

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// --- 2. CẤU HÌNH GEMINI AI (GOOGLE) ---
// Quan trọng: Hãy đảm bảo bạn đã dán Key mới tạo vào đây
const genAI = new GoogleGenerativeAI("dán API Key của bạn vào đây"); 

// Sử dụng model cơ bản để đảm bảo tương thích tối đa, không dùng config JSON mode gây lỗi
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash", 
});

// --- 3. CẤU HÌNH CHATBOT (PYTHON) ---
// Link Ngrok của máy chạy Python (Thay đổi mỗi lần chạy Ngrok)
const PYTHON_AI_URL = "https://xxxx-xxxx-xxxx.ngrok-free.app"; 

// --- 4. CẤU HÌNH SERVER ---
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ================= MIDDLEWARES =================


// Middleware kiểm tra Auth nhưng KHÔNG bắt buộc (Dành cho trang chủ)
const checkAuthOptional = async (req, res, next) => {
  const idToken = req.header('Authorization')?.replace('Bearer ', '');
  
  // Nếu không có token -> Cho qua luôn (là Guest)
  if (!idToken) {
    req.user = null; 
    return next();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; 
    next();
  } catch (error) {
    console.log('Token lỗi hoặc hết hạn, coi như là Guest');
    req.user = null;
    next();
  }
};

// Xác thực người dùng (Kiểm tra Token)
const checkAuth = async (req, res, next) => {
  const idToken = req.header('Authorization')?.replace('Bearer ', '');
  if (!idToken) return res.status(401).send('Unauthorized: No token provided');

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; 
    next();
  } catch (error) {
    console.error('Auth Error:', error);
    return res.status(403).send('Unauthorized: Invalid token');
  }
};

// Xác thực Admin (Chỉ cho phép Admin đi tiếp)
const checkAdmin = async (req, res, next) => {
  try {
    const uid = req.user.uid;
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      return res.status(403).send('Access denied: Admins only');
    }
    next();
  } catch (error) {
    console.error('Admin Check Error:', error);
    res.status(500).send('Server Error');
  }
};

// ================= ROUTES API =================

// --- A. QUẢN LÝ USER (ADMIN ONLY) ---

// [R] Lấy danh sách user
app.get('/api/admin/users', checkAuth, checkAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
    const users = snapshot.docs.map(doc => doc.data());
    res.json(users);
  } catch (error) {
    res.status(500).send('Error fetching users');
  }
});

// [C] Tạo User mới (Admin tạo thủ công)
app.post('/api/admin/users', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { email, password, fullName, role, avatarUrl } = req.body;

    // 1. Tạo tài khoản trong Firebase Authentication
    // LƯU Ý: KHÔNG truyền avatarUrl vào đây nếu nó là Base64
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: fullName,
      // photoURL: avatarUrl || '' // <--- XÓA DÒNG NÀY ĐI
    });

    // 2. Tạo thông tin chi tiết trong Firestore
    // Firestore chấp nhận chuỗi Base64 (miễn là < 1MB)
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: email,
      fullName: fullName,
      role: role || 'student',
      avatarUrl: avatarUrl || '', // Lưu Base64 vào đây
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ 
      message: 'User created successfully', 
      uid: userRecord.uid 
    });

  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send({ error: error.message });
  }
});

// [U] Cập nhật thông tin User
app.put('/api/admin/users/:uid', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { fullName, role, avatarUrl, email } = req.body;
    
    // 1. Cập nhật trong Firestore (Nơi quan trọng nhất để hiển thị)
    await db.collection('users').doc(uid).update({ 
      fullName, role, avatarUrl, email
    });

    // 2. Cập nhật trong Firebase Auth (Chỉ cập nhật Tên và Email)
    // Bỏ qua cập nhật photoURL để tránh lỗi Base64
    await admin.auth().updateUser(uid, { 
      displayName: fullName, 
      email: email 
    });

    res.json({ message: `Updated user ${uid}` });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).send('Error updating user');
  }
});


// [U] Đổi quyền nhanh (Role)
app.put('/api/admin/users/:uid/role', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    await db.collection('users').doc(uid).update({ role });
    res.json({ message: `Updated user role` });
  } catch (error) {
    res.status(500).send('Error updating role');
  }
});

// [D] Xóa User
app.delete('/api/admin/users/:uid', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    await db.collection('users').doc(uid).delete();
    await admin.auth().deleteUser(uid);
    res.json({ message: `Deleted user ${uid}` });
  } catch (error) {
    res.status(500).send('Error deleting user');
  }
});


// --- B. QUẢN LÝ MÔN HỌC (SUBJECTS) - ADMIN ---

app.post('/api/admin/subjects', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { id, name, description, thumbnailUrl } = req.body;
    const docRef = id ? db.collection('subjects').doc(id) : db.collection('subjects').doc();
    await docRef.set({ id: docRef.id, name, description, thumbnailUrl });
    res.status(201).json({ message: 'Subject created', id: docRef.id });
  } catch (error) { res.status(500).send('Error creating subject'); }
});

app.put('/api/admin/subjects/:id', checkAuth, checkAdmin, async (req, res) => {
  try {
    await db.collection('subjects').doc(req.params.id).update(req.body);
    res.json({ message: 'Subject updated' });
  } catch (error) { res.status(500).send('Error updating subject'); }
});

app.delete('/api/admin/subjects/:id', checkAuth, checkAdmin, async (req, res) => {
  try {
    await db.collection('subjects').doc(req.params.id).delete();
    res.json({ message: 'Subject deleted' });
  } catch (error) { res.status(500).send('Error deleting subject'); }
});


// --- C. QUẢN LÝ BÀI HỌC (LESSONS) - ADMIN ---

app.post('/api/admin/lessons', checkAuth, checkAdmin, async (req, res) => {
  try {
    const docRef = await db.collection('lessons').add(req.body);
    res.status(201).json({ message: 'Lesson created', id: docRef.id });
  } catch (error) { res.status(500).send('Error creating lesson'); }
});

app.put('/api/admin/lessons/:id', checkAuth, checkAdmin, async (req, res) => {
  try {
    await db.collection('lessons').doc(req.params.id).update(req.body);
    res.json({ message: 'Lesson updated' });
  } catch (error) { res.status(500).send('Error updating lesson'); }
});

app.delete('/api/admin/lessons/:id', checkAuth, checkAdmin, async (req, res) => {
  try {
    await db.collection('lessons').doc(req.params.id).delete();
    res.json({ message: 'Lesson deleted' });
  } catch (error) { res.status(500).send('Error deleting lesson'); }
});


// --- D. PUBLIC API (CHO APP MOBILE) ---



// [U] User tự cập nhật thông tin cá nhân (Tên, Email, Avatar)
app.put('/api/users/me', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid; // Lấy UID từ token (an toàn)
    const { fullName, email, avatarUrl } = req.body;

    // 1. Cập nhật Firestore
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (email) updateData.email = email;
    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    
    await db.collection('users').doc(uid).update(updateData);

    // 2. Cập nhật Firebase Auth (Để lần sau login hiện đúng tên/email)
    const authUpdate = {};
    if (fullName) authUpdate.displayName = fullName;
    if (email) authUpdate.email = email;
    // Lưu ý: photoURL của Auth có giới hạn độ dài, nếu avatarUrl là Base64 quá dài thì nên bỏ qua dòng dưới
    if (avatarUrl && avatarUrl.length < 2000) authUpdate.photoURL = avatarUrl;

    if (Object.keys(authUpdate).length > 0) {
      await admin.auth().updateUser(uid, authUpdate);
    }

    res.json({ message: 'Cập nhật thông tin thành công' });
  } catch (error) {
    console.error("Lỗi cập nhật profile:", error);
    res.status(500).send('Lỗi server: ' + error.message);
  }
});

// [U] User tự đổi mật khẩu
app.put('/api/users/me/password', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).send('Mật khẩu phải từ 6 ký tự trở lên');
    }

    await admin.auth().updateUser(uid, { password: password });
    res.json({ message: 'Đổi mật khẩu thành công' });
  } catch (error) {
    console.error("Lỗi đổi mật khẩu:", error);
    res.status(500).send('Lỗi server: ' + error.message);
  }
});

// Tạo Profile khi đăng ký
app.post('/api/users/create-profile', checkAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { fullName, avatarUrl } = req.body;
    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    if (!doc.exists) {
      await userRef.set({ uid, email, fullName, avatarUrl, role: 'student', createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    res.status(201).send({ message: 'User profile synced', uid });
  } catch (error) { res.status(500).send('Error'); }
});

// [R] Lấy danh sách Môn học (Public: Khách xem được, User xem được tiến độ)
app.get('/api/courses', checkAuthOptional, async (req, res) => {
  try {
    // 1. Lấy tất cả môn học (Ai cũng cần cái này)
    const subjectsSnapshot = await db.collection('subjects').get();
    
    // 2. Lấy tất cả bài học (để đếm tổng số bài mỗi môn)
    const lessonsSnapshot = await db.collection('lessons').get();
    const lessonCounts = {}; // Map: { subjectId: totalLessons }
    
    lessonsSnapshot.forEach(doc => {
      const data = doc.data();
      const subId = data.subjectId;
      lessonCounts[subId] = (lessonCounts[subId] || 0) + 1;
    });

    // 3. Lấy tiến độ học của User (CHỈ KHI ĐÃ ĐĂNG NHẬP)
    const userProgress = {}; // Map: { subjectId: completedCount }
    
    // Kiểm tra: Nếu req.user tồn tại (đã đăng nhập) thì mới đi tìm tiến độ
    if (req.user) {
      const userId = req.user.uid;
      const progressSnapshot = await db.collection('learning_progress')
                                      .where('userId', '==', userId)
                                      .where('isCompleted', '==', true)
                                      .get();
      
      progressSnapshot.forEach(doc => {
        const data = doc.data();
        const subId = data.subjectId;
        userProgress[subId] = (userProgress[subId] || 0) + 1;
      });
    }

    // 4. Gộp dữ liệu trả về
    const subjects = subjectsSnapshot.docs.map(doc => {
      const data = doc.data();
      const subjectId = doc.id;
      return {
        id: subjectId,
        name: data.name,
        title: data.name, 
        description: data.description,
        thumbnailUrl: data.thumbnailUrl,
        totalLessons: lessonCounts[subjectId] || 0,
        // Nếu là Khách (userProgress rỗng) thì completedLessons luôn là 0
        completedLessons: userProgress[subjectId] || 0 
      };
    });

    res.status(200).json(subjects);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error getting subjects');
  }
});

// Lấy danh sách bài học
app.get('/api/courses/:subjectId/lessons', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('lessons').where('subjectId', '==', req.params.subjectId).get();
    const lessons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    res.status(200).json(lessons);
  } catch (error) { res.status(500).send('Error'); }
});

// [C/U] Cập nhật tiến độ học tập (Đánh dấu hoàn thành)
app.post('/api/learning-progress', checkAuth, async (req, res) => {
  try {
    const { userId, lessonId, subjectId, isCompleted } = req.body;
    
    // Tìm xem đã có bản ghi tiến độ chưa
    const progressRef = db.collection('learning_progress');
    const snapshot = await progressRef
      .where('userId', '==', userId)
      .where('lessonId', '==', lessonId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Chưa có -> Tạo mới
      await progressRef.add({
        userId,
        lessonId,
        subjectId,
        isCompleted: isCompleted || true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Đã có -> Cập nhật
      const docId = snapshot.docs[0].id;
      await progressRef.doc(docId).update({
        isCompleted: isCompleted,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({ message: 'Progress updated' });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error updating progress');
  }
});

// API: Lấy danh sách tiến độ học tập của User theo môn học
// App Flutter sẽ gọi cái này để biết tô xanh bài nào
app.get('/api/learning-progress', async (req, res) => {
  try {
    const { userId, subjectId } = req.query;

    if (!userId || !subjectId) {
      return res.status(400).json({ error: 'Missing userId or subjectId' });
    }

    // Lấy tất cả các bài đã học của user này trong môn này
    const snapshot = await db.collection('learning_progress')
      .where('userId', '==', userId)
      .where('subjectId', '==', subjectId)
      .where('isCompleted', '==', true) // Chỉ lấy bài đã hoàn thành
      .get();

    // Trả về danh sách chỉ chứa lessonId (để App xử lý cho nhẹ)
    const progressList = snapshot.docs.map(doc => ({
      lessonId: doc.data().lessonId,
      isCompleted: true
    }));

    res.json(progressList);

  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).send('Error fetching progress');
  }
});

// --- E. AI QUIZ LOGIC (NÂNG CẤP) ---

const getLessonContent = async (lessonIds) => { 
  let combinedContent = "";
  try {
    const promises = lessonIds.map(id => db.collection('lessons').doc(id).get());
    const docs = await Promise.all(promises);
    for (const doc of docs) {
      if (doc.exists) {
        const data = doc.data();
        if (data.textContent) combinedContent += `--- BÀI: ${data.title} ---\n${data.textContent}\n`;
        else if (data.videoUrl) combinedContent += `(Video: ${data.videoUrl})`;
      }
    }
    return combinedContent;
  } catch (error) { throw new Error("Failed to get content"); }
};

// Cập nhật hàm này để nhận numQuestions
const generateQuizWithAI = async (content, numQuestions) => { 
  try {
    // Thêm numQuestions vào prompt
    const prompt = `
      Bạn là một giáo viên giỏi. Hãy tạo chính xác ${numQuestions} câu hỏi trắc nghiệm từ nội dung sau.
      Trả về duy nhất JSON object (không markdown) theo mẫu: 
      { "questions": [{ "question": "...", "options": {"A":"...", "B":"...", "C":"...", "D":"..."}, "correctAnswer": "A" }] }
      
      Nội dung bài học:
      ${content}
    `;

    console.log(`Đang gọi Gemini tạo ${numQuestions} câu hỏi...`);
    const result = await model.generateContent(prompt);
    let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) text = text.substring(firstBrace, lastBrace + 1);
    
    const data = JSON.parse(text);
    if (data.questions) return data.questions;
    if (Array.isArray(data)) return data;
    throw new Error("Invalid format");
  } catch (error) { throw error; }
};

app.post('/api/quizzes/generate', checkAuth, async (req, res) => {
  const { lessonIds, title, numberOfQuestions } = req.body; // Nhận thêm numberOfQuestions
  
  if (!lessonIds?.length) return res.status(400).send('Missing lessonIds');
  
  // Xác định số lượng câu hỏi (mặc định 5 nếu không gửi)
  let count = 5;
  if (numberOfQuestions) {
    count = parseInt(numberOfQuestions);
    // Giới hạn để tránh lỗi hoặc quá tải (ví dụ max 30 câu)
    if (count > 30) count = 30;
    if (count < 1) count = 5;
  }

  try {
    const content = await getLessonContent(lessonIds);
    if (!content || content.length < 20) return res.status(400).send('Nội dung trống');
    
    const questions = await generateQuizWithAI(content, count);
    
    // Lưu vào Firestore (Đã bao gồm chức năng lịch sử)
    const quizRef = await db.collection('quizzes').add({
      userId: req.user.uid, 
      title: title || 'Quiz ôn tập', 
      lessonIds, 
      questions, 
      // Lưu thêm số câu hỏi để sau này thống kê nếu cần
      questionCount: questions.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(201).json({ message: 'Success', quizData: { id: quizRef.id, userId: req.user.uid, title, questions } });
  } catch (error) { 
    console.error(error);
    res.status(500).send('Error generating quiz'); 
  }
});

// API Lấy Lịch sử Quiz (Đã sửa lỗi ngày tháng)
app.get('/api/quizzes', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('quizzes')
                             .where('userId', '==', req.user.uid)
                             .orderBy('createdAt', 'desc')
                             .get();
    
    const quizzes = snapshot.docs.map(doc => {
      const data = doc.data();
      return { 
        id: doc.id, 
        ...data,
        // CHUYỂN ĐỔI TIMESTAMP SANG STRING TRÁNH LỖI FLUTTER
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
      };
    });
    
    res.status(200).json(quizzes);
  } catch (error) {
    console.error("Lỗi lấy lịch sử Quiz:", error);
    // In ra lỗi cụ thể để bạn xem trong terminal (thường là lỗi thiếu Index)
    res.status(500).send(`Error getting quizzes: ${error.message}`); 
  }
});

// --- G. TÍNH NĂNG CHAT HISTORY (FIX LỖI NGÀY THÁNG) ---

// 1. Tạo Phiên Chat Mới
app.post('/api/chat/sessions', checkAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { title } = req.body; 

    const sessionRef = await db.collection('chat_sessions').add({
      userId: userId,
      title: title || 'Cuộc trò chuyện mới',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ 
      sessionId: sessionRef.id, 
      title: 'Cuộc trò chuyện mới',
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error creating chat session');
  }
});

// 2. Lấy danh sách các Phiên Chat (Đã Fix lỗi Map/String)
app.get('/api/chat/sessions', checkAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('chat_sessions')
                             .where('userId', '==', userId)
                             .orderBy('updatedAt', 'desc')
                             .get();
    
    const sessions = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        // QUAN TRỌNG: Chuyển Timestamp của Firestore thành chuỗi ISO String
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
        updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null
      };
    });
    res.json(sessions);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching chat sessions');
  }
});

// 3. Lấy tin nhắn của một phiên (Đã Fix lỗi Map/String)
app.get('/api/chat/sessions/:sessionId/messages', checkAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const snapshot = await db.collection('chat_messages')
                             .where('sessionId', '==', sessionId)
                             .orderBy('createdAt', 'asc')
                             .get();
    
    const messages = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        // Chuyển Timestamp sang chuỗi
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null
      };
    });
    res.json(messages);
  } catch (error) {
    res.status(500).send('Error fetching messages');
  }
});

// 4. Gửi tin nhắn & Gọi AI (ĐÃ SỬA LỖI CRASH NOT_FOUND)
app.post('/api/chat-tutor', checkAuth, async (req, res) => {
  try {
    const { question, sessionId } = req.body;
    const userId = req.user.uid;

    if (!question) return res.status(400).send("Vui lòng nhập câu hỏi.");

    let currentSessionId = sessionId;
    let sessionRef;

    // --- BƯỚC 1: XỬ LÝ SESSION ID VÀ TẠO SESSION NẾU CHƯA CÓ ---
    if (!currentSessionId) {
      // Trường hợp 1: Client không gửi ID -> Tạo mới hoàn toàn (Auto ID)
      sessionRef = db.collection('chat_sessions').doc();
      currentSessionId = sessionRef.id;
      
      await sessionRef.set({
        userId,
        title: question.substring(0, 30) + "...",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Trường hợp 2: Client gửi ID lên (VD: 1765039451932)
      // Cần kiểm tra xem ID này đã có trong DB chưa. Nếu chưa thì phải tạo (SET) thay vì Update.
      sessionRef = db.collection('chat_sessions').doc(currentSessionId);
      const docSnap = await sessionRef.get();

      if (!docSnap.exists) {
        // Nếu chưa tồn tại -> Tạo mới với ID do Client gửi
        await sessionRef.set({
          userId,
          title: question.substring(0, 30) + "...",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // --- BƯỚC 2: LƯU TIN NHẮN USER ---
    await db.collection('chat_messages').add({
      sessionId: currentSessionId,
      sender: 'user',
      text: question,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[NodeJS -> Python] Câu hỏi: "${question}"`);

    // --- BƯỚC 3: GỌI AI ---
    const response = await axios.post(`https://stipulatory-lavada-nonegoistically.ngrok-free.dev/api/chat`, {
      question: question,
      subject: "General" 
    });

    const aiAnswer = response.data.answer;

    // --- BƯỚC 4: LƯU TIN NHẮN BOT ---
    await db.collection('chat_messages').add({
      sessionId: currentSessionId,
      sender: 'bot',
      text: aiAnswer,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // --- BƯỚC 5: CẬP NHẬT THỜI GIAN SESSION (SỬA LỖI TẠI ĐÂY) ---
    // Dùng set với merge: true để an toàn hơn update (tránh crash nếu doc bị xóa giữa chừng)
    await db.collection('chat_sessions').doc(currentSessionId).set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ 
      success: true, 
      data: response.data,
      sessionId: currentSessionId 
    });

  } catch (error) {
    console.error("Lỗi xử lý Chat:", error.message);
    // Phân biệt lỗi để debug dễ hơn
    if (error.code === 5 || error.message.includes('NOT_FOUND')) {
       return res.status(500).send("Lỗi Database: Không tìm thấy phiên chat để cập nhật.");
    }
    if (error.code === 'ECONNREFUSED' || error.response?.status === 404) {
      return res.status(503).send("Gia sư AI đang ngủ (Server Python chưa bật).");
    }
    res.status(500).send("Lỗi hệ thống: " + error.message);
  }
});

// // --- F. TÍNH NĂNG CHATBOT (GỌI SANG PYTHON SERVER) ---

// app.post('/api/chat-tutor', checkAuth, async (req, res) => {
//   try {
//     const { question } = req.body;
//     if (!question) return res.status(400).send("Vui lòng nhập câu hỏi.");

//     console.log(`[NodeJS -> Python] Câu hỏi: "${question}"`);

//     // Gọi sang Server Python qua Ngrok
//     const response = await axios.post(`https://stipulatory-lavada-nonegoistically.ngrok-free.dev/api/chat`, {
//       question: question,
//       subject: "General" // Hoặc lấy môn học từ client nếu có
//     });

//     res.json({ success: true, data: response.data });

//   } catch (error) {
//     console.error("Lỗi kết nối Python AI:", error.message);
//     if (error.code === 'ECONNREFUSED' || error.response?.status === 404) {
//       return res.status(503).send("Gia sư AI đang ngủ (Server Python chưa bật).");
//     }
//     res.status(500).send("Lỗi hệ thống AI.");
//   }
// });


// --- KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server hoàn chỉnh đang chạy trên cổng ${PORT}`);
});