// electron-app/main.js

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const robot = require("robotjs");
const io = require("socket.io-client");
const path = require("path");

let mainWindow;
let socket;
let screenShareInterval = null;
let mode = "host"; // Default mode is host, can be "host" or "controller"

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the HTML file
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Connect to the socket.io server
  socket = io("http://192.168.29.140:5000"); // Change to your server IP if needed

  // Handle connection
  socket.on("connect", () => {
    console.log(`Connected as ${mode} with ID:`, socket.id);
    mainWindow.webContents.send('connection-id', socket.id);
    
    if (mode === "host") {
      socket.emit("host-ready");
    }
  });

  // IPC communication with renderer
  ipcMain.on('change-mode', (event, newMode) => {
    mode = newMode;
    
    // Disconnect and reconnect to update role
    if (socket.connected) {
      socket.disconnect();
    }
    
    // Clear any existing interval
    if (screenShareInterval) {
      clearInterval(screenShareInterval);
      screenShareInterval = null;
    }
    
    // Reconnect with new mode
    socket.connect();
    
    // Update UI
    mainWindow.webContents.send('mode-changed', mode);
  });

  // Handle controller requests
  ipcMain.on('connect-to-host', (event, hostId) => {
    console.log(`Connecting to host: ${hostId}`);
    socket.emit("connect-to-host", hostId);
    
    // Request screen data
    socket.emit("request-screen", {
      to: hostId,
      from: socket.id
    });
    
    mainWindow.webContents.send('status-update', `Connecting to host ${hostId}...`);
  });

  ipcMain.on('send-mouse-move', (event, data) => {
    socket.emit("remote-mouse-move", data);
  });

  ipcMain.on('send-mouse-click', (event, data) => {
    socket.emit("remote-mouse-click", data);
  });

  ipcMain.on('send-key-event', (event, data) => {
    socket.emit("remote-key-event", data);
  });

  ipcMain.on('send-mouse-scroll', (event, data) => {
    socket.emit("remote-mouse-scroll", data);
  });

  // --- HOST MODE HANDLERS ---
  
  // Handle controller connection
  socket.on("controller-connected", (controllerId) => {
    console.log("Controller connected:", controllerId);
    mainWindow.webContents.send('status-update', `Controller ${controllerId} connected`);
  });

  // Start screen sharing when requested
  socket.on("request-screen", async (data) => {
    if (mode !== "host") return;
    
    try {
      console.log("Screen sharing requested by:", data.from);
      mainWindow.webContents.send('status-update', 'Starting screen sharing...');
      
      // Clear any existing interval
      if (screenShareInterval) {
        clearInterval(screenShareInterval);
      }
      
      const { desktopCapturer } = require("electron");
      
      // Function to capture and send screen
      const sendScreen = async () => {
        try {
          const sources = await desktopCapturer.getSources({ 
            types: ['screen'],
            thumbnailSize: { width: 1280, height: 960 }
          });
          
          if (sources.length > 0) {
            // Convert to base64 string with lower quality to reduce bit rate
            const imageDataUrl = sources[0].thumbnail.toDataURL('image/jpeg', 0.6);
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
      
      // Then send updates every 300ms (increased interval to reduce bandwidth)
      screenShareInterval = setInterval(sendScreen, 300);
    } catch (err) {
      console.error("Error setting up screen sharing:", err);
      mainWindow.webContents.send('status-update', 'Screen sharing error: ' + err.message);
    }
  });

  // Handle improved mouse movements from controller
  socket.on("remote-mouse-move", (data) => {
    if (mode !== "host") return;
    
    try {
      const { x, y, screenWidth, screenHeight } = data;
      
      // Get the local screen size
      const { width: localWidth, height: localHeight } = robot.getScreenSize();
      
      // Convert the coordinates proportionally based on the remote screen size
      const scaledX = Math.round((x / screenWidth) * localWidth);
      const scaledY = Math.round((y / screenHeight) * localHeight);
      
      // Move the mouse to the scaled position
      robot.moveMouse(scaledX, scaledY);
    } catch (err) {
      console.error("Error handling mouse move:", err);
    }
  });

  // Handle improved key events (down/up)
  socket.on("remote-key-event", (data) => {
    if (mode !== "host") return;
    
    try {
      const { type, key, modifiers } = data;
      
      // Map keys from browser format to robotjs format
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
        ' ': 'space',
        'Control': 'control',
        'Shift': 'shift',
        'Alt': 'alt',
        'Meta': 'command',
        'CapsLock': 'caps_lock'
      };
      
      // Explicitly define the toggle state as a string value
      const toggleState = (type === 'down') ? 'down' : 'up';
      
      // Special handling for CapsLock
      if (key === 'CapsLock') {
        // Instead of trying to toggle CapsLock (which can be problematic),
        // let's use a key tap approach
        if (type === 'down') {
          robot.keyTap('caps_lock');
        }
        return;
      }
      
      // Get robotjs key
      let robotKey = keyMap[key] || key.toLowerCase();
      
      // Build modifier array
      const activeModifiers = [];
      if (modifiers.shift) activeModifiers.push('shift');
      if (modifiers.control) activeModifiers.push('control');
      if (modifiers.alt) activeModifiers.push('alt');
      if (modifiers.meta) activeModifiers.push('command');
      
      // For modifier keys themselves
      if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
        robot.keyToggle(robotKey, toggleState);
      } 
      // For regular keys with modifiers
      else if (activeModifiers.length > 0 && type === 'down') {
        robot.keyTap(robotKey, activeModifiers);
      } 
      // For regular keys
      else {
        if (type === 'down') {
          robot.keyToggle(robotKey, 'down');
        } else {
          robot.keyToggle(robotKey, 'up');
        }
      }
    } catch (err) {
      console.error(`Error handling key ${type}:`, err);
    }
  });

  // Handle mouse click
  socket.on("remote-mouse-click", (data) => {
    if (mode !== "host") return;
    
    try {
      const { button } = data;
      robot.mouseClick(button || "left");
    } catch (err) {
      console.error("Error handling mouse click:", err);
    }
  });

  // Handle mouse scrolling
  socket.on("remote-mouse-scroll", (data) => {
    if (mode !== "host") return;
    
    try {
      const { deltaY } = data;
      
      // Determine scroll direction
      const direction = deltaY < 0 ? "up" : "down";
      
      // Calculate scroll amount
      const scrollAmount = Math.ceil(Math.abs(deltaY) / 100);
      
      // Execute the scroll
      for (let i = 0; i < scrollAmount; i++) {
        robot.scrollMouse(1, direction);
      }
    } catch (err) {
      console.error("Error handling mouse scroll:", err);
    }
  });

  // --- CONTROLLER MODE HANDLERS ---
  
  // Handle received screen data
  socket.on("screen-data", (data) => {
    mainWindow.webContents.send('screen-data', data.imageData);
  });
  
  socket.on("host-available", (id) => {
    mainWindow.webContents.send('host-available', id);
  });

  // Handle when controller disconnects
  socket.on("controller-disconnected", () => {
    if (screenShareInterval) {
      clearInterval(screenShareInterval);
      screenShareInterval = null;
    }
    mainWindow.webContents.send('status-update', 'Controller disconnected');
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    if (screenShareInterval) {
      clearInterval(screenShareInterval);
      screenShareInterval = null;
    }
    console.log("Disconnected from server");
    mainWindow.webContents.send('status-update', 'Disconnected from server');
  });

  // Handle window close
  mainWindow.on('closed', () => {
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