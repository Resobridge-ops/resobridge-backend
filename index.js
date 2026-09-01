require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { celebrate, Joi, errors, Segments } = require("celebrate");
const cors = require("cors");
const app = express();
const N8N_WEBHOOK_URL = "https://resobridgestorm.app.n8n.cloud/webhook-test/f6bb51e9-2ff0-4e1d-b1f3-ec336077de0f";


// Middleware to parse incoming JSON requests
// Raised from the default 100kb so base64-encoded dispute evidence photos (up to 5MB on the client) fit
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


// Enable CORS for all routes
// app.use(cors({
//   origin: [
//     "http://localhost:5173", // for local development
//     "http://localhost:5174", // for local development
//     "https://resobridge-dashboard.netlify.app", //  live frontend
//     "https://resobridge-demo.netlify.app"
//   ],
//   credentials: true // only if you're using cookies/sessions/auth
// }));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
         const allowedOrigins = [
       // Local development ports (allow any port 3000-9999)
       /^http:\/\/localhost:[3-9][0-9]{3}$/,
       // Production URLs
       "https://resobridge-dashboard.netlify.app",
       "https://resobridge-demo.netlify.app",
       // Render URLs (add your actual Render frontend URL)
       // /^https:\/\/.*\.onrender\.com$/,
       // "https://resobridge-dashboard.onrender.com",
        /^https:\/\/.*\.onrender\.com$/,
       "https://resobridge-backend-enal.onrender.com"
     ];
    
    // Check if origin matches any allowed pattern
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      return allowed.test(origin);
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));



// Connect to MongoDB using environment variables
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => {
    console.log(`Connected to MongoDB: ${mongoose.connection.name}`);

    // Import models AFTER successful MongoDB connection
    const Complaint = require("./models/Complaint");
    const ResourceAllocation = require("./models/ResourceAllocation");
    const User = require("./models/User");
    const Hall = require("./models/Hall");
    const ComplaintType = require("./models/ComplaintType");
    const sendOTP = require("./utils/sendOTP");
    const adminRoutes = require("./middleware/admin.js");
    const { router: authRoutes, authenticateUser, authorizeRoles, authenticateToken } = require('./middleware/auth');
     const chatbotRoutes = require("./routes/chatbot.js");
    const intelligenceRoutes = require("./routes/intelligence.js");
    const { generateAIResponse } = require("./utils/chatbotAI.js");

    const Otp = require("./models/Otp"); // Import the OTP model
    const PendingHallPorter = require("./models/PendingHallPorter.js"); // Import the PendingHallPorter model
    const PendingStudent = require("./models/PendingStudent.js");
    const PendingAdmin = require("./models/PendingAdmin.js"); // Import the PendingAdmin model
    const Notification = require("./models/Notification.js"); // Import the Notification model
    const multer = require("multer");
    const upload = multer();
    const axios = require("axios");
    const sendResetEmail = require("./utils/sendNewAdminEmail.js");
    const sendResetPasswordEmail = require("./utils/sendResetPassword.js");
    const sendComplaintReceipt = require("./utils/sendComplaintReceipt.js");
    const sendPorterNotification = require("./utils/sendPorterNotification");


    app.use("/auth", authRoutes);
    app.use("/admin", adminRoutes);
    app.use("/chatbot", chatbotRoutes);
    app.use("/intelligence", intelligenceRoutes);

    // User registration endpoint
    app.post("/register", async (req, res) => {
      try {
        const { fullName, email, password, role, hallId, studentId } = req.body;
    
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          return res.status(400).json({ message: "Email already registered" });
        }
    
        // Hash password before saving
        const hashedPassword = await bcrypt.hash(password, 10);
    
        // Save to pending student collection (TTL clears after 10min)
        await PendingStudent.findOneAndUpdate(
          { email },
          {
            fullName,
            email,
            studentId,
            hallId,
            password: hashedPassword,
            role: "student",
          },
          { upsert: true }
        );
    
        return res.status(200).json({
          success: true,
          message: "Student registered successfully. OTP sent to email.",
        });
      } catch (err) {
        console.error("Register Error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
      }
    });
    

    // User login endpoint
    app.post("/login", async (req, res) => {
      const { email, password, role } = req.body; // Get role from frontend

      try {
        const user = await User.findOne({ email });

        if (!user) {
          return res
            .status(400)
            .json({ success: false, message: "User not found" });
        }

        if (user.role !== role) {
          return res.status(400).json({
            success: false,
            message: "Incorrect role selected. Please choose the correct role.",
          });
        }

        // Ensure only approved staff & admins can log in
        if (role !== "student" && !user.approved) {
          return res.status(403).json({
            success: false,
            message: "Your account is pending approval.",
          });
        }
        
        console.log("Plaintext password from frontend:", password);
        console.log("Hashed password in DB:", user.password);

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid email or password" });
          
        }

        const token = jwt.sign(
          { userId: user._id, name: user.fullName, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );
        

        res.status(200).json({
          success: true,
          message: "Login successful",
          token,
          role: user.role,
          userId: user._id, // <--- important
          name: user.fullName,
          email: user.email
        });
        

        

      } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ success: false, message: "Server error, try again later" });
      }

     
    });

    // JWT verification middleware
    

