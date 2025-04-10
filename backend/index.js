// backend/index.js

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 5000,            // INCREASED ping interval (less frequent pings)
  pingTimeout: 10000,            // INCREASED ping timeout (more time to respond)
  connectTimeout: 15000,         // INCREASED connection timeout
  maxHttpBufferSize: 1e7,        // Increased buffer size to 10MB
  transports: ['websocket', 'polling'],  // ADDED polling as fallback
  upgradeTimeout: 10000,         // ADDED longer upgrade timeout
  allowUpgrades: true,           // CHANGED to allow upgrades
  httpCompression: true
});

app.use(cors());
app.use(express.json());

// Replace the clients Map with a simpler approach
const activeHosts = new Set();
const activeControllers = new Set();

// Socket handlers
const registerSocketHandlers = require("./socketHandlers/index");
// server.js
io.on("connection", (socket) => {
  console.log("New connection with ID:", socket.id);
  
  // Simple heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit("heartbeat");
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 5000);
  
  // Host computer announces it's ready to accept connections
  socket.on("host-ready", () => {
    activeHosts.add(socket.id);
    socket.broadcast.emit("host-available", socket.id);
  });

  // Simplified screen data handling (most important for performance)
  socket.on("screen-data", (data) => {
    // Use direct emit for critical screen data
    if (socket.connected) {
      socket.to(data.to).emit("screen-data", data);
    }
  });
  
  // Handle disconnection with basic cleanup
  socket.on("disconnect", (reason) => {
    console.log(`Socket ${socket.id} disconnected, reason: ${reason}`);
    clearInterval(heartbeatInterval);
    activeHosts.delete(socket.id);
    activeControllers.delete(socket.id);
    socket.broadcast.emit("controller-disconnected", socket.id);
  });

  // Update activity timestamp on any event
  socket.use(([event, ...args], next) => {
    if (activeHosts.has(socket.id) || activeControllers.has(socket.id)) {
      next();
    } else {
      console.log(`Cleaning up stale connection: ${socket.id}`);
      socket.disconnect(true);
    }
  });
  
  socket.on("offer", (data) => {
    socket.to(data.to).emit("offer", {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on("answer", (data) => {
    socket.to(data.to).emit("answer", {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.to).emit("ice-candidate", {
      candidate: data.candidate,
      from: socket.id
    });
  });

  socket.on("remote-mouse-move", (data) => {
    socket.to(data.to).emit("remote-mouse-move", data);
  });

  socket.on("remote-mouse-click", (data) => {
    socket.to(data.to).emit("remote-mouse-click", data);
  });

  socket.on("remote-key-press", (data) => {
    socket.to(data.to).emit("remote-key-press", data);
  });

  socket.on("remote-key-event", (data) => {
    socket.to(data.to).emit("remote-key-event", data);
  });

  socket.on("remote-mouse-scroll", (data) => {
    socket.to(data.to).emit("remote-mouse-scroll", data);
  });

  socket.on("connect-to-host", (hostId) => {
    console.log(`Client ${socket.id} wants to connect to host ${hostId}`);
    socket.to(hostId).emit("controller-connected", socket.id);
  });

  socket.on("request-screen", (data) => {
    console.log(`Screen requested from ${data.from} to ${data.to}`);
    socket.to(data.to).emit("request-screen", data);
  });
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
