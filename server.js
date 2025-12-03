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
const genAI = new GoogleGenerativeAI("dán Key của bạn vào đây"); 

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
// Tăng giới hạn body để nhận được nội dung bài học dài (nếu cần)
app.use(express.json({ limit: '10mb' })); 

// ================= MIDDLEWARES =================

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
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: fullName,
      photoURL: avatarUrl || ''
    });
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: email,
      fullName: fullName,
      role: role || 'student',
      avatarUrl: avatarUrl || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ message: 'User created successfully', uid: userRecord.uid });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// [U] Cập nhật User
app.put('/api/admin/users/:uid', checkAuth, checkAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { fullName, role, avatarUrl, email } = req.body;
    await db.collection('users').doc(uid).update({ fullName, role, avatarUrl, email });
    res.json({ message: `Updated user ${uid}` });
  } catch (error) {
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

// Lấy danh sách môn học
app.get('/api/courses', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('subjects').get();
    const subjects = snapshot.docs.map(doc => {
      const data = doc.data();
      return { id: doc.id, name: data.name, title: data.name, description: data.description, thumbnailUrl: data.thumbnailUrl };
    });
    res.status(200).json(subjects);
  } catch (error) { res.status(500).send('Error'); }
});

// Lấy danh sách bài học
app.get('/api/courses/:subjectId/lessons', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('lessons').where('subjectId', '==', req.params.subjectId).get();
    const lessons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    res.status(200).json(lessons);
  } catch (error) { res.status(500).send('Error'); }
});


// --- E. TÍNH NĂNG TẠO QUIZ VỚI GEMINI AI ---

const getLessonContent = async (lessonIds) => {
  let combinedContent = "";
  try {
    const promises = lessonIds.map(id => db.collection('lessons').doc(id).get());
    const docs = await Promise.all(promises);
    for (const doc of docs) {
      if (doc.exists) {
        const data = doc.data();
        combinedContent += `--- BÀI HỌC: ${data.title} ---\n`;
        // Ưu tiên lấy text content (SGK)
        if (data.textContent && data.textContent.trim().length > 0) {
          combinedContent += data.textContent;
        } else if (data.videoUrl) {
          combinedContent += `(Nội dung video: ${data.videoUrl})`;
        }
        combinedContent += `\n---------------------------\n`;
      }
    }
    return combinedContent;
  } catch (error) { throw new Error("Failed to get content"); }
};

const generateQuizWithAI = async (content, numQuestions = 5) => {
  try {
    const prompt = `
      Bạn là giáo viên. Hãy tạo ${numQuestions} câu hỏi trắc nghiệm từ nội dung sau.
      Trả về duy nhất JSON object (không markdown) theo mẫu: 
      { "questions": [{ "question": "...", "options": {"A":"...", "B":"...", "C":"...", "D":"..."}, "correctAnswer": "A" }] }
      
      Nội dung bài học:
      ${content}
    `;

    console.log("Đang gọi Gemini tạo Quiz...");
    const result = await model.generateContent(prompt);
    let text = result.response.text();

    // Xử lý làm sạch JSON
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) text = text.substring(firstBrace, lastBrace + 1);
    
    const data = JSON.parse(text);
    if (data.questions) return data.questions;
    if (Array.isArray(data)) return data;
    throw new Error("Invalid format");
  } catch (error) { console.error("Gemini Error:", error); throw error; }
};

app.post('/api/quizzes/generate', checkAuth, async (req, res) => {
  const { lessonIds, title } = req.body;
  // Lưu ý: User thường cũng được tạo Quiz để ôn tập nên không checkAdmin ở đây
  if (!lessonIds?.length) return res.status(400).send('Missing lessonIds');
  
  try {
    const content = await getLessonContent(lessonIds);
    if (!content || content.length < 20) return res.status(400).send('Nội dung bài học trống/quá ngắn');
    
    const questions = await generateQuizWithAI(content, 5);
    
    const quizRef = await db.collection('quizzes').add({
      userId: req.user.uid, 
      title: title || 'Quiz ôn tập', 
      lessonIds, 
      questions, 
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.status(201).json({ message: 'Success', quizData: { id: quizRef.id, userId: req.user.uid, title, questions } });
  } catch (error) { res.status(500).send('Error generating quiz'); }
});

app.get('/api/quizzes', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('quizzes').where('userId', '==', req.user.uid).orderBy('createdAt', 'desc').get();
    res.status(200).json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) { res.status(500).send('Error'); }
});


// --- F. TÍNH NĂNG CHATBOT (GỌI SANG PYTHON SERVER) ---

app.post('/api/chat-tutor', checkAuth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).send("Vui lòng nhập câu hỏi.");

    console.log(`[NodeJS -> Python] Câu hỏi: "${question}"`);

    // Gọi sang Server Python qua Ngrok
    const response = await axios.post(`${PYTHON_AI_URL}/api/chat`, {
      question: question,
      subject: "General" // Hoặc lấy môn học từ client nếu có
    });

    res.json({ success: true, data: response.data });

  } catch (error) {
    console.error("Lỗi kết nối Python AI:", error.message);
    if (error.code === 'ECONNREFUSED' || error.response?.status === 404) {
      return res.status(503).send("Gia sư AI đang ngủ (Server Python chưa bật).");
    }
    res.status(500).send("Lỗi hệ thống AI.");
  }
});


// --- KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server hoàn chỉnh đang chạy trên cổng ${PORT}`);
});