// Middleware to verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // You can now access `req.user` in the next handler
    req.user = decoded;

    next(); // All good, move on to the next middleware or route
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}



    // Route for users to view their complaints
    app.get("/complaints/student/:id", verifyToken, async (req, res) => {
      try {
        const studentId = req.params.id;

        // 🧠 Fetch complaints made by the student
        const complaints = await Complaint.find({ userId: studentId })
          .populate("complaintTypeId", "name") // only populate name of the complaint type
          .populate("hallId", "name") // only populate name of hall
          .sort({ createdAt: -1 }); // newest first

        res.status(200).json({ complaints });
      } catch (err) {
        console.error("Error fetching student complaints:", err);
        res.status(500).json({ message: "Failed to fetch complaints" });
      }
    });


    // app.post('/submit-complaint', authenticateToken,  upload.none(),
    // async (req, res) => {
    //   try {
    //     const {
    //       title,
    //       description,
    //       roomNumber,
    //       category, // ID of category (same as complaintTypeId)
    //        imageUrl
    //        // Pass Firebase file URL here (optional)
    //     } = req.body;
    

    //     if (!title || !description || !roomNumber || !category) {
    //       return res.status(400).json({ error: 'All required fields must be filled' });
    //     }
        
    //      // If hallId isn't in the JWT, fetch it
    // const user = await User.findById(req.user.userId);

    // const newComplaint = new Complaint({
    //   title,
    //   description,
    //   roomNumber,
    //   complaintTypeId: category,
    //   category,
    //   userId: req.user.userId,
    //   hallId: user.hallId, // use user.hallId after querying
    //   imageUrl: imageUrl || null,
    //   status: 'Pending',
    //   votes: 1,
    // });

    //     console.log('req.body:', req.body);

    
    //     const savedComplaint = await newComplaint.save();
    
    //     console.log('Complaint submission body:', req.body);

    //     res.status(201).json({
          
    //       message: 'Complaint submitted successfully',
    //       complaint: savedComplaint
          
    //     });
    
    //   } catch (error) {
    //     console.error('Submit Complaint Error:', error);
    //     res.status(500).json({ error: 'Something went wrong submitting the complaint' });
    //   }
    // });


//     app.post(
//   "/submit-complaint",
//   authenticateToken,
//   upload.none(),
//   async (req, res) => {
//     try {
//       const {
//         title,
//         description,
//         roomNumber,
//         category,
//         imageUrl,
//       } = req.body;

//       if (!title || !description || !roomNumber || !category) {
//         return res
//           .status(400)
//           .json({ error: "All required fields must be filled" });
//       }

//       // Get user details (so we know who submitted)
//       const user = await User.findById(req.user.userId);

//       const newComplaint = new Complaint({
//         title,
//         description,
//         roomNumber,
//         complaintTypeId: category,
//         category,
//         userId: req.user.userId,
//         hallId: user.hallId,
//         imageUrl: imageUrl || null,
//         status: "Pending",
//         votes: 1,
//       });

//       const savedComplaint = await newComplaint.save();

