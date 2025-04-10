// backend/index.js

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // use specific domain in production
    methods: ["GET", "POST"]
  },
  pingInterval: 1000, // More frequent ping
  pingTimeout: 2000, // Shorter ping timeout
  connectTimeout: 10000, // Shorter connection timeout
  maxHttpBufferSize: 5e6, // Limit buffer size to 5MB
  transports: ['websocket'], // Only use websocket for faster connection
  allowUpgrades: false, // Don't allow transport upgrades
  httpCompression: true, // Enable compression
  perMessageDeflate: {
    threshold: 1024, // Only compress messages larger than 1KB
  }
});

app.use(cors());
app.use(express.json());

// Socket handlers
const registerSocketHandlers = require("./socketHandlers/index");
// server.js
io.on("connection", (socket) => {
  console.log("New connection with ID:", socket.id);
  
  // Add to clients map
  clients.set(socket.id, {
    lastActivity: Date.now(),
    role: 'unknown'
  });
  
  // Update client role when they announce as host
  socket.on("host-ready", () => {
    // Update role
    if (clients.has(socket.id)) {
      clients.get(socket.id).role = 'host';
      clients.get(socket.id).lastActivity = Date.now();
    }
    
    // Host computer announces it's ready to accept connections
    socket.broadcast.emit("host-available", socket.id);
  });
  
  // Update activity timestamp on any event
  socket.use(([event, ...args], next) => {
    if (clients.has(socket.id)) {
      clients.get(socket.id).lastActivity = Date.now();
    }
    next();
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

  socket.on("screen-data", (data) => {
    // Forward screen data to the controller using volatile for less overhead
    socket.volatile.to(data.to).emit("screen-data", data);
  });

  // Handle disconnection with improved cleanup
  socket.on("disconnect", (reason) => {
    console.log(`Socket ${socket.id} disconnected, reason: ${reason}`);
    // Remove from clients map
    clients.delete(socket.id);
    // Notify others
    socket.broadcast.emit("controller-disconnected", socket.id);
  });
});

// Set up a periodic check for stale connections (every 30 seconds)
setInterval(() => {
  const now = Date.now();
  clients.forEach((client, id) => {
    // If no activity for 2 minutes, forcibly disconnect
    if (now - client.lastActivity > 120000) {
      console.log(`Cleaning up stale connection: ${id}`);
      const socket = io.sockets.sockets.get(id);
      if (socket) {
        socket.disconnect(true);
      }
      clients.delete(id);
    }
  });
}, 30000);

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
