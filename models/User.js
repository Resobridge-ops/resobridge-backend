const mongoose = require("mongoose");
const bcrypt = require("bcrypt")

const userSchema = new mongoose.Schema({
fullName: { type: String, required: function() { return this.role !== 'admin'; } },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },

  role: { 
    type: String, 
    required: true, 
    enum: ["student", "hallporter", "staff", "admin", "superadmin"] // Separated Hall Porters from General Staff
  }, 

  position: { type: String, 
    // default: null 
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

  resetToken: {
  type: String,
},
resetTokenExpiry: {
  type: Date,
},


});


// userSchema.pre('save', async function (next) {
//   if (!this.isModified('password')) return next(); // only hash if password was changed
//   try {
//     const salt = await bcrypt.genSalt(10);
//     this.password = await bcrypt.hash(this.password, salt);
//     next();
//   } catch (err) {
//     next(err);
//   }
// });

const User = mongoose.model("User", userSchema);
module.exports = User;
