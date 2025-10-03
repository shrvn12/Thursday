const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

let rooms = {}; 
// { roomId: { lastSender: "", text: "", status: {}, uniqueUsers: Set, lastHeartbeat: {}, timestamp: number, creator: string } }

// Helper function to create or get a room
function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { 
      text: "", 
      lastSender: "", 
      status: {},
      uniqueUsers: new Set(),
      lastHeartbeat: {},
      timestamp: Date.now(),
      creator: null
    };
  }
  return rooms[roomId];
}

// Helper function to check if room is full (max 2 users)
function isRoomFull(room) {
  return room.uniqueUsers.size >= 2;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentRoom = null;
  let clientId = null;
  
  // Handle room creation/joining
  socket.on('join-room', (data) => {
    const { room: roomId, client: userId } = data;
    
    if (!roomId || !userId) {
      socket.emit('error', { message: 'Room ID and Client ID are required' });
      return;
    }
    
    currentRoom = roomId;
    clientId = userId;
    
    const room = getOrCreateRoom(roomId);
    
    // Check if room is full
    if (!room.uniqueUsers.has(clientId) && isRoomFull(room)) {
      socket.emit('room-full', { error: "Room is full", full: true });
      return;
    }
    
    // Add user to room
    room.uniqueUsers.add(clientId);
    room.lastHeartbeat[clientId] = Date.now();
    
    // Join socket room
    socket.join(roomId);
    
    // Notify others in room that someone joined
    socket.to(roomId).emit('user-joined', {
      joined: true,
      uniqueUsers: Array.from(room.uniqueUsers),
      userCount: room.uniqueUsers.size
    });
    
    // Send current room state to the new user
    socket.emit('room-state', {
      text: room.text,
      uniqueUsers: Array.from(room.uniqueUsers),
      userCount: room.uniqueUsers.size,
      timestamp: room.timestamp || Date.now()
    });
    
    // Send other user's status if available
    const otherClientId = Object.keys(room.status).find(k => k !== clientId);
    if (otherClientId && room.status[otherClientId]) {
      socket.emit('user-status', { status: room.status[otherClientId] });
    }
  });
  
  // Handle waiting for someone to join (used by room creator)
  socket.on('wait-for-join', (data) => {
    const { room: roomId, client: userId } = data;
    
    if (!roomId || !userId) {
      socket.emit('error', { message: 'Room ID and Client ID are required' });
      return;
    }
    
    currentRoom = roomId;
    clientId = userId;
    
    const room = getOrCreateRoom(roomId);
    
    // Mark this client as the room creator
    if (!room.creator) {
      room.creator = userId;
    }
    
    room.uniqueUsers.add(userId);
    room.lastHeartbeat[userId] = Date.now();
    
    // Join socket room
    socket.join(roomId);
    
    // If there are already other users, notify immediately
    if (room.uniqueUsers.size > 1) {
      socket.emit('user-joined', {
        joined: true,
        uniqueUsers: Array.from(room.uniqueUsers),
        userCount: room.uniqueUsers.size
      });
    }
  });

  // Handle text messages
  socket.on('send-message', (data) => {
    if (!currentRoom || !clientId) {
      socket.emit('error', { message: 'Not connected to a room' });
      return;
    }
    
    const room = getOrCreateRoom(currentRoom);
    
    // Update heartbeat timestamp
    room.lastHeartbeat[clientId] = Date.now();

    // Update text if provided
    if (data.text !== undefined) {
      room.text = data.text;
      room.lastSender = clientId;
      room.timestamp = Date.now();
    }

    // Update status
    if (data.status) {
      room.status[clientId] = data.status;
    }

    // Broadcast message to all other users in the room
    socket.to(currentRoom).emit('message-received', {
      text: room.text,
      timestamp: room.timestamp,
      hasNewContent: true
    });
    
    // Send status update to all other users
    if (data.status) {
      socket.to(currentRoom).emit('user-status', {
        status: data.status,
        userId: clientId
      });
    }
    
    // Confirm message sent
    socket.emit('message-sent', {
      success: true,
      timestamp: room.timestamp
    });
  });

  // Handle emoji sending
  socket.on('send-emoji', (data) => {
    if (!currentRoom || !clientId) {
      socket.emit('error', { message: 'Not connected to a room' });
      return;
    }
    
    const { emoji } = data;
    if (!emoji) {
      socket.emit('error', { message: 'Emoji is required' });
      return;
    }
    
    const room = getOrCreateRoom(currentRoom);
    room.uniqueUsers.add(clientId);
    room.lastHeartbeat[clientId] = Date.now();

    // Send emoji to all other users in the room
    socket.to(currentRoom).emit('emoji-received', { emoji });
    
    // Confirm emoji sent
    socket.emit('emoji-sent', { success: true });
  });

  // Handle heartbeat/status updates
  socket.on('heartbeat', (data) => {
    if (!currentRoom || !clientId) {
      return;
    }
    
    const room = getOrCreateRoom(currentRoom);
    room.lastHeartbeat[clientId] = Date.now();
    
    if (data.status) {
      room.status[clientId] = data.status;
      
      // Broadcast status update to other users
      socket.to(currentRoom).emit('user-status', {
        status: data.status,
        userId: clientId
      });
    }
  });

  // Handle manual disconnect
  socket.on('disconnect-user', () => {
    handleUserDisconnect('manual');
  });
  
  // Handle socket disconnect (network issues, browser close, etc.)
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    handleUserDisconnect('socket_disconnect', reason);
  });
  
  // Helper function to handle user disconnection
  function handleUserDisconnect(type, reason = null) {
    if (!currentRoom || !clientId) {
      return;
    }
    
    const room = rooms[currentRoom];
    if (!room) {
      return;
    }
    
    console.log(`User ${clientId} disconnecting from room ${currentRoom} (${type})`);
    
    // Update status to disconnected
    room.status[clientId] = 'disconnected';
    
    // Remove user from unique users set
    room.uniqueUsers.delete(clientId);
    
    // Leave the socket room
    socket.leave(currentRoom);
    
    // Notify other users in the room about disconnection
    socket.to(currentRoom).emit('user-left', {
      status: 'disconnected',
      userLeft: true,
      remainingUsers: room.uniqueUsers.size,
      userId: clientId
    });
    
    // Clean up heartbeat data
    delete room.lastHeartbeat[clientId];
    delete room.status[clientId];
    
    // If room is empty, mark it for deletion
    if (room.uniqueUsers.size === 0) {
      console.log(`Room ${currentRoom} is now empty, scheduling for deletion`);
      delete rooms[currentRoom];
    }
  }
});

