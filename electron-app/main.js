// electron-app/main.js

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const robot = require("robotjs");
const io = require("socket.io-client");
const path = require("path");

let mainWindow;
let socket;
let screenShareInterval = null;
let mode = "host"; // Default mode is host, can be "host" or "controller"
let lastScreenshotTime = 0;
const SCREEN_THROTTLE = 30;         // Reduced to 30ms
let lastQualityAdjustment = Date.now();
let currentQuality = 0.5;           // Start with medium quality
let currentResolution = { width: 800, height: 450 };  // 16:9 aspect ratio, medium resolution
let reconnectTimer = null;
let connectionAttempts = 0;
let lastSuccessfulScreenUpdate = Date.now();

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

  // Connect to the socket.io server with optimized settings
  socket = io("http://192.168.29.140:5000", {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,          // Increased to 1000ms
    reconnectionDelayMax: 5000,       // Increased to 5000ms
    timeout: 20000,                   // Increased to 20000ms
    transports: ['websocket', 'polling'],  // ADDED polling as fallback
    forceNew: true,                   // Force new connection
    autoConnect: true                 // Auto connect
  });

  // Remove the complex keepalive and just use a simpler approach
  function setupSimpleKeepAlive() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
    }
    
    reconnectTimer = setInterval(() => {
      if (socket && !socket.connected) {
        console.log('Socket disconnected, attempting to reconnect...');
        socket.connect();
      }
    }, 3000);
  }

  // Create a function to attach socket handlers so we can reuse it
  function attachSocketHandlers() {
    // Handle connection
    socket.on("connect", () => {
      console.log(`Connected as ${mode} with ID:`, socket.id);
      mainWindow.webContents.send('connection-id', socket.id);
      connectionAttempts = 0;
      
      if (mode === "host") {
        socket.emit("host-ready");
      }
    });

    // Handle reconnection
    socket.on("reconnect", (attemptNumber) => {
      console.log(`Reconnected after ${attemptNumber} attempts`);
      mainWindow.webContents.send('status-update', `Reconnected to server`);
      
      if (mode === "host") {
        socket.emit("host-ready");
      }
    });

    socket.on("reconnect_attempt", (attemptNumber) => {
      console.log(`Reconnection attempt ${attemptNumber}`);
      mainWindow.webContents.send('status-update', `Reconnecting to server... (${attemptNumber})`);
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

    // Process events immediately for reducing latency
    ipcMain.on('send-mouse-move', (event, data) => {
      if (socket.connected) {
        socket.volatile.emit("remote-mouse-move", data); // Use volatile for mouse moves
      }
    });

    ipcMain.on('send-mouse-click', (event, data) => {
      if (socket.connected) {
        // Use emit instead of volatile for important actions like clicks
        socket.emit("remote-mouse-click", data);
      }
    });

    ipcMain.on('send-key-event', (event, data) => {
      if (socket.connected) {
        socket.emit("remote-key-event", data);
      }
    });

    ipcMain.on('send-mouse-scroll', (event, data) => {
      if (socket.connected) {
        socket.volatile.emit("remote-mouse-scroll", data); // Use volatile for scrolls
      }
    });

    // --- HOST MODE HANDLERS ---
    
    // Handle controller connection
    socket.on("controller-connected", (controllerId) => {
      console.log("Controller connected:", controllerId);
      mainWindow.webContents.send('status-update', `Controller ${controllerId} connected`);
    });

    // Start screen sharing when requested (optimized version)
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
        
        // Function to capture and send screen (with throttling)
        const sendScreen = async () => {
          try {
            // Get screen
            const sources = await desktopCapturer.getSources({ 
              types: ['screen'],
              thumbnailSize: currentResolution
            });
            
            if (sources.length > 0 && socket.connected) {
              // Use current quality setting
              const imageDataUrl = sources[0].thumbnail.toDataURL('image/jpeg', currentQuality);
              
              // Send screen data and track successful update
              socket.emit("screen-data", {
                to: data.from,
                imageData: imageDataUrl
              });
              
              lastSuccessfulScreenUpdate = Date.now();
              
              // Adjust quality and resolution based on success rate
              const now = Date.now();
              if (now - lastQualityAdjustment > 5000) {  // Check every 5 seconds
                lastQualityAdjustment = now;
                
                // If we're having connection issues, reduce quality
                if (now - lastSuccessfulScreenUpdate > 2000) {
                  // Connection issues - reduce quality
                  currentQuality = Math.max(0.3, currentQuality - 0.1);
                  currentResolution = { width: 640, height: 360 };  // Lower resolution
                  console.log("Reducing quality due to connection issues:", currentQuality);
                } else {
                  // Connection is good - gradually increase quality
                  currentQuality = Math.min(0.7, currentQuality + 0.05);
                  currentResolution = { width: 800, height: 450 };  // Better resolution
                  console.log("Increasing quality due to good connection:", currentQuality);
                }
              }
            }
          } catch (err) {
            console.error("Error capturing screen:", err);
          }
        };
        
        // Set up a fixed interval for screen updates - avoid adaptive intervals
        // that might cause timing issues
        screenShareInterval = setInterval(sendScreen, 100);  // Fixed 100ms interval
      } catch (err) {
        console.error("Error setting up screen sharing:", err);
        mainWindow.webContents.send('status-update', 'Screen sharing error: ' + err.message);
      }
    });

    // Handle improved mouse movements from controller with priority
    socket.on("remote-mouse-move", (data) => {
      if (mode !== "host") return;
      
      try {
        const { x, y, screenWidth, screenHeight } = data;
        
        // Get the local screen size
        const { width: localWidth, height: localHeight } = robot.getScreenSize();
        
        // Convert the coordinates proportionally based on the remote screen size
        const scaledX = Math.round((x / screenWidth) * localWidth);
        const scaledY = Math.round((y / screenHeight) * localHeight);
        
        // Move the mouse to the scaled position (priority task)
        setImmediate(() => {
          robot.moveMouse(scaledX, scaledY);
        });
      } catch (err) {
        console.error("Error handling mouse move:", err);
      }
    });

    // Handle improved key events (down/up) with priority
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
        
        // Process keyboard event immediately
        setImmediate(() => {
          // Special handling for CapsLock
          if (key === 'CapsLock') {
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
        });
      } catch (err) {
        console.error(`Error handling key ${type}:`, err);
      }
    });

    // Handle mouse click with priority
    socket.on("remote-mouse-click", (data) => {
      if (mode !== "host") return;
      
      try {
        const { button } = data;
        // Execute click immediately with higher priority
        setImmediate(() => {
          robot.mouseClick(button || "left");
        });
      } catch (err) {
        console.error("Error handling mouse click:", err);
      }
    });

    // Handle mouse scrolling with priority
    socket.on("remote-mouse-scroll", (data) => {
      if (mode !== "host") return;
      
      try {
        const { deltaY } = data;
        
        // Determine scroll direction
        const direction = deltaY < 0 ? "up" : "down";
        
        // Calculate scroll amount (use smaller value for more responsive scrolling)
        const scrollAmount = Math.ceil(Math.abs(deltaY) / 120);
        
        // Execute the scroll with priority
        setImmediate(() => {
          for (let i = 0; i < scrollAmount; i++) {
            robot.scrollMouse(1, direction);
          }
        });
      } catch (err) {
        console.error("Error handling mouse scroll:", err);
      }
    });

    // --- CONTROLLER MODE HANDLERS ---
    
    // Handle received screen data
    socket.on("screen-data", (data) => {
      if (!data || !data.imageData) return;
      
      // Process immediately with high priority
      setImmediate(() => {
        mainWindow.webContents.send('screen-data', data.imageData);
      });
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
      mainWindow.webContents.send('status-update', 'Disconnected from server - will reconnect automatically');
    });

    // Handle connection error
    socket.on("connect_error", (err) => {
      console.error("Connection error:", err.message);
      mainWindow.webContents.send('status-update', `Connection error: ${err.message}. Reconnecting...`);
    });

    // Handle window close
    mainWindow.on('closed', () => {
      if (screenShareInterval) {
        clearInterval(screenShareInterval);
      }
      socket.disconnect();
    });

    // Add a response to heartbeat
    socket.on("heartbeat", () => {
      // Just receiving this keeps the connection alive
      // No need to respond
    });
  }

  // Call this function after creating the socket
  setupSimpleKeepAlive();
  attachSocketHandlers();
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