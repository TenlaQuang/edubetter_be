// server.js
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CÀI ĐẶT ---
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- CẤU HÌNH AI ---
// Quan trọng: Hãy đảm bảo bạn đã dán Key mới tạo vào đây
const genAI = new GoogleGenerativeAI("YOUR_GEMINI_API_KEY"); 

// Sử dụng model cơ bản để đảm bảo tương thích tối đa
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash", 
});

const app = express();
app.use(cors());
// Tăng giới hạn body để nhận được nội dung bài học dài (nếu cần)
app.use(express.json({ limit: '10mb' })); 

// --- MIDDLEWARE AUTH ---
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

// --- ROUTES ---

// 1. Tạo Profile User
app.post('/api/users/create-profile', checkAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { fullName, avatarUrl } = req.body;

    await db.collection('users').doc(uid).set({
      uid, email,
      fullName: fullName || '',
      avatarUrl: avatarUrl || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(201).send({ message: 'User profile created', uid });
  } catch (error) {
    res.status(500).send('Error creating user profile');
  }
});

// 2. Lấy danh sách Môn học (Subjects)
// API này map dữ liệu từ bảng 'subjects' sang format Client cần
app.get('/api/courses', checkAuth, async (req, res) => {
  try {
    const snapshot = await db.collection('subjects').get();
    const subjects = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name, 
        title: data.name, // Fallback cho client cũ
        description: data.description,
        thumbnailUrl: data.thumbnailUrl
      };
    });
    res.status(200).json(subjects);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error getting subjects');
  }
});

// 3. Lấy bài học theo Môn học
app.get('/api/courses/:subjectId/lessons', checkAuth, async (req, res) => {
  try {
    const { subjectId } = req.params;
    // Tìm các bài học có subjectId trùng khớp
    const snapshot = await db.collection('lessons')
                             .where('subjectId', '==', subjectId)
                             .get();
    
    const lessons = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
                                    
    res.status(200).json(lessons);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error getting lessons');
  }
});

// --- LOGIC TẠO QUIZ THÔNG MINH ---

// Hàm helper: Lấy nội dung bài học từ Firestore
const getLessonContent = async (lessonIds) => {
  let combinedContent = "";
  try {
    const promises = lessonIds.map(id => db.collection('lessons').doc(id).get());
    const docs = await Promise.all(promises);

    for (const doc of docs) {
      if (doc.exists) {
        const data = doc.data();
        combinedContent += `--- BÀI HỌC: ${data.title} ---\n`;
        
        // Ưu tiên số 1: Nội dung văn bản (SGK)
        if (data.textContent && data.textContent.trim().length > 0) {
          combinedContent += data.textContent;
        } 
        // Ưu tiên số 2: Link Video (nếu không có text)
        else if (data.videoUrl) {
          combinedContent += `(Chỉ có video tham khảo: ${data.videoUrl})`;
        }
        combinedContent += `\n---------------------------\n`;
      }
    }
    return combinedContent;
  } catch (error) {
    throw new Error("Failed to get lesson content from DB");
  }
};

// Hàm helper: Gọi Gemini API
const generateQuizWithAI = async (content, numQuestions = 5) => {
  try {
    const prompt = `
      Bạn là một giáo viên giỏi. Hãy tạo ${numQuestions} câu hỏi trắc nghiệm dựa trên nội dung bài học sau đây.
      
      NỘI DUNG BÀI HỌC:
      """
      ${content}
      """
      
      YÊU CẦU QUAN TRỌNG:
      1. Câu hỏi phải bằng Tiếng Việt, rõ ràng, dễ hiểu.
      2. Tuyệt đối KHÔNG trả về định dạng Markdown (không dùng \`\`\`json).
      3. Chỉ trả về MỘT JSON Object duy nhất theo cấu trúc sau:
      {
        "questions": [
          {
            "question": "Nội dung câu hỏi?",
            "options": { "A": "Đáp án A", "B": "Đáp án B", "C": "Đáp án C", "D": "Đáp án D" },
            "correctAnswer": "A"
          }
        ]
      }
    `;

    console.log("Dang goi Gemini...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    console.log("Gemini tra loi (Raw):", text.substring(0, 100) + "...");

    // Xử lý làm sạch JSON (Sanitize)
    // Loại bỏ markdown code block nếu AI lỡ thêm vào
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Tìm điểm bắt đầu { và kết thúc } để cắt chuỗi rác
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      text = text.substring(firstBrace, lastBrace + 1);
    }

    // Parse JSON
    const data = JSON.parse(text);
    
    // Chuẩn hóa đầu ra thành mảng câu hỏi
    if (data.questions && Array.isArray(data.questions)) {
      return data.questions;
    } else if (Array.isArray(data)) {
      return data;
    }

    throw new Error("AI response format invalid");

  } catch (error) {
    console.error("Gemini Error:", error);
    throw new Error("Failed to generate quiz with AI");
  }
};

// API: Tạo Quiz (Triggered by App)
app.post('/api/quizzes/generate', checkAuth, async (req, res) => {
  const { lessonIds, title } = req.body;
  const userId = req.user.uid;

  if (!lessonIds?.length) return res.status(400).send('Missing lessonIds');

  try {
    // 1. Lấy nội dung từ DB
    const content = await getLessonContent(lessonIds);
    
    // Kiểm tra nếu nội dung quá ngắn (chưa nạp dữ liệu)
    if (!content || content.length < 20) {
      return res.status(400).send('Nội dung bài học trống. Hãy kiểm tra lại dữ liệu.');
    }

    // 2. Gọi AI tạo câu hỏi
    const questions = await generateQuizWithAI(content, 5);

    // 3. Lưu kết quả vào Firestore (bảng 'quizzes')
    const quizRef = await db.collection('quizzes').add({
      userId,
      title: title || 'Bài kiểm tra',
      lessonIds,
      questions,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4. Trả về cho Client
    res.status(201).json({
      message: 'Quiz created successfully',
      quizData: { 
        id: quizRef.id, 
        userId, 
        title, 
        questions 
      }
    });

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).send('Error generating quiz');
  }
});

// API: Lấy lịch sử Quiz
app.get('/api/quizzes', checkAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('quizzes')
                             .where('userId', '==', userId)
                             .orderBy('createdAt', 'desc')
                             .get();
    
    const quizzes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(quizzes);
  } catch (error) {
    res.status(500).send('Error getting quizzes');
  }
});

// --- KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});