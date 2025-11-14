# Backend Node.js cho Ứng dụng Học tập Flutter

Đây là server backend (Node.js + Express) phục vụ cho dự án ứng dụng học tập trên Flutter. Backend này quản lý việc xác thực, lấy nội dung khóa học từ Firebase và tạo trắc nghiệm bằng AI (OpenAI).

## Tính năng

* **Xác thực:** Xác thực người dùng thông qua Firebase ID Token.
* **Nội dung:** Cung cấp API để lấy danh sách khóa học và bài học (video URL).
* **Trắc nghiệm AI:** Dùng AI (OpenAI) để tự động tạo câu hỏi trắc nghiệm dựa trên nội dung bài học được chọn.
* **Lưu trữ:** Lưu trữ các bài trắc nghiệm đã tạo vào Firestore để người dùng xem lại.

---

## 🚀 Cài đặt Yêu cầu

Để chạy được dự án này, bạn BẮT BUỘC phải có 2 file/key sau:

### 1. Key Firebase Admin (Bắt buộc)

1.  Truy cập [Firebase Console](https://console.firebase.google.com/).
2.  Vào **Project Settings** > **Service accounts**.
3.  Nhấn **"Generate new private key"** để tải về một file `.json`.
4.  Đổi tên file đó thành `service-account.json` và đặt nó vào thư mục gốc của dự án `backend` này (ngang hàng với `server.js`).
    *(File này đã có trong `.gitignore` nên sẽ không bị up lên Git).*

### 2. API Key của OpenAI (Bắt buộc)

1.  Lấy API Key từ tài khoản [OpenAI](https://platform.openai.com/api-keys) của bạn.
2.  Mở file `server.js`.
3.  Tìm đến dòng 21 (hoặc dòng có `new OpenAI(...)`).
4.  Thay thế chuỗi `'YOUR_OPENAI_API_KEY'` bằng key thật của bạn.

```javascript
const openai = new OpenAI({
  apiKey: 'sk-...' // <-- THAY KEY CỦA BẠN VÀO ĐÂY
});
```

---

## 🏃 Khởi chạy dự án

Sau khi đã hoàn tất 2 bước Cài đặt Yêu cầu ở trên:

1.  **Cài đặt thư viện:**
    ```bash
    npm install
    ```

2.  **Chạy server:**
    ```bash
    npm start
    ```

Server sẽ chạy tại `http://localhost:3000` (hoặc cổng mà bạn thiết lập).

---

## 📖 API Endpoints

(Chỉ liệt kê các API chính)

* `POST /api/users/create-profile`: (Cần Auth) Tạo hồ sơ người dùng trên Firestore.
* `GET /api/courses`: (Cần Auth) Lấy tất cả khóa học.
* `GET /api/courses/:courseId/lessons`: (Cần Auth) Lấy bài học của một khóa.
* `POST /api/quizzes/generate`: (Cần Auth) Tạo trắc nghiệm mới từ AI.
* `GET /api/quizzes`: (Cần Auth) Lấy lịch sử trắc nghiệm đã tạo.