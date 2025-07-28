const bcrypt = require("bcrypt");

const plainPassword = "waitontheLORD001"; // 🔑 Replace with your desired password
const saltRounds = 10;

bcrypt.hash(plainPassword, saltRounds, (err, hash) => {
  if (err) {
    console.error("Error hashing password:", err);
    return;
  }
  console.log("Hashed Password:", hash);
});
