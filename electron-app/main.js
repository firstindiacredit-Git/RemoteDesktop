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
      
      // Keep track of the last image to calculate difference
      let lastImageData = null;
      
      // Function to capture and send screen with optimized bit rate
      const sendScreen = async () => {
        try {
          // Maintain high resolution
          const sources = await desktopCapturer.getSources({ 
            types: ['screen'],
            thumbnailSize: { 
              width: 1920,
              height: 1080
            }
          });
          
          if (sources.length > 0) {
            // Reduce quality to lower bit rate but keep resolution
            // The third parameter is quality (0.0-1.0) - lower means less bandwidth
            const imageDataUrl = sources[0].thumbnail.toDataURL('image/jpeg', 0.5);  // Reduced from 0.8 to 0.5
            
            // Only send if there's a significant change or it's been a while
            // This avoids sending redundant frames when screen is static
            if (!lastImageData || lastImageData !== imageDataUrl) {
              socket.emit("screen-data", { 
                to: data.from,
                imageData: imageDataUrl,
                screenWidth: 1920,
                screenHeight: 1080
              });
              
              lastImageData = imageDataUrl;
            }
          }
        } catch (err) {
          console.error("Error capturing screen:", err);
        }
      };
      
      // Send initial screen capture
      await sendScreen();
      
      // Reduce update frequency to save bandwidth
      // Increase interval from 250ms to 400ms (2.5 updates per second instead of 4)
      screenShareInterval = setInterval(sendScreen, 400);
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

  // Handle mouse movement with improved positioning
  socket.on("remote-mouse-move", (data) => {
    try {
      const { x, y, screenWidth, screenHeight } = data;
      
      // Get the local screen size
      const { width: localWidth, height: localHeight } = robot.getScreenSize();
      
      // Convert the coordinates proportionally based on the remote screen size
      const scaledX = Math.round((x / screenWidth) * localWidth);
      const scaledY = Math.round((y / screenHeight) * localHeight);
      
      console.log(`Mouse move: Original(${x},${y}) => Scaled(${scaledX},${scaledY})`);
      
      // Move the mouse to the scaled position
      robot.moveMouse(scaledX, scaledY);
    } catch (err) {
      console.error("Error handling mouse move:", err);
    }
  });

  // Handle improved key events (down/up)
  socket.on("remote-key-event", (data) => {
    try {
      const { type, key, modifiers } = data;
      console.log(`Received key ${type}:`, key, "Modifiers:", JSON.stringify(modifiers));
      
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
          console.log("Tapped caps_lock key");
        }
        win.webContents.send('status-update', `CapsLock tap`);
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
      
      win.webContents.send('status-update', `Key ${type}: ${key}`);
    } catch (err) {
      console.error(`Error handling key ${type}:`, err);
      console.error("Key data:", data);
      win.webContents.send('status-update', `Error with key ${type}: ${data.key} - ${err.message}`);
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

  // Handle mouse scrolling
  socket.on("remote-mouse-scroll", (data) => {
    try {
      const { deltaY } = data;
      
      // In browser wheel events:
      // deltaY > 0 means scroll down, deltaY < 0 means scroll up
      // For robotjs, we need to convert this to direction and amount
      
      // Determine scroll direction
      const direction = deltaY < 0 ? "up" : "down";
      
      // Calculate scroll amount (normalize it to something reasonable)
      // Average wheel delta is around 100-125 per scroll "click"
      const scrollAmount = Math.ceil(Math.abs(deltaY) / 100);
      
      console.log(`Scroll ${direction} by ${scrollAmount}`);
      
      // Execute the scroll
      for (let i = 0; i < scrollAmount; i++) {
        robot.scrollMouse(1, direction);
      }
      
      win.webContents.send('status-update', `Scrolled ${direction}`);
    } catch (err) {
      console.error("Error handling mouse scroll:", err);
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