//       // 🔑 Send confirmation email to the student
//       sendComplaintReceipt(
//         user.email,              // student’s email
//         savedComplaint.title,    // complaint title
//         savedComplaint._id       // complaint reference ID
//       );

//       const hallporter = await User.findOne({ hallId: user.hallId, role: "hallporter" });
//       const hall = await Hall.findById(user.hallId);
// const hallName = hall ? hall.name : "Unknown Hall";


// if (hallporter) {
//   await sendPorterNotification(
//     hallporter.email,
//     hallName, // make sure you have this from hallId mapping
//     savedComplaint._id,
//     title,
//     description,
//     roomNumber
//   );
// } else {
//   console.log("❌ No hallporter found for hallId:", user.hallId);
// }

//       res.status(201).json({
//         message: "Complaint submitted successfully",
//         complaint: savedComplaint,
//       });
//     } catch (error) {
//       console.error("Submit Complaint Error:", error);
//       res
//         .status(500)
//         .json({ error: "Something went wrong submitting the complaint" });
//     }
//   }
// );





app.post(
  "/submit-complaint",
  authenticateToken,
  upload.none(),
  async (req, res) => {
    try {
      const {
        title,
        description,
        roomNumber,
        category,
        imageUrl,
      } = req.body;

      if (!title || !description || !roomNumber || !category) {
        return res
          .status(400)
          .json({ error: "All required fields must be filled" });
      }

      const user = await User.findById(req.user.userId);

      // ⭐ Send complaint to n8n instead of saving here
      const n8nResponse = await axios.post(N8N_WEBHOOK_URL, {
        title,
        description,
        roomNumber,
        category,
        imageUrl: imageUrl || null,
        userId: req.user.userId,
        hallId: user.hallId,
      });

      const { status, complaint, error } = n8nResponse.data;

      if (status === "spam") {
        return res.status(400).json({ error: "Complaint flagged as spam" });
      }

      const savedComplaint = complaint; // ⭐ Already saved by n8n

      // Email to student
      sendComplaintReceipt(
        user.email,
        savedComplaint.title,
        savedComplaint._id
      );

      const hallporter = await User.findOne({
        hallId: user.hallId,
        role: "hallporter"
      });

      const hall = await Hall.findById(user.hallId);
      const hallName = hall ? hall.name : "Unknown Hall";

      if (hallporter) {
        await sendPorterNotification(
          hallporter.email,
          hallName,
          savedComplaint._id,
          title,
          description,
          roomNumber
        );
      }

      res.status(201).json({
        message: "Complaint submitted successfully",
        complaint: savedComplaint,
      });

    } catch (error) {
      console.error("Submit Complaint Error:", error);
      res.status(500).json({
        error: "Something went wrong submitting the complaint"
      });
    }
  }
);



    
    
    

   
    // Route for users to view their notifications
    app.get("/notifications/:userId", async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, notifications });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
});

