// frontend/src/App.jsx

import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://192.168.29.140:5000");

function App() {
  const videoRef = useRef(null);
  const [hostId, setHostId] = useState("");
  const [availableHosts, setAvailableHosts] = useState([]);
  const [peerConnection, setPeerConnection] = useState(null);

  useEffect(() => {
    socket.on("host-available", (id) => {
      setAvailableHosts(prev => [...prev, id]);
    });

    socket.on("answer", async (data) => {
      await peerConnection.setRemoteDescription(data.answer);
    });

    socket.on("ice-candidate", async (data) => {
      if (data.candidate) {
        await peerConnection.addIceCandidate(data.candidate);
      }
    });

    return () => {
      socket.off("host-available");
      socket.off("answer");
      socket.off("ice-candidate");
    };
  }, [peerConnection]);

  const connectToHost = async (hostId) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          to: hostId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      videoRef.current.srcObject = event.streams[0];
    };

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", {
      to: hostId,
      offer: offer
    });

    setPeerConnection(pc);
  };

  // Mouse/keyboard event handlers
  const handleMouseMove = (e) => {
    const rect = videoRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    socket.emit("remote-mouse-move", {
      to: hostId,
      x: Math.round(x * screen.width),
      y: Math.round(y * screen.height)
    });
  };

  const handleKeyPress = (e) => {
    socket.emit("remote-key-press", {
      to: hostId,
      key: e.key
    });
  };

  return (
    <div>
      <h2>Remote Control - Controller</h2>
      
      {!hostId && (
        <div>
          <h3>Available Hosts:</h3>
          {availableHosts.map(id => (
            <button key={id} onClick={() => setHostId(id)}>
              Connect to {id}
            </button>
          ))}
        </div>
      )}

      {hostId && !peerConnection && (
        <button onClick={() => connectToHost(hostId)}>
          Start Controlling {hostId}
        </button>
      )}

      <video
        ref={videoRef}
        autoPlay
        width="800"
        height="500"
        onMouseMove={handleMouseMove}
        onKeyDown={handleKeyPress}
        tabIndex={0}
      />
    </div>
  );
}

export default App;
