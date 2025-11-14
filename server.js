// server.js
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const { OpenAI } = require('openai');

// --- CÀI ĐẶT ---

// 1. Cài đặt Firebase Admin
// Bạn cần tải file serviceAccountKey.json từ Console Firebase
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 2. Cài đặt AI (Ví dụ: OpenAI)
// Lấy API key từ tài khoản OpenAI của bạn
const openai = new OpenAI({
  apiKey: 'YOUR_OPENAI_API_KEY' // <-- THAY KEY CỦA BẠN VÀO ĐÂY
});

// 3. Cài đặt Express
const app = express();
app.use(cors()); // Cho phép Flutter gọi API
app.use(express.json()); // Đọc JSON từ body của request

// --- MIDDLEWARE XÁC THỰC ---
// Middleware này sẽ kiểm tra Firebase ID Token do client (Flutter) gửi lên
const checkAuth = async (req, res, next) => {
  const idToken = req.header('Authorization')?.replace('Bearer ', '');

  if (!idToken) {
    return res.status(401).send('Unauthorized: No token provided');
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    // Gắn thông tin user (uid, email...) vào request để các hàm sau sử dụng
    req.user = decodedToken; 
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(403).send('Unauthorized: Invalid token');
  }
};

// --- ROUTES ---

// === 1. AUTHENTICATION (Đăng ký / Đăng nhập) ===
// Lưu ý: Với Firebase, Đăng ký/Đăng nhập thường diễn ra ở CLIENT (Flutter).
// Client dùng Firebase SDK để đăng ký/đăng nhập (ví dụ: bằng Email/Pass, Google...).
// Sau khi thành công, client lấy ID Token và gửi cho backend.
// Backend chỉ cần MỘT endpoint để tạo profile user trong Firestore sau khi client đăng ký.

/*
 * @route   POST /api/users/create-profile
 * @desc    Tạo profile user trong Firestore sau khi đăng ký thành công ở client
 * @access  Private (Phải có token)
 */
app.post('/api/users/create-profile', checkAuth, async (req, res) => {
  try {
    const { uid, email } = req.user; // Lấy từ middleware checkAuth
    const { fullName, avatarUrl } = req.body; // Lấy thêm từ client

    const userRef = db.collection('users').doc(uid);
    await userRef.set({
      uid: uid,
      email: email,
      fullName: fullName || '',
      avatarUrl: avatarUrl || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).send({ message: 'User profile created', uid: uid });
  } catch (error) {
    console.error('Error creating user profile:', error);
    res.status(500).send('Error creating user profile');
  }
});

// === 2. COURSE CONTENT (Nội dung khóa học) ===

/*
 * @route   GET /api/courses
 * @desc    Lấy danh sách tất cả khóa học
 * @access  Private
 */
app.get('/api/courses', checkAuth, async (req, res) => {
  try {
    const coursesSnapshot = await db.collection('courses').get();
    const courses = coursesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).send('Error getting courses');
  }
});

/*
 * @route   GET /api/courses/:courseId/lessons
 * @desc    Lấy tất cả bài học (gồm URL video) của một khóa học
 * @access  Private
 */
app.get('/api/courses/:courseId/lessons', checkAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lessonsSnapshot = await db.collection('lessons')
                                    .where('courseId', '==', courseId)
                                    .orderBy('order') // Sắp xếp theo thứ tự bài học
                                    .get();
                                    
    const lessons = lessonsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lessons);
  } catch (error) {
    res.status(500).send('Error getting lessons');
  }
});


// === 3. QUIZ GENERATION (Tạo trắc nghiệm) ===

/**
 * Hàm trợ giúp: Lấy nội dung text từ các bài học trong Firestore.
 * Giả sử trong document 'lessons' của bạn có một trường là 'textContent' hoặc 'transcript'.
 * Đây là phần text mà AI sẽ đọc để tạo câu hỏi.
 */
const getLessonContentForAI = async (lessonIds) => {
  let combinedContent = "";
  try {
    const lessonPromises = lessonIds.map(id => db.collection('lessons').doc(id).get());
    const lessonDocs = await Promise.all(lessonPromises);

    for (const doc of lessonDocs) {
      if (doc.exists) {
        // GIẢ SỬ bạn lưu nội dung bài học trong trường 'textContent'
        // Đây là điều KIÊN QUYẾT để AI có dữ liệu tạo câu hỏi
        const data = doc.data();
        combinedContent += `--- Start Lesson ${data.title} ---\n`;
        combinedContent += `${data.textContent}\n`; // <-- TRƯỜNG QUAN TRỌNG
        combinedContent += `--- End Lesson ${data.title} ---\n\n`;
      }
    }
    return combinedContent;
  } catch (error) {
    console.error("Error fetching lesson content:", error);
    throw new Error("Failed to get lesson content");
  }
};

