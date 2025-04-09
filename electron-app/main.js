// electron-app/robotjsControl.js

const { app, BrowserWindow, desktopCapturer } = require("electron");
const robot = require("robotjs");
const io = require("socket.io-client");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the HTML file
  win.loadFile(path.join(__dirname, 'index.html'));

  // Connect to the socket.io server
  const socket = io("http://192.168.29.140:5000"); // Change to your server IP if needed
  let screenShareInterval = null;

  // Handle connection
  socket.on("connect", () => {
    console.log("Connected as host with ID:", socket.id);
    win.webContents.send('connection-id', socket.id);
    socket.emit("host-ready");
  });

  // Handle controller connection
  socket.on("controller-connected", (controllerId) => {
    console.log("Controller connected:", controllerId);
    win.webContents.send('status-update', `Controller ${controllerId} connected`);
  });

  // Start screen sharing when requested
  socket.on("request-screen", async (data) => {
    try {
      console.log("Screen sharing requested by:", data.from);
      win.webContents.send('status-update', 'Starting screen sharing...');
      
      // Clear any existing interval
      if (screenShareInterval) {
        clearInterval(screenShareInterval);
      }
      
      // Function to capture and send screen
      const sendScreen = async () => {
        try {
          const sources = await desktopCapturer.getSources({ 
            types: ['screen'],
            thumbnailSize: { width: 800, height: 600 }
          });
          
          if (sources.length > 0) {
            // Convert to base64 string to send via socket.io
            const imageDataUrl = sources[0].thumbnail.toDataURL();
            socket.emit("screen-data", { 
              to: data.from,
              imageData: imageDataUrl
            });
          }
        } catch (err) {
          console.error("Error capturing screen:", err);
        }
      };
      
      // Send initial screen capture
      await sendScreen();
      
      // Then send updates every 200ms
      screenShareInterval = setInterval(sendScreen, 200);
    } catch (err) {
      console.error("Error setting up screen sharing:", err);
      win.webContents.send('status-update', 'Screen sharing error: ' + err.message);
    }
  });

  // Handle when controller disconnects
  socket.on("controller-disconnected", () => {
    if (screenShareInterval) {
      clearInterval(screenShareInterval);
      screenShareInterval = null;
    }
    win.webContents.send('status-update', 'Controller disconnected');
  });

  // Handle mouse movement
  socket.on("remote-mouse-move", (data) => {
    try {
      const { x, y } = data;
      robot.moveMouse(x, y);
    } catch (err) {
      console.error("Error handling mouse move:", err);
    }
  });

  // Handle key press
  socket.on("remote-key-press", (data) => {
    try {
      const { key, modifier } = data;
      
      if (modifier && modifier.length > 0) {
        // Handle key combinations with modifiers
        robot.keyTap(key, modifier);
        console.log(`Key ${key} pressed with modifiers: ${modifier.join(', ')}`);
      } else {
        // Handle single key press
        robot.keyTap(key);
        console.log(`Key ${key} pressed`);
      }
    } catch (err) {
      console.error("Error handling key press:", err);
      console.error("Key data:", data);
    }
  });

  // Handle mouse click
  socket.on("remote-mouse-click", (data) => {
    try {
      const { button } = data;
      robot.mouseClick(button || "left");
    } catch (err) {
      console.error("Error handling mouse click:", err);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    if (screenShareInterval) {
      clearInterval(screenShareInterval);
      screenShareInterval = null;
    }
    console.log("Disconnected from server");
    win.webContents.send('status-update', 'Disconnected from server');
  });

  // Handle window close
  win.on('closed', () => {
    if (screenShareInterval) {
      clearInterval(screenShareInterval);
    }
    socket.disconnect();
  });
}

// Initialize the app when Electron is ready
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

module.exports = { createWindow };