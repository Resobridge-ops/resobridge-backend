const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  role: { 
    type: String, 
    required: true, 
    enum: ["student", "hallporter", "staff", "admin", "superadmin"] // Separated Hall Porters from General Staff
  }, 

  hallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Hall",
    required: function () {
      return this.role === "student" || this.role === "hallporter"; // Hall Porters also need hall assignment
    }
  },

  

  staffId: { 
    type: String, 
    required: function() { return this.role === 'hallporter'; } 
  },

  studentId: { 
    type: String, 
    required: function() { 
      return this.role === 'student' ? true : false; 
    } 
  },
  

  workLocation: { 
    type: String, 
    required: function() { return this.role === "staff"; } // Hall Porters use hallId, but other staff use workLocation
  },
  
  isApproved: { 
    type: Boolean, 
    default: function() { return this.role === 'student'; } 
  },

  otp: { type: String },
  otpExpiry: { type: Date },

  forcePasswordReset: { type: Boolean, default: false },

  resetToken: String,
resetTokenExpiry: Date,


});

const User = mongoose.model("User", userSchema);
module.exports = User;
