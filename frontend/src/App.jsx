// frontend/src/App.jsx

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://192.168.29.140:5000");

function App() {
  const canvasRef = useRef(null);
  const [hostId, setHostId] = useState("");
  const [availableHosts, setAvailableHosts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [modifierKeys, setModifierKeys] = useState({
    shift: false,
    control: false,
    alt: false,
    meta: false,
    capsLock: false
  });
  const [connectionQuality, setConnectionQuality] = useState('Connecting...');
  const frameTimeRef = useRef({ lastFrameTime: 0, frameCount: 0, fps: 0 });

  useEffect(() => {
    socket.on("host-available", (id) => {
      setAvailableHosts(prev => [...prev, id]);
    });

    // Add handler for screen data with optimized rendering
    socket.on("screen-data", (data) => {
      if (!canvasRef.current) return;
      
      const img = new Image();
      img.onload = () => {
        // Get canvas context
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for better performance
        
        // Set canvas size on first frame or resolution change
        if (data.screenWidth && data.screenHeight && 
            (canvas.width !== data.screenWidth || canvas.height !== data.screenHeight)) {
          canvas.width = data.screenWidth;
          canvas.height = data.screenHeight;
          
          // Apply smooth image rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // Apply CSS scaling
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.maxHeight = '85vh';
        }
        
        // Draw the image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      
      // Error handling for image loading
      img.onerror = (err) => {
        console.error("Error loading screen image:", err);
      };
      
      img.src = data.imageData;
    });

    // Global key handlers
    const handleKeyDown = (e) => {
      if (!hostId) return;
      
      // Track modifier key states
      if (e.key === 'Shift') {
        setModifierKeys(prev => ({...prev, shift: true}));
      } else if (e.key === 'Control') {
        setModifierKeys(prev => ({...prev, control: true}));
      } else if (e.key === 'Alt') {
        setModifierKeys(prev => ({...prev, alt: true}));
      } else if (e.key === 'Meta') { // Windows key
        setModifierKeys(prev => ({...prev, meta: true}));
      } else if (e.key === 'CapsLock') {
        setModifierKeys(prev => ({...prev, capsLock: !prev.capsLock}));
      }
      
      // Prevent defaults to avoid browser actions
      e.preventDefault();
      
      console.log("Key down:", e.key, "Modifiers:", 
        `Shift:${e.shiftKey}, Ctrl:${e.ctrlKey}, Alt:${e.altKey}, Meta:${e.metaKey}, CapsLock:${e.getModifierState('CapsLock')}`);
      
      // Send key event with all necessary information
      socket.emit("remote-key-event", {
        to: hostId,
        type: "down",
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        modifiers: {
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey,
          capsLock: e.getModifierState('CapsLock')
        }
      });
    };
    
    const handleKeyUp = (e) => {
      if (!hostId) return;
      
      // Track modifier key states
      if (e.key === 'Shift') {
        setModifierKeys(prev => ({...prev, shift: false}));
      } else if (e.key === 'Control') {
        setModifierKeys(prev => ({...prev, control: false}));
      } else if (e.key === 'Alt') {
        setModifierKeys(prev => ({...prev, alt: false}));
      } else if (e.key === 'Meta') { // Windows key
        setModifierKeys(prev => ({...prev, meta: false}));
      }
      
      // Prevent defaults to avoid browser actions
      e.preventDefault();
      
      console.log("Key up:", e.key);
      
      // Send key up event
      socket.emit("remote-key-event", {
        to: hostId,
        type: "up",
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        modifiers: {
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey,
          capsLock: e.getModifierState('CapsLock')
        }
      });
    };
    
    // Add global keyboard listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    return () => {
      socket.off("host-available");
      socket.off("screen-data");
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const connectToHost = (id) => {
    setHostId(id);
    setConnected(true);
    
    // Tell the host we want to connect
    socket.emit("connect-to-host", id);
    
    // Request screen data
    socket.emit("request-screen", {
      to: id,
      from: socket.id
    });
    
    // Activate keyboard
    setKeyboardActive(true);
  };

  // Mouse handlers
  const handleMouseMove = (e) => {
    if (!hostId) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Send absolute position and canvas dimensions
    socket.emit("remote-mouse-move", {
      to: hostId,
      x: x,
      y: y,
      screenWidth: rect.width,
      screenHeight: rect.height
    });
  };

  const handleMouseClick = (e) => {
    e.preventDefault(); // Prevent default browser behavior
    if (!hostId) return;
    
    console.log("Mouse clicked:", e.button); // Debugging
    
    let button = "left";
    if (e.button === 1) button = "middle";
    if (e.button === 2) button = "right";
    
    socket.emit("remote-mouse-click", {
      to: hostId,
      button: button
    });
  };

  // Prevent context menu on right-click
  const handleContextMenu = (e) => {
    e.preventDefault();
    return false;
  };

  const handleMouseWheel = (e) => {
    if (!hostId) return;
    
    // Prevent default scrolling
    e.preventDefault();
    
    // Get scroll direction and amount
    const delta = e.deltaY || e.detail || e.wheelDelta;
    
    console.log("Mouse scroll:", delta);
    
    socket.emit("remote-mouse-scroll", {
      to: hostId,
      deltaY: delta
    });
  };

  // Add this inside the screen-data handler to monitor performance
  socket.on("screen-data", (data) => {
    // Calculate and update FPS (frames per second)
    const now = performance.now();
    const frameTime = frameTimeRef.current;
    
    if (now - frameTime.lastFrameTime >= 1000) {
      // Update connection quality indicator based on FPS
      const fps = frameTime.frameCount;
      frameTime.fps = fps;
      frameTime.frameCount = 0;
      frameTime.lastFrameTime = now;
      
      let quality = 'Poor';
      if (fps >= 5) quality = 'Good';
      else if (fps >= 2) quality = 'Fair';
      
      setConnectionQuality(`${quality} (${fps} FPS)`);
    } else {
      frameTime.frameCount++;
    }
  });

  return (
    <div>
      <h2>Remote Control - Controller</h2>
      
      {!hostId && (
        <div>
          <h3>Available Hosts:</h3>
          {availableHosts.map(id => (
            <button key={id} onClick={() => connectToHost(id)}>
              Connect to {id}
            </button>
          ))}
        </div>
      )}

      {connected && (
        <div style={{ width: '100%', maxWidth: '1920px', margin: '0 auto' }}>
          <div style={{ 
            padding: '5px 10px', 
            backgroundColor: '#f0f0f0', 
            borderRadius: '4px',
            margin: '5px 0',
            fontSize: '14px'
          }}>
            Connection: {connectionQuality}
          </div>
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseClick}
            onContextMenu={handleContextMenu}
            onWheel={handleMouseWheel}
            style={{ 
              border: '1px solid #ccc',
              width: '100%',
              height: 'auto'
            }}
          />
          
          <div style={{ 
            marginTop: '10px', 
            padding: '8px', 
            backgroundColor: keyboardActive ? '#e6ffe6' : '#ffe6e6',
            borderRadius: '4px'
          }}>
            <strong>Keyboard status:</strong> {keyboardActive ? 'Active - Press any key' : 'Not active'}
            <div style={{marginTop: '5px'}}>
              <span style={{
                padding: '3px 6px',
                margin: '0 3px',
                backgroundColor: modifierKeys.shift ? '#007bff' : '#e6e6e6',
                color: modifierKeys.shift ? 'white' : 'black',
                borderRadius: '3px'
              }}>Shift</span>
              
              <span style={{
                padding: '3px 6px',
                margin: '0 3px',
                backgroundColor: modifierKeys.control ? '#007bff' : '#e6e6e6',
                color: modifierKeys.control ? 'white' : 'black',
                borderRadius: '3px'
              }}>Ctrl</span>
              
              <span style={{
                padding: '3px 6px',
                margin: '0 3px',
                backgroundColor: modifierKeys.alt ? '#007bff' : '#e6e6e6',
                color: modifierKeys.alt ? 'white' : 'black',
                borderRadius: '3px'
              }}>Alt</span>
              
              <span style={{
                padding: '3px 6px',
                margin: '0 3px',
                backgroundColor: modifierKeys.capsLock ? '#007bff' : '#e6e6e6',
                color: modifierKeys.capsLock ? 'white' : 'black',
                borderRadius: '3px'
              }}>Caps</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