// Function to clean up disconnected users
function cleanupDisconnectedUsers() {
  const now = Date.now();
  const HEARTBEAT_TIMEOUT = 15000; // 15 seconds
  
  Object.keys(rooms).forEach(roomId => {
    const room = rooms[roomId];
    const usersToRemove = [];
    
    // Check for users who haven't sent heartbeat recently
    room.uniqueUsers.forEach(userId => {
      const lastHeartbeat = room.lastHeartbeat[userId] || 0;
      if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
        console.log(`User ${userId} timed out in room ${roomId}`);
        usersToRemove.push(userId);
      }
    });
    
    // Remove timed out users
    usersToRemove.forEach(userId => {
      room.uniqueUsers.delete(userId);
      room.status[userId] = 'disconnected';
      delete room.lastHeartbeat[userId];
      
      // Notify other clients
      room.clients && room.clients.forEach(({ res: clientRes, id }) => {
        if (id !== userId) {
          try {
            clientRes.json({ 
              status: 'disconnected', 
              userLeft: true,
              remainingUsers: room.uniqueUsers.size
            });
          } catch (err) {
            console.error('Error notifying client:', err);
          }
        }
      });
      
      // Clean up client connections for this user
      room.clients = room.clients.filter(c => c.id !== userId);
    });
    
    // Delete empty rooms
    if (room.uniqueUsers.size === 0) {
      console.log(`Deleting empty room ${roomId}`);
      delete rooms[roomId];
    }
  });
}

// Clean up disconnected users every 5 seconds
setInterval(cleanupDisconnectedUsers, 5000);

// Clean up inactive rooms every 5 minutes (additional cleanup)
setInterval(() => {
  const now = Date.now();
  Object.keys(rooms).forEach(roomId => {
    const room = rooms[roomId];
    // Check if all users are disconnected and no recent activity
    const allDisconnected = Object.values(room.status).every(s => s === 'disconnected' || s === 'offline');
    const noRecentActivity = Object.values(room.lastHeartbeat).every(hb => now - hb > 60000); // 1 minute
    
    if ((allDisconnected || room.uniqueUsers.size === 0) && noRecentActivity) {
      console.log(`Cleaning up inactive room ${roomId}`);
      delete rooms[roomId];
    }
  });
}, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = { app, server, io };
