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
      const { key } = data;
      console.log("Received key press:", key);
      
      // Map keys from browser format to robotjs format
      let robotKey = key;
      let modifiers = [];
      
      // Special key mapping
      const keyMap = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'Backspace': 'backspace',
        'Delete': 'delete',
        'Enter': 'enter',
        'Tab': 'tab',
        'Escape': 'escape',
        'Home': 'home',
        'End': 'end',
        'PageUp': 'pageup',
        'PageDown': 'pagedown',
        ' ': 'space'
      };
      
      // Handle modifier keys
      if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') {
        // For modifier keys, we simulate pressing them with another key
        if (key === 'Control') {
          modifiers.push('control');
          robotKey = 'a'; // Just a placeholder key, will be released immediately
        } else if (key === 'Alt') {
          modifiers.push('alt');
          robotKey = 'a';
        } else if (key === 'Shift') {
          modifiers.push('shift');
          robotKey = 'a';
        } else if (key === 'Meta') { // Windows key
          modifiers.push('command');
          robotKey = 'a';
        }
      } 
      // Handle complex key combinations like Ctrl+C
      else if (key.length > 1 && key.includes('+')) {
        const parts = key.split('+');
        robotKey = parts[parts.length - 1].toLowerCase();
        
        if (key.includes('Control+')) modifiers.push('control');
        if (key.includes('Alt+')) modifiers.push('alt');
        if (key.includes('Shift+')) modifiers.push('shift');
        if (key.includes('Meta+')) modifiers.push('command');
      }
      // Handle special keys
      else if (keyMap[key]) {
        robotKey = keyMap[key];
      } 
      // Handle regular keys
      else if (key.length === 1) {
        robotKey = key.toLowerCase();
      }
      
      console.log(`Sending to robotjs: key=${robotKey}, modifiers=${modifiers.join(',')}`);
      
      if (modifiers.length > 0) {
        robot.keyTap(robotKey, modifiers);
      } else {
        robot.keyTap(robotKey);
      }
      
      win.webContents.send('status-update', `Key pressed: ${key}`);
    } catch (err) {
      console.error("Error handling key press:", err);
      console.error("Key data:", data);
      win.webContents.send('status-update', `Error with key: ${data.key} - ${err.message}`);
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