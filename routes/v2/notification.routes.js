// routes/v2/notification.routes.js
//
// Notifications are created internally (see complaint.routes.js's notify()
// helper) — this file is the read/mutate surface that never existed before:
// list, unread count, mark-read, mark-all-read, delete. Every route is
// scoped to req.user.id via the where clause itself (not a fetch-then-check
// pattern), so there's no separate ownership check to forget.

const express = require("express");
const router = express.Router();
const prisma = require("../../prisma/client");
const { authenticate } = require("../../middleware/authenticate");

router.use(authenticate);

router.get("/", async (req, res) => {
  try {
    const { unreadOnly } = req.query;
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user.id,
        ...(unreadOnly === "true" && { isRead: false }),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return res.json({ success: true, data: notifications });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/unread-count", async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    });
    return res.json({ success: true, data: { unreadCount: count } });
  } catch (error) {
    console.error("Unread notification count error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/read-all", async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return res.json({ success: true, message: "All notifications marked read." });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/:id/read", async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { isRead: true, readAt: new Date() },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }
    return res.json({ success: true, message: "Notification marked read." });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }
    return res.json({ success: true, message: "Notification deleted." });
  } catch (error) {
    console.error("Delete notification error:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