app.get("/notifications/unread-count/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const count = await Notification.countDocuments({ userId, read: false });
    res.json({ unreadCount: count });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ unreadCount: 0 });
  }
});




    app.get("/check-duplicate", verifyToken, async (req, res) => {
      const { category, roomNumber, title } = req.query;

      // Ensure title and other fields are correctly passed and not undefined
      if (!category || !roomNumber || !title) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      try {
        const match = await Complaint.findOne({
          category,
          roomNumber,
          title,
        });

        if (match) {
          return res.json({ exists: true, complaint: match });
        } else {
          return res.json({ exists: false });
        }
      } catch (error) {
        console.error("Error checking duplicate:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Backend - Upvote Logic
    app.post("/upvote-complaint", verifyToken, async (req, res) => {
      const { complaintId } = req.body;

      try {
        const complaint = await Complaint.findById(complaintId);

        if (!complaint) {
          return res.status(404).json({ error: "Complaint not found" });
        }

        // Increment vote count
        complaint.votes += 1;
        await complaint.save();

        return res.json({
          message: "Your vote has been added!",
          votes: complaint.votes,
        });
      } catch (error) {
        console.error("Error upvoting complaint:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // Route for hall porters to view all student requests
    app.get("/porter/requests", verifyToken, async (req, res) => {
      if (req.user.role !== "staff")
        return res.status(403).json({ error: "Unauthorised access" });

      try {
        // Find the hall porter's assigned hall
        const staff = await User.findById(req.user.userId);
        if (!staff || !staff.hallId) {
          return res
            .status(400)
            .json({ error: "Hall ID not found for this porter" });
        }

        // Fetch only requests from students in the same hall
        const complaints = await Complaint.find({ hallId: staff.hallId });
        res.status(200).json({
          message: "Here are all the student requests for your hall",
          requests: complaints,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to retrieve requests" });
      }
    });

    // Route for admin to allocate resources to halls
    app.post("/admin/allocate", verifyToken, async (req, res) => {
      if (req.user.role !== "admin")
        return res.status(403).json({ error: "Unauthorised access" });
      const { resource, quantity, hallId } = req.body;
      try {
        const newAllocation = new ResourceAllocation({
          resource,
          quantity,
          hallId,
        });
        await newAllocation.save();
        res.status(201).json({
          message: `${quantity} units of ${resource} allocated to hall ${hallId}`,
          allocation: newAllocation,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to allocate resources" });
      }
    });

    // Route to view all resource allocations
    app.get("/admin/allocations", verifyToken, async (req, res) => {
      if (req.user.role !== "admin")
        return res.status(403).json({ error: "Unauthorised access" });
      try {
        const allocations = await ResourceAllocation.find();
        res.status(200).json({
          message: "Here are all the resource allocations",
          allocations,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to retrieve allocations" });
      }
    });

    // Route for hall porters to update request status
    // app.patch("/porter/request/:studentId", verifyToken, async (req, res) => {
    //   if (req.role !== "staff")
    //     return res.status(403).json({ error: "Unauthorised access" });
    //   const { studentId } = req.params;
    //   const { status } = req.body;
    //   try {
    //     const request = await Complaint.findOneAndUpdate(
    //       { studentId },
    //       { status },
    //       { new: true }
    //     );
    //     if (request) {
    //       res.status(200).json({
    //         message: `Request status for student ${studentId} updated to '${status}'`,
    //         request,
    //       });
    //     } else {
    //       res
    //         .status(404)
    //         .json({ message: `Request for student ${studentId} not found` });
    //     }
    //   } catch (error) {
    //     res.status(500).json({ error: "Failed to update request status" });
    //   }
    // });

    // Route to get all halls
    app.get("/halls", async (req, res) => {
      try {
        const halls = await Hall.find();
        const mongoose = require("mongoose");

        console.log("Connected to Database:", mongoose.connection.name);

        console.log("Halls retrieved:", halls); // Debugging log
        res.status(200).json({halls});
      } catch (error) {
        console.error("Error fetching halls:", error);
        res.status(500).json({ error: "Failed to retrieve halls" });
      }
    });

    app.get("/halls/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid hall ID" });
    }

    const hall = await Hall.findById(req.params.id);
    if (!hall) {
      return res.status(404).json({ success: false, message: "Hall not found" });
    }

    console.log("Hall retrieved:", hall); // Debugging log
    res.status(200).json({ success: true, hall });
  } catch (error) {
    console.error("Error fetching hall:", error);
    res.status(500).json({ success: false, message: "Server error"  });
  }
});

//     app.get("/complaints/hall/:hallId", async (req, res) => {
//   try {
//     const { hallId } = req.params;

//     // Validate ObjectId
//     if (!mongoose.Types.ObjectId.isValid(hallId)) {
//       return res.status(400).json({ error: "Invalid hall ID" });
//     }

//     const complaints = await Complaint.find({ hall: hallId }).sort({ createdAt: -1 });

//     console.log(`Complaints for hall ${hallId}:`, complaints);
//     res.status(200).json(complaints);
//   } catch (error) {
//     console.error("Error fetching complaints by hall:", error);
//     res.status(500).json({ error: "Server error" });
//   }
// });


    app.get("/complaints/hall/:hallId", async (req, res) => {
  try {
    const { hallId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(hallId)) {
      return res.status(400).json({ error: "Invalid hall ID" });
    }

    const complaints = await Complaint.find({
      hallId: new mongoose.Types.ObjectId(req.params.hallId),
    }).populate("complaintTypeId").sort({ createdAt: -1 });

    console.log(`Complaints for hall ${hallId}:`, complaints);
    res.status(200).json({ data: complaints }); // wrap in `data` to match frontend usage
  } catch (error) {
    console.error("Error fetching complaints by hall:", error);
    res.status(500).json({ error: "Server error" });
  }
});


app.get("/complaints/by-hall", async (req, res) => {
  try {
    const complaintCounts = await Complaint.aggregate([
      {
        $group: {
          _id: "$hall", // group by hall ID
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "halls", // collection name in lowercase & plural
          localField: "_id",
          foreignField: "_id",
          as: "hallInfo",
        },
      },
      {
        $unwind: "$hallInfo",
      },
      {
        $project: {
          _id: 0,
          hallId: "$hallInfo._id",
          hallName: "$hallInfo.name",
          count: 1,
        },
      },
      {
        $sort: { count: -1 } // Optional: most complaints first
      }
    ]);

    res.status(200).json(complaintCounts);
  } catch (error) {
    console.error("Error getting complaints by hall:", error);
    res.status(500).json({ error: "Server error" });
  }
});



    // Route to get all complaint types
    app.get("/complaint-types", async (req, res) => {
      try {
        const complaintTypes = await ComplaintType.find();
        console.log("Complaint Types Found:", complaintTypes); 

        if (!complaintTypes.length) {
          return res.status(404).json({ error: "No complaint types found" });
        }

        // Debugging Line
        res.status(200).json(complaintTypes);

      } catch (error) {
        console.error("Error fetching complaint types:", error); // Debugging Line
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to fetch complaint types" }); // ✅ only send if not already sent
        }
      }
    });

    app.post("/send-otp", async (req, res) => {
      const { email } = req.body;
      const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate 6-digit OTP
      const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 mins

      try {
        // Remove any previous OTP for this email
        await Otp.deleteOne({ email });

        const hashedOTP = await bcrypt.hash(otp, 10);

        // Save new OTP in separate OTP collection
        await Otp.create({ email, otp: hashedOTP, otpExpiry });

        console.log(`Generated OTP for ${email}: ${otp}`); // ✅ Log OTP to terminal

        // Send the OTP to user's email
        await sendOTP(email, otp);

        res.json({ success: true, message: "OTP sent successfully!" });
      } catch (error) {
        console.error("Error sending OTP:", error);
        res.status(500).json({ success: false, message: "Failed to send OTP" });
      }
    });

    app.post("/verify-otp", async (req, res) => {
      const { email, otp, role } = req.body;
    
      if (!role) {
        return res.status(400).json({ success: false, message: "Role is required" });
      }
    
      try {
        console.log("Request Body:", req.body);
    
        // 1. Check if OTP exists and is valid
        const otpRecord = await Otp.findOne({ email });
        console.log("OTP Record:", otpRecord);
    
        if (!otpRecord) {
          return res.status(400).json({ success: false, message: "OTP not requested or expired" });
        }
    
        if (otpRecord.otpExpiry < new Date()) {
          await Otp.deleteOne({ email });
          return res.status(400).json({
            success: false,
            message: "OTP expired, request a new one",
          });
        }
    
        const isMatch = await bcrypt.compare(otp, otpRecord.otp);
        if (!isMatch) {
          return res.status(400).json({ success: false, message: "Invalid OTP" });
        }
    
        // ✅ STUDENT FLOW
        if (role === "student") {
          const pendingStudent = await PendingStudent.findOne({ email });
          if (!pendingStudent) {
            return res.status(400).json({
              success: false,
              message: "No pending student registration found",
            });
          }
    
          const newUser = new User({
            email,
            fullName: pendingStudent.fullName,
            password: pendingStudent.password,
            role: "student",
            studentId: pendingStudent.studentId,
            hallId: pendingStudent.hallId,
          });
          await newUser.save();
    
          await PendingStudent.deleteOne({ email });
          await Otp.deleteOne({ email });
    
          const token = jwt.sign(
            { userId: newUser._id, role: "student", name: newUser.fullName },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
          );
    
          return res.json({
            success: true,
            message: "Student successfully verified and registered!",
            token,
          });
        }
    
        // ✅ HALL PORTER FLOW
        if (role === "hallporter") {
          const userData = await User.findOne({ email });
    
          if (!userData) {
            return res.status(404).json({ message: "User not found" });
          }
    
          await PendingHallPorter.create({
            email,
            fullName: userData.fullName,
            phoneNumber: userData.phoneNumber,
            staffId: userData.staffId,
            hallId: userData.hallId,
            requestDate: new Date(),
          });
    
          await Otp.deleteOne({ email });
          return res.json({
            success: true,
            message: "OTP verified. Hall porter request is now pending admin approval.",
          });
        }
    
        // ✅ ADMIN FLOW
        if (role === "admin") {
          await User.updateOne({ email }, { isApproved: true });
        }      


        return res.status(400).json({ success: false, message: "Role not recognized" });
      } catch (error) {
        console.error("OTP Verification Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });
    

 



    app.post("/resend-otp", async (req, res) => {
      const { email } = req.body;

      try {
        // 1. Check if user is already verified
        const existingUser = await User.findOne({ email });
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: "User already verified and registered",
          });
        }

        // 2. Check for existing valid OTP
        let otpRecord = await Otp.findOne({ email });
        if (otpRecord && otpRecord.otpExpiry > new Date()) {
          // Resend existing OTP

          console.log(
            `Re-sending existing OTP to ${email}: ${otpRecord.plainOtp || "[hidden]"
            }`
          );
          return res.json({
            success: true,
            message: "OTP resent successfully",
          });
        }

        // 3. Create and send new OTP
        const plainOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedOtp = await bcrypt.hash(plainOtp, 10);
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Replace existing or insert new
        await Otp.findOneAndUpdate(
          { email },
          { otp: hashedOtp, otpExpiry, plainOtp }, // You may want to store plain OTP temporarily for testing
          { upsert: true }
        );

        // TODO: Replace this with actual email sending logic
        await sendOTP(email, plainOtp);
        console.log(`New OTP for ${email}: ${plainOtp}`);

        res.json({ success: true, message: "OTP resent successfully" });
      } catch (error) {
        console.error("Resend OTP Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    
    // Example route for superadmins
    app.get(
      "/superadmin-dashboard",
      authenticateUser,
      authorizeRoles("superadmin"),
      (req, res) => {
        res.json({ message: "Welcome to the superadmin dashboard" });
      }
    );
    // Example route for admins
    app.get(
      "/admin-dashboard",
      authenticateUser,
      authorizeRoles("admin", "superadmin"),
      (req, res) => {
        res.json({ message: "Welcome to the admin dashboard" });
      }
    );

    // Example route for staff
    app.get(
      "/staff-dashboard",
      authenticateUser,
      authorizeRoles("staff", "admin", "superadmin"),
      (req, res) => {
        res.json({ message: "Welcome to the staff dashboard" });
      }
    );

    // Example route for students
    app.get(
      "/student-dashboard",
      authenticateUser,
      authorizeRoles("student"),
      (req, res) => {
        res.json({ message: "Welcome to the student dashboard" });
      }
    );

    // Super Admin Only Route
    app.post("/create-admin",
      authenticateUser,
      authorizeRoles("superadmin"),
      async (req, res) => {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = new User({
          email,
          password: hashedPassword,
          role: "admin",
        });
        await newAdmin.save();

        res.json({ message: "Admin account created successfully" });
      }
    );

    // Endpoint to get dashboard stats
app.get('/stats', async (req, res) => {
  try {
    const totalStaff = await User.countDocuments({role: "hallporter"});
    const PendingApprovals = await PendingHallPorter.countDocuments();
    const PendingComplaints = await Complaint.countDocuments({ status: 'Pending' });
    const resolvedComplaints = await Complaint.countDocuments({ status: 'Resolved' });

    res.json({
      totalStaff,
      PendingComplaints,
      resolvedComplaints,
      PendingApprovals
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.patch('/profile', verifyToken, async (req, res) => {
  let allowedFields = [];

  if (req.user.role === 'student') {
    allowedFields = ['fullName', 'email', 'hall', 'roomNo'];
  } else if (req.user.role === 'hallporter') {
    allowedFields = ['fullName', 'email']; // no hall or roomNo
  } else if (req.user.role === 'admin') {
    allowedFields = ['fullName', 'email']; // no hall or roomNo either
  } else {
    return res.status(403).json({ message: 'Role not authorized to update profile' });
  }

  const updates = Object.keys(req.body);
  const isValid = updates.every(field => allowedFields.includes(field));
  if (!isValid) return res.status(400).json({ message: 'Invalid fields for your role' });

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    updates.forEach(field => {
      user[field] = req.body[field];
    });

    await user.save();
    res.json({ message: 'Profile updated successfully', user });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


app.post('/profile/change-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ message: 'Both current and new password required' });

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ message: 'Incorrect current password' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password updated successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


    

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "No account with that email" });

    const token = jwt.sign(
          { userId: user._id, name: user.fullName, role: user.role },
          // { userId: user._id },
          process.env.JWT_SECRET,
          { expiresIn: "1h" }
        );
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 1000 * 60 * 10; // 10 min
    await user.save();

    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${token}&email=${email}`;
    await sendResetPasswordEmail(email, resetLink);

    res.json({ message: "Reset link sent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error sending reset email" });
  }
});

// app.post("/reset-password", async (req, res) => {
//   const { email, token, newPassword } = req.body;

//   try {
//     const user = await User.findOne({ email, resetToken: token });

//     if (!user || user.resetTokenExpiry < Date.now()) {
//       return res.status(400).json({ message: "Token is invalid or expired" });
//     }

//     user.password = newPassword;
//     user.resetToken = undefined;
//     user.resetTokenExpiry = undefined;
//     await user.save();

//     const hashedPassword = await bcrypt.hash(newPassword, 10);
// user.password = hashedPassword;


//     res.json({ message: "Password reset successful" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Error resetting password" });
//   }
// });

app.post("/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;

  try {
    const user = await User.findOne({ email, resetToken: token });

    if (!user || user.resetTokenExpiry < Date.now()) {
      return res.status(400).json({ message: "Token is invalid or expired" });
    }

    // hash before save (if no pre-save hook in model)
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    // clear reset fields
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;

    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error resetting password" });
  }
});


app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});


// Route to update complaint status
// This route allows hall porters or admins to update the status of a complaint

app.patch('/complaints/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required' });
  }

  try {
    const updated = await Complaint.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    console.log(`Complaint ${id} status updated to "${status}"`);
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update complaint status failed:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Route for a student to confirm a resolution and close out their own complaint
app.put('/complaints/:id/confirm', verifyToken, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorised access' });
  }

  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    if (complaint.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorised access' });
    }

    if (complaint.status !== 'Awaiting Confirmation') {
      return res.status(400).json({ error: 'Complaint is not awaiting confirmation' });
    }

    complaint.status = 'Resolved';
    await complaint.save();

    return res.json({ success: true, message: 'Complaint confirmed as resolved', complaint });
  } catch (err) {
    console.error('Confirm complaint failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Route for a student to dispute a resolution on their own complaint
app.put('/complaints/:id/dispute', verifyToken, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorised access' });
  }

  const { reason, evidence } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A reason is required to dispute a complaint' });
  }

  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    if (complaint.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorised access' });
    }

    if (complaint.status !== 'Awaiting Confirmation') {
      return res.status(400).json({ error: 'Complaint is not awaiting confirmation' });
    }

    complaint.status = 'Disputed';
    complaint.disputeReason = reason.trim();
    if (evidence) complaint.disputeEvidence = evidence;
    complaint.disputedAt = new Date();
    await complaint.save();

    return res.json({ success: true, message: 'Complaint disputed', complaint });
  } catch (err) {
    console.error('Dispute complaint failed:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});




// ✅ Add the route logger here
// app._router.stack.forEach((r) => {
//   if (r.route && r.route.path) {
//     console.log("Registered route:", r.route.path);
//   }
// });


// Wildcard route for 404 errors
    app.use("*", (req, res) => {
      res.status(404).json({ error: "Route not found" });
    });

    app.use(errors()); // Celebrate error handling middleware
  })
  .catch((err) => console.error("MongoDB connection error:", err));


// Use environment variable for JWT_SECRET
const jwtSecret = process.env.JWT_SECRET;

// Use environment variable for PORT
const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

