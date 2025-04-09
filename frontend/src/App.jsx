// frontend/src/App.jsx

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://192.168.29.140:5000");

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [hostId, setHostId] = useState("");
  const [availableHosts, setAvailableHosts] = useState([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    socket.on("host-available", (id) => {
      setAvailableHosts(prev => [...prev, id]);
    });

    // Add handler for screen data
    socket.on("screen-data", (data) => {
      if (!canvasRef.current) return;
      
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current.getContext('2d');
        ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
      };
      img.src = data.imageData;
    });

    return () => {
      socket.off("host-available");
      socket.off("screen-data");
    };
  }, []);

  // Set focus on canvas when connection is established
  useEffect(() => {
    if (connected && canvasRef.current) {
      canvasRef.current.focus();
    }
  }, [connected]);

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

    // We need to add a global event listener for keys
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  };

  // Map special keys to robotjs format
  const mapKeyToRobotJs = (key) => {
    const specialKeyMap = {
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right',
      'Backspace': 'backspace',
      'Tab': 'tab',
      'Enter': 'enter',
      'Escape': 'escape',
      'Delete': 'delete',
      'Home': 'home',
      'End': 'end',
      'PageUp': 'pageup',
      'PageDown': 'pagedown',
      'Control': 'control',
      'Alt': 'alt',
      'Shift': 'shift',
      'Meta': 'command', // Windows key or Mac command key
      ' ': 'space'
    };

    return specialKeyMap[key] || key.toLowerCase();
  };

  // Mouse/keyboard event handlers
  const handleMouseMove = (e) => {
    if (!hostId) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    socket.emit("remote-mouse-move", {
      to: hostId,
      x: Math.round(x * screen.width),
      y: Math.round(y * screen.height)
    });
  };

  // Global key handler
  const handleKeyDown = (e) => {
    if (!hostId) return;
    
    // Prevent default browser behavior except for combinations with Ctrl/Meta for browser shortcuts
    if (!(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
    }
    
    const robotKey = mapKeyToRobotJs(e.key);
    console.log("Key pressed:", e.key, "→ RobotJS key:", robotKey);
    
    // Special handling for modifier combinations
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
      const modifiers = [];
      if (e.ctrlKey) modifiers.push("control");
      if (e.altKey) modifiers.push("alt");
      if (e.shiftKey) modifiers.push("shift");
      if (e.metaKey) modifiers.push("command");
      
      socket.emit("remote-key-press", {
        to: hostId,
        key: robotKey,
        modifier: modifiers
      });
    } else {
      socket.emit("remote-key-press", {
        to: hostId,
        key: robotKey
      });
    }
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
        <div style={{ outline: 'none' }} tabIndex={-1}>
          <canvas
            ref={canvasRef}
            width="800"
            height="600"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseClick}
            onContextMenu={handleContextMenu}
            tabIndex={0}
            style={{ 
              border: '1px solid #ccc',
              outline: 'none'  // Remove focus outline
            }}
          />
          <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
            Click on the canvas to focus and enable keyboard control
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
