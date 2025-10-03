const express = require("express");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

let rooms = {}; 
// { roomId: { lastSender: "", text: "", status: {}, clients: [], joinWaiters: [], uniqueUsers: Set } }

// Helper function to create or get a room
function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { 
      text: "", 
      lastSender: "", 
      status: {},
      clients: [], 
      joinWaiters: [],
      uniqueUsers: new Set(),
      lastHeartbeat: {} // Track last heartbeat for each user
    };
  }
  return rooms[roomId];
}

// Helper function to check if room is full (max 2 users)
function isRoomFull(room) {
  return room.uniqueUsers.size >= 2;
}

// Endpoint to check if someone joined your room
app.get("/check-join", (req, res) => {
  const roomId = req.query.room;
  const clientId = req.query.client;
  
  // Check if room exists and was created by this client recently
  if (!rooms[roomId]) {
    // Only create room if this appears to be the room creator
    rooms[roomId] = {
      text: "", 
      lastSender: "", 
      status: {},
      clients: [], 
      joinWaiters: [],
      uniqueUsers: new Set(),
      lastHeartbeat: {},
      creator: clientId // Track who created the room
    };
  }
  
  const room = rooms[roomId];
  
  // Add user to unique users set
  room.uniqueUsers.add(clientId);
  
  // Update heartbeat
  room.lastHeartbeat[clientId] = Date.now();
  
  // Check if room is now full (more than 2 users trying to join)
  if (isRoomFull(room) && room.uniqueUsers.size > 2) {
    // Remove the user we just added since room is full
    room.uniqueUsers.delete(clientId);
    return res.status(429).json({ error: "Room is full", full: true });
  }

  // Add this client to the waiting list
  room.joinWaiters.push({ res, id: clientId });
});

app.post("/send", (req, res) => {
  const roomId = req.query.room;
  const clientId = req.query.client;
  
  const room = getOrCreateRoom(roomId);
  
  // Add user to unique users set
  room.uniqueUsers.add(clientId);
  
  // Update heartbeat timestamp
  room.lastHeartbeat[clientId] = Date.now();

  // Update text if provided
  if (req.body.text !== undefined) {
    room.text = req.body.text;
    room.lastSender = clientId;
  }

  // Update status
  if (req.body.status) {
    room.status[clientId] = req.body.status;
  }

  // If this is the first message in the room and there are join waiters, notify them
  if (room.joinWaiters.length > 0) {
    room.joinWaiters.forEach(({ res: waiterRes, id }) => {
      if (id !== clientId) {
        waiterRes.json({ joined: true });
      }
    });
    room.joinWaiters = room.joinWaiters.filter(w => w.id === clientId);
  }

  // Notify all waiting clients except the sender
  room.clients.forEach(({ res: clientRes, id }) => {
    if (id !== clientId) {
      const response = {
        text: room.text
      };
      
      // Send other user's status
      const otherClientId = Object.keys(room.status).find(k => k !== id);
      if (otherClientId && room.status[otherClientId]) {
        response.status = room.status[otherClientId];
      }
      
      clientRes.json(response);
    }
  });

  // Keep only sender's waiting res objects
  room.clients = room.clients.filter(c => c.id === clientId);

  res.sendStatus(200);
});

app.get("/recv", (req, res) => {
  const roomId = req.query.room;
  const clientId = req.query.client;
  
  const room = getOrCreateRoom(roomId);
  
  // Check if trying to join a full room
  if (!room.uniqueUsers.has(clientId) && isRoomFull(room)) {
    return res.status(429).json({ error: "Room is full", full: true });
  }
  
  // Add user to unique users set
  room.uniqueUsers.add(clientId);
  
  // Update heartbeat timestamp
  room.lastHeartbeat[clientId] = Date.now();

  // Notify join waiters that someone has joined
  if (room.joinWaiters.length > 0) {
    room.joinWaiters.forEach(({ res: waiterRes, id: waiterId }) => {
      if (waiterId !== clientId) {
        waiterRes.json({ joined: true });
      }
    });
    room.joinWaiters = [];
  }

  // If there is new text and it wasn't sent by this client, send immediately
  if (room.text && room.lastSender !== clientId) {
    const response = {
      text: room.text
    };
    
    // Send other user's status
    const otherClientId = Object.keys(room.status).find(k => k !== clientId);
    if (otherClientId && room.status[otherClientId]) {
      response.status = room.status[otherClientId];
    }
    
    res.json(response);
  } else {
    // Otherwise wait
    room.clients.push({ res, id: clientId });
  }
});

app.post("/emoji", (req, res) => {
  const roomId = req.query.room;
  const clientId = req.query.client;
  const emoji = req.body.emoji;
  
  const room = getOrCreateRoom(roomId);
  
  // Add user to unique users set
  room.uniqueUsers.add(clientId);

  // Send emoji to all other clients
  room.clients.forEach(({ res: clientRes, id }) => {
    if (id !== clientId) {
      clientRes.json({ emoji });
    }
  });

  // Remove notified clients
  room.clients = room.clients.filter(c => c.id === clientId);

  res.sendStatus(200);
});

app.post("/disconnect", (req, res) => {
  const roomId = req.query.room;
  const clientId = req.query.client;
  
  if (rooms[roomId]) {
    const room = rooms[roomId];
    
    console.log(`User ${clientId} disconnecting from room ${roomId}`);
    
    // Update status to disconnected
    room.status[clientId] = 'disconnected';
    
    // Remove user from unique users set
    room.uniqueUsers.delete(clientId);
    
    // Notify other clients about disconnection
    room.clients.forEach(({ res: clientRes, id }) => {
      if (id !== clientId) {
        clientRes.json({ 
          status: 'disconnected', 
          userLeft: true,
          remainingUsers: room.uniqueUsers.size
        });
      }
    });
    
    // Clean up client connections
    room.clients = room.clients.filter(c => c.id !== clientId);
    room.joinWaiters = room.joinWaiters.filter(w => w.id !== clientId);
    
    // If room is empty, mark it for deletion
    if (room.uniqueUsers.size === 0) {
      console.log(`Room ${roomId} is now empty, scheduling for deletion`);
      // Delete immediately if no users
      delete rooms[roomId];
    }
  }
  
  res.sendStatus(200);
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
      room.clients.forEach(({ res: clientRes, id }) => {
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
