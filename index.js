require("dotenv").config();

const express = require("express");
const cors = require("cors");
const app = express();

// Raised from the default 100kb so base64-encoded dispute evidence photos (up to 5MB on the client) fit
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      // Local development ports (allow any port 3000-9999)
      /^http:\/\/localhost:[3-9][0-9]{3}$/,
      // Production URLs
      "https://resobridge-dashboard.netlify.app",
      "https://multitenant-resobridge.netlify.app",
      // Render URLs (add your actual Render frontend URL)
      /^https:\/\/.*\.onrender\.com$/,
      "https://resobridge-backend-enal.onrender.com",
    ];

    const isAllowed = allowedOrigins.some((allowed) => {
      if (typeof allowed === "string") {
        return origin === allowed;
      }
      return allowed.test(origin);
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

const authRoutes = require("./routes/v2/auth.routes");
const departmentRoutes = require("./routes/v2/department.routes");
const infrastructureRoutes = require("./routes/v2/infrastructure.routes");
const complaintRoutes = require("./routes/v2/complaint.routes");
const adminRoutes = require("./routes/v2/admin.routes");
const notificationRoutes = require("./routes/v2/notification.routes");
const chatbotRoutes = require("./routes/chatbot.js");
const intelligenceRoutes = require("./routes/intelligence.js");

app.use("/api/v2/auth", authRoutes);
app.use("/api/v2/departments", departmentRoutes);
app.use("/api/v2/infrastructure", infrastructureRoutes);
app.use("/api/v2/complaints", complaintRoutes);
app.use("/api/v2/admin", adminRoutes);
app.use("/api/v2/notifications", notificationRoutes);
app.use("/api/v2/chatbot", chatbotRoutes);
app.use("/api/v2/intelligence", intelligenceRoutes);

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// Wildcard route for 404s
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Fallback error handler for anything a route didn't already catch itself
// (malformed JSON bodies from express.json(), truly unexpected throws).
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ success: false, message: err.message || "Server error." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
