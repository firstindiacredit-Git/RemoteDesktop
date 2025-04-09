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
  }
});

app.use(cors());
app.use(express.json());

// Socket handlers
const registerSocketHandlers = require("./socketHandlers/index");
// server.js
io.on("connection", (socket) => {
  console.log("New connection with ID:", socket.id);

  socket.on("host-ready", () => {
    // Host computer announces it's ready to accept connections
    socket.broadcast.emit("host-available", socket.id);
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
});


const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