/**
 * Hàm trợ giúp: Gọi AI (OpenAI) để tạo trắc nghiệm từ nội dung text
 */
const generateQuizWithAI = async (content, numQuestions = 5) => {
  try {
    // Đây là "Prompt" - câu lệnh bạn ra cho AI.
    // Yêu cầu AI trả về định dạng JSON là RẤT QUAN TRỌNG.
    const prompt = `
      Dựa trên nội dung sau đây:
      """
      ${content}
      """
      Hãy tạo một bài trắc nghiệm gồm ${numQuestions} câu hỏi.
      Mỗi câu hỏi phải có 4 lựa chọn (A, B, C, D) và chỉ MỘT đáp án đúng.
      
      Vui lòng trả về kết quả CHÍNH XÁC dưới dạng một JSON array, KHÔNG có bất kỳ text nào khác.
      Cấu trúc của mỗi object trong array phải là:
      {
        "question": "Nội dung câu hỏi...",
        "options": {
          "A": "Lựa chọn A",
          "B": "Lựa chọn B",
          "C": "Lựa chọn C",
          "D": "Lựa chọn D"
        },
        "correctAnswer": "A" 
      }
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Hoặc "gpt-4"
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5, // Giảm độ "sáng tạo" để bám sát nội dung
      response_format: { type: "json_object" }, // Yêu cầu trả về JSON (nếu model hỗ trợ)
    });

    // Lấy nội dung JSON string từ AI và parse nó
    const jsonString = response.choices[0].message.content;
    
    // Đôi khi AI vẫn trả về JSON trong một code block, cần xử lý
    const cleanedJsonString = jsonString.replace(/```json/g, '').replace(/```/g, '').trim();

    const quizData = JSON.parse(cleanedJsonString);
    
    // AI có thể trả về 1 object { "questions": [...] }, cần check
    if (quizData.questions && Array.isArray(quizData.questions)) {
      return quizData.questions; 
    }
    // Hoặc trả về 1 array [...]
    if (Array.isArray(quizData)) {
      return quizData;
    }
    
    throw new Error("AI response is not in expected format.");

  } catch (error) {
    console.error("Error calling AI API:", error);
    throw new Error("Failed to generate quiz from AI");
  }
};

/*
 * @route   POST /api/quizzes/generate
 * @desc    Tạo một bài trắc nghiệm mới từ các bài học đã chọn
 * @access  Private
 * @body    { "lessonIds": ["id1", "id2", ...], "title": "Quiz Tuần 1" }
 */
app.post('/api/quizzes/generate', checkAuth, async (req, res) => {
  const { lessonIds, title } = req.body;
  const userId = req.user.uid;

  if (!lessonIds || lessonIds.length === 0) {
    return res.status(400).send('lessonIds array is required');
  }

  try {
    // Bước 1: Lấy nội dung text của các bài học từ Firebase
    const content = await getLessonContentForAI(lessonIds);
    if (content.trim().length === 0) {
      return res.status(400).send('No content found for selected lessons. Check "textContent" field.');
    }

    // Bước 2: Gửi nội dung cho AI để tạo câu hỏi
    const questions = await generateQuizWithAI(content, 5); // Tạo 5 câu

    // Bước 3: Lưu bài trắc nghiệm mới vào Firestore
    const newQuizRef = await db.collection('quizzes').add({
      userId: userId,
      title: title || 'Bài trắc nghiệm',
      lessonIds: lessonIds,
      questions: questions, // Mảng câu hỏi từ AI
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Bước 4: Gửi bài trắc nghiệm về cho client
    res.status(201).json({
      message: 'Quiz generated successfully',
      quizId: newQuizRef.id,
      quizData: {
        id: newQuizRef.id,
        userId,
        title,
        questions,
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).send('Error generating quiz');
  }
});

/*
 * @route   GET /api/quizzes
 * @desc    Lấy lịch sử các bài trắc nghiệm đã tạo của user
 * @access  Private
 */
app.get('/api/quizzes', checkAuth, async (req, res) => {
  try {
    const userId = req.user.uid;
    const quizzesSnapshot = await db.collection('quizzes')
                                    .where('userId', '==', userId)
                                    .orderBy('createdAt', 'desc')
                                    .get();
                                    
    const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(quizzes);
  } catch (error) {
    res.status(500).send('Error getting quizzes');
  }
});


// --- KHỞI ĐỘNG SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});