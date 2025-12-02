const { GoogleGenerativeAI } = require("@google/generative-ai");

// THAY KEY CỦA BẠN VÀO ĐÂY
const API_KEY = "AIzaSyDEcA6tfUJRj2l93HYDV3SE5lsgOo4-i8g"; 

const genAI = new GoogleGenerativeAI(API_KEY);

async function run() {
  console.log("--- ĐANG TEST KẾT NỐI ĐẾN GEMINI AI ---");
  
  // Thử model chuẩn nhất hiện nay
  const modelName = "gemini-2.5-flash"; 
  console.log(`Đang thử model: ${modelName}...`);

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = "Chào bạn, hãy giới thiệu ngắn gọn về bản thân.";

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log("\n>>> THÀNH CÔNG! KẾT QUẢ:");
    console.log(text);
  } catch (error) {
    console.log("\n>>> THẤT BẠI! CHI TIẾT LỖI:");
    console.error(error);
    
    console.log("\n--- HƯỚNG DẪN KHẮC PHỤC ---");
    if (error.message.includes("404")) {
      console.log("1. Lỗi 404: Thường do sai tên Model hoặc API Key không đúng loại.");
      console.log("2. Hãy chắc chắn bạn lấy Key tại: https://aistudio.google.com/");
      console.log("3. KHÔNG dùng Key của Google Cloud Vertex AI.");
    } else if (error.message.includes("API key not valid")) {
      console.log("Key của bạn bị sai hoặc đã bị xóa.");
    }
  }
}

run();